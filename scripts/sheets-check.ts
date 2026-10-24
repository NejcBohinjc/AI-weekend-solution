// Checks the Google Sheets connection against the configured spreadsheet and prints the exact Google error.
//   npm run sheets:check                         configuration and access (tab names only, no cell values)
//   npm run sheets:check -- --hours-entry <id>   also sends that finished time entry to the hours tab and
//                                                confirms its row (by the id in column F)
//   npm run sheets:check -- --task-types         also lists the "Tip taska" values of the tasks tab and the
//                                                types in the database, most used first (to choose TASK_TYPES)
import "dotenv/config";
import { count, desc, eq, isNotNull } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { tasks, timeEntries } from "../src/db/schema";
import { hoursSheetTab, syncHoursSheet } from "../src/lib/hours/sheet-sync";
import { columnLetter, describeGoogleError, openTab, sheetsApi, sheetsConfig } from "../src/lib/google/sheets";
import { findColumns } from "../src/lib/tasks/sheet-mapping";
import { tasksSheetTab } from "../src/lib/tasks/sheet-sync";

async function main(): Promise<number> {
  for (const name of ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"]) {
    console.log(`${process.env[name] ? "✓" : "✗"} ${name}`);
  }
  let cfg: ReturnType<typeof sheetsConfig>;
  try {
    cfg = sheetsConfig();
  } catch (err) {
    console.error(`\n${describeGoogleError(err)}`);
    return 1;
  }
  console.log(`\nService account: ${cfg.email} (the sheet must be shared with it as Editor)`);

  try {
    const res = await sheetsApi().request<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.sheetId)}?fields=properties.title,sheets.properties.title`,
    });
    const tabs = res.data.sheets.map((s) => s.properties.title);
    console.log(`Spreadsheet: “${res.data.properties.title}”, tabs: ${tabs.map((t) => `“${t}”`).join(", ")}`);
    for (const [what, tab] of [["tasks", tasksSheetTab()], ["hours", hoursSheetTab()]]) {
      console.log(`${tabs.includes(tab) ? "✓" : "✗"} ${what} tab “${tab}”${tabs.includes(tab) ? "" : " not found (the hours sync creates it)"}`);
    }
  } catch (err) {
    console.error(`\nCannot open the spreadsheet: ${describeGoogleError(err)}`);
    return 1;
  }

  if (process.argv.includes("--task-types")) {
    // Only the header row and the "Tip taska" column are read.
    const tab = openTab(tasksSheetTab());
    const col = findColumns((await tab.get("1:1"))[0] ?? []).columns.type;
    if (col === undefined) console.log(`\nNo "tip taska" column in “${tab.tab}”.`);
    else {
      const counts = new Map<string, number>();
      for (const [v] of await tab.get(`${columnLetter(col)}2:${columnLetter(col)}`)) {
        const value = String(v ?? "").replace(/\s+/g, " ").trim();
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      console.log(`\n"Tip taska" in “${tab.tab}”, most used first:`);
      for (const [value, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${value}`);
    }
    const inDb = await db.select({ type: tasks.type, n: count() }).from(tasks).where(isNotNull(tasks.type)).groupBy(tasks.type).orderBy(desc(count()));
    console.log("\nTask types in the database, most used first:");
    for (const r of inDb) console.log(`  ${r.n}  ${r.type}`);
  }

  const i = process.argv.indexOf("--hours-entry");
  if (i < 0) return 0;
  const id = Number(process.argv[i + 1]);
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (!entry?.endedAt || entry.deletedAt) {
    console.error(`\nTime entry ${process.argv[i + 1]} not found or not finished.`);
    return 1;
  }
  await db.update(timeEntries).set({ sheetStatus: "pending", updatedAt: new Date() }).where(eq(timeEntries.id, id));
  const result = await syncHoursSheet();
  console.log(`\nHours sync: ${result.synced} sent, ${result.failed} failed${result.error ? `\nGoogle error: ${result.error}` : ""}`);
  const ids = (await openTab(hoursSheetTab()).get("F:F", true)).map((r) => Number(r[0]));
  const row = ids.indexOf(id) + 1;
  console.log(row > 0 ? `✓ Entry ${id} is in “${hoursSheetTab()}”, row ${row}.` : `✗ Entry ${id} is not in “${hoursSheetTab()}”.`);
  return row > 0 && result.ok ? 0 : 1;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(describeGoogleError(err));
    await closeDb();
    process.exit(1);
  });
