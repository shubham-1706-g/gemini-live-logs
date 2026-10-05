import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp } from '../server.js';
const sample = { promptTokenCount: 1100, responseTokenCount: 520, thoughtsTokenCount: 10,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }, { modality: 'AUDIO', tokenCount: 1000 }],
  responseTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 500 }] };
async function fixture(t, configured = true, ready = true) {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-live-test-'));
  const provider = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(provider, 'listening');
  const providerMessages = []; let upstream;
  provider.on('connection', ws => { upstream = ws; ws.on('message', bytes => {
    const message = JSON.parse(bytes); providerMessages.push(message);
    if (message.setup && ready) ws.send(JSON.stringify({ setupComplete: {} }));
    if (message.realtimeInput?.audioStreamEnd) ws.send(JSON.stringify({ usageMetadata: sample }));
  }); });
  const app = createApp({ apiKey: configured ? 'fake-test-key' : '', logDir: dir, drainMs: 50,
    connectProvider: () => new WebSocket(`ws://127.0.0.1:${provider.address().port}`) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const browser = new WebSocket(origin.replace('http:', 'ws:') + '/live', { origin });
  const messages = [];
  browser.on('message', bytes => messages.push(JSON.parse(bytes)));
  const wait = async predicate => {
    const timeout = Date.now() + 2500;
    while (!messages.some(predicate)) { if (Date.now() > timeout) throw new Error(`Timeout; messages=${JSON.stringify(messages)}`); await new Promise(r => setTimeout(r, 5)); }
    return messages.find(predicate);
  };
  t.after(async () => { browser.terminate(); app.shutdown(); provider.clients.forEach(ws => ws.terminate()); await new Promise(resolve => provider.close(resolve)); app.server.closeAllConnections(); await rm(dir, { recursive: true, force: true }); });
  return { app, origin, browser, messages, wait, providerMessages, send: data => upstream.send(JSON.stringify(data)), dir };
}
test('voice proxy logs raw usage, rejects spoofed beacon, drains late usage and reopens disk ledger', async t => {
  const f = await fixture(t); const session = await f.wait(x => x.type === 'session'); await f.wait(x => x.type === 'ready');
  assert.equal(f.providerMessages[0].setup.model, 'models/gemini-2.5-flash-native-audio-preview-12-2025');
  f.browser.send(Buffer.from([0, 0, 1, 0]));
  f.send({ usageMetadata: sample, serverContent: { inputTranscription: { text: 'Hello' }, turnComplete: true } });
  const event = await f.wait(x => x.type === 'usage'); assert.equal(event.summary.estimatedUsd, .00911);
  const post = body => fetch(`${f.origin}/api/beacon`, { method: 'POST', headers: { origin: f.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ sessionId: session.id, token: 'wrong' })).status, 403);
  const beacon = { sessionId: session.id, token: session.token, eventId: 'same-event', event: 'hidden', estimatedUsd: 99999 };
  assert.equal((await post(beacon)).status, 204); assert.equal((await post(beacon)).status, 204);
  assert.equal(f.app.ledger.records(session.id).filter(r => r.type === 'browser_event').length, 1);
  assert.equal(f.app.ledger.summary(session.id).estimatedUsd, .00911);
  assert.equal(f.browser.readyState, WebSocket.OPEN);
  f.browser.send(JSON.stringify({ type: 'stop' }));
  const end = await f.wait(x => x.type === 'ended'); assert.equal(end.summary.estimatedUsd, .01822);
  assert.equal(end.summary.usageReports, 2);
  const raw = await readFile(join(f.dir, `${session.id}.jsonl`), 'utf8');
  assert(!raw.includes('fake-test-key')); assert(!raw.includes(session.token));
  const records = raw.trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.find(r => r.type === 'usage').rawUsageMetadata, sample);
  assert.equal(records.filter(r => r.type === 'session_end').length, 1);
  assert.equal(f.providerMessages.find(r => r.realtimeInput?.audio)?.realtimeInput.audio.data, 'AAABAA==');
  const history = await (await fetch(`${f.origin}/api/sessions`)).json(); assert.equal(history[0].estimatedUsd, .01822);
  const saved = await (await fetch(`${f.origin}/api/sessions/${session.id}/download`)).text(); assert.equal(saved, raw);
});
test('pagehide beacon closes upstream and duplicate events remain idempotent', async t => {
  const f = await fixture(t); const session = await f.wait(x => x.type === 'session'); await f.wait(x => x.type === 'ready');
  const body = JSON.stringify({ sessionId: session.id, token: session.token, eventId: 'exit', event: 'pagehide' });
  const post = () => fetch(`${f.origin}/api/beacon`, { method: 'POST', headers: { origin: f.origin }, body });
  assert.equal((await post()).status, 204); assert.equal((await post()).status, 204);
  const end = await f.wait(x => x.type === 'ended'); assert.equal(end.summary.reason, 'pagehide');
  assert.equal(f.app.ledger.records(session.id).filter(x => x.type === 'browser_event').length, 1);
});
test('browser disconnect retains late provider usage even without a beacon', async t => {
  const f = await fixture(t); const session = await f.wait(x => x.type === 'session'); await f.wait(x => x.type === 'ready');
  f.browser.close(); await once(f.browser, 'close');
  await new Promise(r => setTimeout(r, 150));
  assert.equal(f.app.ledger.summary(session.id).estimatedUsd, .00911);
  assert.equal(f.app.ledger.summary(session.id).reason, 'browser_disconnected');
});
test('missing key is actionable and creates no provider session', async t => {
  const f = await fixture(t, false); const error = await f.wait(x => x.type === 'error');
  assert.match(error.message, /GEMINI_API_KEY/); assert.equal(f.app.ledger.list().length, 0);
  const config = await (await fetch(`${f.origin}/api/config`)).json(); assert.equal(config.configured, false);
});
test('cross-origin HTTP/beacon and websocket requests are rejected', async t => {
  const f = await fixture(t); await f.wait(x => x.type === 'ready');
  assert.equal((await fetch(`${f.origin}/api/sessions`, { headers: { origin: 'https://untrusted.test' } })).status, 403);
  assert.equal((await fetch(`${f.origin}/api/beacon`, { method: 'POST', body: '{}' })).status, 403);
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + '/live', { origin: 'https://untrusted.test' });
  const [error] = await once(socket, 'error'); assert.match(error.message, /403/);
});
test('user can cancel during provider setup', async t => {
  const f = await fixture(t, true, false); const session = await f.wait(x => x.type === 'session');
  f.browser.send(JSON.stringify({ type: 'stop' }));
  const end = await f.wait(x => x.type === 'ended'); assert.equal(end.summary.reason, 'user_stop');
  assert.equal(f.app.ledger.summary(session.id).usageReports, 0);
});
test('protocol evidence and malformed usage survive pricing, preserving unknown fields', async t => {
  const f = await fixture(t); const session = await f.wait(x => x.type === 'session'); await f.wait(x => x.type === 'ready');
  const odd = { ...sample, promptTokensDetails: [null], futureCacheWriteTokenCount: 77, futureDetails: { newField: 'preserve-me' } };
  f.send({ usageMetadata: odd, futureServerField: { keep: true }, serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAABAA==' } }] } } });
  const event = await f.wait(x => x.type === 'usage'); assert.equal(event.record.cost.complete, false);
  const records = f.app.ledger.records(session.id);
  assert.deepEqual(records.find(x => x.type === 'usage_raw').rawUsageMetadata, odd);
  const frame = records.find(x => x.type === 'protocol' && x.envelope?.usageMetadata);
  assert.deepEqual(frame.envelope.usageMetadata, odd);
  assert.deepEqual(frame.envelope.futureServerField, { keep: true });
  const payload = frame.envelope.serverContent.modelTurn.parts[0].inlineData;
  assert.equal(payload.data, undefined); assert.equal(payload.payloadEvidence.decodedBytes, 4);
  assert.equal(payload.payloadEvidence.durationSeconds, 2 / 24000);
  assert.equal(payload.payloadEvidence.sha256.length, 64);
  assert(records.indexOf(frame) < records.findIndex(x => x.type === 'usage'));
  f.browser.send(JSON.stringify({ type: 'stop' })); await f.wait(x => x.type === 'ended');
});
