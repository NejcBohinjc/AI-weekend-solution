// IndexedDB for the recorder: every finished MP3 segment is stored here until the server confirms its
// upload, and each recording has a session row. If the tab crashes or the phone dies, the next visit
// finds them and offers to finish uploading. Falls back to memory when IndexedDB is unavailable
// (some private windows): recording still works, only crash recovery is lost.

export type StoredSegment = { recordingId: number; index: number; ext: string; blob: Blob; durationMs: number };
/** "recording": being recorded in some tab (found on load = interrupted); "finishing": upload what is left, then finish. */
export type StoredSession = { recordingId: number; meetingId: number; meetingTitle: string; startedAt: number; state: "recording" | "finishing" };

const DB = "shapers-recorder";
let opening: Promise<IDBDatabase | null> | null = null;
const memory = { segments: new Map<string, StoredSegment>(), sessions: new Map<number, StoredSession>() };

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("segments", { keyPath: ["recordingId", "index"] });
        req.result.createObjectStore("sessions", { keyPath: "recordingId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

export async function persistent(): Promise<boolean> {
  return (await open()) !== null;
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const key = (recordingId: number, index: number) => `${recordingId}:${index}`;

export async function putSegment(seg: StoredSegment): Promise<void> {
  const db = await open();
  if (!db) return void memory.segments.set(key(seg.recordingId, seg.index), seg);
  await run(db, "segments", "readwrite", (s) => s.put(seg));
}

export async function deleteSegment(recordingId: number, index: number): Promise<void> {
  const db = await open();
  if (!db) return void memory.segments.delete(key(recordingId, index));
  await run(db, "segments", "readwrite", (s) => s.delete([recordingId, index]));
}

export async function listSegments(): Promise<StoredSegment[]> {
  const db = await open();
  const all = db ? await run<StoredSegment[]>(db, "segments", "readonly", (s) => s.getAll()) : [...memory.segments.values()];
  return all.sort((a, b) => a.recordingId - b.recordingId || a.index - b.index);
}

export async function putSession(session: StoredSession): Promise<void> {
  const db = await open();
  if (!db) return void memory.sessions.set(session.recordingId, session);
  await run(db, "sessions", "readwrite", (s) => s.put(session));
}

export async function deleteSession(recordingId: number): Promise<void> {
  const db = await open();
  if (!db) return void memory.sessions.delete(recordingId);
  await run(db, "sessions", "readwrite", (s) => s.delete(recordingId));
}

export async function listSessions(): Promise<StoredSession[]> {
  const db = await open();
  return db ? run<StoredSession[]>(db, "sessions", "readonly", (s) => s.getAll()) : [...memory.sessions.values()];
}
