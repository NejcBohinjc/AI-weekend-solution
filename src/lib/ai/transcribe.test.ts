import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { RateLimitError, TranscribeError, transcribeAudio, transcribeConfig, transcribeEnabled } from "./transcribe";

let sent: { url: string; init: RequestInit } | null = null;
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => async (url: string | URL | Request, init?: RequestInit) => {
  sent = { url: String(url), init: init! };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
};
const audio = new Blob([new Uint8Array(1000)], { type: "audio/mpeg" });
const VARS = ["TRANSCRIBE_API_KEY", "TRANSCRIBE_BASE_URL", "TRANSCRIBE_MODEL", "OPENAI_API_KEY"];

beforeEach(() => {
  for (const v of VARS) delete process.env[v];
  process.env.TRANSCRIBE_API_KEY = "gsk-test";
  sent = null;
});
afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

test("Groq by default: its address, whisper-large-v3, one Slovenian language, the key; returns the text", async () => {
  const r = await transcribeAudio({ audio, fileName: "part-0.mp3", languages: ["sl"], prompt: "Grants meeting. Participants: Žiga Krajnc." }, reply(200, { text: " Pozdravljeni. " }) as typeof fetch);
  assert.deepEqual(r, { text: "Pozdravljeni.", model: "whisper-large-v3", seconds: undefined });
  assert.equal(sent!.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal((sent!.init.headers as Record<string, string>).authorization, "Bearer gsk-test");
  const form = sent!.init.body as FormData;
  assert.equal(form.get("model"), "whisper-large-v3");
  assert.equal(form.get("language"), "sl");
  assert.equal(form.getAll("languages[]").length, 0);
  assert.match(String(form.get("prompt")), /Žiga Krajnc/);
  assert.equal((form.get("file") as File).name, "part-0.mp3");
});

test("any OpenAI-compatible address and model; the prompt is cut to fit Groq's limit; two languages mean auto-detect", async () => {
  process.env.TRANSCRIBE_BASE_URL = "https://stt.example.com/v1/";
  process.env.TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
  await transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl", "en"], prompt: "x".repeat(2000) }, reply(200, { text: "x" }) as typeof fetch);
  assert.equal(sent!.url, "https://stt.example.com/v1/audio/transcriptions");
  const form = sent!.init.body as FormData;
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
  assert.equal(form.get("language"), null);
  assert.ok(String(form.get("prompt")).length <= 450);
});

test("OPENAI_API_KEY is the fallback: OpenAI's address and whisper-1 (TRANSCRIBE_MODEL still applies); the new key wins", async () => {
  delete process.env.TRANSCRIBE_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.TRANSCRIBE_BASE_URL = "https://ignored.example.com/v1"; // belongs to the new provider, not to OpenAI
  assert.deepEqual(transcribeConfig(), { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1", model: "whisper-1" });
  await transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(200, { text: "x" }) as typeof fetch);
  assert.equal(sent!.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal((sent!.init.headers as Record<string, string>).authorization, "Bearer sk-test");
  assert.equal((sent!.init.body as FormData).get("model"), "whisper-1");
  process.env.TRANSCRIBE_MODEL = "gpt-transcribe";
  await transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl", "en"] }, reply(200, { text: "x" }) as typeof fetch);
  assert.deepEqual((sent!.init.body as FormData).getAll("languages[]"), ["sl", "en"], "gpt-transcribe takes a list");
  process.env.TRANSCRIBE_API_KEY = "gsk-test";
  assert.equal(transcribeConfig()!.apiKey, "gsk-test");
});

test("on when either key is set, off with neither", () => {
  assert.equal(transcribeEnabled(), true);
  delete process.env.TRANSCRIBE_API_KEY;
  assert.equal(transcribeEnabled(), false);
  process.env.OPENAI_API_KEY = "sk-test";
  assert.equal(transcribeEnabled(), true);
});

test("a rate limit (429) is its own, retryable error that says how long to wait", async () => {
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(429, { error: { message: "Rate limit reached" } }, { "retry-after": "34" }) as typeof fetch), (err: unknown) => {
    assert.ok(err instanceof RateLimitError && err instanceof TranscribeError);
    assert.equal((err as RateLimitError).retryAfterSeconds, 34);
    assert.match((err as Error).message, /rate limit was reached \(it asks to wait 34 s\)\. Wait a little, then retry the failed parts: the parts already transcribed are kept\./);
    return true;
  });
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(429, {}) as typeof fetch), /rate limit was reached\. Wait a little/);
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(429, {}, { "retry-after": "600" }) as typeof fetch), /wait 10 min/);
});

test("errors: provider message (never the key), missing key names TRANSCRIBE_API_KEY, too large, network", async () => {
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(400, { error: { message: "Invalid file format." } }) as typeof fetch), {
    message: "Transcription failed (400: Invalid file format.).",
  });
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch), /request failed: ECONNRESET/);
  await assert.rejects(transcribeAudio({ audio: new Blob([new Uint8Array(26 * 1024 * 1024)]), fileName: "a.mp3", languages: [] }, reply(200, {}) as typeof fetch), /25 MB/);
  delete process.env.TRANSCRIBE_API_KEY;
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: [] }, reply(200, {}) as typeof fetch), { message: "Transcription is not set up (TRANSCRIBE_API_KEY)." });
});
