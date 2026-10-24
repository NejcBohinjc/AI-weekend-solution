// Supabase Storage over its REST API, server-side only: SUPABASE_SERVICE_ROLE_KEY is not a NEXT_PUBLIC_
// variable, so it is never bundled for the browser. The browser only gets short-lived signed URLs (upload straight to Storage, so audio never
// passes through our functions and their ~4.5 MB body limit). Tests use FakeStore (fake-store.ts).
import { RECORDINGS_BUCKET } from "@/lib/recordings/constants";

export interface ObjectStore {
  /** Absolute URL the browser PUTs the file to (valid about 2 hours). Re-uploading the same path overwrites it. */
  signedUploadUrl(path: string): Promise<string>;
  /** Absolute download URLs, null where an object is missing. */
  signedDownloadUrls(paths: string[], expiresInSeconds: number): Promise<(string | null)[]>;
  /** Size in bytes, null if the object does not exist. */
  size(path: string): Promise<number | null>;
  download(path: string): Promise<Blob>;
  remove(paths: string[]): Promise<void>;
}

export function storageConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class StorageError extends Error {}

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StorageError("Storage is not set up (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).");
  return { base: `${url}/storage/v1`, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { base, headers } = config();
  const { json, ...rest } = init;
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: { ...headers, ...(json !== undefined && { "content-type": "application/json" }), ...(rest.headers as Record<string, string>) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  return res;
}

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  let message = text;
  try {
    const j = JSON.parse(text);
    message = j.message ?? j.error ?? text;
  } catch {}
  throw new StorageError(`Storage ${what} failed (${res.status}${message ? `: ${String(message).slice(0, 200)}` : ""}).`);
}

export const supabaseStore: ObjectStore = {
  async signedUploadUrl(path) {
    const res = await call(`/object/upload/sign/${RECORDINGS_BUCKET}/${encodePath(path)}`, { method: "POST", json: {}, headers: { "x-upsert": "true" } });
    if (!res.ok) await fail(res, "upload link");
    const { url } = (await res.json()) as { url?: string };
    if (!url || !url.includes("token=")) throw new StorageError("Storage did not return an upload link.");
    return `${config().base}${url}`;
  },
  async signedDownloadUrls(paths, expiresIn) {
    if (!paths.length) return [];
    const res = await call(`/object/sign/${RECORDINGS_BUCKET}`, { method: "POST", json: { expiresIn, paths } });
    if (!res.ok) await fail(res, "download link");
    const rows = (await res.json()) as { path?: string; signedURL?: string | null; error?: string | null }[];
    return paths.map((p) => {
      const row = rows.find((r) => r.path === p);
      return row?.signedURL ? `${config().base}${row.signedURL}` : null;
    });
  },
  async size(path) {
    const res = await call(`/object/info/${RECORDINGS_BUCKET}/${encodePath(path)}`);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) await fail(res, "lookup");
    const info = (await res.json()) as { size?: number; metadata?: { size?: number } };
    return info.size ?? info.metadata?.size ?? null;
  },
  async download(path) {
    const res = await call(`/object/authenticated/${RECORDINGS_BUCKET}/${encodePath(path)}`);
    if (!res.ok) await fail(res, "download");
    return res.blob();
  },
  async remove(paths) {
    if (!paths.length) return;
    const res = await call(`/object/${RECORDINGS_BUCKET}`, { method: "DELETE", json: { prefixes: paths } });
    if (!res.ok) await fail(res, "delete");
  },
};
