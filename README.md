# Shapers Hub

One place for a volunteer institute's tasks, work hours and meeting attendance, with a member view and an admin view for each.

Stack: Next.js (App Router, TypeScript) + Tailwind, Postgres with Drizzle ORM. Sandbox data lives in `data/`.

## Run locally

Requires Node 18.18+ and Docker (or any Postgres).

```bash
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
docker compose up -d          # local Postgres on port 5433
npm install
npm run db:migrate            # apply migrations in drizzle/
npm run db:seed               # load sandbox data from data/
npm run dev                   # http://localhost:3000
```

For the local Postgres from `docker-compose.yml`:
`DATABASE_URL=postgres://shapers:shapers@localhost:5433/shapers`.
Generate a session secret with `openssl rand -base64 32`.

## Sign-in

For the hackathon you sign in by picking your name from the roster. The admin role comes from the roster's `admin` column. All auth code is in `src/lib/auth/`; switching to Google sign-in only touches that folder.

## Licence

MIT, see `LICENSE`.
