# The Prism — Landing Page (Vercel)

Standalone marketing/waitlist page. Static `index.html` + one serverless function
(`api/waitlist.js`) that stores early-access signups in Supabase. No build step.

## What's here
- `index.html` — the full landing page (self-contained: inline CSS/JS, fonts via CDN)
- `api/waitlist.js` — `POST /api/waitlist` → Supabase
- `vercel.json` — security headers + cache policy

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
