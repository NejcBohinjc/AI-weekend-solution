import assert from "node:assert/strict";
import { test } from "node:test";
import { locationLabel, locationTotals, parseLocation } from "./location";

const at = (iso: string) => new Date(iso);
const H = 3_600_000;

test("totals per location; entries without one are unspecified, never guessed", () => {
  const from = at("2026-10-19T00:00:00Z");
  const to = at("2026-10-26T00:00:00Z");
  const now = at("2026-10-23T12:00:00Z");
  const totals = locationTotals(
    [
      { startedAt: at("2026-10-20T08:00:00Z"), endedAt: at("2026-10-20T10:00:00Z"), location: "office" },
      { startedAt: at("2026-10-21T08:00:00Z"), endedAt: at("2026-10-21T09:30:00Z"), location: "home" },
      { startedAt: at("2026-10-19T09:00:00Z"), endedAt: at("2026-10-19T13:00:00Z"), location: null }, // seeded
      { startedAt: at("2026-10-23T11:00:00Z"), endedAt: null, location: "home" }, // running: counts up to now
      { startedAt: at("2026-10-18T22:00:00Z"), endedAt: at("2026-10-19T01:00:00Z"), location: "office" }, // clipped to the week
    ],
    from,
    to,
    now,
  );
  assert.deepEqual(totals, { office: 3 * H, home: 2.5 * H, unspecified: 4 * H });
});

test("parse and label", () => {
  assert.equal(parseLocation("office"), "office");
  assert.equal(parseLocation("home"), "home");
  assert.equal(parseLocation("unspecified"), null, "unspecified is not a choice a member can make");
  assert.equal(parseLocation(undefined), null);
  assert.equal(parseLocation("Office"), null);
  assert.equal(locationLabel(null), "Unspecified");
  assert.equal(locationLabel("home"), "Home");
});
