// Reads meetings from an iCalendar (.ics) file, such as a Google Calendar export or its iCal address.
// Pure (no I/O), so it is unit-tested (ics.test.ts). Uses ical.js for the format details Google
// produces: line folding, escaping, time zones (VTIMEZONE / TZID), recurring events (RRULE, EXDATE)
// and changed or cancelled single occurrences (RECURRENCE-ID).
import ICAL from "ical.js";
import { ljubljanaToUtc } from "@/lib/hours/time";

export type ParsedMeeting = {
  uid: string;
  title: string;
  series: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  /** The event description for people to read (see displayDescription), or null. */
  description: string | null;
  cancelled: boolean;
  /** Invitees: emails from the "Members:" line of the description and from ATTENDEE properties, lowercase. */
  emails: string[];
};

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type Event = InstanceType<typeof ICAL.Event>;

const pad = (n: number) => String(n).padStart(2, "0");

/** The instant of an iCal time. Floating times, and zones the file does not define, are read as Ljubljana time. */
function toDate(t: Time): Date {
  const tzid = t.zone?.tzid;
  if (tzid && tzid !== "floating") {
    const u = t.convertToZone(ICAL.Timezone.utcTimezone);
    return new Date(Date.UTC(u.year, u.month - 1, u.day, u.hour, u.minute, u.second));
  }
  return ljubljanaToUtc(`${t.year}-${pad(t.month)}-${pad(t.day)}`, `${pad(t.hour)}:${pad(t.minute)}`);
}

/** Google Calendar descriptions may contain HTML; turn it into plain lines. */
function plainText(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * The description as plain text for people: iCal escapes undone (ical.js does this; leftover literal
 * "\\n", "\\," and "\\;" from double-escaping exports too), HTML from Google turned into text (links
 * keep their address), and the machine lines "Series: …" and "Members: …" removed. Null if nothing is left.
 */
export function displayDescription(raw: unknown): string | null {
  let text = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1");
  if (/<[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      // <a href="https://x">label</a> -> "label (https://x)", or just the address when they are the same
      .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
        const l = label.replace(/<[^>]+>/g, "").trim();
        return !l || l === href ? href : `${l} (${href})`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "");
  }
  text = text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .split("\n")
    .filter((line) => !/^\s*(Series|Members):/i.test(line))
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

function invitees(event: Component, description: string): string[] {
  const emails = new Set<string>();
  const line = description.match(/^\s*Members:\s*(.+)$/im);
  if (line) {
    for (const part of line[1].split(/[\s,;]+/)) if (EMAIL.test(part)) emails.add(part.toLowerCase());
  }
  for (const prop of event.getAllProperties("attendee")) {
    const value = String(prop.getFirstValue() ?? "").replace(/^mailto:/i, "");
    if (EMAIL.test(value)) emails.add(value.toLowerCase());
  }
  return [...emails].sort();
}

/** "Series: Grants" in the description, else the first category, else the title without " meeting". */
function seriesOf(event: Component, description: string, title: string): string {
  const fromDescription = description.match(/^\s*Series:\s*(.+)$/im)?.[1].trim();
  if (fromDescription) return fromDescription;
  const category = event.getFirstProperty("categories")?.getFirstValue();
  if (category) return String(category).trim();
  return title.replace(/\s+meeting$/i, "").trim() || title;
}

function describe(event: Event, startsAt: Date, endsAt: Date, uid: string): ParsedMeeting {
  const component = event.component;
  const title = String(event.summary ?? "").trim() || "Meeting";
  const description = plainText(event.description);
  return {
    uid,
    title,
    series: seriesOf(component, description, title),
    startsAt,
    endsAt,
    location: String(event.location ?? "").trim() || null,
    description: displayDescription(event.description),
    cancelled: String(component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED",
    emails: invitees(component, description),
  };
}

/**
 * All meetings in the file. A recurring event becomes one meeting per occurrence that starts inside
 * [from, to); a one-off event is always included. Events without a UID or start are skipped.
 */
export function parseIcs(text: string, { from, to }: { from: Date; to: Date }): { meetings: ParsedMeeting[]; skipped: number } {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const vevents = root.getAllSubcomponents("vevent");
  const masters: Event[] = [];
  const exceptions = new Map<string, Event[]>();
  let skipped = 0;
  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    if (!event.uid || !event.startDate) {
      skipped++;
      continue;
    }
    if (event.isRecurrenceException()) exceptions.set(event.uid, [...(exceptions.get(event.uid) ?? []), event]);
    else masters.push(event);
  }

  const meetings: ParsedMeeting[] = [];
  // An event without an end (or with end = start) is given an hour.
  const endOf = (startsAt: Date, end: Time | undefined) => {
    const endsAt = end ? toDate(end) : null;
    return endsAt && endsAt > startsAt ? endsAt : new Date(startsAt.getTime() + 60 * 60_000);
  };
  for (const event of masters) {
    for (const ex of exceptions.get(event.uid) ?? []) event.relateException(ex);

    if (!event.isRecurring()) {
      const startsAt = toDate(event.startDate);
      meetings.push(describe(event, startsAt, endOf(startsAt, event.endDate), event.uid));
      continue;
    }

    const it = event.iterator();
    for (let next = it.next(), n = 0; next && n < 5000; next = it.next(), n++) {
      const occurrence = event.getOccurrenceDetails(next);
      const startsAt = toDate(occurrence.startDate);
      const recurrenceStart = toDate(occurrence.recurrenceId);
      if (recurrenceStart >= to && startsAt >= to) break;
      if (startsAt < from || startsAt >= to) continue;
      meetings.push(describe(occurrence.item, startsAt, endOf(startsAt, occurrence.endDate), `${event.uid}#${recurrenceStart.toISOString()}`));
    }
  }
  return { meetings: meetings.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), skipped };
}
