# Demo script (10 minutes)

Sunday 25 Oct 2026, 15:00. Sandbox data only — `sandbox.example` is not a real domain, so no email
leaves the app and no Slack message is posted unless a token is set.

**Live:** https://ai-weekend-solution-six.vercel.app · **Repo:** https://github.com/NejcBohinjc/AI-weekend-solution

## Before you start (do this at 14:45)

- Open the live URL and **sign in once as Ana Kovač (admin)**, then sign out. The first request after a
  deploy is slow; this warms it.
- Open a second browser profile (or private window) signed in as **Aljaž Hribar (member)**, so you can
  switch between the member and admin view without logging in and out on stage.
- Pick the theme you want (header switch). Light reads better on a projector.
- Browser zoom ~110%, window not maximised on an ultrawide — the layout is built mobile-first and looks
  best narrower.
- Have `docs/INFRASTRUCTURE.md` open in a tab for the last minute.

### One thing that will NOT work live

**Member check-in is closed at demo time.** Check-in opens 15 minutes before a meeting starts and the
next meeting is Monday 26 Oct. Do not try to clock in as a member — it will correctly refuse.

Show attendance instead through either:
- the **admin** path: Admin → Meetings → open a past meeting → *mark the others present* (admins may set
  any state at any time), or
- the **member excuse** path, which is open until 24 h after a meeting ends.

## Running order

| Time | What | Where |
|---|---|---|
| 0:00 | **The problem.** A Miro board that loses a card's history, a manual attendance spreadsheet, untracked hours. One place instead of three. | — |
| 0:30 | **Sign in.** Demo buttons fill the form. Sign in as the member. | `/login` |
| 1:00 | **Dashboard.** This week's hours against the tier target, open tasks, next meetings — the twice-a-week view. | `/dashboard` |
| 1:45 | **Tasks (member).** My tasks across projects, sorted by priority. Tick one done → **Undo toast** (done is reversible). Note the "Synced N s ago" — the Google Sheet is two-way. | `/tasks` |
| 3:00 | **Hours (member).** Press **Start**, pick office/home, press **Stop**. Weekly ring vs the tier commitment, day bars with the even-pace line. | `/hours` |
| 4:15 | **Meetings (member).** Open a past meeting: recording, transcript, **AI summary** (3–6 bullets) in one page. | `/meetings` |
| 5:15 | **AI → tasks.** On the meeting page, *Create tasks from notes*. Each task shows the **quote** it came from and is marked **AI**, waiting for its assignee. | meeting page |
| 6:15 | **Switch to the admin window.** Admin → Meetings: record attendance for a past meeting with *mark the others present*; show a pending **late notice** (the 72-hour rule). | `/admin/meetings` |
| 7:15 | **Admin → Settings.** Turn off confirming of AI tasks when the notes are trusted — they count at once. | `/admin/settings` |
| 7:45 | **Analytics.** Hours vs target by tier, attendance by series, and **drifting members** — under 50% of target in 2+ of the last 4 weeks, or 2+ unexcused in the last 6 meetings. This is the leader's answer to "who needs a nudge". | `/admin/analytics` |
| 9:00 | **Rebuildability.** `docs/INFRASTRUCTURE.md`: services, how they connect, every env var, deploy from zero. Public repo, MIT. | repo |
| 9:30 | **What is not finished**, honestly: see below. | — |

## The closing paragraph (say this, don't read it)

All three areas work for members and admins on the sandbox data, plus analytics for a leader. Meetings
are read from Google Calendar and **never written to** — that was a hard constraint. Tasks sync two
ways with the existing Google Sheet, so nobody has to abandon the sheet on day one. AI is used in three
narrow places where it saves real work: meeting notes or a transcript become draft tasks (each with the
quote it came from, and the assignee confirms), a meeting gets a short summary, and you can ask a
question about a meeting you attended — answered only from that meeting's notes, with the quotes checked
so it cannot invent one.

Not finished: the dashboard has no hours chart yet; the seeded project tasks are placeholders; email
reminders and Slack announcements need SMTP / a token and a scheduler, so on the sandbox they are only
recorded; the meeting recorder needs Supabase Storage and has not been tested on a real phone or Safari.

## If something breaks

- **A page errors** → reload once. Pages render from the database; the Google and calendar syncs run in
  the background and never block a page.
- **The AI button does nothing** → `ANTHROPIC_API_KEY` is not set in that environment; the feature hides
  itself. Fall back to showing an AI task that already exists, with its quote.
- **Attendance looks wrong** → a past meeting with no record counts as *unexcused* by design, not a bug.
- **Worst case** → the sandbox data is seeded and reproducible: `npm run db:seed`.
