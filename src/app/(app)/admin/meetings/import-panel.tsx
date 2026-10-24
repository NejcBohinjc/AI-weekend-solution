"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";
import type { ImportReport } from "@/lib/meetings/import";
import { importFromUrlAction, importIcsFileAction } from "./actions";

type AutoSync = { minutes: number; last: { at: string; ok: boolean; error: string | null } | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

/**
 * With MEETINGS_ICS_URL set (`auto`), meetings are pulled from Google Calendar automatically and this
 * shows how that is going, with "Sync now". Without it, admins import an .ics file. Either way the
 * file upload stays available.
 */
export function ImportPanel({ last, lastBy, auto }: { last: ImportReport | null; lastBy: string | null; auto: AutoSync | null }) {
  const [fileReport, fileAction, importing] = useActionState(importIcsFileAction, null as ImportReport | null);
  const [urlReport, urlAction, syncing] = useActionState(importFromUrlAction, null as ImportReport | null);
  const report = [fileReport, urlReport].filter(Boolean).sort((a, b) => b!.at.localeCompare(a!.at))[0] ?? last;
  const fresh = report !== last;

  const uploadForm = (
    <form action={fileAction} className="flex flex-wrap items-center gap-2">
      <input type="file" name="file" accept=".ics,text/calendar" required className="max-w-full text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-medium" />
      <button type="submit" disabled={importing} className={secondaryButtonClass}>
        {importing ? "Importing…" : "Import .ics file"}
      </button>
      <label className="flex basis-full items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" name="wholeCalendar" defaultChecked={!auto} className="size-3.5" />
        This is the whole calendar: hide upcoming meetings that are not in it
      </label>
    </form>
  );

  return (
    <section aria-label="Calendar import" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      {auto ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Google Calendar</h2>
              <p className="text-xs text-subtle" data-testid="calendar-sync-status">
                Pulled automatically every {auto.minutes} minutes when someone opens the app, and by the scheduled job.{" "}
                {auto.last ? (
                  <span className={auto.last.ok ? "" : "font-medium text-danger"}>
                    Last pull {when(auto.last.at)}
                    {auto.last.ok ? "." : ` failed: ${auto.last.error}`}
                  </span>
                ) : (
                  "Not pulled yet."
                )}{" "}
                Read-only: the calendar is never changed.
              </p>
            </div>
            <form action={urlAction}>
              <button type="submit" disabled={syncing} className={secondaryButtonClass}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </form>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Import an .ics file instead</summary>
            <div className="mt-2">{uploadForm}</div>
          </details>
        </>
      ) : (
        <>
          <div>
            <h2 className="font-semibold">Calendar</h2>
            <p className="text-xs text-subtle">
              Not connected to Google Calendar, so meetings are imported from a file. To pull them automatically, set MEETINGS_ICS_URL
              to the calendar&apos;s secret iCal address. Read-only: the calendar is never changed.
            </p>
          </div>
          {uploadForm}
        </>
      )}
      {report && (
        <>
          <p className="text-xs text-subtle">
            {fresh ? "Just now" : `Last import ${when(report.at)}${lastBy ? ` by ${lastBy}` : ""}`} ({report.source === "url" ? "Google Calendar" : report.source}):
          </p>
          <ImportReportView report={report} />
        </>
      )}
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  if (!report.ok) {
    return (
      <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
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
        {report.relinked > 0 && <span title="Same title and start time, new UID in the calendar">{report.relinked} matched to existing meetings</span>}
      </p>
      {report.unknownEmails.length > 0 && (
        <details className="rounded-lg bg-warning-bg px-3 py-2 text-warning" open>
          <summary className="cursor-pointer font-medium">Invitees who are not members ({report.unknownEmails.length})</summary>
          <p className="mt-1">{report.unknownEmails.map((u) => `${u.email} (${u.meetings})`).join(", ")}</p>
          <p className="mt-1 text-xs">Add them on Admin → Members with the same email, then import again.</p>
        </details>
      )}
      {report.removed.length > 0 && (
        <details className="rounded-lg bg-surface-2 px-3 py-2">
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
