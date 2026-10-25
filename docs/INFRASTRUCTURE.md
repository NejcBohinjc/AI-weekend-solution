# Infrastructure

One page: what runs where, how the pieces connect, every environment variable, and how to deploy
from zero. Nothing here needs us.

## Services

| Service | What it does | Required? |
| --- | --- | --- |
| **Vercel** | Hosts the Next.js app (App Router, server components, server actions) and runs the scheduled job. | Yes |
| **Supabase Postgres** | The database, and the source of truth for everything the app owns. Reached through the transaction pooler. | Yes |
| **Google Calendar** | Meeting source, read-only, via the calendar's secret iCal address. We never create or edit events. | Yes (else upload .ics by hand) |
| **Google Sheets** | Tasks sync two-way with the `List1` tab; finished work hours are mirrored one-way to the `Ure dela` tab. Via a service account. | Optional |
| **SMTP** (any provider) | Meeting reminders and task deadline reminders. Without it, emails are only recorded in `email_log`. | Optional |
| **Anthropic** | Meeting notes → tasks, "Ask about a meeting", meeting summaries. Server-side only. | Optional |
| **Groq** (or any OpenAI-compatible speech-to-text) | Transcribes meeting recordings. | Optional |
| **Supabase Storage** | Private bucket `meeting-recordings` for the in-browser meeting recorder. | Optional |
| **Slack** | Meeting announcements 3 days and 1 day before. Extra; the core platform writes nothing to Slack. | Optional |

Every "Optional" service degrades cleanly: the feature hides itself or records what it would have
done, and the rest of the platform keeps working.

## How they connect

```
                  ┌──────────────────────────────────────────┐
  Browser  ───────▶  Vercel: Next.js app                      │
                  │  - pages, server actions                  │
                  │  - /api/cron/reminders (scheduled)        │
                  └───┬───────────┬──────────┬────────────┬───┘
                      │           │          │            │
            Postgres  │   Google  │   SMTP   │  Anthropic │  Slack
          (Supabase,  │  Calendar │  (email  │  (AI) +    │  (chat.
           pooler)    │  iCal URL │ reminders)│  Groq (STT)│ scheduleMessage)
                      │  + Sheets │          │            │
                      ▼           ▼          ▼            ▼
                  source of   read-only   outbound    server-side
                    truth     meetings      only         only
                                            ▲
  Browser ──── PUT/GET signed URLs ────▶ Supabase Storage (recordings)
```

Notes that matter when rebuilding:

- **Audio never passes through our functions.** The browser uploads MP3 parts straight to Supabase
  Storage with a signed URL, and plays them back the same way.
- **Slow work never blocks a page.** Calendar pulls, Sheets syncs, email and AI calls run in
  `after()` or in the cron job. Pages render the last known state.
- **The database is reached through the transaction pooler**, so statements are not prepared
  (`prepare: false`). Set `DATABASE_MIGRATION_URL` to a session-pooler/direct connection so
  migrations can run.

## Environment variables

Names only; `.env.example` carries the same list with a comment each.

**Required**

- `DATABASE_URL` — Postgres connection string (Supabase transaction pooler, port 6543).
- `APP_URL` — public base URL, no trailing slash. Used to build password setup links.

**Database / deploy**

- `DATABASE_MIGRATION_URL` — optional; used by deploy migrations when `DATABASE_URL` is a
  transaction pooler. Use the session pooler or a direct connection.
- `TEST_DATABASE_URL` — optional; database for `npm test`. Defaults to the local server with
  `_test` added to the name.

**Demo**

- `DEMO_MODE` — `true` only for the sandbox demo: the seed gives every member `DEMO_PASSWORD` and
  `/login` shows demo-account buttons.
- `DEMO_PASSWORD` — shared password for seeded demo members, minimum 10 characters.

**Meetings and reminders**

- `MEETINGS_ICS_URL` — the Google Calendar "Secret address in iCal format". Set it and meetings are
  pulled automatically every 15 minutes; without it, admins upload an .ics export.
- `CRON_SECRET` — the scheduler sends it as `Authorization: Bearer <CRON_SECRET>` to
  `/api/cron/reminders`.
- `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS default, or 465 TLS), `SMTP_USER`, `SMTP_PASS`
- `SMTP_TIMEOUT_MS` — optional, milliseconds per SMTP step (default 10000).
- `MAIL_FROM` — sender, e.g. `Shapers Hub <hub@example.org>`.
- `MAIL_REDIRECT_TO` — optional; sends every email to one address (demo, testing). **The sandbox
  addresses do not exist, so set this before sending anything for real.**
- `GOOGLE_CALENDAR_ID`, `GOOGLE_API_KEY` — unused; kept for an API-based calendar sync.

**Google Sheets**

- `GOOGLE_SHEET_ID` — the sheet, shared with the service account as **Editor** (hours are written).
- `GOOGLE_SHEET_TASKS_TAB` — default `List1`. Only this tab is ever opened.
- `GOOGLE_SHEET_HOURS_TAB` — default `Ure dela`. Created with its header if missing.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — PEM on one line with `\n` for newlines, in double quotes.

**AI (optional)**

- `ANTHROPIC_API_KEY` — turns on notes → tasks, "Ask about a meeting", summaries.
- `ANTHROPIC_MODEL` — default `claude-sonnet-5-5`.

**Meeting recorder (optional)**

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — server-only; private bucket `meeting-recordings`.
- `TRANSCRIBE_API_KEY`, `TRANSCRIBE_BASE_URL` (default `https://api.groq.com/openai/v1`),
  `TRANSCRIBE_MODEL` (default `whisper-large-v3`).
- `OPENAI_API_KEY` — fallback if `TRANSCRIBE_API_KEY` is empty (OpenAI's address, `whisper-1`).
- `RECORDINGS_S3_ENDPOINT`, `RECORDINGS_S3_REGION`, `RECORDINGS_S3_BUCKET`,
  `RECORDINGS_S3_ACCESS_KEY_ID`, `RECORDINGS_S3_SECRET_ACCESS_KEY` — only to keep playing
  recordings made with the first recorder. Not needed for a fresh deploy.

**Slack (optional extra)**

- `SLACK_BOT_TOKEN` — bot scopes `chat:write`, `channels:read`, `channels:join`, `users:read`,
  `users:read.email`. **Set it in one environment per workspace**, or two deployments would each
  announce every meeting.
- `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` — unused so far.

## Deploy from zero

1. **Database.** Create a Supabase project. Copy the **transaction pooler** string (port 6543) into
   `DATABASE_URL`, and the **session pooler / direct** string into `DATABASE_MIGRATION_URL`.
2. **Repository.** Fork or clone the repo and import it into Vercel. Framework preset: Next.js.
   The build command is `npm run vercel-build`, which applies the migrations in `drizzle/` and then
   builds. A failing migration fails the deploy and the previous one stays live.
3. **Environment variables.** Set at least `DATABASE_URL` and `APP_URL` in Vercel. Add the optional
   groups above for the features you want. Redeploy.
4. **Calendar.** In Google Calendar → Settings → *Integrate calendar*, copy "Secret address in iCal
   format" into `MEETINGS_ICS_URL`. Meetings then pull themselves every 15 minutes. (Or skip it and
   upload an .ics export on `/admin/meetings`.)
5. **Google Sheets** (optional). Create a service account in Google Cloud, enable the Sheets API,
   download the JSON key, and share the sheet with the service-account address as **Editor**. Fill
   `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
   Check it with `npm run sheets:check`.
6. **Seed the sandbox.** `npm run db:seed` loads everything in `data/` (roster, attendance, hours,
   meetings.ics) and the team's projects. With `DEMO_MODE=true` every member gets `DEMO_PASSWORD`.
7. **First admin.** `npm run create-admin -- <email> "<name>"`, then sign in and generate setup
   links for everyone else on `/admin/members`.
8. **Scheduler** (optional, for reminders). Point any scheduler at
   `GET /api/cron/reminders` every 5 minutes with the header
   `Authorization: Bearer <CRON_SECRET>`. Vercel Cron, GitHub Actions or cron-job.org all work.
   Locally: `npm run reminders -- --watch`.
9. **Recorder** (optional). Create a **private** Supabase Storage bucket called
   `meeting-recordings`; set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Add
   `TRANSCRIBE_API_KEY` for transcripts.
10. **Slack** (optional). Create a Slack app with the scopes above, install it, put the bot token in
    `SLACK_BOT_TOKEN`, then pick a channel per series on `/admin/slack`.

## Local development

```bash
docker compose up -d      # Postgres on port 5433
npm install
npm run db:migrate
npm run db:seed
npm run dev               # http://localhost:3000
```

`npm test` runs against a separate `*_test` database (created next to the local one, or
`TEST_DATABASE_URL`) with Google, email and calendar blanked. Never point tests or a local app at
the production database or the production Google Sheet — use a copy of the sheet locally.

## Migrations

Generated with `npm run db:generate` into `drizzle/`, applied by `npm run db:migrate` locally and by
`scripts/deploy-migrate.mjs` on production deploys. Never edit a migration that has been applied;
add a new one.
