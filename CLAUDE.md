# Team coordination platform (Global Shapers AI hackathon)

Hackathon 24-25 Oct 2026. **Deadline: Sunday 25.10. 14:00.** Demo at 15:00 (10 min, on sandbox data).
Team: 1-2 people. Coding with AI is expected. Full challenge text: `docs/BRIEF.md`. Read it once at the start of a session.

## What we are building

One web platform for a 20-person volunteer institute, replacing a Miro board, a manual attendance spreadsheet and untracked work hours. Three areas, each needs a **member view** and an **admin view**, plus a leader-level analytics view across all three:

1. **Tasks.** Projects with tasks, synced two-way with the Google Sheet tasks tab (see "Google Sheets tasks sync"). Tasks are assignable to a person. A member sees all of *their* tasks across all projects in one place and can finish, reprioritise, reschedule or hand over a task. Admin sees all projects on one board, adds a project in one step, assigns tasks, sees who finished how many tasks and when. Keep task history (the Miro problem: "when a card moves, its history is gone"). Tasks are imported read-only from a Google Sheet (see "Google Sheets task import").
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

## Calendar access and meetings

Meetings are read from the Google Calendar's iCal (.ics) export, never written. Code: `src/lib/meetings/` (`ics.ts` parses with ical.js, `import.ts` saves, `rules.ts` attendance/reminder rules, `reminders.ts` sends; `ics.test.ts` and `rules.test.ts`), pages `src/app/(app)/meetings/` and `src/app/(app)/admin/meetings/`.

- Sources: with `MEETINGS_ICS_URL` (the calendar's "Secret address in iCal format") meetings are **pulled automatically**: pages that show meetings (`/meetings`, `/meetings/[id]`, `/dashboard`, `/admin/meetings`) call `syncCalendarInBackground()` (`auto-sync.ts`), which after the response pulls the calendar when the last attempt is older than 15 minutes (`CALENDAR_SYNC_MINUTES`; failed attempts count too, so a broken address is not hammered); the scheduled job does the same; admins have "Sync now". No scheduler is needed for this. Without the URL, admins upload an .ics file (Google Calendar → Settings → Import & export → Export). The seed imports `data/meetings.ics`. Cached in `meetings` so the app is fast; Google stays the source of truth.
- Description: `meetings.description` holds the event's DESCRIPTION for people (`displayDescription()` in `ics.ts`: iCal escapes undone, line breaks kept, HTML stripped to text, links keep their address, the machine lines `Series:`/`Members:` removed; null if nothing is left). Updated on every re-import when it changed. Shown on the meeting page and as a collapsible line in the list via `LinkifiedText` (plain text, URLs as links with `target=_blank rel=noopener noreferrer`, never raw HTML).
- A meeting whose UID is new but whose title and start match an existing meeting not in the import is the same meeting (Google gives events new UIDs when an .ics is imported into it): its UID is updated and its attendance kept (`relinked` in the report).
- Parsing: UID (recurring occurrences `UID#<start UTC>`, expanded from 6 months back to 1 year ahead), TZID/VTIMEZONE (unknown zones read as Europe/Ljubljana), EXDATE, moved occurrences, STATUS:CANCELLED. Series = `Series:` line in DESCRIPTION, else CATEGORIES, else title. Invitees = `Members:` line in DESCRIPTION plus ATTENDEE emails, matched to members by email (unknown emails reported).
- Re-import is idempotent (matched by UID; invites replaced; attendance untouched; a moved meeting gets its reminders again). A whole-calendar import (URL, or file with the box ticked) marks future meetings missing from it `removed` (hidden, kept).
- Attendance (`attendance`): `present` / `remote` by the member during check-in (15 min before start to 15 min after end); `excused` with a reason until 24 h after the end; no record once check-in has closed = **unexcused** (derived, not stored). Admins set any state any time, "mark the others present", and their record locks it for the member. `attendance.xlsx` is seeded (`source = seed`).
- Reminders: by email, default 1 day and 10 minutes before; each member picks from 1 week, 3 days, 1 day, 3 h, 1 h, 30 min, 10 min, or turns them off (`reminder_settings`). The scheduled job `GET /api/cron/reminders` (header `Authorization: Bearer CRON_SECRET`, every 5 min from any scheduler) sends what is due; `meeting_reminders` makes it idempotent; no reminder after the start or for an excused meeting. Locally: `npm run reminders -- --watch`.
- Email: SMTP via nodemailer (`src/lib/email.ts`). Without `SMTP_HOST` nothing is sent, emails are only recorded in `email_log` (shown on `/admin/meetings`). `MAIL_REDIRECT_TO` sends every email to one address (demo/testing). Sandbox addresses do not exist, so never send to them for real.

## Google Sheets tasks sync (two-way)

Via the Sheets API with a service account (scope `spreadsheets`, account shared as **Editor**). Code: `src/lib/google/sheets.ts` (client, one `SheetTab` per tab, exact Google errors, `fake-sheets.ts` for tests), `src/lib/tasks/` (`sheet-mapping.ts` maps, `sheet-sync.ts` syncs, tests in `sheet-sync.test.ts`).

- **Scope:** only the tab `GOOGLE_SHEET_TASKS_TAB` (default `List1`) is opened. Never the Users tab or List4. Never read or write the Geslo column: we read row 1 (header names) and then only our six columns, and write only those cells.
- Columns by header (trimmed, case/diacritic-insensitive): `task` → title, `status` → todo/in_progress/verification/done (English + Slovenian variants; unknown → todo, reported; written as "to do"/"in progress"/"verifikacija"/"done"), `nosilec` → assignee by first name, full name, email or email prefix (only on exactly one match; written in the style the sheet already uses), `tip taska` → type (one of `TASK_TYPES` in `src/lib/tasks/constants.ts` if it matches ignoring case, else kept as typed; the app's form offers only `TASK_TYPES`, a task keeps a sheet-only type when edited), `deadline` → due date (dd.mm.yyyy, d.m. = next upcoming, yyyy-mm-dd, Sheets serials; Europe/Ljubljana; written as dd.mm.yyyy), `id` → the task key.
- **Identity:** column `id` (added after the last header if missing) holds the task's `sheet_key` (`t-` + 10 hex). Sorting or re-running never duplicates. Rows without a key are matched once by the legacy key (normalised title + occurrence, `tasks.source_key`), else created, and get a key written. Keys are saved in the DB before the sheet is written. A copied row with a repeated key becomes a new task. A deleted row flags the task "no longer in sheet" (never deleted, never re-added).
- **Conflict rule:** per-field three-way merge against `tasks.sheet_snapshot` (what the sheet held after the last sync). Sheet-only change → app takes it; app-only change → written to the sheet; both changed → **the app wins** (the sheet has no edit times), the overwritten sheet value goes to `task_events` (kind `conflict`) and the admin report. An unreadable deadline never wipes an existing due date.
- **When:** in the background via `after()` on login and on the tasks pages if the last sync finished over 60 s ago, and right after any task edit. A lease in `sync_state` (name `tasks_sheet`) guarantees one sync at a time across instances. "Sync now" is for every member, and so is the reason a sync failed (a task not yet in the sheet says so, with the error); the detailed report (`task_syncs`: raw values, skipped rows) is admin-only.
- **Permissions:** any member creates tasks (on `/tasks` or the dashboard) (assignee defaults to themselves) and edits/hands over/finishes tasks assigned to them or created by them; admins edit all. Every change goes to `task_events`.
- Check the connection for real: `npm run sheets:check` (add `-- --hours-entry <id>` to send one finished time entry and confirm its row).

## Work hours (timer) and the "Ure dela" tab

Clockify-style: Start/Stop on `/hours` and the dashboard, plus manual entries. Code: `src/lib/hours/` (`time.ts` pure helpers with tests, `queries.ts`, `sheet-sync.ts`), pages in `src/app/(app)/hours/` and `src/app/(app)/admin/hours/`.

- **The database is the source of truth** (`time_entries`, `ended_at` null = timer running, one running timer per member by a partial unique index). Weeks run Monday-Sunday in Europe/Ljubljana; totals clip entries to the week.
- **The sheet is a one-way mirror.** When a timer stops (or an entry is added/changed/deleted) the entry is marked `sheet_status = pending` and `after()` runs `syncHoursSheet()`: it writes the row `oseba (full name) | dan začetka | ura začetka | dan konca | ura konca | id` to tab `GOOGLE_SHEET_HOURS_TAB` (default `Ure dela`), updating the row whose column F has the entry id or appending one, and removing the row of a deleted entry. Idempotent, one run at a time (advisory lock). Failures stay pending; admins retry on `/admin/hours`. The app never reads hours back from the sheet: corrections are made in the app.
- Writing needs the service account as **Editor**. `sheet-sync.ts` only opens the hours tab; it creates the tab with its header if it is missing. Failures are stored (`time_entries.sheet_error`, `sync_state` row `hours_sheet`): members see "not synced to the sheet" on the entry, admins see the exact last error and a retry button on `/admin/hours`. The Stop path is in `src/lib/hours/timer.ts` (tested in `stop-and-sheet.test.ts`).
- Rules: timers under 1 minute are discarded; a timer running over 12 h asks for the real end time; entries are 1 min to 24 h and may not overlap. Members add and change their own entries from this week; admins change any entry and add hours for anyone. Seed entries (`source = seed`, from `hours.xlsx`, five per week Mon-Fri) are never written to the sheet.

## Proposed stack (change in one line here if we switch)

- Next.js (App Router, TypeScript) + Tailwind
- Postgres (Neon or Supabase free tier) with Drizzle ORM and migrations
- Deploy on Vercel (public URL). Production deploys apply the migrations in `drizzle/` before building (`vercel-build` → `scripts/deploy-migrate.mjs`; preview deploys skip it); a failing migration fails the deploy and the previous one stays live. Never edit an applied migration; add a new one with `npm run db:generate`.
- Login: email + password, own implementation in `src/lib/auth/` (argon2id via `@node-rs/argon2`, database sessions in an httpOnly/secure/sameSite=lax cookie, failed-login rate limit in Postgres: 5 per email, 20 per IP per 15 min). Only active members sign in; admin flag read from `members` on every request. Login does not use email (email is only for meeting reminders): admins generate one-time setup/reset links on `/admin/members` (hashed, single-use, 7 days). Bootstrap the first admin with `npm run create-admin -- <email> "<name>"`. Middleware runs on the Node.js runtime and checks the session in the database.

## Environment variables (names only, document each in the infra page)

`DATABASE_URL`, `DATABASE_MIGRATION_URL` (optional; used by deploy migrations instead of a transaction-pooler `DATABASE_URL`), `APP_URL` (public base URL, used in setup links), `DEMO_MODE` (`true` only for the sandbox demo: seed sets every member's password to `DEMO_PASSWORD` and `/login` shows demo-account buttons), `DEMO_PASSWORD` (min 10 chars), `MEETINGS_ICS_URL` (the calendar's secret iCal address; meetings are pulled automatically every 15 min), `CRON_SECRET` (protects `/api/cron/reminders`), `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_REDIRECT_TO` (optional), `GOOGLE_CALENDAR_ID`, `GOOGLE_API_KEY` (both unused since meetings come from the iCal export), `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TASKS_TAB` (default `List1`), `GOOGLE_SHEET_HOURS_TAB` (default `Ure dela`), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM with `\n` for newlines; the sheet must be shared with the service account as Editor, because hours are written to it).
Optional (AI): `ANTHROPIC_API_KEY` (turns on "Create tasks from notes"; server-side only), `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Optional (Slack extras): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`.

## Build order (finish each step before the next; commit and push after each)

1. Scaffold app, schema, migrations, seed script that loads everything in `data/`. Deploy an empty shell to a public URL early.
2. Email/password login, member management (`/admin/members`), member/admin role handling, shared layout.
3. Hours: quick log, weekly progress vs tier target, admin "behind this week" and per-member history.
4. Meetings: calendar sync, member clock-in (only for a meeting that is happening now, with a sensible window), member history, admin fast recording (default everyone present, tap the exceptions), attendance table across all series.
5. Tasks: projects, tasks with assignee/priority/due date, "my tasks" across projects, admin board, history of changes, finished-count per member.
6. Admin analytics: hours compliance by tier, attendance rate by series and member, weekly trends, a "drifting members" list (e.g. under 50% of target hours, or repeated unexcused absences), task throughput.
7. Infra page (`docs/INFRASTRUCTURE.md`, one page: services, how they connect, env var names, deploy from zero), final README, demo script.
8. Extras, in this order: gamification (streaks of weeks at target, attendance streaks, badges) > Slack reminders 3 days and 1 day before meetings > Slack activity signal (admin only) > Jarvis agent.

## Meeting notes → AI tasks

- Meeting invitees and admins add notes on the meeting page (paste, or a .txt/.md/.vtt/.srt file; max 100,000 characters; subtitle timestamps stripped). Stored in `meeting_notes`, readable only by that meeting's invitees and admins.
- "Create tasks from notes" (`src/lib/ai/meeting-tasks.ts` + `meeting-tasks-run.ts`): Anthropic API server-side only, model `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), structured outputs (`output_config.format`, zod) with server-side refusal fallbacks. The prompt gives the meeting's invitees (name + email) and date; notes are fenced in `<meeting_notes>` and treated as untrusted data. Every item is re-validated: assignee matched to an invitee by email/name (unknown → unassigned, never an id from the model), due date valid and near the meeting, type from `TASK_TYPES`, invalid items dropped. Hidden (with an admin note) when `ANTHROPIC_API_KEY` is missing.
- Idempotent: identical notes reuse the stored items of the earlier run (`ai_task_runs`, no second API call); every created item is recorded per meeting by normalised title + assignee (`ai_task_items`), so reruns never duplicate and a deleted AI task is never recreated. Rate limit: 5 API runs per member per hour.
- AI tasks: `created_by_ai`, `source_meeting_id`, `source_quote`, `ai_model`, `triggered_by_id` (created_by_id stays null), `ai_confirmed_at`. Badge "AI" / "AI, confirmed" everywhere; the assignee reviews (Confirm / edit / reassign / Delete). Deletion is soft (`deleted_at`); the sheet sync removes the row. Unconfirmed AI tasks are not counted in a member's numbers. They sync to the sheet like any task; the sheet carries no AI marker.

## Admin analytics (`/admin/analytics`)

- Data: `src/lib/analytics/load.ts` (rows, server-only) + `compute.ts` (pure, tested in `compute.test.ts`). No API endpoint: the admin-only page computes everything on the server; middleware returns 403 to members.
- Same rules as the rest of the app: `weekPace()` for on track (pro-rated), `effectiveState()` (unanswered past meeting = unexcused) and `attendanceSummary()` for rates. Unconfirmed AI tasks and deleted tasks are never counted.
- Filters (URL): tier, meeting series, range (4 weeks / 8 weeks / all, max 26). Drifting = under 50% of target in 2+ of the last 4 full weeks, or 2+ unexcused in the last 6 meetings.
- Charts are plain SVG (`src/components/charts.tsx`), colours from `--viz-*` tokens validated for colour-blind safety in both themes; every chart has a title, a text summary, a tooltip on hover/focus and a table view.

## Theme (light / dark)

- All colours are design tokens (CSS variables) in `src/app/globals.css`, light values on `:root`, dark on `[data-theme="dark"]`, exposed to Tailwind via `@theme inline` (`bg-surface`, `text-muted`, `border-line`, `bg-success-bg text-success`, ...). Never use raw palette classes (`bg-white`, `text-slate-600`, `bg-red-50`); add a token instead. Every text/background token pair passes WCAG AA (4.5:1) in both themes.
- Choice System (default) / Light / Dark: `ThemeSwitch` in the header and on the login page, stored in the `theme` cookie. The root layout renders `data-theme` for an explicit choice; `THEME_SCRIPT` (`src/lib/theme.ts`, inline in `<head>`) resolves "system" from `prefers-color-scheme` before first paint and follows it live. `color-scheme` is set in CSS and the viewport meta so native controls match. Tailwind 4 `dark:` variant: `@custom-variant dark` on `[data-theme=dark]`.

## Working rules

- Small steps. After each step: run it, check it in the browser, then commit.
- Keep the UI fast and plain. Mobile-friendly: members log hours and clock in from a phone.
- Prefer boring, well-known solutions. Rebuildability is scored.
- Keep the repo public and generic. Add an open-source licence (MIT) in the repo root.
- At the end we owe: public URL, public repo, one-page infra description, 10-minute demo, one paragraph (what is finished, what is not, what AI does). Keep `docs/STATUS.md` updated with exactly that as we go.
