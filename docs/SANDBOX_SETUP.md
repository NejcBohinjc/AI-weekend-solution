# Sandbox setup: Team coordination platform hackathon

Saturday 2026-10-24, 9:00. Read BRIEF.md first, then this page.

## What is in this package

| **File**        | **What it is**                                                        |
|-----------------|-----------------------------------------------------------------------|
| BRIEF.md        | The challenge. Read it first.                                         |
| SCHEDULE.md     | Saturday and Sunday times.                                            |
| meetings.ics    | Six meeting series, 2026-09-14 to 2026-11-21, 55 meetings.            |
| roster.csv      | 20 members: name, email, tier, weekly_hours, admin, series.           |
| attendance.xlsx | One sheet per series. Dates down, members across, four states.        |
| attendance.csv  | The same attendance, one row per member per meeting.                  |
| hours.csv       | One row per member per week, six weeks. The last week is in progress. |
| slack-notes.md  | Only if you go for the Slack extras.                                  |

## Calendar in three clicks

1.  Open Google Calendar on the web. Settings (gear icon), then "Import & export".

2.  Choose meetings.ics, pick the calendar to import into, click Import. Make a new calendar called "Sandbox" first if you want it separate.

3.  For API access: Settings, your Sandbox calendar, "Access permissions", tick "Make available to public". Copy the Calendar ID from "Integrate calendar". With a Google Cloud API key you can then read events without OAuth.

Times are Europe/Ljubljana. Each event's description lists the series and the members' emails, so you can match attendees to roster.csv.

## Data notes

- All people, emails and numbers are made up. The domain sandbox.example does not exist.

- Tiers and weekly hours: Core 70, Impact 10, GO! 4. Three members are admins (admin = yes in roster.csv).

- Attendance states: present, remote, excused, unexcused. Attendance exists for every meeting before 2026-10-24.

- hours.csv: week_start is the Monday of that week. The week of 2026-10-19 is in progress, entries run through Friday 2026-10-23.

- Community meetings include everyone. The other five series have their own members, listed in roster.csv under "series" and in each calendar event's description.

## Questions

WhatsApp group:

Everyone sees every answer.
