import assert from "node:assert/strict";
import { TASK_STATUSES, TASK_TYPES } from "./constants";
import { test } from "node:test";
import { buildRowKeys, findColumns, formatStatus, mapStatus, matchAssignee, matchOwner, normalizeType, parseDeadline } from "./sheet-mapping";

const TODAY = "2026-10-24";

test("finds columns by header name, case- and space-insensitive, in any order", () => {
  const { columns, missing } = findColumns(["Geslo", " Deadline ", "TASK", "Tip  taska", "nosilec", "Status"]);
  assert.deepEqual(columns, { title: 2, status: 5, assignee: 4, type: 3, deadline: 1 });
  assert.deepEqual(missing, []);
  assert.deepEqual(findColumns(["task"]).missing, ["status", "assignee", "type", "deadline"]);
});

test("maps English and Slovenian statuses", () => {
  for (const s of ["to do", "To-Do", "TODO", "", "odprto", "ni začeto"]) assert.equal(mapStatus(s).status, "todo", s);
  for (const s of ["in progress", "In-Progress", "WIP", "v delu", "V teku"]) assert.equal(mapStatus(s).status, "in_progress", s);
  for (const s of ["verifikacija", "Verifikacija ", "VERIFICATION", "v verifikaciji"]) {
    assert.deepEqual(mapStatus(s), { status: "verification", recognised: true }, s);
  }
  for (const s of ["done", "Done ", "completed", "narejeno", "Končano", "zaključeno", "opravljeno"]) assert.equal(mapStatus(s).status, "done", s);
  assert.deepEqual(mapStatus("blocked"), { status: "todo", recognised: false });
});

const members = [
  { id: 1, name: "Žiga Krajnc", email: "ziga.krajnc@sandbox.example" },
  { id: 2, name: "Ana Kovač", email: "ana.kovac@sandbox.example" },
  { id: 3, name: "Ana Novak", email: "anan@sandbox.example" },
];

test("matches assignee by first name, full name, email or email prefix, ignoring case and diacritics", () => {
  assert.equal(matchAssignee("ziga", members).memberId, 1);
  assert.equal(matchAssignee("ŽIGA KRAJNC", members).memberId, 1);
  assert.equal(matchAssignee("ziga.krajnc", members).memberId, 1);
  assert.equal(matchAssignee("Ana Kovac", members).memberId, 2);
  assert.equal(matchAssignee("anan", members).memberId, 3);
  assert.equal(matchAssignee("ana.kovac@sandbox.example", members).memberId, 2);
  assert.equal(matchAssignee(" Ana.Kovac@Sandbox.Example ", members).memberId, 2);
  assert.deepEqual(matchAssignee("ana.kovac@other.example", members), { memberId: null, reason: "no member matches" });
});

test("leaves assignee empty unless exactly one member matches", () => {
  assert.deepEqual(matchAssignee("Ana", members), { memberId: null, reason: "matches 2 members (Ana Kovač, Ana Novak)" });
  assert.deepEqual(matchAssignee("Marko", members), { memberId: null, reason: "no member matches" });
  assert.deepEqual(matchAssignee("", members), { memberId: null });
});

test("nosilec can name a whole department instead of one person", () => {
  const departments = [
    { id: 7, name: "Tech" },
    { id: 8, name: "Voice" },
  ];
  assert.deepEqual(matchOwner("Tech", members, departments), { assigneeId: null, departmentId: 7 });
  assert.deepEqual(matchOwner(" voice ", members, departments), { assigneeId: null, departmentId: 8 });
  assert.deepEqual(matchOwner("Oddelek Tech", members, departments), { assigneeId: null, departmentId: 7 });
  assert.deepEqual(matchOwner("Tech department", members, departments), { assigneeId: null, departmentId: 7 });
  assert.deepEqual(matchOwner("Ana Kovac", members, departments), { assigneeId: 2, departmentId: null, reason: undefined });
  assert.deepEqual(matchOwner("Marko", members, departments), { assigneeId: null, departmentId: null, reason: "no member matches" });
  assert.deepEqual(matchOwner("", members, departments), { assigneeId: null, departmentId: null });
});

test("task types: list types match ignoring case and diacritics, other types are kept as typed", () => {
  assert.equal(normalizeType("  Marketing "), "Marketing");
  assert.equal(normalizeType("marketing"), "Marketing");
  assert.equal(normalizeType("EVENTS"), "Events");
  assert.equal(normalizeType("Logistika  dvorane"), "Logistika dvorane");
  assert.equal(normalizeType(""), null);
  assert.equal(normalizeType(undefined), null);
  for (const t of TASK_TYPES) assert.equal(normalizeType(t), t, "every listed type maps to itself");
});

test("parses deadlines", () => {
  const cases: [unknown, string | null][] = [
    ["15.11.2026", "2026-11-15"],
    ["5. 1. 2027", "2027-01-05"],
    ["15.11.26", "2026-11-15"],
    ["2026-11-15", "2026-11-15"],
    ["15/11/2026", "2026-11-15"],
    ["15.11.2026 14:00", "2026-11-15"],
    ["2026-11-15T23:30:00Z", "2026-11-16"], // 00:30 in Ljubljana
    [46341, "2026-11-15"], // Sheets serial
    [46341.75, "2026-11-15"], // serial with time of day
    ["", null],
    [undefined, null],
  ];
  for (const [raw, expected] of cases) assert.equal(parseDeadline(raw as never, TODAY).date, expected, String(raw));
});

test("a deadline without a year is the next upcoming date", () => {
  assert.equal(parseDeadline("15.11.", TODAY).date, "2026-11-15");
  assert.equal(parseDeadline("24.10.", TODAY).date, "2026-10-24"); // today counts
  assert.equal(parseDeadline("1.3.", TODAY).date, "2027-03-01");
  assert.equal(parseDeadline("29.2.", TODAY).date, "2028-02-29");
});

test("rejects invalid deadlines", () => {
  assert.equal(parseDeadline("31.2.2027", TODAY).error, "not a valid calendar date");
  assert.equal(parseDeadline("next week", TODAY).error, "not a date");
  assert.equal(parseDeadline(12, TODAY).error, "not a date");
});

test("row keys are stable and distinguish duplicate titles", () => {
  assert.deepEqual(buildRowKeys(["Plakat", "Objava na IG", " plakat "]), ["plakat#1", "objava na ig#1", "plakat#2"]);
  // Reordering other rows does not change a row's key.
  assert.deepEqual(buildRowKeys(["Objava na IG", "Plakat"]), ["objava na ig#1", "plakat#1"]);
});

test("every status the app writes to the sheet reads back as the same status", () => {
  for (const status of TASK_STATUSES) assert.deepEqual(mapStatus(formatStatus(status)), { status, recognised: true }, status);
  assert.equal(formatStatus("verification"), "verifikacija");
});

test("verifikacija and its variants are a known status, never an \"unknown status\" warning", () => {
  for (const s of ["verifikacija", "Verifikacija", "verification", "v verifikaciji", "preverjanje", "Preverjanje "]) {
    assert.deepEqual(mapStatus(s), { status: "verification", recognised: true }, s);
  }
});
