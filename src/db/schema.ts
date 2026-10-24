import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Tiers and their weekly hour commitment: Core 70, Impact 10, GO! 4.
export const TIERS = ["Core", "Impact", "GO!"] as const;
export type Tier = (typeof TIERS)[number];

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  tier: text("tier", { enum: TIERS }).notNull(),
  weeklyHours: integer("weekly_hours").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  series: text("series").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
