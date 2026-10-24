# Status

**Finished:** email/password sign-in (argon2id, database sessions, rate limiting), one-time setup/reset links, member management for admins (add, edit, deactivate/reactivate), `create-admin` bootstrap command, demo mode for the sandbox, route protection (`/admin/*` admin-only with a 403 page), shared layout with member and admin navigation. Members table and roster seed. Tasks: read-only Google Sheets import (idempotent, admin edits kept, history, sync report), task list with My tasks / All tasks and type/status filters, task detail with history, admin task editing. Hours: Start/Stop timer (on Hours and the dashboard), manual entries and corrections, weekly progress against the tier commitment, recent weeks, admin "who is behind / working now" with per-member history and editing; every finished entry is mirrored to the "Ure dela" sheet tab; hours.xlsx seeded as history.

**Not finished:** step 1 is partial (meetings and projects are not yet in the schema; no public deploy yet). Meetings (attendance) and analytics are placeholder pages. Hours: no chart on the dashboard yet. Tasks: no projects, board or member actions (finish, hand over) yet; no scheduled sheet sync.

**What AI does:** nothing in the product yet.
