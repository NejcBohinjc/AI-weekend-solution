// AudioWorklet for the meeting recorder: mixes the microphone to mono and posts it in blocks of 4096
// samples to the page, which passes them to the MP3 worker. Nothing is kept here beyond one block.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.paused = false;
    this.port.onmessage = (e) => {
      if (e.data.type === "pause") this.paused = e.data.paused;
      if (e.data.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ type: "pcm", data: out }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (this.paused || !input || !input.length) return true;
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let v = 0;
      for (let c = 0; c < channels; c++) v += input[c][i];
      this.buf[this.n++] = v / channels;
      if (this.n === this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor("recorder-processor", RecorderProcessor);
