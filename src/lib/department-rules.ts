// Department rules, pure so they are unit-tested (department-rules.test.ts) and usable in the browser.
import { TIERS, type Tier } from "./tiers";

/** A department named like a tier ("Core") is only for members of that tier; null for any other department. */
export function tierOfDepartment(name: string): Tier | null {
  const key = name.trim().toLowerCase();
  return TIERS.find((t) => t.toLowerCase() === key) ?? null;
}

/** The error to show when a member of `tier` is put in a department reserved for another tier, else null. */
export function departmentTierProblem(chosen: { name: string }[], tier: Tier): string | null {
  for (const d of chosen) {
    const only = tierOfDepartment(d.name);
    if (only && only !== tier) return `${d.name} is only for members of the ${only} tier.`;
  }
  return null;
}
