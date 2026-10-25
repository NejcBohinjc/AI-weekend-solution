// Page profiler: requests pages with a real session and reports, per page, the number of SQL statements,
// their summed time and the wall time. Statements are read from the log of the LOCAL Postgres container,
// so run it against a local app (npm run build && npm run start) and see docs/PERFORMANCE.md for the setup.
// Usage: node scripts/perf/profile.mjs <base url> <label> [pages...]
// Env:   ROLE=admin|member (default admin), RUNS=5, PG_CONTAINER=ai-weekend-solution-db-1, DETAIL=1 (list queries)
import { createHash, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
const BASE = process.argv[2];
const LABEL = process.argv[3] ?? "";
const only = process.argv.slice(4);
const ROLE = process.env.ROLE ?? "admin";
const RUNS = Number(process.env.RUNS ?? 5);
const PG = process.env.PG_CONTAINER ?? "ai-weekend-solution-db-1";
const psql = (q) => execSync(`docker exec -i ${PG} psql -U shapers -d shapers -tA`, { input: q }).toString().trim();
const email = ROLE === "admin" ? "ana.kovac@sandbox.example" : "ziga.krajnc@sandbox.example";
const token = randomBytes(32).toString("base64url");
const id = createHash("sha256").update(token).digest("hex");
psql(`insert into sessions (id, member_id, expires_at) values ('${id}', (select id from members where email='${email}'), now() + interval '30 days')`);

const PAGES = {
  dashboard: "/dashboard",
  tasks: "/tasks",
  "tasks-all": "/tasks?view=all",
  hours: "/hours",
  meetings: "/meetings",
  "meeting-detail": "/meetings/34",
  analytics: "/admin/analytics",
  "admin-hours": "/admin/hours",
  "admin-meetings": "/admin/meetings",
  "admin-board": "/admin/tasks",
  "admin-members": "/admin/members",
  notifications: "/notifications",
  "tasks-general": "/tasks?tab=general",
  "admin-member-hours": "/admin/hours/3",
};
const list = (only.length ? only : Object.keys(PAGES)).filter((p) => ROLE === "admin" || !p.startsWith("admin") && p !== "analytics");

function logSince(sinceIso) {
  const out = execSync(`docker logs --since ${sinceIso} ${PG} 2>&1`, { maxBuffer: 1 << 28 }).toString();
  const stmts = [];
  // 2026-10-24 21:00:00.123 UTC [57] LOG:  duration: 0.215 ms  execute <unnamed>: select ...
  for (const m of out.matchAll(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+) UTC \[(\d+)\] LOG:\s+duration: ([\d.]+) ms\s+(?:execute [^:]*|statement): ([\s\S]*?)(?=\n\d{4}-\d\d-\d\d |\n*$)/gm)) {
    stmts.push({ at: Date.parse(m[1].replace(" ", "T") + "Z"), pid: m[2], ms: Number(m[3]), sql: m[4].replace(/\s+/g, " ").trim() });
  }
  return stmts.filter((s) => !/^(show|set |begin|commit|select pg_|insert into sessions|delete from sessions)/i.test(s.sql));
}

const results = [];
for (const name of list) {
  const path = PAGES[name];
  const samples = [];
  for (let i = 0; i < RUNS + 2; i++) {
    const since = new Date(Date.now() - 200).toISOString();
    const t0 = performance.now();
    const res = await fetch(BASE + path, { headers: { cookie: `session=${token}` }, redirect: "manual" });
    const body = await res.text();
    const wall = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 400)); // let after() work finish and be logged
    if (i < 2) continue; // warm-up (opens pool connections, builds caches)
    const stmts = logSince(since);
    samples.push({ status: res.status, bytes: body.length, wall, n: stmts.length, db: stmts.reduce((a, s) => a + s.ms, 0), stmts });
  }
  samples.sort((a, b) => a.wall - b.wall);
  const med = samples[Math.floor(samples.length / 2)];
  results.push({ name, ...med });
}
psql(`delete from sessions where id='${id}'`);
const f = (n, d = 0) => n.toFixed(d);
console.log(`\n${LABEL}  (${ROLE}, median of ${RUNS})`);
console.log("page".padEnd(16), "status", "queries", "db ms".padStart(7), "wall ms".padStart(8), " KB");
for (const r of results) console.log(r.name.padEnd(16), String(r.status).padEnd(6), String(r.n).padStart(7), f(r.db, 1).padStart(7), f(r.wall).padStart(8), f(r.bytes / 1024).padStart(5));
if (process.env.DETAIL) for (const r of results) {
  console.log(`\n--- ${r.name}`);
  r.stmts.forEach((s, i) => console.log(String(i + 1).padStart(2), `[${s.pid}]`, f(s.ms, 1).padStart(6), "ms ", s.sql.slice(0, 150)));
}
