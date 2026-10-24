# Team coordination platform (Global Shapers AI hackathon)

Hackathon 24-25 Oct 2026. **Deadline: Sunday 25.10. 14:00.** Demo at 15:00 (10 min, on sandbox data).
Team: 1-2 people. Coding with AI is expected. Full challenge text: `docs/BRIEF.md`. Read it once at the start of a session.

## What we are building

One web platform for a 20-person volunteer institute, replacing a Miro board, a manual attendance spreadsheet and untracked work hours. Three areas, each needs a **member view** and an **admin view**, plus a leader-level analytics view across all three:

1. **Tasks.** Projects with tasks. Tasks are assignable to a person. A member sees all of *their* tasks across all projects in one place and can finish, reprioritise, reschedule or hand over a task. Admin sees all projects on one board, adds a project in one step, assigns tasks, sees who finished how many tasks and when. Keep task history (the Miro problem: "when a card moves, its history is gone"). Tasks are imported read-only from a Google Sheet (see "Google Sheets task import").
2. **Hours.** Member logs hours in seconds and sees progress against their tier's weekly commitment. Admin sees who is behind this week and any member's history.
3. **Meetings** (UI name; routes `/meetings`, `/admin/meetings`; this area tracks meeting attendance). Member clocks in to a meeting in seconds and sees their history (present / remote / excused / unexcused). Admin records attendance for any meeting with minimal effort and sees everyone across all six meeting series.
4. **Analytics (admin).** Hours, meeting attendance and tasks per member, across tiers, series and time. Must be useful to a leader: who is active, who is drifting, how the organisation is doing.

## How we are judged (decide trade-offs by this)

- Usefulness 40%: would the institute use it next week as it is?
- Completeness 25%: do all three areas work for members AND admins on the sandbox data?
- Quality 20%: fast, clear, pleasant for someone who opens it twice a week.
- Rebuildability 15%: can they redeploy from the repo + one-page infra description without us?

Extras (gamification, Slack, Jarvis agent) count **only after all three areas work**. They never replace a missing area. Do not start extras early.

## Hard constraints

- Meetings live in Google Calendar. **Read only. Never create or edit events.**
- Slack: the core platform **writes nothing to Slack**. Slack posting/reading is an extra only.
- AI features only where they genuinely make a task easier. Unwelcome where they do not.
- Admin-only data (e.g. Slack activity signal) is never shown to members.
- No real people or data. The sandbox domain `sandbox.example` does not exist.
- Never commit secrets. Keep a `.env.example` with variable names only.

## Sandbox data (in `data/`, all made up)

- `roster.xlsx`: 20 members. Columns: name, email, tier, weekly_hours, admin (yes/no), series (semicolon-separated list). Tiers and weekly hours: **Core 70, Impact 10, GO! 4**. 3 members are admins.
- `attendance.xlsx`: flat, one row per member per meeting. Columns: series, date, email, name, state. States: `present`, `remote`, `excused`, `unexcused`. 258 rows. Exists for every meeting before 2026-10-24.
- `hours.xlsx`: 120 rows (20 members x 6 weeks). Columns: email, name, tier, week_start (a Monday), hours, weekly_hours. Week of 2026-10-19 is in progress (entries through Fri 2026-10-23).
- `meetings.ics`: 55 events, 2026-09-14 to 2026-11-21, six series: Summer School, Grants, Shape Talks, Shapers Tech, Shapers Voice (10 each) and Community (5, includes everyone). DTSTART is UTC (`Z`); display in **Europe/Ljubljana**. Each event DESCRIPTION is `Series: <name>\nMembers: <comma-separated emails>`, use it to match attendees to the roster. UID looks like `community-20260914@sandbox.example`.
- The brief mentions "ten project names" in the sandbox package. **They were not in our zip.** Ask in the WhatsApp group; until then seed 10 plausible placeholder project names and mark them clearly as placeholders.
- Seeding note: hours.xlsx has weekly totals only. The product needs individual hour entries, so seed each weekly total as one entry dated that week and let members add more.

## Calendar access

Import `data/meetings.ics` into a Google Calendar called "Sandbox", make it public, copy the Calendar ID, and read events with a Google API key (no OAuth needed). Cache events in the database so the app stays fast and works if the API is slow. Reading from Google is the source of truth; sync on a schedule and on demand.

## Google Sheets task import

Read-only, via the Sheets API with a service account (scope `spreadsheets.readonly`). **Never write to the tasks tab or any other tab**; the only tab the app writes is the hours tab (next section). Code: `src/lib/tasks/` (`google-sheets.ts` reads, `sheet-mapping.ts` maps, `sheet-sync.ts` upserts).

- Reads only the tab `GOOGLE_SHEET_TASKS_TAB` (default `List1`). Never import the Users tab or List4. Never read the Geslo column: we fetch row 1, then only the five mapped columns.
- Columns by header (trimmed, case/diacritic-insensitive): `task` → title, `status` → todo/in_progress/done (English + Slovenian variants; unknown → todo, reported), `nosilec` → assignee by first name, full name, email or email prefix (only on exactly one match, else unassigned with raw value kept), `tip taska` → lowercase type label, `deadline` → due date (dd.mm.yyyy, d.m. = next upcoming, yyyy-mm-dd, Sheets serials; Europe/Ljubljana).
- Row key: normalised title + occurrence number (`plakat#1`, `plakat#2`). Survives row inserts/sorting; renaming a task in the sheet creates a new task and flags the old one "no longer in sheet" (never deleted).
- Admin edits in the app lock that field (`tasks.locked_fields`); syncs never overwrite locked fields. Every create/change goes to `task_events`.
- Sync is manual (admin button on `/tasks`), report stored in `task_syncs`. No scheduled sync yet.

## Work hours (timer) and the "Ure dela" tab

Clockify-style: Start/Stop on `/hours` and the dashboard, plus manual entries. Code: `src/lib/hours/` (`time.ts` pure helpers with tests, `queries.ts`, `sheet-sync.ts`), pages in `src/app/(app)/hours/` and `src/app/(app)/admin/hours/`.

- **The database is the source of truth** (`time_entries`, `ended_at` null = timer running, one running timer per member by a partial unique index). Weeks run Monday-Sunday in Europe/Ljubljana; totals clip entries to the week.
- **The sheet is a one-way mirror.** When a timer stops (or an entry is added/changed/deleted) the entry is marked `sheet_status = pending` and `after()` runs `syncHoursSheet()`: it writes the row `oseba (full name) | dan začetka | ura začetka | dan konca | ura konca | id` to tab `GOOGLE_SHEET_HOURS_TAB` (default `Ure dela`), updating the row whose column F has the entry id or appending one, and removing the row of a deleted entry. Idempotent, one run at a time (advisory lock). Failures stay pending; admins retry on `/admin/hours`. The app never reads hours back from the sheet: corrections are made in the app.
- Writing needs scope `spreadsheets` and the service account as **Editor**. Only `sheet-sync.ts` uses that scope, and every range it builds is inside the hours tab.
- Rules: timers under 1 minute are discarded; a timer running over 12 h asks for the real end time; entries are 1 min to 24 h and may not overlap. Members add and change their own entries from this week; admins change any entry and add hours for anyone. Seed entries (`source = seed`, from `hours.xlsx`, five per week Mon-Fri) are never written to the sheet.

## Proposed stack (change in one line here if we switch)

- Next.js (App Router, TypeScript) + Tailwind
- Postgres (Neon or Supabase free tier) with Drizzle ORM and migrations
- Deploy on Vercel (public URL)
- Login: email + password, own implementation in `src/lib/auth/` (argon2id via `@node-rs/argon2`, database sessions in an httpOnly/secure/sameSite=lax cookie, failed-login rate limit in Postgres: 5 per email, 20 per IP per 15 min). Only active members sign in; admin flag read from `members` on every request. No email service: admins generate one-time setup/reset links on `/admin/members` (hashed, single-use, 7 days). Bootstrap the first admin with `npm run create-admin -- <email> "<name>"`. Middleware runs on the Node.js runtime and checks the session in the database.

## Environment variables (names only, document each in the infra page)

`DATABASE_URL`, `APP_URL` (public base URL, used in setup links), `DEMO_MODE` (`true` only for the sandbox demo: seed sets every member's password to `DEMO_PASSWORD` and `/login` shows demo-account buttons), `DEMO_PASSWORD` (min 10 chars), `GOOGLE_CALENDAR_ID`, `GOOGLE_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TASKS_TAB` (default `List1`), `GOOGLE_SHEET_HOURS_TAB` (default `Ure dela`), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM with `\n` for newlines; the sheet must be shared with the service account as Editor, because hours are written to it).
Optional (AI): `ANTHROPIC_API_KEY`. Optional (Slack extras): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`.

## Build order (finish each step before the next; commit and push after each)

1. Scaffold app, schema, migrations, seed script that loads everything in `data/`. Deploy an empty shell to a public URL early.
2. Email/password login, member management (`/admin/members`), member/admin role handling, shared layout.
3. Hours: quick log, weekly progress vs tier target, admin "behind this week" and per-member history.
4. Meetings: calendar sync, member clock-in (only for a meeting that is happening now, with a sensible window), member history, admin fast recording (default everyone present, tap the exceptions), attendance table across all series.
5. Tasks: projects, tasks with assignee/priority/due date, "my tasks" across projects, admin board, history of changes, finished-count per member.
6. Admin analytics: hours compliance by tier, attendance rate by series and member, weekly trends, a "drifting members" list (e.g. under 50% of target hours, or repeated unexcused absences), task throughput.
7. Infra page (`docs/INFRASTRUCTURE.md`, one page: services, how they connect, env var names, deploy from zero), final README, demo script.
8. Extras, in this order: gamification (streaks of weeks at target, attendance streaks, badges) > Slack reminders 3 days and 1 day before meetings > Slack activity signal (admin only) > Jarvis agent.

## Working rules

- Small steps. After each step: run it, check it in the browser, then commit.
- Keep the UI fast and plain. Mobile-friendly: members log hours and clock in from a phone.
- Prefer boring, well-known solutions. Rebuildability is scored.
- Keep the repo public and generic. Add an open-source licence (MIT) in the repo root.
- At the end we owe: public URL, public repo, one-page infra description, 10-minute demo, one paragraph (what is finished, what is not, what AI does). Keep `docs/STATUS.md` updated with exactly that as we go.
