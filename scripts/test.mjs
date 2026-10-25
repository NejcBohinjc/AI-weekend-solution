// npm test: runs every src/**/*.test.ts.
// Database tests get their own database, never the one the app uses: TEST_DATABASE_URL if set, else
// the local DATABASE_URL with "_test" added to the database name (e.g. shapers -> shapers_test). It is
// created if missing and migrated first. Without a local database, the database tests are skipped.
// Google, email, the calendar address, Supabase Storage and OpenAI are blanked for tests, so nothing
// reaches the real Sheet, sends mail or touches real recordings (the tests use fakes).
import "dotenv/config";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import postgres from "postgres";

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) return null;
  const url = new URL(process.env.DATABASE_URL);
  // Never derive a test database on a remote server.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  url.pathname = `/${url.pathname.slice(1)}_test`;
  return url.toString();
}

async function createIfMissing(dbUrl) {
  const url = new URL(dbUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) throw new Error(`Test database name must end in "_test": ${name}`);
  url.pathname = "/postgres";
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await sql`select 1 from pg_database where datname = ${name}`;
    if (!exists) {
      await sql.unsafe(`create database "${name}"`);
      console.log(`Created test database ${name}`);
    }
  } finally {
    await sql.end();
  }
}

const dbUrl = testDatabaseUrl();
const env = {
  ...process.env,
  DATABASE_URL: dbUrl ?? "",
  // Empty (not deleted), so `import "dotenv/config"` in a test cannot bring the real values back.
  GOOGLE_SHEET_ID: "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "",
  MEETINGS_ICS_URL: "",
  SMTP_HOST: "",
  MAIL_REDIRECT_TO: "",
  // Recordings and transcription: tests use a fake store and a mocked provider, never the real ones.
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  OPENAI_API_KEY: "",
  TRANSCRIBE_API_KEY: "",
  TRANSCRIBE_BASE_URL: "",
  TRANSCRIBE_MODEL: "",
  // Slack: tests use FakeSlack, never the real workspace.
  SLACK_BOT_TOKEN: "",
};

if (dbUrl) {
  await createIfMissing(dbUrl);
  try {
    execSync("npm run db:migrate", { env, stdio: "pipe" });
  } catch (err) {
    console.error(String(err.stdout ?? ""), String(err.stderr ?? ""));
    throw new Error("Migrating the test database failed");
  }
} else {
  console.log("No local database: database tests are skipped (set TEST_DATABASE_URL to run them).");
}

const files = readdirSync("src", { recursive: true })
  .map((f) => `src/${String(f).replace(/\\/g, "/")}`)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();
try {
  // One file at a time: the database tests share the test database (the tasks sync test empties
  // the tasks table), so running them in parallel makes them fail at random.
  execSync(`npx tsx --test --test-concurrency=1 ${files.join(" ")}`, { env, stdio: "inherit" });
} catch {
  process.exit(1);
}
