import { TIMEZONE } from "@/lib/app";
import { FIELD_LABELS } from "@/lib/tasks/constants";
import type { SyncReport } from "@/lib/tasks/sheet-sync";

const fieldNames = (fields: string[]) => fields.map((f) => FIELD_LABELS[f as keyof typeof FIELD_LABELS]?.toLowerCase() ?? f).join(", ");

/** The last sync's full report, with raw sheet values and reasons. Admins only. */
export function SyncReportPanel({ report, by }: { report: Partial<SyncReport> & { at: string; ok: boolean }; by: string | null }) {
  const when = new Date(report.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const list = <T,>(items: T[] | undefined) => items ?? [];
  return (
    <details className="rounded-xl border border-line bg-surface p-4 text-sm" open={!report.ok} data-testid="sync-report">
      <summary className="cursor-pointer font-semibold">
        Sync report <span className="font-normal text-subtle">· {when}{by ? ` by ${by}` : ""} · admins only</span>
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        {!report.ok ? (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-danger">
            Sync failed: {report.error}
          </p>
        ) : (
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <Count n={list(report.created).length} label="new from sheet" />
            <Count n={list(report.updated).length} label="updated from sheet" />
            <Count n={list(report.appended).length} label="added to sheet" />
            <Count n={list(report.exported).length} label="updated in sheet" />
            <Count n={list(report.conflicts).length} label="conflicts" />
            <Count n={report.unchanged ?? 0} label="unchanged" />
            <span className="text-subtle">
              {report.rowsRead ?? 0} rows read from “{report.tab}”
            </span>
          </p>
        )}
        {list(report.missingColumns).length > 0 && (
          <p className="rounded-lg bg-warning-bg px-3 py-2 text-warning">
            Columns not found in the sheet: {list(report.missingColumns).join(", ")}. Those fields are kept in the app only.
          </p>
        )}
        <Details title="Unassigned" open items={list(report.unassigned).map((u) => `Row ${u.row} “${u.title}”: nosilec “${u.raw}”, ${u.reason}`)} />
        <Details title="Warnings" open items={list(report.warnings).map((w) => `Row ${w.row} “${w.title}”: ${w.message}`)} />
        <Details
          title="Conflicts (the app's value was kept)"
          open
          items={list(report.conflicts).map((c) => `Row ${c.row} “${c.title}”, ${fieldNames([c.field])}: sheet had “${c.sheetValue ?? "empty"}”, kept “${c.appValue ?? "empty"}”`)}
        />
        <Details title="Skipped rows" items={list(report.skipped).map((s) => `Row ${s.row}: ${s.reason}`)} />
        <Details title="Updated from the sheet" items={list(report.updated).map((u) => `Row ${u.row} “${u.title}”: ${fieldNames(u.fields)}`)} />
        <Details title="Written to the sheet" items={[...list(report.appended).map((a) => `Row ${a.row} “${a.title}”: new row`), ...list(report.exported).map((e) => `Row ${e.row} “${e.title}”: ${fieldNames(e.fields)}`)]} />
        <Details title="No longer in the sheet (kept here)" items={list(report.noLongerInSheet).map((n) => `“${n.title}”`)} />
      </div>
    </details>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <strong className="tabular-nums">{n}</strong> {label}
    </span>
  );
}

function Details({ title, items, open }: { title: string; items: string[]; open?: boolean }) {
  if (!items.length) return null;
  return (
    <details className="rounded-lg bg-surface-2 px-3 py-2" open={open}>
      <summary className="cursor-pointer font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mt-1 list-disc pl-5 text-fg-2">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
