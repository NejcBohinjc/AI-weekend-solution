// Database tests only ever run against a database whose name ends in "_test" (`npm test` sets one up,
// see scripts/test.mjs), so they can never empty or change the development or production database.

/** For `describe(..., { skip: testDatabaseSkip() })`: false when DATABASE_URL is a test database, else the reason to skip. */
export function testDatabaseSkip(): string | false {
  const url = process.env.DATABASE_URL;
  if (!url) return "no test database; run the tests with npm test";
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
  return name.endsWith("_test") ? false : `DATABASE_URL is "${name}", not a *_test database; run the tests with npm test`;
}
