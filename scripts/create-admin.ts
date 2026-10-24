// Bootstraps a real deployment: creates (or promotes) an admin and prints a one-time setup link.
// Usage: npm run create-admin -- <email> <name>
import "dotenv/config";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../src/db";
import { members, TIER_HOURS } from "../src/db/schema";
import { createSetupLink } from "../src/lib/auth/setup-links";

async function main() {
  const [rawEmail, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  const email = z.email().safeParse(rawEmail?.trim().toLowerCase());
  if (!email.success || !name) {
    console.error('Usage: npm run create-admin -- <email> "<full name>"');
    process.exit(1);
  }

  const [existing] = await db.select().from(members).where(eq(members.email, email.data)).limit(1);
  let memberId: number;
  if (existing) {
    // Keep their tier and hours; make sure they are an active admin.
    await db.update(members).set({ isAdmin: true, active: true, updatedAt: new Date() }).where(eq(members.id, existing.id));
    memberId = existing.id;
    console.log(`${existing.name} <${email.data}> already exists; made them an active admin.`);
  } else {
    // Tier defaults to Core; an admin can change it later on /admin/members.
    const [created] = await db
      .insert(members)
      .values({ name, email: email.data, tier: "Core", weeklyHours: TIER_HOURS.Core, isAdmin: true })
      .returning({ id: members.id });
    memberId = created.id;
    console.log(`Created admin ${name} <${email.data}>.`);
  }

  const link = await createSetupLink(memberId);
  console.log(`\nOne-time setup link (valid until ${link.expiresAt.toISOString()}):\n${link.url}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
