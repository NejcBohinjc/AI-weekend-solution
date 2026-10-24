# Team coordination platform (Global Shapers AI hackathon)

Hackathon 24-25 Oct 2026. **Deadline: Sunday 25.10. 14:00.** Demo at 15:00 (10 min, on sandbox data).
Team: 1-2 people. Coding with AI is expected. Full challenge text: `docs/BRIEF.md`. Read it once at the start of a session.

## What we are building

One web platform for a 20-person volunteer institute, replacing a Miro board, a manual attendance spreadsheet and untracked work hours. Three areas, each needs a **member view** and an **admin view**, plus a leader-level analytics view across all three:

1. **Tasks.** Projects with tasks. Tasks are assignable to a person. A member sees all of *their* tasks across all projects in one place and can finish, reprioritise, reschedule or hand over a task. Admin sees all projects on one board, adds a project in one step, assigns tasks, sees who finished how many tasks and when. Keep task history (the Miro problem: "when a card moves, its history is gone").
2. **Hours.** Member logs hours in seconds and sees progress against their tier's weekly commitment. Admin sees who is behind this week and any member's history.
3. **Attendance.** Member clocks in to a meeting in seconds and sees their history (present / remote / excused / unexcused). Admin records attendance for any meeting with minimal effort and sees everyone across all six meeting series.
4. **Analytics (admin).** Hours, attendance and tasks per member, across tiers, series and time. Must be useful to a leader: who is active, who is drifting, how the organisation is doing.

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

## Proposed stack (change in one line here if we switch)

- Next.js (App Router, TypeScript) + Tailwind
- Postgres (Neon or Supabase free tier) with Drizzle ORM and migrations
- Deploy on Vercel (public URL)
- Login: for the hackathon, pick-your-name-from-roster with a signed cookie; admin flag from the roster. Note the upgrade path (Google sign-in) in the infra page.

## Environment variables (names only, document each in the infra page)

`DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CALENDAR_ID`, `GOOGLE_API_KEY`.
Optional (AI): `ANTHROPIC_API_KEY`. Optional (Slack extras): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`.

## Build order (finish each step before the next; commit and push after each)

1. Scaffold app, schema, migrations, seed script that loads everything in `data/`. Deploy an empty shell to a public URL early.
2. Pick-a-member login, member/admin role handling, shared layout.
3. Hours: quick log, weekly progress vs tier target, admin "behind this week" and per-member history.
4. Attendance: calendar sync, member clock-in (only for a meeting that is happening now, with a sensible window), member history, admin fast recording (default everyone present, tap the exceptions), attendance table across all series.
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
