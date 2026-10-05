// Downsample any browser microphone rate >=16 kHz to mono signed PCM16 LE.
// Area averaging preserves the fractional phase across 128-frame render blocks.
class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.remaining = this.ratio;
    this.sum = 0;
    this.samples = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      let available = 1;
      while (available > 1e-8) {
        const taken = Math.min(available, this.remaining);
        this.sum += sample * taken;
        available -= taken; this.remaining -= taken;
        if (this.remaining < 1e-8) {
          this.samples.push(Math.max(-1, Math.min(1, this.sum / this.ratio)));
          this.sum = 0; this.remaining = this.ratio;
          if (this.samples.length === 640) {
            const buffer = new ArrayBuffer(1280);
            const view = new DataView(buffer);
            this.samples.forEach((value, i) => view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true));
            this.port.postMessage(buffer, [buffer]);
            this.samples = [];
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-recorder', PCMRecorder);
