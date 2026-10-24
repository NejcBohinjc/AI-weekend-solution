// Loads sandbox data from data/ into the database. Safe to re-run (upserts by email).
import "dotenv/config";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { members, TIERS, type Tier } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { PASSWORD_MIN_LENGTH } from "../src/lib/auth/password-rules";

async function readSheet(path: string): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const values = (row.values as unknown[]).slice(1);
    rows.push(Object.fromEntries(header.map((h, j) => [h, values[j]])));
  });
  return rows;
}

// DEMO_MODE=true: every seeded member gets DEMO_PASSWORD. Otherwise no passwords are set
// (and existing ones are left alone); members get setup links from an admin instead.
async function demoPasswordHash(): Promise<string | null> {
  if (process.env.DEMO_MODE !== "true") return null;
  const pw = process.env.DEMO_PASSWORD ?? "";
  if (pw.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`DEMO_MODE=true needs DEMO_PASSWORD with at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return hashPassword(pw);
}

async function seedMembers() {
  const rows = await readSheet("data/roster.xlsx");
  const passwordHash = await demoPasswordHash();
  const values = rows.map((r) => {
    const tier = String(r.tier) as Tier;
    if (!TIERS.includes(tier)) throw new Error(`Unknown tier "${tier}" for ${r.email}`);
    return {
      name: String(r.name),
      email: String(r.email).toLowerCase(),
      tier,
      weeklyHours: Number(r.weekly_hours),
      isAdmin: String(r.admin).toLowerCase() === "yes",
      series: String(r.series ?? "").split(";").map((s) => s.trim()).filter(Boolean),
      ...(passwordHash && { passwordHash }),
    };
  });
  await db
    .insert(members)
    .values(values)
    .onConflictDoUpdate({
      target: members.email,
      set: {
        name: sql`excluded.name`,
        tier: sql`excluded.tier`,
        weeklyHours: sql`excluded.weekly_hours`,
        isAdmin: sql`excluded.is_admin`,
        series: sql`excluded.series`,
        ...(passwordHash && { passwordHash: sql`excluded.password_hash` }),
      },
    });
  console.log(`members: ${values.length} (${values.filter((v) => v.isAdmin).length} admins)`);
  console.log(passwordHash ? "passwords: all set to DEMO_PASSWORD (demo mode)" : "passwords: none set (not demo mode)");
}

async function main() {
  await seedMembers();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
