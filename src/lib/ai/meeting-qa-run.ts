// "Ask about a meeting" against the database: finds the meeting (picked, or by a date in the question),
// checks access (the meeting's invitees and admins only), applies the per-member rate limit, sends the
// notes (capped) to Claude and records usage. Tested with a mocked API call in meeting-qa-run.test.ts.
import { and, asc, count, desc, eq, exists, gt, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { aiQuestions, meetingInvites, meetingNotes, meetings } from "@/db/schema";
import { ljubljanaParts, ljubljanaToUtc, addDays } from "@/lib/hours/time";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { AI_QUESTIONS_PER_HOUR, answerFromNotes, callClaudeQa, joinNotes, parseQuestionDate, QA_QUESTION_MAX_CHARS } from "./meeting-qa";
import { summaryOfMeeting } from "./meeting-summary-run";
import { canUseMeetingNotes } from "./meeting-tasks-run";
import type { ModelCall } from "./meeting-tasks";

type Member = { id: number; isAdmin: boolean };
export type MeetingRef = { id: number; title: string; series: string; startsAt: Date };

export type AskResult =
  | { kind: "error"; error: string }
  /** Several meetings with notes that day: the member picks one. */
  | { kind: "choose"; date: string; meetings: MeetingRef[] }
  | { kind: "answer"; meeting: MeetingRef; found: boolean; answer: string; quotes: string[]; truncated: boolean };

const ref = { id: meetings.id, title: meetings.title, series: meetings.series, startsAt: meetings.startsAt };
const hasNotes = exists(db.select({ one: meetingNotes.id }).from(meetingNotes).where(eq(meetingNotes.meetingId, meetings.id)));

/** Meetings with notes the member may ask about (invited, or any for admins), newest first. */
export async function askableMeetings(member: Member, limit = 100): Promise<MeetingRef[]> {
  const base = db.select(ref).from(meetings);
  const q = member.isAdmin
    ? base.where(hasNotes)
    : base.innerJoin(meetingInvites, and(eq(meetingInvites.meetingId, meetings.id), eq(meetingInvites.memberId, member.id))).where(hasNotes);
  return q.orderBy(desc(meetings.startsAt)).limit(limit);
}

/** Meetings on a Ljubljana day the member may access, with whether they have notes. */
async function meetingsOnDay(member: Member, date: string) {
  const from = ljubljanaToUtc(date, "00:00");
  const to = ljubljanaToUtc(addDays(date, 1), "00:00");
  const rows = await db
    .select(ref)
    .from(meetings)
    .where(and(gte(meetings.startsAt, from), lt(meetings.startsAt, to)))
    .orderBy(asc(meetings.startsAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [invited, withNotes] = await Promise.all([
    member.isAdmin
      ? Promise.resolve(ids)
      : db
          .select({ id: meetingInvites.meetingId })
          .from(meetingInvites)
          .where(and(eq(meetingInvites.memberId, member.id), inArray(meetingInvites.meetingId, ids)))
          .then((r) => r.map((x) => x.id)),
    db.selectDistinct({ id: meetingNotes.meetingId }).from(meetingNotes).where(inArray(meetingNotes.meetingId, ids)).then((r) => new Set(r.map((x) => x.id))),
  ]);
  return rows.filter((r) => invited.includes(r.id)).map((r) => ({ ...r, hasNotes: withNotes.has(r.id) }));
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function askAboutMeeting({
  member,
  question: rawQuestion,
  meetingId,
  date,
  call = callClaudeQa,
  now = new Date(),
}: {
  member: Member;
  question: string;
  meetingId?: number | null;
  /** yyyy-mm-dd picked in the form; otherwise a date in the question is used. */
  date?: string | null;
  call?: ModelCall;
  now?: Date;
}): Promise<AskResult> {
  const fail = (error: string): AskResult => ({ kind: "error", error });
  const question = rawQuestion.replace(/\s+/g, " ").trim();
  if (!question) return fail("Type a question.");
  if (question.length > QA_QUESTION_MAX_CHARS) return fail(`Keep the question under ${QA_QUESTION_MAX_CHARS} characters.`);

  // 1. Which meeting.
  let meeting: MeetingRef | undefined;
  if (meetingId) {
    [meeting] = await db.select(ref).from(meetings).where(eq(meetings.id, meetingId)).limit(1);
    // Same answer whether the meeting does not exist or is not theirs: nothing leaks.
    if (!meeting || !(await canUseMeetingNotes(member, meeting.id))) return fail("You can only ask about meetings you were invited to.");
  } else {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : parseQuestionDate(question, todayInLjubljana(now));
    if (!day) return fail("Pick a meeting or a date, or mention the date in your question (for example “14 October”).");
    const onDay = await meetingsOnDay(member, day);
    if (!onDay.length) return fail(`You had no meeting on ${dayLabel(day)}.`);
    const withNotes = onDay.filter((m) => m.hasNotes);
    if (!withNotes.length) return fail(`No notes are stored for ${onDay.length === 1 ? `“${onDay[0].title}”` : "the meetings"} on ${dayLabel(day)}.`);
    const plain = withNotes.map((m) => ({ id: m.id, title: m.title, series: m.series, startsAt: m.startsAt }));
    if (plain.length > 1) return { kind: "choose", date: day, meetings: plain };
    meeting = plain[0];
  }

  // 2. Its notes, newest first, capped.
  const [notes, stored] = await Promise.all([
    db
      .select({ content: meetingNotes.content, createdAt: meetingNotes.createdAt })
      .from(meetingNotes)
      .where(eq(meetingNotes.meetingId, meeting.id))
      .orderBy(desc(meetingNotes.createdAt)),
    summaryOfMeeting(meeting.id),
  ]);
  if (!notes.length) return fail(`No notes are stored for “${meeting.title}” yet.`);
  const { text, truncated } = joinNotes(notes.map((n) => ({ content: n.content, addedOn: ljubljanaParts(n.createdAt).date })));

  // 3. Rate limit (every question that reached the API counts).
  const [{ n }] = await db
    .select({ n: count() })
    .from(aiQuestions)
    .where(and(eq(aiQuestions.memberId, member.id), gt(aiQuestions.createdAt, new Date(now.getTime() - 3_600_000))));
  if (n >= AI_QUESTIONS_PER_HOUR) return fail(`You can ask ${AI_QUESTIONS_PER_HOUR} questions an hour. Please try again later.`);

  // 4. Ask.
  const result = await answerFromNotes({ title: meeting.title, series: meeting.series, date: ljubljanaParts(meeting.startsAt).date }, text, question, call, stored?.text);
  await db.insert(aiQuestions).values({
    memberId: member.id,
    meetingId: meeting.id,
    model: result.model,
    ok: result.ok,
    found: result.ok ? result.found : null,
    error: result.ok ? null : result.error,
    inputTokens: result.ok ? result.inputTokens : null,
    outputTokens: result.ok ? result.outputTokens : null,
  });
  if (!result.ok) return fail(result.error);
  return { kind: "answer", meeting, found: result.found, answer: result.answer, quotes: result.quotes, truncated };
}
