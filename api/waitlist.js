// Vercel serverless function — POST /api/waitlist
// Stores an early-access signup in Supabase (the durable store we own) AND upserts
// the contact into Loops (the sending layer for the welcome email + nurture drip).
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL          e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (server-side only — never ship to the client)
// Optional (enables the welcome email + drip):
//   LOOPS_API_KEY         Loops.so API key (Loops → Settings → API)
//
// Supabase table (run once in the Supabase SQL editor):
//   create table waitlist (
//     id bigint generated always as identity primary key,
//     email text not null unique,
//     source text default 'landing',
//     created_at timestamptz not null default now()
//   );
//
// Data-flow contract:
//   - Supabase write is fail-LOUD: if it errors, the signup fails (we must never
//     silently drop a lead — serverless has no disk).
//   - Loops write is fail-OPEN: the lead is already safe in Supabase, so a Loops
//     hiccup (or an unset LOOPS_API_KEY) must never break the signup UX. We log and move on.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Upsert the signup into Loops so its welcome + drip automations can fire.
// Fail-open by contract: never throws to the caller.
async function addToLoops(email, source) {
  const key = process.env.LOOPS_API_KEY || "";
  if (!key) return; // Loops not configured yet — the Supabase lead still stands.
  try {
    const resp = await fetch("https://app.loops.so/api/v1/contacts/create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      // userGroup lets the Loops automation trigger on the "waitlist" segment.
      body: JSON.stringify({ email, source, userGroup: "waitlist" }),
    });
    // 409 = contact already exists → a duplicate signup, which is fine.
    if (!resp.ok && resp.status !== 409) {
      const detail = (await resp.text()).slice(0, 300);
      console.error("waitlist: loops error", resp.status, detail);
    }
  } catch (err) {
    console.error("waitlist: loops unreachable", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = String((body && body.email) || "").trim().toLowerCase();
  const source = String((body && body.source) || "landing").slice(0, 40);

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) {
    // Fail loud — serverless has no persistent disk, so a missing store would
    // silently drop signups. Better to surface it than lose leads.
    console.error("waitlist: SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
    return res.status(500).json({ error: "Waitlist storage is not configured yet." });
  }

  try {
    const resp = await fetch(`${url}/rest/v1/waitlist`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // duplicate emails are fine — silently ignore them (needs the unique constraint above)
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ email, source }),
    });

    // 2xx = stored; 409 = duplicate (treated as success)
    if (resp.ok || resp.status === 409) {
      // Lead is durably stored. Now hand off to Loops for the welcome + drip.
      // Fail-open: awaited so it completes before the function freezes, but any
      // Loops error is swallowed inside addToLoops — it can never fail the signup.
      await addToLoops(email, source);
      return res.status(200).json({ ok: true });
    }
    const detail = (await resp.text()).slice(0, 300);
    console.error("waitlist: supabase error", resp.status, detail);
    return res.status(502).json({ error: "Could not save your signup. Please try again." });
  } catch (err) {
    console.error("waitlist: supabase unreachable", err);
    return res.status(502).json({ error: "Could not save your signup. Please try again." });
  }
}
