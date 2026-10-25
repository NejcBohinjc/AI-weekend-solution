// In-memory stand-in for the Slack Web API, for tests. Records every call.
import { SlackError, type SlackApi, type SlackResponse } from "./client";

type Scheduled = { id: string; channel: string; post_at: number; text: string };

export class FakeSlack implements SlackApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  scheduled = new Map<string, Scheduled>();
  posted: { channel: string; text: string; ts: string }[] = [];
  users = new Map<string, string>(); // email -> Slack user id
  members = new Set<string>(); // channels the app is in
  failWith: string | null = null;
  private seq = 0;

  async call(method: string, params: Record<string, unknown> = {}): Promise<SlackResponse> {
    this.calls.push({ method, params });
    if (this.failWith) throw new SlackError(method, this.failWith);
    const channel = String(params.channel ?? "");
    const needsChannel = method === "chat.scheduleMessage" || method === "chat.postMessage";
    if (needsChannel && !this.members.has(channel)) throw new SlackError(method, "not_in_channel");
    switch (method) {
      case "users.lookupByEmail": {
        const id = this.users.get(String(params.email));
        if (!id) throw new SlackError(method, "users_not_found");
        return { ok: true, user: { id } };
      }
      case "chat.scheduleMessage": {
        const id = `Q${++this.seq}`;
        this.scheduled.set(id, { id, channel, post_at: Number(params.post_at), text: String(params.text) });
        return { ok: true, scheduled_message_id: id, channel };
      }
      case "chat.deleteScheduledMessage": {
        if (!this.scheduled.delete(String(params.scheduled_message_id))) throw new SlackError(method, "invalid_scheduled_message_id");
        return { ok: true };
      }
      case "chat.postMessage": {
        const ts = `${++this.seq}.000100`;
        this.posted.push({ channel, text: String(params.text), ts });
        return { ok: true, ts, channel };
      }
      case "chat.delete": {
        const i = this.posted.findIndex((p) => p.channel === channel && p.ts === String(params.ts));
        if (i < 0) throw new SlackError(method, "message_not_found");
        this.posted.splice(i, 1);
        return { ok: true };
      }
      case "chat.scheduledMessages.list": {
        // All on one page unless `limit` is smaller (the cursor is the offset).
        const all = [...this.scheduled.values()];
        const from = Number(params.cursor ?? 0);
        const limit = Number(params.limit ?? 100);
        const page = all.slice(from, from + limit).map((s) => ({ id: s.id, channel_id: s.channel, post_at: s.post_at }));
        const next = from + limit < all.length ? String(from + limit) : "";
        return { ok: true, scheduled_messages: page, response_metadata: { next_cursor: next } };
      }
      case "conversations.join":
        this.members.add(channel);
        return { ok: true };
      default:
        return { ok: true };
    }
  }

  /** Lets time pass: scheduled messages whose time has come are posted. */
  deliverUntil(now: Date) {
    for (const [id, s] of this.scheduled) {
      if (s.post_at * 1000 <= now.getTime()) {
        this.scheduled.delete(id);
        this.posted.push({ channel: s.channel, text: s.text, ts: `${s.post_at}.000200` });
      }
    }
  }
}
