// Speech to text, behind one function so the provider can be swapped (Claude does not transcribe
// audio). Default: OpenAI audio transcription, POST /v1/audio/transcriptions, model TRANSCRIBE_MODEL
// (default gpt-transcribe; the older whisper-1 / gpt-4o-*-transcribe are deprecated). Limits from the
// provider's docs: files up to 25 MB, formats mp3, mp4, mpeg, mpga, m4a, wav, webm. Our segments are
// ~10 minutes of 32 kbps MP3 (~2.4 MB), well inside that.
// gpt-transcribe takes a `languages` list ("sl", or "sl" + "en"); older models take a single `language`.

export const DEFAULT_TRANSCRIBE_MODEL = "gpt-transcribe";
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
const PROMPT_MAX_CHARS = 800;

export function transcribeModel(): string {
  return process.env.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
}

/** Off (button hidden, admins told why) without OPENAI_API_KEY. */
export function transcribeEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export type TranscribeInput = {
  audio: Blob;
  fileName: string;
  /** ISO 639-1 codes; empty = let the model detect the language. */
  languages: string[];
  /** Context that helps spelling, e.g. the meeting title and attendees' names. */
  prompt?: string;
};
export type TranscribeResult = { text: string; model: string; seconds?: number };
export type Transcriber = (input: TranscribeInput) => Promise<TranscribeResult>;

export class TranscribeError extends Error {}

export async function transcribeAudio(input: TranscribeInput, fetchImpl: typeof fetch = fetch): Promise<TranscribeResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TranscribeError("Transcription is not set up (OPENAI_API_KEY).");
  if (input.audio.size > MAX_TRANSCRIBE_BYTES) throw new TranscribeError("This part is larger than the 25 MB the provider accepts.");
  const model = transcribeModel();

  const form = new FormData();
  form.append("file", input.audio, input.fileName);
  form.append("model", model);
  form.append("response_format", "json");
  if (model.startsWith("gpt-transcribe")) {
    for (const code of input.languages) form.append("languages[]", code);
  } else if (input.languages.length === 1) {
    form.append("language", input.languages[0]);
  }
  if (input.prompt) form.append("prompt", input.prompt.slice(0, PROMPT_MAX_CHARS));

  let res: Response;
  try {
    res = await fetchImpl(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    throw new TranscribeError(`The transcription request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    // Only the provider's message: never the request or the key.
    let message = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      message = j.error?.message ?? "";
    } catch {}
    throw new TranscribeError(`Transcription failed (${res.status}${message ? `: ${message.slice(0, 200)}` : ""}).`);
  }
  const body = (await res.json()) as { text?: unknown; usage?: { type?: string; seconds?: number } };
  if (typeof body.text !== "string") throw new TranscribeError("The transcription answer could not be read.");
  return { text: body.text.trim(), model, seconds: body.usage?.type === "duration" ? body.usage.seconds : undefined };
}
