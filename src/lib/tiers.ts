// Tiers and their weekly hour commitment: Core 70, Impact 10, GO! 4.
export const TIERS = ["Core", "Impact", "GO!"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_HOURS: Record<Tier, number> = { Core: 70, Impact: 10, "GO!": 4 };
