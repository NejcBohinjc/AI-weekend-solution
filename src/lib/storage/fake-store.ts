// In-memory ObjectStore for tests: "uploads" are put() directly, as the browser would.
import type { ObjectStore } from "./supabase";

export class FakeStore implements ObjectStore {
  objects = new Map<string, Blob>();
  removed: string[] = [];
  put(path: string, bytes: number | Blob) {
    this.objects.set(path, typeof bytes === "number" ? new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }) : bytes);
  }
  async signedUploadUrl(path: string) {
    return `https://storage.test/upload/${path}?token=t`;
  }
  async signedDownloadUrls(paths: string[]) {
    return paths.map((p) => (this.objects.has(p) ? `https://storage.test/download/${p}?token=t` : null));
  }
  async size(path: string) {
    return this.objects.get(path)?.size ?? null;
  }
  async download(path: string) {
    const b = this.objects.get(path);
    if (!b) throw new Error(`missing ${path}`);
    return b;
  }
  async remove(paths: string[]) {
    for (const p of paths) {
      this.objects.delete(p);
      this.removed.push(p);
    }
  }
}
