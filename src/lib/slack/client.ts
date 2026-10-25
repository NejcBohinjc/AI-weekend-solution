// Minimal Slack Web API client (plain fetch, no SDK). Only used by the Slack extras, and only when
// SLACK_BOT_TOKEN is set. Tests pass a fake SlackApi instead (fake-slack.ts).

export type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };
export type SlackApi = { call(method: string, params?: Record<string, unknown>): Promise<SlackResponse> };

/** A Slack API error, with Slack's error code (e.g. "not_in_channel", "missing_scope"). */
export class SlackError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
    readonly needed?: string,
  ) {
    super(`${method}: ${code}${needed ? ` (needs scope ${needed})` : ""}`);
  }
}

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

/** The real client, or null without SLACK_BOT_TOKEN. Throws SlackError when Slack says ok: false. */
export function slackClient(token = process.env.SLACK_BOT_TOKEN): SlackApi | null {
  if (!token) return null;
  return {
    async call(method, params = {}) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
      });
      if (res.status === 429) throw new SlackError(method, `ratelimited, retry after ${res.headers.get("retry-after") ?? "?"} s`);
      const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as SlackResponse;
      if (!json.ok) throw new SlackError(method, json.error ?? `HTTP ${res.status}`, json.needed as string | undefined);
      return json;
    },
  };
}

/** Describes any error for people (admins): Slack's code, or the message. */
export function describeSlackError(err: unknown): string {
  if (err instanceof SlackError) {
    const hints: Record<string, string> = {
      not_in_channel: "the app is not in that channel: in Slack, type /invite @<app name> there",
      channel_not_found: "the channel no longer exists, or the app cannot see it",
      invalid_auth: "SLACK_BOT_TOKEN is not valid",
      not_authed: "SLACK_BOT_TOKEN is missing",
      account_inactive: "the app was removed from the workspace",
      missing_scope: `the app needs another permission${err.needed ? ` (${err.needed})` : ""}: add it under OAuth & Permissions and reinstall the app`,
      time_too_far: "Slack schedules messages at most 120 days ahead",
    };
    return `${err.code}${hints[err.code] ? `: ${hints[err.code]}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}
