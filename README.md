# The Prism — Landing Page (Vercel)

Standalone marketing page. Static `index.html` + one serverless function
(`api/waitlist.js`) that stores early-access signups in Supabase. Vercel runs no build:
`index.html` is built locally and committed.

Since the web launch the page itself sends people to the app ("Start free", to
`app.theprismai.com`) and has no waitlist form. Keep `api/waitlist.js`: the rankings and
Refractions pages proxied onto this domain still post to it. `/pricing` is proxied to the
app's `/_pricing` the same way (`vercel.json`).

## The page (v6, for the web launch)
`index.html` is built by `python3 build.py` (standard library only) from:
- `src/head.html`, `src/style.css`, `src/body.html`, `src/app.js`: the page itself. Every scene
  (the hero's answer, Ask, the standing, Matches, Scout, Your club, The Monday Prism) is drawn by
  `src/app.js` from the data, and moves only when the visitor allows motion.
- `data/landing.json`: the real data those scenes draw (answers recorded from the app, players,
  matches and clubs read from it), baked from The Prism before launch.
- `fonts/`: the app's own Inter, Nunito and JetBrains Mono files (SIL Open Font License), so no
  request leaves the page for a font. `img/`: the player photos and club crests the scenes use.
- `python3 build.py --initials` builds the page with initials in place of every photo and crest.

CSS, data and script are inline, so the page is one request plus its fonts and images. The Monday
Prism box posts to `https://app.theprismai.com/api/monday/subscribe`. The previous page is kept at
`landing-v5.html` (it still uses `cards.css`, `views.css`, `views.js` and `replays.js`).

## What's here
- `index.html`: the landing page (built, see above)
- `api/waitlist.js`: `POST /api/waitlist` → Supabase
- `vercel.json`: security headers, cache policy and the proxies
- `.vercelignore`: keeps the build sources (`src/`, `data/`, `build.py`) off the site

## Deploy steps

### 1. Create the Supabase table (one time)
In your Supabase project → SQL editor, run:
```sql
create table waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  source text default 'landing',
  created_at timestamptz not null default now()
);
```
Grab `SUPABASE_URL` (Project Settings → API → Project URL) and the
`service_role` key (Project Settings → API → service_role — keep it secret).

### 2. Deploy to Vercel
From this folder:
```bash
npm i -g vercel        # if you don't have it
vercel                 # first run: links/creates the project, preview deploy
vercel --prod          # production deploy
```
(Or push this folder to a GitHub repo and "Import Project" in the Vercel dashboard.)

### 3. Set environment variables (Vercel → Project → Settings → Environment Variables)
| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | your service_role key |
Redeploy after adding them so the function picks them up.

### 4. Attach your domain
Vercel → Project → Settings → Domains → add your purchased domain and follow the DNS steps.
Then in `index.html` replace every `theprism.football` (canonical, og:url, Plausible
`data-domain`) with the real domain.

## Notes
- The form posts to a **relative** `/api/waitlist`, so it only works when the page is
  served by Vercel (same origin) — that's the case here.
- Until `SUPABASE_*` env vars are set, the endpoint returns a 500 and the form shows
  "Try again" — by design, so signups are never silently lost on serverless.
- A social share image (`og-image.png`, 1200×630) is intentionally omitted; add one and
  re-enable the `og:image` / `twitter:image` tags in `index.html` when ready.
- Editing the page: the working copy lives at `../static/landing-v3.html` (previewable via
  the FastAPI dev server). Re-copy it here (`cp ../static/landing-v3.html index.html`) and
  re-apply the head tweaks before deploying.

Waitlist email HTML lives in `emails/` — see `emails/README.md`.
