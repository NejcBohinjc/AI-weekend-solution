"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";
import type { ImportReport } from "@/lib/meetings/import";
import { importFromUrlAction, importIcsFileAction } from "./actions";

/** Import meetings from an .ics file, or from the calendar's iCal address when MEETINGS_ICS_URL is set. */
export function ImportPanel({ last, lastBy, hasUrl }: { last: ImportReport | null; lastBy: string | null; hasUrl: boolean }) {
  const [fileReport, fileAction, importing] = useActionState(importIcsFileAction, null as ImportReport | null);
  const [urlReport, urlAction, syncing] = useActionState(importFromUrlAction, null as ImportReport | null);
  const report = [fileReport, urlReport].filter(Boolean).sort((a, b) => b!.at.localeCompare(a!.at))[0] ?? last;
  const fresh = report !== last;
  const when = report && new Date(report.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

  return (
    <section aria-label="Calendar import" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Calendar</h2>
        <p className="text-xs text-slate-500">
          {report ? `${fresh ? "Imported" : "Last import"} ${when}${!fresh && lastBy ? ` by ${lastBy}` : ""} (${report.source}). ` : "Never imported. "}
          Read-only: the calendar is never changed. Invitees are matched to members by email.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <form action={fileAction} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".ics,text/calendar" required className="max-w-full text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium" />
          <button type="submit" disabled={importing} className={secondaryButtonClass}>
            {importing ? "Importing…" : "Import .ics file"}
          </button>
          <label className="flex basis-full items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" name="wholeCalendar" defaultChecked className="size-3.5" />
            This is the whole calendar: hide upcoming meetings that are not in it
          </label>
        </form>
        {hasUrl && (
          <form action={urlAction}>
            <button type="submit" disabled={syncing} className={secondaryButtonClass}>
              {syncing ? "Syncing…" : "Sync from Google Calendar"}
            </button>
          </form>
        )}
      </div>
      {report && <ImportReportView report={report} />}
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  if (!report.ok) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        Import failed: {report.error}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="import-report">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <strong className="tabular-nums">{report.meetings}</strong> meetings
        </span>
        <span>
          <strong className="tabular-nums">{report.created}</strong> new
        </span>
        <span>
          <strong className="tabular-nums">{report.updated}</strong> changed
        </span>
        <span>
          <strong className="tabular-nums">{report.invites}</strong> invitations
        </span>
        {report.cancelled > 0 && <span>{report.cancelled} cancelled</span>}
      </p>
      {report.unknownEmails.length > 0 && (
        <details className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900" open>
          <summary className="cursor-pointer font-medium">Invitees who are not members ({report.unknownEmails.length})</summary>
          <p className="mt-1">{report.unknownEmails.map((u) => `${u.email} (${u.meetings})`).join(", ")}</p>
          <p className="mt-1 text-xs">Add them on Admin → Members with the same email, then import again.</p>
        </details>
      )}
      {report.removed.length > 0 && (
        <details className="rounded-lg bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer font-medium">No longer in the calendar ({report.removed.length}), hidden</summary>
          <ul className="mt-1 list-disc pl-5">
            {report.removed.map((r, i) => (
              <li key={i}>
                {r.title}, {new Date(r.startsAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
