// Joining the transcripts of a recording's parts. Pure (tested in join.test.ts).

export const FAILED_PART_TEXT = "(this part could not be transcribed)";

export function formatOffset(ms: number): string {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** The parts' texts in order, each starting with its offset in the recording, e.g. "[00:10:00] …". */
export function joinTranscripts(parts: { index: number; durationMs: number; text: string | null; failed?: boolean }[]): string {
  let offset = 0;
  const out: string[] = [];
  for (const p of [...parts].sort((a, b) => a.index - b.index)) {
    const text = p.failed ? FAILED_PART_TEXT : (p.text ?? "").trim();
    if (text) out.push(`[${formatOffset(offset)}] ${text}`);
    offset += p.durationMs;
  }
  return out.join("\n\n");
}
