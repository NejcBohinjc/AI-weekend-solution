# Manual checks

Quick checks before a demo or after touching these areas. Use two browser tabs and a phone if you can.

## Hours timer

1. **Start:** on the dashboard press Start. The clock counts up from 0:00:00.
2. **Navigate away and back:** after ~10 s open Tasks, wait ~10 s, come back to Dashboard with the nav link, then again with the browser Back button. The clock shows the full time (~20 s, ~30 s), never jumps back to 0.
3. **Both places agree:** open Hours. It shows the same time as the dashboard (±1 s).
4. **Reload:** reload the page. The time continues; it does not restart.
5. **Second tab:** open Hours in a second tab; both show the same time. Press Stop in the second tab, switch back to the first: it shows "Not tracking" within a moment.
6. **Wrong phone clock:** set the phone's clock a few minutes off and repeat 1–2: the time is still right (corrected by `/api/time`).
7. **Stop:** a run under 1 minute says "Stopped within a minute, so nothing was saved"; a longer run says "Saved N min" and appears in the day's list straight away, marked "not synced to the sheet" until the sheet has it.

Automated: `npm test` covers the clock offset (`clock.test.ts`) and the Stop path (`stop-and-sheet.test.ts`, needs a local Postgres).

## Tasks and the Google Sheet

1. Sign in as a regular member. The dashboard and Tasks both have **New task**; the form's assignee is you and the status list is To do, In progress, Verification, Done.
2. Create a task. Within a few seconds its row appears in the tasks tab with a key in the `id` column. Until then the task says "Not in the Google Sheet yet"; if the sync failed it says why (e.g. `403 PERMISSION_DENIED: …`).
3. Change the task's status in the app: the sheet cell changes within seconds. Change a deadline in the sheet, then press **Sync now** (or reload Tasks after a minute): the app shows it, and the history says "Sheet sync".
4. Sort the sheet and sync again: no duplicate rows or tasks.
5. Type "verifikacija" as a status in the sheet: no "unknown status" warning in the admin report.

Real-sheet access check: `npm run sheets:check` (with the Google variables set).
