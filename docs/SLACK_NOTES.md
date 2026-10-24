# Slack notes, for the extras only

The core platform never writes to Slack. These notes matter only if you build the Slack extras: announcements and reminders, or the activity signal in the admin view.

## Your own workspace, three lines

1.  Create a free workspace at slack.com/create and invite your teammate.

2.  Make one channel per meeting series if you want, or just \#general.

3.  On Sunday morning invite the jury, so there are real posts and reactions to show in the demo.

Everything below works on the free plan. Limits: 10 apps per workspace, 90 days of visible message history.

## Bot app

api.slack.com/apps, "Create New App", then "OAuth & Permissions". Bot token scopes:

| **Scope**                       | **For**                                                                                    |
|---------------------------------|--------------------------------------------------------------------------------------------|
| users:read, users:read.email    | match Slack users to roster.csv by email                                                   |
| channels:read, channels:history | who posts and replies                                                                      |
| reactions:read                  | who reacts                                                                                 |
| chat:write                      | announcements and reminders (chat.postMessage, chat.scheduleMessage, up to 120 days ahead) |

Presence: users.getPresence returns "active" or "away" for other users. Slack has no API that tells you whether someone has read a message, so the activity signal is reactions, posts and presence.

Socket Mode lets your app receive events without a public URL while you develop. Subscribe to events (message, reaction_added) rather than polling history.
