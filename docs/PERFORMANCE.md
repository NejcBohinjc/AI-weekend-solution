# Performance

Why pages were slow on Vercel + Supabase, what changed, the measurements, and how to measure again.

## The cause

The app talks to Postgres through Supabase's transaction pooler, which does not support prepared statements (`prepare: false` in `src/db/index.ts`). With prepared statements off, the driver (postgres.js) needs **two round trips for every query that has parameters**: it first asks the server for the parameter types, then runs the query. A page's time is therefore roughly

> (number of sequential waves of queries) × 2 × (round-trip time to the database) + rendering

Before this work a page made three or four sequential waves:
1. the middleware looked the session up;
2. the layout looked the same session up again;
3. the page's own queries ran, plus the unread-notification count;
4. on some pages, a second wave of queries after the first, or more queries than the connection pool had connections.

## What changed

- **Sessions:**
  - One session lookup per request, cached for the whole request (`getCurrentSession()` in `src/lib/auth/index.ts`). It is one parameter-free statement (one round trip, not two), and it also returns the unread count and the member's departments.
  - The middleware no longer queries the database. It checks the cookie, and once every 6 hours it validates and renews the session (companion cookie `session_check`).
  - Pages, routes and actions still validate the session themselves, and `/admin/*` is guarded by an admin layout plus `requireAdmin()` on each page.
- **One wave per page:**
  - Admin pages and `[id]` detail pages start their queries in the same `Promise.all` as the session check (access is checked before anything is rendered).
  - Member hours read the selected week and 8 weeks of history in one query.
  - The dashboard's open tasks and their counts come from one query (window counts).
  - The meeting page loads recordings, and who made them, in the same wave.
- **Analytics:**
  - Hours are added up in SQL per member, week and location (`src/lib/analytics/weekly-hours.ts`, tested against the JavaScript calculation, including the October clock change), only for the weeks shown.
  - Tasks are limited to that window.
  - Time entries are never loaded into JavaScript.
- **Indexes** (migration 0013) for the common filters:
  - open tasks per assignee;
  - tasks by created and finished time;
  - time entries by period;
  - task activity;
  - pending late notices;
  - notification lists;
  - the AI run of a note;
  - the last calendar pull.
- **Background work stays in the background:**
  - Google Sheets syncs, the calendar pull, email and AI run in `after()`, in the cron job, or behind a button the user pressed.
  - The calendar import no longer rewrites the invites of meetings whose invitees did not change.
- **Connection pool:** one pool per instance, 10 connections, `prepare: false`, idle connections closed after 20 s, connect timeout 10 s.
- **`loading.tsx` skeletons** for dashboard, tasks, hours, meetings and the admin pages: the page frame appears at once. Because of them, `next/link` prefetching in the main navigation now prefetches something useful.

## Measurements

Measured locally on production builds (`next build && next start`), median of 5 requests per page. The local Postgres was used directly and through a proxy that adds a fixed delay, to stand in for the network between Vercel and Supabase. "Before" is commit `ce6cb05`, the commit before this work; "after" is this work before the merge with main. Times are wall time per page in ms.

| Page (admin) | Queries | Direct | 30 ms round trip | 100 ms round trip |
|---|---|---|---|---|
| Dashboard | 10 → 7 | 81 → 90 | 332 → 231 | 909 → 476 |
| Tasks | 8 → 7 | 78 → 63 | 264 → 181 | 683 → 466 |
| Hours | 7 → 4 | 71 → 60 | 262 → 186 | 694 → 472 |
| Meetings | 5 → 4 | 100 → 98 | 310 → 230 | 779 → 550 |
| Meeting detail | 9 → 9 | 56 → 71 | 329 → 164 | 923 → 385 |
| Analytics | 10 → 9 | 120 → 138 | 370 → 228 | 797 → 459 |
| Admin hours | 7 → 6 | 61 → 78 | 272 → 151 | 693 → 375 |
| Admin hours of one member | 7 → 4 | 50 → 63 | 366 → 144 | 896 → 362 |
| Admin meetings | 10 → 9 | 109 → 119 | 373 → 252 | 928 → 453 |
| Admin members | 5 → 4 | 68 → 68 | 265 → 152 | 690 → 355 |
| Notifications | 4 → 3 | 48 → 47 | 242 → 176 | 665 → 457 |

| Page (member) | Queries | Direct | 30 ms round trip | 100 ms round trip |
|---|---|---|---|---|
| Dashboard | 9 → 6 | 45 → 55 | 334 → 169 | 884 → 461 |
| Tasks | 7 → 6 | 49 → 57 | 254 → 173 | 676 → 455 |
| Hours | 7 → 4 | 60 → 58 | 274 → 182 | 702 → 464 |
| Meetings | 5 → 4 | 66 → 64 | 267 → 196 | 713 → 483 |
| Meeting detail | 10 → 9 | 61 → 43 | 314 → 136 | 880 → 351 |

- **With a database far away (100 ms round trip), pages take half the time or less.**
- **With the database right next door ("Direct"), time is mostly rendering:** the differences of ±10–20 ms there are noise.
- The query count includes the session lookup.

## Settings to check in Vercel and Supabase

If production pages take seconds, the round trip or cold starts are the likely cause, not the queries:
- **Same region:**
  - The Vercel functions' region (Settings → Functions → Function Region, e.g. `fra1`) must be next to the Supabase project's region (Frankfurt is `eu-central-1`).
  - Across an ocean, every round trip costs about 100 ms.
- **Pooler address:**
  - `DATABASE_URL` must be the **transaction pooler** address of the same region (`…pooler.supabase.com:6543`).
  - The direct database host is IPv6-only and not meant for serverless.
- **Fluid compute** (Vercel → Settings → Functions) on, so warm instances serve concurrent requests and cold starts are rarer.
- **Supabase free projects pause after a week without traffic:** the first request after that waits for the database to start. A paid plan does not pause.
- **Pooler size:** the pool is 10 connections per Vercel instance. Supabase's pooler limits clients per project (200 on the free plan), which is plenty for this app; raise the pooler's pool size only if the dashboard shows waiting clients.

## How to measure again

1. Locally: `npm run build && npm run start`.
2. Turn on statement logging in the local Postgres container, once:

   ```
   docker exec ai-weekend-solution-db-1 psql -U shapers -d shapers -c "alter system set log_min_duration_statement = 0"
   docker exec ai-weekend-solution-db-1 psql -U shapers -d shapers -c "alter system set log_line_prefix = '%m [%p] '"
   docker exec ai-weekend-solution-db-1 psql -U shapers -d shapers -c "select pg_reload_conf()"
   ```
3. Run `node scripts/perf/profile.mjs http://localhost:3000 my-label`. Options:
   - `ROLE=member` for member pages;
   - `DETAIL=1` to list each page's queries;
   - `PG_CONTAINER` if the container has another name.
4. To simulate a remote database, start `node scripts/perf/delay-proxy.mjs 5434 5433 50` (50 ms each way) and start the app with `DATABASE_URL` pointing at port 5434.
