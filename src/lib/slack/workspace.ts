// What Admin → Slack shows about the workspace: its name, its channels and its people.
import { describeSlackError, type SlackApi } from "./client";

export type SlackChannel = { id: string; name: string; isMember: boolean };
export type SlackUser = { id: string; name: string; email: string | null };
export type WorkspaceInfo = {
  team: string | null;
  bot: string | null;
  channels: SlackChannel[];
  users: SlackUser[];
  errors: string[];
};

type RawChannel = { id: string; name: string; is_member?: boolean };
type RawUser = { id: string; name: string; deleted?: boolean; is_bot?: boolean; real_name?: string; profile?: { real_name?: string; email?: string } };

async function paged<T>(api: SlackApi, method: string, key: string, params: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await api.call(method, { ...params, limit: 200, cursor });
    out.push(...((res[key] as T[]) ?? []));
    cursor = (res.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

/** Each part on its own: a missing scope for one part still shows the others. */
export async function workspaceInfo(api: SlackApi): Promise<WorkspaceInfo> {
  const info: WorkspaceInfo = { team: null, bot: null, channels: [], users: [], errors: [] };
  const [auth, channels, users] = await Promise.allSettled([
    api.call("auth.test"),
    paged<RawChannel>(api, "conversations.list", "channels", { types: "public_channel", exclude_archived: true }),
    paged<RawUser>(api, "users.list", "members", {}),
  ]);
  if (auth.status === "fulfilled") {
    info.team = (auth.value.team as string) ?? null;
    info.bot = (auth.value.user as string) ?? null;
  } else info.errors.push(`Connection: ${describeSlackError(auth.reason)}`);
  if (channels.status === "fulfilled") {
    info.channels = channels.value.map((c) => ({ id: c.id, name: c.name, isMember: !!c.is_member })).sort((a, b) => a.name.localeCompare(b.name));
  } else info.errors.push(`Channels: ${describeSlackError(channels.reason)}`);
  if (users.status === "fulfilled") {
    info.users = users.value
      .filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT")
      .map((u) => ({ id: u.id, name: u.profile?.real_name || u.real_name || u.name, email: u.profile?.email ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } else info.errors.push(`People: ${describeSlackError(users.reason)}`);
  return info;
}
