# Shapers Hub

One place for a volunteer institute's tasks, work hours and meeting attendance, with a member view and an admin view for each.

Stack: Next.js (App Router, TypeScript) + Tailwind, Postgres with Drizzle ORM. Sandbox data lives in `data/`.

## Run locally

Requires Node 18.18+ and Docker (or any Postgres).

```bash
cp .env.example .env          # set DATABASE_URL and APP_URL (and DEMO_MODE/DEMO_PASSWORD for the sandbox demo)
docker compose up -d          # local Postgres on port 5433
npm install
npm run db:migrate            # apply migrations in drizzle/
npm run db:seed               # load sandbox data from data/ (passwords only if DEMO_MODE=true)
npm run dev                   # http://localhost:3000
```

For the local Postgres from `docker-compose.yml`:
`DATABASE_URL=postgres://shapers:shapers@localhost:5433/shapers`, and `APP_URL=http://localhost:3000`.

## Sign-in and members

- Members sign in with email and password. Only active members can sign in; the admin flag is read from the database on every request.
- There is no email service. An admin opens **Admin → Members**, adds or picks a member and clicks **Generate setup link** (or reset link), then sends the link to the member. Links work once and expire after 7 days.
- First admin on a fresh deployment: `npm run create-admin -- you@example.org "Your Name"` prints a setup link.
- Demo: with `DEMO_MODE=true`, `npm run db:seed` gives every sandbox member `DEMO_PASSWORD`, and the login page shows demo admin/member buttons. Never enable it with real data.

Security details: passwords hashed with argon2id (min 10 characters); sessions stored in Postgres (only token hashes), revoked on logout, password change and deactivation; failed sign-ins rate-limited per email (5) and per IP (20) per 15 minutes. All auth code is in `src/lib/auth/`.

## Tasks from Google Sheets

Tasks are imported read-only from a Google Sheet (tab `List1` by default). Setup:

1. In Google Cloud, enable the **Google Sheets API** and create a **service account**; create a JSON key for it.
2. Share the spreadsheet with the service account's email as **Editor** (the tasks tab is only read; work hours are written to their own tab, see below).
3. Set `GOOGLE_SHEET_ID` (from the sheet URL), `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the key's `private_key`, with `\n` for newlines). Optional: `GOOGLE_SHEET_TASKS_TAB`.
4. As an admin, open **Tasks** and click **Sync from Google Sheets**. The report lists what was created, updated, skipped and left unassigned.

Running the sync again never creates duplicates, and fields an admin changed in the app are not overwritten. Mapping tests: `npm test`.

## Work hours

Members press **Start** when they begin and **Stop** when they finish (on **Hours** or the dashboard), or add time by hand. They see their week against their tier's commitment and their recent weeks. Admins see on **Admin → Hours** who is behind this week and who is working now, and can open any member to see and correct their hours.

Every finished entry is also written to the tab `Ure dela` of the same Google Sheet (columns oseba, dan začetka, ura začetka, dan konca, ura konca, id), so the sheet must be shared with the service account as **Editor**. The app is the source of truth; make corrections in the app, not in the sheet. Set `GOOGLE_SHEET_HOURS_TAB` if the tab has another name. To make sure the app cannot change anything else, protect the other tabs (**Data → Protect sheets and ranges**) so the service account cannot edit them.

## Meetings, attendance and reminders

Meetings come from the Google Calendar (read-only). Each member sees the meetings they are invited to on **Meetings** (invitees are matched by email), checks in as present or remote from 15 minutes before the start, or sends an excuse with a reason. Whoever did neither counts as unexcused once the meeting is over. Admins import the calendar and record or correct anyone's attendance on **Admin → Meetings** (with "mark the others present" and a member × series table).

- **Calendar, pulled automatically:** set `MEETINGS_ICS_URL` to the calendar's secret iCal address. The app then pulls the calendar on its own every 15 minutes (whenever someone opens it, and from the scheduled job), and Admin → Meetings shows the last pull and a **Sync now** button. To get the address: in Google Calendar open the calendar's **Settings and sharing → Integrate calendar → Secret address in iCal format** and copy it (keep it secret: anyone with it can read the calendar). For the sandbox, first create a calendar and import `data/meetings.ics` into it (**Settings → Import & export → Import**); the app recognises the meetings it already has even though Google gives them new IDs, so attendance history stays.
- **Calendar, by hand:** without `MEETINGS_ICS_URL`, upload an .ics export (Google Calendar → Settings → Import & export → Export) on Admin → Meetings. `npm run db:seed` imports `data/meetings.ics` and `data/attendance.xlsx`.
- **Reminders by email:** 1 day and 10 minutes before by default; each member chooses on the Meetings page. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (e.g. a Google Workspace account with an app password). Without SMTP, reminders are only recorded and shown on Admin → Meetings. `MAIL_REDIRECT_TO` sends every email to one address, for demos.
- **Scheduled job:** set `CRON_SECRET` and call `GET /api/cron/reminders` with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes, for example with a free [cron-job.org](https://cron-job.org) job (Vercel Cron on the Hobby plan runs only once a day, too rarely for 10-minute reminders). Locally: `npm run reminders -- --watch`.

## Licence

MIT, see `LICENSE`.
