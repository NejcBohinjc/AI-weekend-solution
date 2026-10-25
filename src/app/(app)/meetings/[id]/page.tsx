import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { TierBadge } from "@/components/badges";
import { LinkifiedText } from "@/components/linkified-text";
import { AttendanceBadge, meetingWhen, SeriesBadge } from "@/components/meetings";
import { db } from "@/db";
import { aiTaskRuns, meetingNotes, members } from "@/db/schema";
import { aiEnabled } from "@/lib/ai/meeting-tasks";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { ATTENDANCE_STATES, STATE_LABELS } from "@/lib/meetings/constants";
import { syncCalendarInBackground } from "@/lib/meetings/auto-sync";
import { meetingAttendees, meetingById } from "@/lib/meetings/queries";
import { attendanceSummary, effectiveState, meetingPhase, memberActions } from "@/lib/meetings/rules";
import { noticeHint } from "@/lib/meetings/absence";
import { adminMarkRestPresentAction, adminSetAttendanceAction, decideLateNoticeAction, setMyAttendanceAction } from "../actions";
import { AttendanceActions } from "../attendance-actions";
import { addNoteAction, createTasksFromNotesAction } from "../notes-actions";
import { AddNotesSection, CreateTasksButton } from "../notes-ui";
import { RecordingItem, type RecordingView } from "../recordings-ui";
import { EarlierRecordings, earlierRecordings } from "../recordings-section";
import { RecorderPanel } from "@/components/recorder/recorder-panel";
import { transcribeEnabled } from "@/lib/ai/transcribe";
import { recordingsOfMeeting } from "@/lib/recordings/service";
import { storageConfigured } from "@/lib/storage/supabase";

// Transcribing a recording runs in the background after a server action on this page.
export const maxDuration = 300;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  // Everything the page needs only depends on the id in the URL, so it is fetched while the session is
  // checked (one wait instead of two). Nothing is shown before the invitee-or-admin check below.
  const [me, meeting, attendees, notes, runs, recs, earlier] = await Promise.all([
    requireMember(),
    meetingById(id),
    meetingAttendees(id),
    db
      .select({ note: meetingNotes, author: members.name })
      .from(meetingNotes)
      .leftJoin(members, eq(meetingNotes.authorId, members.id))
      .where(eq(meetingNotes.meetingId, id))
      .orderBy(desc(meetingNotes.createdAt)),
    db
      .select({ noteId: aiTaskRuns.noteId, ok: aiTaskRuns.ok, created: aiTaskRuns.created, at: aiTaskRuns.createdAt, by: members.name })
      .from(aiTaskRuns)
      .leftJoin(members, eq(aiTaskRuns.triggeredById, members.id))
      .where(eq(aiTaskRuns.meetingId, id))
      .orderBy(desc(aiTaskRuns.id)),
    recordingsOfMeeting(id),
    earlierRecordings(id),
  ]);
  syncCalendarInBackground();
  if (!meeting) notFound();
  const mine = attendees.find((a) => a.memberId === me.id);
  if (!mine && !me.isAdmin) notFound();

  const now = new Date();
  const phase = meetingPhase(meeting, now);
  const cancelled = meeting.status !== "confirmed";
  const lateOf = (a: { lateNotice: boolean | null; lateDecision: "accepted" | "rejected" | null }) => ({ lateNotice: !!a.lateNotice, lateDecision: a.lateDecision });
  const people = attendees.map((a) => ({ ...a, effective: effectiveState(a.state, meeting, now, lateOf(a)) }));
  const summary = attendanceSummary(people.map((p) => p.effective));
  const unanswered = people.filter((p) => !p.state).length;
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const recordingViews: RecordingView[] = recs.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    durationMs: r.durationMs,
    status: r.status,
    error: r.error,
    source: r.source,
    fileName: r.fileName,
    startedBy: r.startedByName,
    parts: r.segments.length,
    failedParts: r.segments.filter((g) => g.transcriptStatus === "failed").length,
    transcript: r.transcript,
    savedNote: r.savedNoteId !== null,
    transcribedSeconds: r.transcribedSeconds,
    transcribeModel: r.transcribeModel,
    languages: r.languages,
  }));

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={me.isAdmin && !mine ? "/admin/meetings" : "/meetings"} className="text-sm text-subtle hover:text-fg">
          ← Meetings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{meeting.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <SeriesBadge series={meeting.series} />
          <span>{meetingWhen(meeting)}</span>
          {meeting.location && <span>· {meeting.location}</span>}
        </p>
        {cancelled && (
          <p className="rounded-xl bg-surface-3 px-4 py-2 text-sm text-fg-2">
            {meeting.status === "cancelled" ? "This meeting was cancelled in the calendar." : "This meeting is no longer in the calendar."}
          </p>
        )}
      </div>

      {meeting.description && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4" data-testid="meeting-description">
          <h2 className="text-sm font-semibold text-subtle">From the calendar</h2>
          <LinkifiedText text={meeting.description} className="text-sm text-fg" />
        </div>
      )}

      {mine && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm" data-testid="my-attendance">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Your attendance</h2>
            {!cancelled &&
              (mine.state === "excused" && mine.lateNotice ? (
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning-line">
                  Late notice{mine.lateDecision === "accepted" ? ": accepted" : mine.lateDecision === "rejected" ? ": not accepted" : ": waiting for an admin"}
                </span>
              ) : (
                <AttendanceBadge state={effectiveState(mine.state, meeting, now, lateOf(mine))} />
              ))}
          </div>
          <AttendanceActions
            action={setMyAttendanceAction.bind(null, meeting.id)}
            current={mine.state}
            note={mine.note}
            can={memberActions({ ...meeting, cancelled }, now)}
            lockedByAdmin={mine.source === "admin"}
            noticeHint={noticeHint(meeting.startsAt, now)}
            />
          {!cancelled && phase === "upcoming" && (
            <p className="text-xs text-subtle">Check-in opens 15 minutes before the start. If you don&apos;t check in or send an excuse, you count as unexcused.</p>
          )}
        </div>
      )}

      {/* Recordings: admins record and manage them; invitees can listen and read the transcript. */}
      {(me.isAdmin || recordingViews.length > 0) && (
        <div id="recording" className="flex scroll-mt-28 flex-col gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="recordings">
          <h2 className="font-semibold">{me.isAdmin ? "Record meeting" : "Recordings"}</h2>
          {me.isAdmin && <RecorderPanel meetings={[{ id: meeting.id, title: meeting.title, label: meeting.title }]} initialId={meeting.id} storageReady={storageConfigured()} />}
          {recordingViews.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              {me.isAdmin && <h3 className="text-sm font-semibold text-subtle">Recordings</h3>}
              {recordingViews.map((r) => (
                <RecordingItem key={r.id} rec={r} meetingId={meeting.id} meetingTitle={meeting.title} isAdmin={me.isAdmin} transcribeReady={transcribeEnabled()} />
              ))}
            </div>
          )}
        </div>
      )}
      <EarlierRecordings rows={earlier} me={me} now={now} />

      {/* Notes: this page is only shown to the meeting's invitees and admins. */}
      <div id="notes" className="flex scroll-mt-28 flex-col gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="meeting-notes">
        <h2 className="font-semibold">Meeting notes</h2>
        {me.isAdmin && !aiEnabled() && (
          <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">
            Creating tasks from notes with AI is off: ANTHROPIC_API_KEY is not set. Notes can still be added. (Only admins see this.)
          </p>
        )}
        {notes.map(({ note, author }) => {
          // The run that created this note's tasks (a rerun on the same notes creates none).
          const lastRun = runs.find((r) => r.noteId === note.id && r.ok && r.created > 0) ?? runs.find((r) => r.noteId === note.id && r.ok);
          return (
            <div key={note.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <p className="text-xs text-subtle">
                Added by {author ?? "a former member"} on {fmt(note.createdAt)}
                {note.fileName && ` · ${note.fileName}`} · {note.content.length.toLocaleString("en-GB")} characters
              </p>
              <details>
                <summary className="cursor-pointer text-sm font-medium">Show notes</summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-sans text-sm text-fg-2">{note.content}</pre>
              </details>
              {lastRun && (
                <p className="text-xs text-subtle">
                  AI ran on {fmt(lastRun.at)}{lastRun.by ? ` (${lastRun.by})` : ""}: {lastRun.created} {lastRun.created === 1 ? "task" : "tasks"} created.
                </p>
              )}
              {aiEnabled() && <CreateTasksButton action={createTasksFromNotesAction.bind(null, note.id, meeting.id)} />}
            </div>
          );
        })}
        {aiEnabled() && notes.length > 0 && (
          <Link href={`/meetings/ask?meeting=${meeting.id}`} className="self-start text-sm font-medium text-fg-2 underline-offset-2 hover:underline">
            ✦ Ask a question about these notes
          </Link>
        )}
        <AddNotesSection action={addNoteAction.bind(null, meeting.id)} initiallyOpen={notes.length === 0} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Invited ({people.length})</h2>
          {me.isAdmin && (
            <p className="text-sm text-muted">
              {summary.present} present · {summary.remote} remote · {summary.excused} excused · {summary.unexcused} unexcused
              {phase !== "past" && unanswered ? ` · ${unanswered} no answer yet` : ""}
            </p>
          )}
        </div>

        {me.isAdmin && phase !== "upcoming" && unanswered > 0 && !cancelled && (
          <form action={adminMarkRestPresentAction.bind(null, meeting.id)}>
            <button type="submit" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
              Mark the other {unanswered} present
            </button>
          </form>
        )}

        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm" data-testid="attendees">
          {people.map((p) => (
            <li key={p.memberId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {me.isAdmin && <TierBadge tier={p.tier} />}
                </span>
                {me.isAdmin && p.state === "excused" && p.lateNotice && (
                  <span className="flex flex-wrap items-center gap-2 text-xs" data-testid="late-notice">
                    <span className="rounded-full bg-warning-bg px-2 py-0.5 font-semibold text-warning ring-1 ring-inset ring-warning-line">
                      Late notice{p.noticeAt ? `, sent ${fmt(p.noticeAt)}` : ""}
                    </span>
                    {p.lateDecision ? (
                      <span className="text-muted">{p.lateDecision === "accepted" ? "Accepted as excused" : "Counts as unexcused"}</span>
                    ) : (
                      <>
                        <span className="text-muted">Counts as unexcused until you decide:</span>
                        <form action={decideLateNoticeAction.bind(null, meeting.id, p.memberId, "accepted")}>
                          <button type="submit" className="rounded-lg bg-surface px-2 py-1 font-medium text-fg-2 ring-1 ring-inset ring-line hover:bg-surface-2">
                            Accept as excused
                          </button>
                        </form>
                        <form action={decideLateNoticeAction.bind(null, meeting.id, p.memberId, "rejected")}>
                          <button type="submit" className="rounded-lg bg-surface px-2 py-1 font-medium text-fg-2 ring-1 ring-inset ring-line hover:bg-surface-2">
                            Count as unexcused
                          </button>
                        </form>
                      </>
                    )}
                  </span>
                )}
                {me.isAdmin && p.state && (
                  <span className="text-xs text-subtle">
                    {p.note && `“${p.note}” · `}
                    {p.source === "seed" ? "imported" : `${p.source === "admin" ? `set by ${p.setByName ?? "an admin"}` : "by themself"}, ${fmt(p.updatedAt!)}`}
                  </span>
                )}
              </span>
              {me.isAdmin ? (
                <form action={adminSetAttendanceAction.bind(null, meeting.id, p.memberId)} className="flex flex-wrap items-center gap-1" aria-label={`Attendance of ${p.name}`}>
                  {ATTENDANCE_STATES.map((s) => (
                    <button
                      key={s}
                      type="submit"
                      name="state"
                      value={s}
                      aria-pressed={(p.state ?? p.effective) === s}
                      className={`rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset ${(p.state ?? p.effective) === s ? "bg-primary text-on-primary ring-primary" : "bg-surface text-fg-2 ring-line hover:bg-surface-2"}`}
                    >
                      {STATE_LABELS[s]}
                    </button>
                  ))}
                  {p.state && (
                    <button type="submit" name="state" value="clear" className="px-1.5 text-xs text-subtle hover:underline" title="Remove the record">
                      Clear
                    </button>
                  )}
                </form>
              ) : p.memberId === me.id ? (
                <span className="text-xs text-subtle">you</span>
              ) : null}
            </li>
          ))}
        </ul>
        {me.isAdmin && <p className="text-xs text-subtle">A darker button shows the current state; unanswered invitees count as unexcused once the meeting is over.</p>}
      </div>
    </section>
  );
}
