// Vercel serverless function — GET /api/wc-dispatch
//
// The "live" E2: a matchday-morning World Cup dispatch, generated from real ESPN
// data and drafted in The Prism voice. It is generate-and-approve, NOT auto-send:
//   1. Vercel Cron hits this endpoint each morning (see vercel.json → crons).
//   2. It pulls the last ~36h of finished results + the next notable fixture from
//      ESPN (the same public feed behind the in-app World Cup hub — no key needed).
//   3. It drafts the connective prose (subject, preview, intro) via Anthropic.
//   4. It renders the full email HTML, stores it in Supabase (wc_dispatch.latest),
//      and pings an approver via Slack with a preview link.
//   5. YOU review the preview and send it to the waitlist as a Loops campaign.
//      Nothing is mailed to anyone from this function.
//
// Preview:  GET /api/wc-dispatch?preview=1[&token=DISPATCH_PREVIEW_TOKEN]
//           → returns the latest stored dispatch as rendered HTML (view / copy).
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   (already set for the waitlist)
//   ANTHROPIC_API_KEY                    drafting; falls back to a static template if unset
//   CRON_SECRET                          Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`;
//                                        when set, the generate path requires it
//   SLACK_DISPATCH_WEBHOOK   (optional)  incoming-webhook URL to ping when a draft is ready
//   DISPATCH_PREVIEW_TOKEN   (optional)  gate the ?preview link with ?token=<value>
//   DISPATCH_BASE_URL        (optional)  override the preview link host (else inferred from the request)
//
// Supabase table (run once in the SQL editor — see README "Making E2 live"):
//   create table wc_dispatch (
//     slug text primary key,
//     subject text not null,
//     html text not null,
//     facts jsonb,
//     created_at timestamptz not null default now()
//   );

const WC_SLUG = "fifa.world";
const ESPN_SCOREBOARD = `https://site.api.espn.com/apis/site/v2/sports/soccer/${WC_SLUG}/scoreboard`;
const ESPN_NEWS = `https://site.api.espn.com/apis/site/v2/sports/soccer/${WC_SLUG}/news`;

// Tournament window — dispatch only runs while the World Cup is live.
const WC_START = "20260611";
const WC_END = "20260719";

const MODEL = "claude-opus-4-8";

// ---------- date helpers ----------

function ymd(date) {
  // YYYYMMDD in UTC
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}
function shiftDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function prettyDate(date) {
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function wcActive(today) {
  const t = ymd(today);
  return t >= WC_START && t <= WC_END;
}

// ---------- ESPN fetch + fact extraction ----------

async function espnScoreboard(startDate, endDate) {
  const url = `${ESPN_SCOREBOARD}?dates=${ymd(startDate)}-${ymd(endDate)}`;
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  if (!resp.ok) throw new Error(`ESPN scoreboard ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data.events) ? data.events : [];
}

function shortStatus(desc) {
  const d = (desc || "").toLowerCase();
  if (d.includes("penalt")) return "PENS";
  if (d.includes("overtime") || d.includes("extra")) return "AET";
  return "FT";
}

function parseResult(ev) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const type = (ev.status && ev.status.type) || {};
  if (!type.completed) return null; // finished games only
  const cs = comp.competitors || [];
  if (cs.length < 2) return null;
  // ESPN orders competitors [home, away] via .homeAway, but not guaranteed — sort explicitly.
  const home = cs.find((c) => c.homeAway === "home") || cs[0];
  const away = cs.find((c) => c.homeAway === "away") || cs[1];
  const nm = (c) => (c.team && (c.team.displayName || c.team.name)) || "?";
  return {
    date: ev.date,
    home: nm(home),
    homeScore: home.score,
    away: nm(away),
    awayScore: away.score,
    status: shortStatus(type.description),
    round: (ev.season && ev.season.slug) || "",
    // Knockout extras: who advanced, and the shootout score if it went to pens.
    homeWin: home.winner === true,
    awayWin: away.winner === true,
    homePens: home.shootoutScore != null ? home.shootoutScore : null,
    awayPens: away.shootoutScore != null ? away.shootoutScore : null,
  };
}

function parseFixture(ev) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const type = (ev.status && ev.status.type) || {};
  if (type.state !== "pre") return null; // scheduled only
  const cs = comp.competitors || [];
  if (cs.length < 2) return null;
  const home = cs.find((c) => c.homeAway === "home") || cs[0];
  const away = cs.find((c) => c.homeAway === "away") || cs[1];
  const nm = (c) => (c.team && (c.team.displayName || c.team.name)) || "?";
  const venue = comp.venue || {};
  return {
    date: ev.date,
    home: nm(home),
    away: nm(away),
    round: (ev.season && ev.season.slug) || "",
    venueName: venue.fullName || "",
    venueCity: (venue.address && venue.address.city) || "",
  };
}

// "round-of-16" -> "Round of 16", etc.
function prettyRound(slug) {
  const map = {
    "round-of-16": "Round of 16",
    "round-of-32": "Round of 32",
    quarterfinals: "Quarter-final",
    semifinals: "Semi-final",
    "third-place": "Third-place play-off",
    final: "Final",
  };
  if (!slug) return "";
  if (map[slug]) return map[slug];
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ISO -> "2026-07-04" in UK time — used to group a day's fixtures together.
function ukDay(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
// ISO -> "Saturday 4 Jul" (the matchday label) in UK time.
function prettyDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "short", timeZone: "Europe/London",
  });
}
// ISO -> "18:00 BST" kickoff time in UK time (the dispatch's home audience).
function prettyTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/London", timeZoneName: "short",
  });
}

async function buildFacts(today) {
  // Recent: last ~2 days (catches late-night finishes). Upcoming: next ~3 days.
  const [recent, upcoming, newsData] = await Promise.all([
    espnScoreboard(shiftDays(today, -2), today),
    espnScoreboard(today, shiftDays(today, 3)),
    fetch(ESPN_NEWS, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : { articles: [] }))
      .catch(() => ({ articles: [] })),
  ]);

  const results = recent
    .map(parseResult)
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 6);

  const upcomingParsed = upcoming
    .map(parseFixture)
    .filter(Boolean)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  // The next matchday's full slate: every scheduled game on the UK calendar day
  // of the earliest upcoming fixture (cap at 8 to stay email-sane).
  let nextFixtures = [];
  if (upcomingParsed.length) {
    const day0 = ukDay(upcomingParsed[0].date);
    nextFixtures = upcomingParsed.filter((f) => ukDay(f.date) === day0).slice(0, 8);
  }

  const stories = pickStories(newsData.articles || []);

  return {
    dateLabel: prettyDate(today),
    results,
    nextFixtures,
    // Round context, derived from real ESPN data, so the prose can't misdescribe
    // which round just happened vs which is next (e.g. R32 done, R16 today).
    resultsRound: roundsLabel(results.map((r) => r.round)),
    fixturesRound: roundsLabel(nextFixtures.map((f) => f.round)),
    stories,
    headlines: stories.map((s) => s.headline), // string list for the drafting prompt
    isMatchday: results.length > 0,
  };
}

// Turn a list of round slugs into one human label, e.g. ["round-of-32"] -> "Round of 32".
// If a day genuinely spans rounds, join them ("Round of 16 & Quarter-finals").
function roundsLabel(slugs) {
  const uniq = [...new Set((slugs || []).filter(Boolean))];
  if (!uniq.length) return "";
  return uniq.map(prettyRound).join(" & ");
}

// Pick up to 3 distinct, substantive news stories from the ESPN news feed.
// Guards against (a) video clips whose "description" just repeats the headline,
// and (b) multiple stories on the SAME subject (e.g. four England–Mexico previews)
// so the three shown span different storylines.
const STORY_STOPWORDS = new Set([
  "world", "clash", "ahead", "says", "with", "from", "that", "this", "they",
  "their", "have", "been", "will", "about", "after", "over", "into", "your",
  "when", "what", "cup", "the", "and", "for", "are",
]);
function significantWords(s) {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STORY_STOPWORDS.has(w))
  );
}
// Two headlines are "the same story" if they share >=2 significant words.
function sameSubject(aWords, bWords) {
  let shared = 0;
  for (const w of aWords) if (bWords.has(w)) shared++;
  return shared >= 2;
}
function pickStories(articles) {
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const clean = (articles || [])
    .map((a) => {
      const headline = (a.headline || "").trim();
      const description = (a.description || "").trim();
      return {
        headline,
        // Drop descriptions that just mirror the headline (video clips).
        description: description && norm(description) !== norm(headline) ? description : "",
        link: (a.links && a.links.web && a.links.web.href) || "",
      };
    })
    .filter((s) => s.headline);
  // Prefer stories with a real summary; keep clips only to backfill to 3.
  const ordered = [...clean.filter((s) => s.description), ...clean.filter((s) => !s.description)];
  const out = [];
  const taken = [];
  for (const s of ordered) {
    const words = significantWords(s.headline);
    if (taken.some((w) => sameSubject(words, w))) continue; // different storyline only
    out.push(s);
    taken.push(words);
    if (out.length === 3) break;
  }
  return out;
}

// ---------- drafting (Anthropic, raw HTTP — matches the repo's fetch-based idiom) ----------

const DRAFT_SYSTEM =
  "You are The Prism, an AI football analyst writing a short World Cup email dispatch for a waitlist " +
  "of football fans, coaches and scouts. Voice: sharp, confident, grounded, no hype, no emoji, " +
  "British English. You are given the finished results, the upcoming fixtures, and the round each " +
  "belongs to, as structured data. Accuracy matters more than colour — this goes to real inboxes.\n" +
  "FACTUAL RULES — follow strictly:\n" +
  "- Use ONLY the supplied data for anything factual: teams, rounds, dates, who won. The results are " +
  "rendered separately, so never restate a scoreline.\n" +
  "- Be exact about the tournament timeline. The results belong to 'resultsRound'; the fixtures are " +
  "'fixturesRound'. NEVER say a round has begun, opened or 'kicked off' when its fixtures are still " +
  "upcoming, and never attribute a result to the wrong round.\n" +
  "- Your training data is out of date on personnel, so DO NOT name managers or head coaches, do NOT " +
  "claim any specific player will play, is injured, suspended or in the squad, and do NOT cite " +
  "results, runs or placings from this or past tournaments unless they are in the data. Do not " +
  "invent statistics.\n" +
  "- You MAY characterise a nation's broad, enduring footballing identity and likely stylistic " +
  "contrast in general terms, and lean on the stakes of the round. Keep it durable and safe: if a " +
  "claim could be out of date, leave it out. Write only the connective prose.";

async function draftProse(facts) {
  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key) return fallbackProse(facts);

  const userPrompt =
    "Here is the World Cup data (JSON):\n\n" +
    JSON.stringify(
      {
        today: facts.dateLabel,
        resultsRound: facts.resultsRound,
        fixturesRound: facts.fixturesRound,
        results: facts.results,
        nextFixtures: facts.nextFixtures,
        headlines: facts.headlines,
      },
      null, 2
    ) +
    "\n\nWrite the connective prose for the dispatch. Rules:\n" +
    "- subject: <=60 chars, punchy; may name the biggest storyline by team, but NO scoreline.\n" +
    "- preview: <=90 chars, the email preview line.\n" +
    "- intro: a fuller opening — 3 to 4 sentences (roughly 55-80 words) that accurately sets the " +
    "scene: the '" + (facts.resultsRound || "latest") + "' results are in, and the '" +
    (facts.fixturesRound || "next fixtures") + "' is what's ahead. Be precise about which round is " +
    "done and which is still to come — do NOT say the upcoming round has already started. You may use " +
    "the storylines in 'headlines' for colour. Sharp, grounded, British English. NO scorelines, no " +
    "invented facts.\n" +
    "- next_previews: an array with EXACTLY one entry per fixture in 'nextFixtures', in the SAME " +
    "ORDER. Each entry is a 1-2 sentence preview (roughly 22-40 words) about that specific match: the " +
    "stakes of this knockout round and the broad stylistic contrast between the two nations. Name the " +
    "teams, make each distinct, keep it durable and safe per the factual rules (no managers, no named " +
    "players, no past-tournament claims). NOT a prediction of the winner or score. Return an empty " +
    "array if there are no fixtures.";

  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: DRAFT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            subject: { type: "string" },
            preview: { type: "string" },
            intro: { type: "string" },
            next_previews: { type: "array", items: { type: "string" } },
          },
          required: ["subject", "preview", "intro", "next_previews"],
          additionalProperties: false,
        },
      },
    },
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error("wc-dispatch: anthropic error", resp.status, (await resp.text()).slice(0, 300));
      return fallbackProse(facts);
    }
    const data = await resp.json();
    const text = (data.content || []).find((b) => b.type === "text");
    const parsed = JSON.parse(text.text);
    // Guard against an empty/garbled draft.
    if (!parsed.subject || !parsed.intro) return fallbackProse(facts);
    // Keep previews aligned 1:1 with the fixtures (the model may over/under-return).
    const n = (facts.nextFixtures || []).length;
    const previews = Array.isArray(parsed.next_previews) ? parsed.next_previews : [];
    parsed.next_previews = Array.from({ length: n }, (_, i) => previews[i] || "");
    return parsed;
  } catch (err) {
    console.error("wc-dispatch: anthropic unreachable", err);
    return fallbackProse(facts);
  }
}

function fallbackProse(facts) {
  const fixtures = facts.nextFixtures || [];
  const rr = facts.resultsRound || "the latest round";
  const fr = facts.fixturesRound || "the next round";
  return {
    subject: "The World Cup, read by the numbers",
    preview: "The latest results and what's next — grounded in data, not vibes.",
    intro:
      `The World Cup doesn't stop, and neither does The Prism. The ${rr} is settled, the bracket is ` +
      `taking shape, and the ${fr} is up next. Here's how the results actually looked once you strip ` +
      "out the noise, the stories worth your time, and the matches still to come.",
    next_previews: fixtures.map(
      (f) => `${f.home} against ${f.away} — a ${prettyRound(f.round || fr).toLowerCase()} knockout, win or go home.`
    ),
  };
}

// ---------- render ----------

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Hosted PNG (inline SVG doesn't render in Outlook/Gmail). Goes live with the deploy.
const PRISM_LOGO = `<img src="https://theprismai.com/prism-mark.png" width="34" height="34" alt="The Prism" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;">`;

function renderEmail(facts, prose) {
  const rows = facts.results
    .map((r) => {
      // Bold the side that advanced (only when there's a decided winner).
      const nameStyle = (win) =>
        `font-size:14px;font-weight:${win ? 700 : 500};color:${win ? "#0b0b0b" : "#26272b"};`;
      const hasPens = r.homePens != null && r.awayPens != null;
      const scoreCell = hasPens
        ? `${esc(r.homeScore)} &ndash; ${esc(r.awayScore)}<div style="font-family:'JetBrains Mono',monospace;font-weight:400;font-size:10px;color:#8a8e96;margin-top:2px;">${esc(r.homePens)}&ndash;${esc(r.awayPens)} pens</div>`
        : `${esc(r.homeScore)} &ndash; ${esc(r.awayScore)}`;
      return `
      <tr>
        <td style="padding:11px 14px;border-bottom:1px solid #f1f1f3;${nameStyle(r.homeWin)}">${esc(r.home)}</td>
        <td style="padding:11px 8px;border-bottom:1px solid #f1f1f3;font-family:'JetBrains Mono',monospace;font-weight:500;font-size:15px;color:#0b0b0b;text-align:center;white-space:nowrap;">${scoreCell}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #f1f1f3;text-align:right;${nameStyle(r.awayWin)}">${esc(r.away)}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #f1f1f3;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.06em;color:#8a8e96;text-align:right;vertical-align:top;">${esc(r.status)}</td>
      </tr>`;
    })
    .join("");

  const fixtures = facts.nextFixtures || [];
  const previews = Array.isArray(prose.next_previews) ? prose.next_previews : [];
  const dayLabel = fixtures.length ? prettyDay(fixtures[0].date) : "";
  const nextBlock = fixtures.length
    ? `
      <div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#2563EB;font-weight:500;margin:6px 0 12px;">Coming up${dayLabel ? ` &middot; ${esc(dayLabel)}` : ""}</div>
      <div style="background:#eef2fe;border:1px solid #dbe4fc;border-radius:12px;padding:2px 16px;margin:0 0 18px;">
        ${fixtures
          .map((f, i) => {
            const meta = [prettyRound(f.round), prettyTime(f.date), [f.venueName, f.venueCity].filter(Boolean).join(", ")]
              .filter(Boolean)
              .map(esc)
              .join(" &middot; ");
            const why = previews[i] || "";
            return `
        <div style="padding:14px 0;${i ? "border-top:1px solid #dbe4fc;" : ""}">
          <div style="font-size:15px;font-weight:600;color:#0b0b0b;">${esc(f.home)} v ${esc(f.away)}</div>
          ${meta ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.03em;color:#7b8497;margin-top:4px;">${meta}</div>` : ""}
          ${why ? `<div style="font-size:13px;line-height:1.55;color:#4b5563;margin-top:6px;">${esc(why)}</div>` : ""}
        </div>`;
          })
          .join("")}
      </div>`
    : "";

  const stories = facts.stories || [];
  const newsBlock = stories.length
    ? `
      <div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#2563EB;font-weight:500;margin:6px 0 12px;">Around the tournament</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
        ${stories
          .map(
            (s, i) => `
        <tr><td style="padding:${i ? "13px" : "0"} 0 13px;${i ? "border-top:1px solid #f1f1f3;" : ""}">
          <div style="font-size:15px;font-weight:600;line-height:1.35;color:#0b0b0b;margin:0 0 ${s.description ? "5px" : s.link ? "6px" : "0"};">${
            s.link
              ? `<a href="${esc(s.link)}" style="color:#0b0b0b;text-decoration:none;">${esc(s.headline)}</a>`
              : esc(s.headline)
          }</div>
          ${s.description ? `<div style="font-size:13.5px;line-height:1.55;color:#4b5563;margin:0 0 ${s.link ? "6px" : "0"};">${esc(s.description)}</div>` : ""}
          ${s.link ? `<a href="${esc(s.link)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#2563EB;text-decoration:none;">Read &rarr;</a>` : ""}
        </td></tr>`
          )
          .join("")}
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(prose.subject)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700&family=Nunito:wght@700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  body{margin:0;background:#e8e9ec;font-family:'Inter',Arial,sans-serif;color:#26272b;}
  a{color:#2563EB;}
</style></head>
<body>
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(prose.preview)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8e9ec;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e6e6e9;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:22px 24px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td style="vertical-align:middle;">${PRISM_LOGO}<span style="font-family:'Nunito',Arial,sans-serif;font-weight:800;font-size:18px;color:#0b0b0b;letter-spacing:-.02em;vertical-align:middle;margin-left:10px;">The Prism<span style="color:#2563EB;">.</span></span></td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.12em;color:#8a8e96;text-transform:uppercase;">World Cup Dispatch</td>
          </tr></table>
        </td></tr>
        <tr><td style="height:3px;background:#2563EB;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:26px 32px 8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#2563EB;font-weight:500;margin-bottom:12px;">Live &middot; ${esc(facts.dateLabel)}</div>
          <h1 style="font-family:'Syne',Arial,sans-serif;font-weight:700;font-size:26px;line-height:1.14;letter-spacing:-.02em;color:#0b0b0b;margin:0 0 16px;">${esc(prose.subject)}</h1>
          <p style="font-size:15px;line-height:1.65;color:#33353a;margin:0 0 16px;">${esc(prose.intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececee;border-radius:12px;border-collapse:separate;overflow:hidden;margin:0 0 18px;">
            ${rows}
          </table>
          ${newsBlock}
          ${nextBlock}
          <p style="font-size:15px;line-height:1.65;color:#33353a;margin:0 0 8px;">That's the kind of read The Prism builds on demand inside the World Cup 2026 hub &mdash; results, form and matchups refracted into a single picture, with the receipts underneath. No hot takes. Just what the numbers say.</p>
        </td></tr>
        <tr><td style="background:#f6f6f8;border-top:1px solid #ededf0;padding:18px 24px 20px;text-align:center;">
          <div style="font-family:'Nunito',Arial,sans-serif;font-weight:700;font-size:12px;color:#0b0b0b;margin-bottom:8px;">The Prism<span style="color:#2563EB;">.</span></div>
          <p style="margin:0 0 6px;font-size:11.5px;color:#9296a0;line-height:1.6;">You're receiving this because you requested early access at theprismai.com.</p>
          <p style="margin:0;font-size:11.5px;color:#9296a0;"><a href="{unsubscribe_link}" style="color:#6b6f76;">Unsubscribe</a> &middot; <a href="https://theprismai.com" style="color:#6b6f76;">theprismai.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ---------- storage + notify ----------

function supabase() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return url && key ? { url, key } : null;
}

async function storeLatest(subject, html, facts) {
  const sb = supabase();
  if (!sb) throw new Error("Supabase not configured");
  const resp = await fetch(`${sb.url}/rest/v1/wc_dispatch?on_conflict=slug`, {
    method: "POST",
    headers: {
      apikey: sb.key,
      Authorization: `Bearer ${sb.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ slug: "latest", subject, html, facts, created_at: new Date().toISOString() }),
  });
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`Supabase store ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

async function loadLatest() {
  const sb = supabase();
  if (!sb) return null;
  const resp = await fetch(`${sb.url}/rest/v1/wc_dispatch?slug=eq.latest&select=subject,html,created_at`, {
    headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows && rows[0] ? rows[0] : null;
}

async function notify(subject, previewUrl) {
  const hook = process.env.SLACK_DISPATCH_WEBHOOK || "";
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🏟️ *World Cup dispatch ready* — "${subject}"\nPreview & copy: ${previewUrl}\nSend it to the waitlist as a Loops campaign when you're happy.`,
      }),
    });
  } catch (err) {
    console.error("wc-dispatch: slack notify failed", err);
  }
}

// ---------- handler ----------

export default async function handler(req, res) {
  // ---- preview path: return the latest stored dispatch as HTML ----
  if (req.query && (req.query.preview === "1" || req.query.preview === "true")) {
    const gate = process.env.DISPATCH_PREVIEW_TOKEN || "";
    if (gate && req.query.token !== gate) {
      return res.status(401).send("Unauthorized");
    }
    const latest = await loadLatest();
    if (!latest) return res.status(404).send("No dispatch generated yet.");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(latest.html);
  }

  // ---- generate path (cron) ----
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date();
  if (!wcActive(today)) {
    return res.status(200).json({ skipped: true, reason: "World Cup not active" });
  }

  // Idempotent per day: if today's dispatch was already generated, return it unchanged
  // so the preview link stays stable and any zip built from it matches exactly.
  // Each generate re-drafts via the AI (fresh subject/intro), so without this the
  // preview would drift from an already-downloaded zip. Pass ?force=1 to regenerate.
  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  if (!force) {
    const existing = await loadLatest();
    if (existing && existing.created_at &&
        new Date(existing.created_at).toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) {
      return res.status(200).json({ ok: true, cached: true, subject: existing.subject });
    }
  }

  try {
    const facts = await buildFacts(today);
    if (!facts.isMatchday) {
      // Rest day — don't send an empty dispatch.
      return res.status(200).json({ skipped: true, reason: "no finished matches in window" });
    }

    const prose = await draftProse(facts);
    const html = renderEmail(facts, prose);
    await storeLatest(prose.subject, html, facts);

    const base =
      process.env.DISPATCH_BASE_URL ||
      `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const token = process.env.DISPATCH_PREVIEW_TOKEN;
    const previewUrl = `${base}/api/wc-dispatch?preview=1${token ? `&token=${token}` : ""}`;
    await notify(prose.subject, previewUrl);

    return res.status(200).json({
      ok: true,
      subject: prose.subject,
      results: facts.results.length,
      fixtures: facts.nextFixtures.length,
      previewUrl,
    });
  } catch (err) {
    console.error("wc-dispatch: generate failed", err);
    return res.status(500).json({ error: "Dispatch generation failed", detail: String(err).slice(0, 200) });
  }
}

// Exported for local testing (see scripts/preview-wc-dispatch.mjs).
export const _internals = { buildFacts, draftProse, renderEmail, fallbackProse, wcActive };
