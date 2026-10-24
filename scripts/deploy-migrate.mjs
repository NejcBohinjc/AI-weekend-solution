// Runs on Vercel before `next build` (package.json "vercel-build"): applies the migrations in drizzle/
// to the database, so a deploy never goes live with code that expects tables the database lacks.
// If a migration fails, the build fails and the previous deployment stays live.
// Only production deploys migrate, so a preview of an unmerged branch never changes the live schema.
// DATABASE_MIGRATION_URL (optional) is used instead of DATABASE_URL, for when DATABASE_URL is a
// transaction pooler (Supabase port 6543) that migrations should not go through.
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env !== "production") {
  console.log(`Database migrations skipped (VERCEL_ENV=${env ?? "not set"}; only production deploys migrate).`);
  process.exit(0);
}

const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Database migrations: DATABASE_URL is not set for production builds. Add it in Vercel → Settings → Environment Variables.");
  process.exit(1);
}

console.log("Applying database migrations…");
execSync("npm run db:migrate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
