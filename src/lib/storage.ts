// File storage for meeting recordings.
//
// "s3": any S3-compatible bucket (Cloudflare R2, AWS S3, Supabase Storage, MinIO), set with the
//   RECORDINGS_S3_* variables. Browsers upload and play files directly with short-lived signed URLs,
//   so large files never pass through the app (Vercel accepts request bodies of 4.5 MB at most).
//   The bucket stays private and needs a CORS rule allowing PUT and GET from the app's address.
// "local": without those variables, in development only, files go to .data/recordings and are
//   uploaded and played through the app's own /api/recordings routes.
// "none": production without a bucket: recordings can be made and downloaded, not stored.
import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageMode = "s3" | "local" | "none";

const LOCAL_DIR = path.join(process.cwd(), ".data", "recordings");
const UPLOAD_URL_SECONDS = 60 * 60;
const PLAY_URL_SECONDS = 60 * 60;

export function storageMode(): StorageMode {
  const e = process.env;
  if (e.RECORDINGS_S3_BUCKET && e.RECORDINGS_S3_ACCESS_KEY_ID && e.RECORDINGS_S3_SECRET_ACCESS_KEY) return "s3";
  return process.env.NODE_ENV === "production" ? "none" : "local";
}

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    region: process.env.RECORDINGS_S3_REGION || "auto",
    endpoint: process.env.RECORDINGS_S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.RECORDINGS_S3_ENDPOINT),
    credentials: {
      accessKeyId: process.env.RECORDINGS_S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.RECORDINGS_S3_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}
const bucket = () => process.env.RECORDINGS_S3_BUCKET!;

/** The path of a stored file on disk ("local" mode); throws if the key would leave the folder. */
export function localPath(key: string): string {
  const full = path.resolve(LOCAL_DIR, key);
  if (!full.startsWith(LOCAL_DIR + path.sep)) throw new Error("Bad storage key");
  return full;
}

/** Where the browser sends the file with a PUT (with this Content-Type). `localUrl` is used in "local" mode. */
export async function uploadUrl(key: string, contentType: string, localUrl: string): Promise<string> {
  if (storageMode() === "s3") {
    return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: UPLOAD_URL_SECONDS });
  }
  return localUrl;
}

/** A URL the browser can play the file from. `localUrl` is used in "local" mode. */
export async function playUrl(key: string, contentType: string, localUrl: string): Promise<string> {
  if (storageMode() === "s3") {
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentType: contentType }), { expiresIn: PLAY_URL_SECONDS });
  }
  return localUrl;
}

/** Size of the stored file in bytes, or null if it is not there (yet). */
export async function storedSize(key: string): Promise<number | null> {
  try {
    if (storageMode() === "s3") {
      const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return head.ContentLength ?? null;
    }
    return (await stat(localPath(key))).size;
  } catch {
    return null;
  }
}

export async function deleteStored(key: string): Promise<void> {
  try {
    if (storageMode() === "s3") await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    else await unlink(localPath(key));
  } catch {
    // Already gone.
  }
}

// ---------- "local" mode: the app's own upload and download routes ----------

/** Writes an upload to disk, stopping at `maxBytes`. Returns the bytes written. */
export async function writeLocal(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  let written = 0;
  const counted = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>).map((chunk: Buffer) => {
    written += chunk.length;
    if (written > maxBytes) throw new Error("File too large");
    return chunk;
  });
  await pipeline(counted, createWriteStream(file));
  return written;
}

/** A stored file (or part of it) as a web stream, for "local" mode playback. */
export function readLocal(key: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(localPath(key), range)) as ReadableStream<Uint8Array>;
}
