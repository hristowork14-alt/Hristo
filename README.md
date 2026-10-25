# ProfileFinder

Enter a **company website** and a **job title** (e.g. `stripe.com` + `CFO`). ProfileFinder returns the **3–5 most likely LinkedIn profiles** of people holding that role, each with a name, headline, LinkedIn URL, confidence score and a one-sentence reason. It also does **bulk searches from a CSV** and keeps a **search history**.

It never visits, logs in to or scrapes linkedin.com. It finds _public_ profile URLs through a web search API (Serper.dev) and lets Claude rank them.

> **Current state: working demo.** Everything is built and verified in demo / mock mode. The real Supabase, Serper and Anthropic adapters are fully written but have not been run against the live services yet — see [What has been verified](#what-has-been-verified).

---

## Contents

1. [See the demo in 2 minutes](#1-see-the-demo-in-2-minutes)
2. [How it works](#2-how-it-works)
3. [The three run modes](#3-the-three-run-modes)
4. [What has been verified](#what-has-been-verified)
5. [Full setup guide (Supabase → keys → GitHub → Netlify)](#5-full-setup-guide)
6. [Environment variables](#6-environment-variables)
7. [How to check Row Level Security](#7-how-to-check-row-level-security)
8. [Limits and costs](#8-limits-and-costs)
9. [Troubleshooting](#9-troubleshooting)
10. [Project structure](#10-project-structure)
11. [Known limitations](#11-known-limitations)

---

## 1. See the demo in 2 minutes

The demo runs entirely in your browser with fictional companies and people. No accounts, keys or internet services are needed.

1. Install **Node.js 22** (LTS) from https://nodejs.org (choose the "LTS" installer).
2. Open a terminal in this folder and run:
   ```bash
   npm install
   npm run dev:demo
   ```
3. Open the address it prints (usually http://localhost:5173).
4. Click **Try the demo**, sign up with any email (e.g. `me@example.com`) and any 8+ character password.
5. On the search page, click one of the **demo scenarios**:

| Scenario                                   | What it shows                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `CTO` at `nimbus-labs.example`             | Company name read from the homepage (`og:site_name`), full ranking with Claude        |
| `Head of Marketing` at `quietpine.example` | Company name cleaned from the page title `Home \| Quiet Pine`                         |
| `CFO` at `northwind-freight.example`       | Homepage not reachable → name taken from the domain. Run it twice → served from cache |
| `CEO` at `flaky-ai.example`                | The "model" returns broken JSON twice → automatic fallback to the heuristic ranker    |
| `CTO` at `empty.example`                   | No profiles found → friendly empty state                                              |
| `CTO` at `search-down.example`             | Search API fails → clear error message, search recorded as failed                     |

Any other company + position works too; the fixture provider generates a consistent set of fictional people for it.

For **bulk search**, click **Load the demo sample** on the Bulk page (or upload your own CSV) and press **Start bulk search**. Refresh the page in the middle of a job and press **Resume**. In demo mode, the template and the results CSV open in a window with **Copy CSV** and **Download** buttons, because some hosted previews block downloads; the real app downloads the file directly.

To build a static copy of the demo (open `dist-demo/index.html` through any web server): `npm run build:demo`.

---

## 2. How it works

```
Browser (React)                     Netlify Function "search"                          Services
───────────────                     ─────────────────────────                          ────────
company + position  ──POST + token──▶ verify token with Supabase ───────────────────▶ Supabase Auth
                                      validate input, normalize domain & position
                                      cache hit (< 7 days)? → return it ◀──────────── search_cache table
                                      hourly limit reached? → 429
                                      ┌ pipeline (hard stop at 9 s) ──────────────────┐
                                      │ 1. fetch homepage → company name (3 s max)   │─▶ company website
                                      │    + domain query starts at the same time    │
                                      │ 2. 2–3 site:linkedin.com/in queries (4 s)    │─▶ Serper.dev
                                      │ 3. keep /in/ profile URLs, normalize, dedupe │
                                      │ 4. Claude ranks them as strict JSON (zod)    │─▶ Anthropic API
                                      │    invalid JSON → 1 retry → heuristic ranker │
                                      └──────────────────────────────────────────────┘
results  ◀──────────────────────────── save search + results to history ────────────▶ Supabase Postgres (RLS)
                                      write cache
```

Key decisions (each also commented in the code):

- **The pipeline lives in `shared/`** and runs unchanged in the Netlify Function and in the browser demo, so the demo exercises the real logic.
- **Time budget:** the domain query starts in parallel with the homepage fetch, every step gets only the time that is left, and Claude is skipped for the heuristic if there isn't enough time. Typical search: 4–6 s.
- **No invented URLs, enforced in code:** after zod validation, any URL Claude returns that wasn't in the search results is dropped.
- **Heuristic results are not cached**, so the next try can get Claude's ranking.
- **Bulk jobs run from the browser** (2 rows at a time) and write each row's outcome to the database immediately, which is what makes "Resume" work.
- **Security:** the homepage fetcher never requests linkedin.com (not even through a redirect), refuses IP addresses and caps redirects and size. Secret keys exist only in the functions. The CSV export neutralizes spreadsheet formulas.

---

## 3. The three run modes

| Mode                    | How to start                                                    | Accounts & history            | Search & ranking                         |
| ----------------------- | --------------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| **Demo**                | `npm run dev:demo` (sets `VITE_DEMO_MODE=true` via `.env.demo`) | In the browser (localStorage) | Fixture data, in the browser             |
| **Real app with mocks** | Normal setup, plus `USE_MOCKS=true` in Netlify / `.env`         | Real Supabase                 | Fixture data inside the Netlify Function |
| **Real app**            | Normal setup                                                    | Real Supabase                 | Serper + Claude                          |

`USE_MOCKS=true` swaps the search provider, the homepage fetcher and the Claude client for the fixture versions **behind the same interfaces** (`SearchProvider`, `LlmClient`, `HomepageFetcher`). It's useful when Supabase is set up but you don't have Serper/Anthropic keys yet.

---

## What has been verified

### ✅ Verified by Claude (in the build workspace, without your keys)

| Acceptance criterion                                                                                                             | How it was checked                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build` and `npm run typecheck` pass with zero errors; `npm run lint` passes                                             | Run on the final code                                                                                                                                                                                                                                                                                     |
| `npm test` passes, with unit tests for every required area                                                                       | 88 tests in 11 files: domain extraction, LinkedIn URL normalization, synonyms/queries, company name from HTML, heuristic ranker, CSV parse/validate/export, zod validation of Claude's reply, pipeline, function handler, adapters, bulk runner                                                           |
| Search returns 1–5 results with valid `https://www.linkedin.com/in/...` URLs, confidence, reasoning; repeat is served from cache | Function handler test + browser walkthrough (mock data)                                                                                                                                                                                                                                                   |
| Calling the function without a valid token returns 401; exceeding the hourly limit returns 429                                   | Handler tests, plus the **bundled** functions called directly in Node 22 (401 / 405 / 503 confirmed)                                                                                                                                                                                                      |
| History shows past searches and saved results; deleting works                                                                    | Browser walkthrough (demo)                                                                                                                                                                                                                                                                                |
| 10-row CSV: live progress, survives a bad row, resumes after a page refresh, correct results CSV                                 | Bulk runner tests + browser walkthrough (refresh mid-job → Resume → 10/10, export checked: 31 lines, empty rows kept)                                                                                                                                                                                     |
| Sign up, log in, log out, reset password, delete account                                                                         | Browser walkthrough (demo auth)                                                                                                                                                                                                                                                                           |
| SQL migration runs; RLS blocks user A from reading user B's data                                                                 | **Partially:** run on a local PostgreSQL 17 with a stand-in for Supabase's `auth` schema and roles — 22/22 checks passed (re-runnable, profile trigger, cross-user reads/writes blocked, `search_cache` hidden from browser roles, cascade on account deletion). Still needs the real Supabase run below. |
| Responsive / no horizontal scroll at phone width; dark mode                                                                      | Screenshots at 390 px and in dark mode                                                                                                                                                                                                                                                                    |
| No secret keys in the browser bundle                                                                                             | Built bundles scanned for secret names and the Anthropic SDK: none found                                                                                                                                                                                                                                  |

### ⏳ Needs your keys / a real deploy

| Acceptance criterion                                                   | How to check                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `0001_init.sql` runs in the **Supabase** SQL editor                    | [Step 2](#step-2--create-the-supabase-project-and-run-the-sql) |
| RLS on the real project                                                | [Section 7](#7-how-to-check-row-level-security)                |
| Real sign-up emails, password-reset emails, Google sign-in             | [Step 6](#step-6--test-that-it-works)                          |
| `https://stripe.com` + `CFO` returns real profiles within ~10 s        | Needs `SERPER_API_KEY` and `ANTHROPIC_API_KEY`                 |
| Push to `main` → successful Netlify deploy, live site works end-to-end | [Steps 4–6](#step-4--put-the-code-on-github)                   |

---

## 5. Full setup guide

You'll create four free accounts: **Supabase**, **Serper**, **Anthropic** and **Netlify** (plus GitHub). Follow the steps in order.

### Step 1 — Run it on your computer (optional but recommended)

1. Install Node.js 22 LTS from https://nodejs.org.
2. In this folder: `npm install`, then `npm run dev:demo` to check the demo works.

### Step 2 — Create the Supabase project and run the SQL

1. Go to https://supabase.com → **Sign in** → **New project**.
2. Pick a name (e.g. `profilefinder`), set a strong **database password** (save it in your password manager), choose the region **Central EU (Frankfurt)** (closest to Bulgaria) → **Create new project**. Wait ~2 minutes.
3. In the left sidebar click **SQL Editor** → **New query**.
4. Open `supabase/migrations/0001_init.sql` from this project in a text editor, copy **all** of it, paste it into the editor and click **Run**. You should see "Success. No rows returned".
5. Click **Table Editor**: you should see `profiles`, `bulk_jobs`, `bulk_job_rows`, `searches`, `search_results`, `search_cache`, each with a **RLS enabled** label.

**Get the keys**

6. Click **Project Settings** (gear icon) → **API Keys**.
7. Copy the **Publishable key** (starts with `sb_publishable_`) — this is `VITE_SUPABASE_PUBLISHABLE_KEY`.
8. Under **Secret keys**, create/reveal a **Secret key** (starts with `sb_secret_`) — this is `SUPABASE_SECRET_KEY`. **Never** put it anywhere starting with `VITE_` and never share it.
9. **Project Settings** → **Data API**: copy the **Project URL** (`https://xxxx.supabase.co`) — this is both `VITE_SUPABASE_URL` and `SUPABASE_URL`.

> Older Supabase projects show "anon" and "service_role" keys. Those are the legacy versions of the publishable and secret keys and are being retired by the end of 2026, so use the new ones.

**Configure sign-in links** (do this again after Step 5 once you know your Netlify address)

10. **Authentication** → **URL Configuration**.
11. **Site URL**: `http://localhost:8888` for now (later: your Netlify address, e.g. `https://profilefinder.netlify.app`).
12. **Redirect URLs** → **Add URL**, add all of these:
    - `http://localhost:8888/**`
    - `http://localhost:5173/**`
    - `https://YOUR-SITE.netlify.app/**` (after Step 5)
    - `https://*--YOUR-SITE.netlify.app/**` (preview deploys)
13. Click **Save**.

**Optional: Google sign-in** (the button is already in the app)

14. In Google Cloud Console (https://console.cloud.google.com) → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → type **Web application**.
15. Under **Authorized redirect URIs** add the callback URL shown in Supabase → **Authentication** → **Sign In / Providers** → **Google** (it looks like `https://xxxx.supabase.co/auth/v1/callback`).
16. Copy the **Client ID** and **Client secret** back into that Supabase Google provider page, switch it **on**, **Save**.

### Step 3 — Get the search and AI keys

**Serper (web search)**

1. Go to https://serper.dev → **Sign up** (2,500 free searches, no card).
2. Dashboard → copy the **API Key** → this is `SERPER_API_KEY`.

**Anthropic (Claude)**

3. Go to https://console.anthropic.com → sign up → **Settings** → **Billing**: add a small amount of credit (ranking with Haiku costs fractions of a cent per search).
4. **API Keys** → **Create Key** → copy it → this is `ANTHROPIC_API_KEY`.
5. `ANTHROPIC_MODEL` defaults to `claude-haiku-5-5` (fastest, cheapest current model). Current model IDs: https://platform.claude.com/docs/en/about-claude/models/overview

> No Anthropic key? The app still works — it ranks with the built-in heuristic.

### Step 4 — Put the code on GitHub

1. Create an account at https://github.com if you don't have one.
2. Click **+** → **New repository** → name `profilefinder` → **Private** → **Create repository**. Don't add a README (this project has one).
3. In a terminal in this folder (replace `YOUR-NAME`):
   ```bash
   git init
   git add .
   git commit -m "ProfileFinder initial version"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/profilefinder.git
   git push -u origin main
   ```
   (Alternatively use **GitHub Desktop**: File → Add local repository → Publish repository.)
4. Check on GitHub that `.env` is **not** in the list of files (it's ignored on purpose).

### Step 5 — Deploy on Netlify

1. Go to https://app.netlify.com → **Add new project** → **Import an existing project** → **GitHub** → authorize → pick `profilefinder`.
2. Netlify reads `netlify.toml`, so the build settings are already filled in (build command `npm run build`, publish directory `dist`, functions `netlify/functions`). Don't change them.
3. Before deploying, open **Add environment variables** (or after the first deploy: **Project configuration** → **Environment variables** → **Add a variable**) and add every variable from the table in [section 6](#6-environment-variables). Mark the secret ones as **Contains secret values**.
4. Click **Deploy**. Wait for "Published".
5. Copy your site address (e.g. `https://profilefinder.netlify.app`), then go back to Supabase **Authentication → URL Configuration** and set it as **Site URL** and add it to **Redirect URLs** (Step 2, items 11–12).
6. From now on, every `git push` to `main` redeploys automatically; pushes to other branches get preview deploys.

> Changed an environment variable? Netlify only picks it up on the next deploy: **Deploys** → **Trigger deploy** → **Deploy project**.

### Step 6 — Test that it works

1. Open your Netlify address → **Sign up** with a real email → open the confirmation email → you land in the app.
2. Search `https://stripe.com` + `CFO`. You should see the detected company name and 1–5 results in ~10 seconds, with "Ranked by Claude".
3. Run the same search again → "Saved result from the last 7 days" (cache).
4. **History** → your two searches are there; open one; delete one.
5. **Bulk** → download the template, upload it, let it finish, download the results CSV.
6. **Account** → log out → **Forgot your password?** → use the email link → set a new password.
7. Check RLS with a second account ([section 7](#7-how-to-check-row-level-security)).

### Local development with real services (optional)

1. Copy `.env.example` to `.env` and fill in the values.
2. Install the Netlify CLI once: `npm install -g netlify-cli`.
3. Run `netlify dev` and open http://localhost:8888 (this serves the app **and** the functions; `npm run dev` alone has no functions).

---

## 6. Environment variables

| Variable                        | Where it comes from                                      | Where to put it                   | Public / secret |
| ------------------------------- | -------------------------------------------------------- | --------------------------------- | --------------- |
| `VITE_SUPABASE_URL`             | Supabase → Project Settings → Data API → Project URL     | `.env` and Netlify                | Public          |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → Publishable key | `.env` and Netlify                | Public          |
| `SUPABASE_URL`                  | Same Project URL                                         | `.env` and Netlify                | Secret (server) |
| `SUPABASE_SECRET_KEY`           | Supabase → Project Settings → API Keys → Secret key      | `.env` and Netlify, marked secret | **Secret**      |
| `SEARCH_PROVIDER`               | `serper` (default)                                       | optional                          | Server          |
| `SERPER_API_KEY`                | serper.dev dashboard                                     | `.env` and Netlify, marked secret | **Secret**      |
| `ANTHROPIC_API_KEY`             | console.anthropic.com → API Keys                         | `.env` and Netlify, marked secret | **Secret**      |
| `ANTHROPIC_MODEL`               | `claude-haiku-5-5` (default)                             | optional                          | Server          |
| `ANTHROPIC_EFFORT`              | `low` (default), `medium`, `high` or `default`           | optional                          | Server          |
| `MAX_SEARCHES_PER_HOUR`         | `30` (default) — fresh searches per user per hour        | optional                          | Server          |
| `USE_MOCKS`                     | `false` (default). `true` = fixture search + ranking     | optional                          | Server          |
| `VITE_DEMO_MODE`                | Leave `false`. `npm run dev:demo` turns it on by itself  | —                                 | Public          |

Anything starting with `VITE_` is compiled into the browser code — that's expected for the Supabase URL and publishable key (Row Level Security protects the data). Nothing secret may ever start with `VITE_`.

---

## 7. How to check Row Level Security

**In the app (easiest)**

1. Sign up as user A in a normal browser window and run a search.
2. Sign up as user B in a private/incognito window. B's **History** must be empty.
3. As A, open a search in History and copy the address (`.../app/history/<id>`). Paste it into B's window → B sees "Search not found".

**In the Supabase SQL editor (proves it at the database level)**

1. **Authentication** → **Users**: copy the IDs of user A and user B.
2. **SQL Editor** → **New query**, paste this, replace `USER-A-ID` and `USER-B-ID`, and **Run**. It pretends to be user B for this one run only:
   ```sql
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub": "USER-B-ID", "role": "authenticated"}', true);
   select
     (select count(*) from public.searches where user_id = 'USER-A-ID') as a_searches_visible_to_b,
     (select count(*) from public.searches) as b_own_searches;
   ```
   `a_searches_visible_to_b` must be **0**; `b_own_searches` is the number of searches B ran.
3. New query, run this — it must fail with **permission denied for table search_cache** (correct: browsers can never read the shared cache):
   ```sql
   set local role authenticated;
   select count(*) from public.search_cache;
   ```
   (If the editor ever says `SET LOCAL can only be used in transaction blocks`, add `begin;` as the first line and `rollback;` as the last.)

---

## 8. Limits and costs

- **Netlify function time limit:** synchronous functions may run for 30 seconds. ProfileFinder's pipeline stops itself at 9 seconds (plus ~1 s for database work), so it stays well inside the limit; no plan upgrade is needed. If Claude is slow, the heuristic ranker answers instead of the request timing out.
- **Serper:** each fresh search uses up to 3 queries, so the 2,500 free credits cover roughly 800 searches. Paid credits are prepaid packs (from $50 for 50,000 queries). Cached searches use none.
- **Anthropic:** one short Haiku request per fresh search (a second only if the first reply isn't valid JSON).
- **Hourly limit:** 30 fresh searches per user per hour (`MAX_SEARCHES_PER_HOUR`); cached searches don't count. A 100-row bulk file will pause at the limit — press **Resume** later, or raise the limit.
- **Supabase emails:** the built-in email sender has a very low hourly limit, fine for testing. For real users, add your own SMTP provider under **Authentication → Emails → SMTP Settings**.

---

## 9. Troubleshooting

| Symptom                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Almost there" page instead of the app                     | `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are missing. Add them in Netlify and **trigger a new deploy** (Vite bakes them in at build time).                                                                                                                                                                                                                                     |
| "Your session has expired. Please log in again." (401)     | Log out and in again. If it persists: `SUPABASE_URL` / `SUPABASE_SECRET_KEY` in Netlify must belong to the **same** project as the `VITE_` values.                                                                                                                                                                                                                                          |
| "Search is not configured yet" (503)                       | A function variable is missing: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, or `SERPER_API_KEY` (unless `USE_MOCKS=true`). Check **Logs → Functions → search** in Netlify for the exact name. Redeploy after changing variables.                                                                                                                                                                 |
| "The search service was not found" / function returns HTML | The functions weren't deployed. In Netlify **Logs → Functions** you should see `search` and `delete-account`. Make sure `netlify.toml` is in the repo root. If a function still returns the app's HTML, add this **above** the existing `[[redirects]]` block in `netlify.toml`: `[[redirects]]` / `from = "/.netlify/functions/*"` / `to = "/.netlify/functions/:splat"` / `status = 200`. |
| CORS error in the browser console                          | The app and functions must be on the same address. Use the Netlify URL, or `netlify dev` locally (http://localhost:8888) — not `npm run dev` on port 5173 together with a deployed function.                                                                                                                                                                                                |
| Search times out                                           | Rare, because the pipeline stops itself at 9 s. Check Netlify function logs for slow homepage or Serper calls. Retrying usually works.                                                                                                                                                                                                                                                      |
| Always "Ranked by fallback rules"                          | Claude isn't reachable. Check function logs for `Anthropic API ...`: `401` = wrong `ANTHROPIC_API_KEY`, `404` = wrong `ANTHROPIC_MODEL`, `400` mentioning effort = set `ANTHROPIC_EFFORT=default`. Also check your Anthropic credit balance.                                                                                                                                                |
| "No matching profiles found"                               | Try a broader or more common title (`Marketing` instead of `Senior Brand Marketing Lead`), or the English title. Small companies and people with private profiles may not be in search results at all. Check the detected company name is right.                                                                                                                                            |
| Serper errors in the logs (`HTTP 401/403`)                 | Wrong `SERPER_API_KEY`. `HTTP 429` or "not enough credits": your Serper credits are used up.                                                                                                                                                                                                                                                                                                |
| Confirmation / reset email link goes to localhost or fails | Supabase **Authentication → URL Configuration**: set the Site URL to your Netlify address and add it to Redirect URLs (Step 2).                                                                                                                                                                                                                                                             |
| "You've reached the limit of 30 new searches per hour"     | Expected behaviour (429). Wait, reuse cached searches, or raise `MAX_SEARCHES_PER_HOUR` and redeploy.                                                                                                                                                                                                                                                                                       |

---

## 10. Project structure

```
├── netlify.toml                    Build, functions, SPA redirect, security headers (Node 22)
├── .env.example                    Every environment variable, with comments
├── supabase/migrations/0001_init.sql   Tables, indexes, triggers, RLS policies
├── shared/                         Pure TypeScript used by the functions AND the browser demo
│   ├── pipeline.ts                 Company → queries → search → filter/dedupe → rank, with time budget
│   ├── searchService.ts            Validation → cache → rate limit → pipeline → save → cache write
│   ├── domain.ts, linkedinUrl.ts, positionSynonyms.ts (edit this to add roles), queryBuilder.ts
│   ├── companyName.ts, heuristicRanker.ts, rankWithClaude.ts, rankingSchema.ts (zod)
│   ├── memoryStore.ts              In-memory storage (tests + demo)
│   └── mocks/                      Fixture search provider, homepage fetcher and "Claude"
├── netlify/functions/
│   ├── search.ts                   POST /.netlify/functions/search
│   ├── delete-account.ts           POST /.netlify/functions/delete-account
│   └── _lib/                       auth, supabaseAdmin, serper, searchProvider, anthropicClient,
│                                   companyResolver (safe homepage fetch), cache, rateLimit, persist, store
├── src/
│   ├── lib/backend/                One Backend interface → supabaseBackend (real) / demoBackend (in browser)
│   ├── lib/                        api.ts, supabaseClient.ts, csv.ts, bulkRunner.ts, config.ts
│   ├── pages/                      Landing, Login, Signup, ResetPassword, Search, History, Bulk, Account, Privacy
│   ├── components/                 ResultCard, ProtectedRoute, Layout, ConfidenceBadge, ui/…
│   └── types/database.ts           Supabase table types
└── tests/                          Vitest unit + integration tests
```

Scripts: `npm run dev` · `npm run dev:demo` · `npm run build` · `npm run build:demo` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run format`

---

## 11. Known limitations

- **Result quality depends on Google's index.** Small companies, very generic names and people with hidden profiles may return nothing or the wrong person. The detected company name is shown so you can spot a wrong match.
- **The heuristic fallback is cruder than Claude**: it can't always tell a deputy or a look-alike company ("Stripe Group") from the real thing; such results get lower, not zero, confidence.
- **Bulk jobs run in your browser tab.** Closing the tab pauses the job; it continues only when you press Resume.
- **The domain normalizer** knows common multi-part endings (`.co.uk`, `.com.au`, `github.io` …) but not the full public-suffix list.
- **GDPR:** the app stores names, headlines and public profile URLs of the people it finds (from public search results), plus a 7-day shared cache. Users can delete their data; the privacy page explains what is stored. If you offer this commercially, have the legal basis (legitimate interest) and the information duties toward the people found reviewed by a lawyer.
- **Netlify** is the only supported host (the functions use the Netlify Functions format).
