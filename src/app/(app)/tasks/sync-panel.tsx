"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";
import type { SyncReport } from "@/lib/tasks/sheet-sync";
import { syncFromSheetAction } from "./actions";

export function SyncPanel({ last, lastBy }: { last: SyncReport | null; lastBy: string | null }) {
  const [report, formAction, pending] = useActionState(syncFromSheetAction, last);
  const fresh = report !== last;
  const when = report && new Date(report.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

  return (
    <section aria-label="Google Sheets sync" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Google Sheets</h2>
          <p className="text-xs text-slate-500">
            {report ? `${fresh ? "Synced" : "Last sync"} ${when}${!fresh && lastBy ? ` by ${lastBy}` : ""}` : "Never synced"}. Read-only:
            the sheet is never changed.
          </p>
        </div>
        <form action={formAction}>
          <button type="submit" disabled={pending} className={secondaryButtonClass}>
            {pending ? "Syncing…" : "Sync from Google Sheets"}
          </button>
        </form>
      </div>
      {report && <SyncReportView report={report} />}
    </section>
  );
}

function SyncReportView({ report }: { report: SyncReport }) {
  if (!report.ok) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        Sync failed: {report.error}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="sync-report">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <Count n={report.created.length} label="created" />
        <Count n={report.updated.length} label="updated" />
        <Count n={report.unchanged} label="unchanged" />
        <Count n={report.skipped.length} label="skipped" />
        <Count n={report.unassigned.length} label="unassigned" />
        <span className="text-slate-500">{report.rowsRead} rows read from “{report.tab}”</span>
      </p>
      {report.missingColumns.length > 0 && (
        <Note tone="warn">Columns not found in the sheet: {report.missingColumns.join(", ")}. Those fields were left empty.</Note>
      )}
      <Details title="Unassigned" items={report.unassigned.map((u) => `Row ${u.row} “${u.title}”: nosilec “${u.raw}”, ${u.reason}`)} />
      <Details title="Warnings" items={report.warnings.map((w) => `Row ${w.row} “${w.title}”: ${w.message}`)} />
      <Details title="Skipped" items={report.skipped.map((s) => `Row ${s.row}: ${s.reason}`)} />
      <Details title="Updated" items={report.updated.map((u) => `Row ${u.row} “${u.title}”: ${u.fields.join(", ")}`)} />
      <Details
        title="Kept admin edits"
        items={report.keptAdminEdits.map((k) => `Row ${k.row} “${k.title}”: sheet differs on ${k.fields.join(", ")}, kept the app value`)}
      />
      <Details title="No longer in the sheet (kept here)" items={report.noLongerInSheet.map((n) => `“${n.title}”`)} />
    </div>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <strong className="tabular-nums">{n}</strong> {label}
    </span>
  );
}

function Note({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return <p className={tone === "warn" ? "rounded-lg bg-amber-50 px-3 py-2 text-amber-900" : ""}>{children}</p>;
}

function Details({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="rounded-lg bg-slate-50 px-3 py-2" open={title === "Unassigned" || title === "Warnings"}>
      <summary className="cursor-pointer font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mt-1 list-disc pl-5 text-slate-700">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
