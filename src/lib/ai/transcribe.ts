// Speech to text, behind one function so the provider can be swapped (Claude does not transcribe audio).
// Any OpenAI-compatible endpoint works: POST <base>/audio/transcriptions with multipart form data.
//
//   TRANSCRIBE_API_KEY   the provider's key. Transcription is on when this or OPENAI_API_KEY is set.
//   TRANSCRIBE_BASE_URL  default https://api.groq.com/openai/v1
//   TRANSCRIBE_MODEL     default whisper-large-v3
//   Fallback: without TRANSCRIBE_API_KEY, OPENAI_API_KEY is used with OpenAI's address and whisper-1
//   (TRANSCRIBE_MODEL still applies, e.g. gpt-transcribe).
//
// Limits (Groq and OpenAI): files up to 25 MB (ours are ~10 minutes of 32 kbps MP3, ~2.4 MB); mp3, mp4,
// mpeg, mpga, m4a, wav, webm (Groq also flac, ogg). Groq takes a prompt of up to 224 tokens and one
// `language`; OpenAI's gpt-transcribe takes a `languages` list. An answer of 429 means a rate limit.

export const DEFAULT_TRANSCRIBE_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-large-v3";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_FALLBACK_MODEL = "whisper-1";
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
export const TRANSCRIBE_NOT_SET_UP = "Transcription is not set up (TRANSCRIBE_API_KEY).";
// About 150 tokens even for Slovenian names, under Groq's 224.
const PROMPT_MAX_CHARS = 450;

export type TranscribeConfig = { apiKey: string; baseUrl: string; model: string };

/** The provider settings from the environment, or null when no key is set. */
export function transcribeConfig(): TranscribeConfig | null {
  const e = process.env;
  if (e.TRANSCRIBE_API_KEY) {
    return { apiKey: e.TRANSCRIBE_API_KEY, baseUrl: (e.TRANSCRIBE_BASE_URL || DEFAULT_TRANSCRIBE_BASE_URL).replace(/\/+$/, ""), model: e.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL };
  }
  if (e.OPENAI_API_KEY) return { apiKey: e.OPENAI_API_KEY, baseUrl: OPENAI_BASE_URL, model: e.TRANSCRIBE_MODEL || OPENAI_FALLBACK_MODEL };
  return null;
}

export function transcribeModel(): string | null {
  return transcribeConfig()?.model ?? null;
}

/** Off (button hidden, admins told why) without TRANSCRIBE_API_KEY or OPENAI_API_KEY. */
export function transcribeEnabled(): boolean {
  return transcribeConfig() !== null;
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

/** The provider's rate limit (HTTP 429): nothing is wrong with the audio, trying again later works. */
export class RateLimitError extends TranscribeError {
  constructor(public retryAfterSeconds: number | null) {
    super(
      `The transcription provider's rate limit was reached${retryAfterSeconds ? ` (it asks to wait ${retryAfterSeconds < 90 ? `${retryAfterSeconds} s` : `${Math.ceil(retryAfterSeconds / 60)} min`})` : ""}. Wait a little, then retry the failed parts: the parts already transcribed are kept.`,
    );
  }
}

export async function transcribeAudio(input: TranscribeInput, fetchImpl: typeof fetch = fetch): Promise<TranscribeResult> {
  const config = transcribeConfig();
  if (!config) throw new TranscribeError(TRANSCRIBE_NOT_SET_UP);
  if (input.audio.size > MAX_TRANSCRIBE_BYTES) throw new TranscribeError("This part is larger than the 25 MB the provider accepts.");
  const { model } = config;

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
    res = await fetchImpl(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    throw new TranscribeError(`The transcription request failed: ${(err as Error).message}`);
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after"));
    throw new RateLimitError(Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : null);
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
