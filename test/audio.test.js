import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../public/audio-worklet.js', import.meta.url), 'utf8');
for (const rate of [16000, 44100, 48000]) {
  test(`microphone ${rate} Hz is resampled to exactly 25 PCM16 frames per second`, () => {
    const frames = []; let Recorder;
    const context = vm.createContext({ sampleRate: rate,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: buffer => frames.push(buffer) }; } },
      registerProcessor: (_name, constructor) => { Recorder = constructor; } });
    vm.runInContext(code, context); const recorder = new Recorder();
    for (let offset = 0; offset < rate; offset += 128) recorder.process([[new Float32Array(Math.min(128, rate - offset)).fill(.5)]]);
    assert.equal(frames.length, 25); assert.equal(frames.reduce((sum, frame) => sum + frame.byteLength, 0), 32000);
    assert.equal(new DataView(frames[0]).getInt16(0, true), 16384);
  });
}
