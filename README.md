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

## Licence

MIT, see `LICENSE`.
