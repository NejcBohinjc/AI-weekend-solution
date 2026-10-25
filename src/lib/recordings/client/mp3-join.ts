// "Download MP3": MP3 files are a sequence of frames, so parts can be joined by concatenation once any
// ID3 tags (v2 at the start, v1 at the end) are removed. Our recorder writes none; imported files may.

export function stripId3(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  // ID3v2: "ID3", version (2), flags (1), size (4 bytes, 7 bits each), plus a 10-byte footer if flagged.
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    start = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  // ID3v1: "TAG" in the last 128 bytes.
  if (end - start >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) end -= 128;
  return bytes.subarray(Math.min(start, end), end);
}

export function joinMp3(parts: Uint8Array[]): Uint8Array {
  const stripped = parts.map(stripId3);
  const out = new Uint8Array(stripped.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of stripped) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
