import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { TranscribeError, transcribeAudio } from "./transcribe";

let sent: { url: string; init: RequestInit } | null = null;
const reply = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
  sent = { url: String(url), init: init! };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
const audio = new Blob([new Uint8Array(1000)], { type: "audio/mpeg" });

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.TRANSCRIBE_MODEL;
  delete process.env.OPENAI_BASE_URL;
  sent = null;
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

test("gpt-transcribe by default: multipart with languages[], prompt and the key; returns text and seconds", async () => {
  const r = await transcribeAudio({ audio, fileName: "part-0.mp3", languages: ["sl", "en"], prompt: "Grants meeting. Participants: Žiga Krajnc." }, reply(200, { text: " Pozdravljeni. ", usage: { type: "duration", seconds: 600 } }) as typeof fetch);
  assert.deepEqual(r, { text: "Pozdravljeni.", model: "gpt-transcribe", seconds: 600 });
  assert.equal(sent!.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal((sent!.init.headers as Record<string, string>).authorization, "Bearer sk-test");
  const form = sent!.init.body as FormData;
  assert.equal(form.get("model"), "gpt-transcribe");
  assert.deepEqual(form.getAll("languages[]"), ["sl", "en"]);
  assert.equal(form.get("language"), null, "never both fields");
  assert.match(String(form.get("prompt")), /Žiga Krajnc/);
  assert.equal((form.get("file") as File).name, "part-0.mp3");
});

test("older models get a single language; auto-detect sends none", async () => {
  process.env.TRANSCRIBE_MODEL = "whisper-1";
  await transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(200, { text: "x" }) as typeof fetch);
  assert.equal((sent!.init.body as FormData).get("language"), "sl");
  assert.equal((sent!.init.body as FormData).getAll("languages[]").length, 0);
  delete process.env.TRANSCRIBE_MODEL;
  await transcribeAudio({ audio, fileName: "a.mp3", languages: [] }, reply(200, { text: "x" }) as typeof fetch);
  assert.equal((sent!.init.body as FormData).getAll("languages[]").length, 0);
});

test("errors: provider message (never the key), missing key, too large, network", async () => {
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, reply(400, { error: { message: "Invalid file format." } }) as typeof fetch), {
    message: "Transcription failed (400: Invalid file format.).",
  });
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: ["sl"] }, (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch), /request failed: ECONNRESET/);
  await assert.rejects(transcribeAudio({ audio: new Blob([new Uint8Array(26 * 1024 * 1024)]), fileName: "a.mp3", languages: [] }, reply(200, {}) as typeof fetch), TranscribeError);
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(transcribeAudio({ audio, fileName: "a.mp3", languages: [] }, reply(200, {}) as typeof fetch), /not set up/);
});
