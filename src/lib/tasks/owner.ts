// A task belongs to one person or to one whole department (never both), picked in one dropdown whose
// values are "m:<member id>", "d:<department id>" or "" (nobody). Safe to import from client components.

export type Owner = { assigneeId: number | null; departmentId: number | null };

export function ownerValue(o: Owner): string {
  if (o.assigneeId) return `m:${o.assigneeId}`;
  if (o.departmentId) return `d:${o.departmentId}`;
  return "";
}

/** Reads a dropdown value; null if it is not one of the three forms. */
export function parseOwner(value: string): Owner | null {
  if (value === "") return { assigneeId: null, departmentId: null };
  const m = value.match(/^([md]):(\d+)$/);
  if (!m) return null;
  const id = Number(m[2]);
  return m[1] === "m" ? { assigneeId: id, departmentId: null } : { assigneeId: null, departmentId: id };
}
