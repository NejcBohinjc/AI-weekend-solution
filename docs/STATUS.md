# Status

**Finished:** email/password sign-in (argon2id, database sessions, rate limiting), one-time setup/reset links, member management for admins (add, edit, deactivate/reactivate), `create-admin` bootstrap command, demo mode for the sandbox, route protection (`/admin/*` admin-only with a 403 page), shared layout with member and admin navigation. Members table and roster seed. Tasks: read-only Google Sheets import (idempotent, admin edits kept, history, sync report), task list with My tasks / All tasks and type/status filters, task detail with history, admin task editing.

**Not finished:** step 1 is partial (only the members table is seeded; hours, attendance, meetings and projects are not yet in the schema; no public deploy yet). Hours, Meetings (attendance) and analytics are placeholder pages. Tasks: no projects, board or member actions (finish, hand over) yet; no scheduled sheet sync. Sheet import not yet run against the real sheet (needs service account credentials).

**What AI does:** nothing in the product yet.
