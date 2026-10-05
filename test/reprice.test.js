import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Ledger } from '../lib/ledger.js';
import { calculateSession, usageEvidence } from '../lib/reprice.js';
import { protocolEvidence } from '../lib/protocol-log.js';
import { readLog } from '../lib/read-log.js';
const raw = { promptTokenCount: 10, responseTokenCount: 10,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 10 }] };
test('offline alternative formulas and custom modules reuse exactly the same captured file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'reprice-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new Ledger(dir); const id = ledger.create('test-project');
  ledger.usage(id, raw, 1, 1); ledger.usage(id, raw, 2, 2); ledger.append(id, { type: 'session_end', reason: 'test' });
  const before = readFileSync(ledger.path(id));
  const run = (...args) => JSON.parse(execFileSync(process.execPath, ['scripts/reprice.js', '--logs', dir, ...args], { encoding: 'utf8' }));
  assert.equal(run().totalEstimatedUsd, .00025);
  assert.equal(run('--strategy', 'last-report').totalEstimatedUsd, .000125);
  assert.equal(run('--strategy', 'positive-deltas').totalEstimatedUsd, .000125);
  const custom = run('--formula', 'formulas/custom-example.mjs', '--actual-usd', '.00025');
  assert.equal(custom.differenceUsd, 0); assert.equal(custom.sessions[0].cacheReadEvidence[0].cachedContentTokenCount, null);
  assert.deepEqual(readFileSync(ledger.path(id)), before);
  assert.equal(run('--project', 'other-project').sessions.length, 0);
  const future = run('--from', '2100-01-01T00:00:00Z'); assert.equal(future.sessions.length, 0);
});
test('offline recovery can price provider evidence without a derived record', () => {
  const wire = { recordId: 'wire-1', type: 'protocol', direction: 'from_google', turn: 1, envelope: { usageMetadata: raw } };
  const evidence = usageEvidence([wire]); assert.equal(evidence.length, 1); assert.equal(evidence[0].recoveredFromProtocol, true);
  assert.equal(calculateSession({ usage: evidence }).estimatedUsd, .000125);
  const original = { type: 'usage_raw', recordId: 'raw-1', providerRecordId: 'wire-1', sequence: 1, rawUsageMetadata: raw };
  assert.equal(usageEvidence([wire, original, { ...original, type: 'usage', recordId: 'derived' }]).length, 1);
});
test('truncated logs retain readable evidence and report corruption without changing the file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'log-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new Ledger(dir); const id = ledger.create(); ledger.usage(id, raw, 1, 1);
  appendFileSync(ledger.path(id), '{"unfinished":');
  const before = readFileSync(ledger.path(id)); const parsed = readLog(ledger.path(id));
  assert.equal(parsed.records.length, 3); assert.equal(parsed.warnings.length, 2);
  assert.equal(ledger.list()[0].usageReports, 1); assert.equal(ledger.list()[0].logWarnings.length, 2);
  assert.deepEqual(readFileSync(ledger.path(id)), before);
});
test('audio evidence retains full payload only when enabled and redacts credentials', () => {
  const message = { audio: { mimeType: 'audio/pcm;rate=16000', data: 'AAABAA==' }, note: 'secret-value', newHandle: 'credential' };
  const result = protocolEvidence(message, { secret: 'secret-value' });
  assert.equal(result.note, '[REDACTED_API_KEY]'); assert.equal(result.newHandle, '[REDACTED_CREDENTIAL]');
  assert.equal(result.audio.payloadEvidence.samples, 2); assert.equal(result.audio.payloadEvidence.dataRetained, false);
  assert.equal(protocolEvidence(message, { retainAudio: true }).audio.data, message.audio.data);
});
test('positive deltas use the pre-window baseline without charging it in the selected window', t => {
  const dir = mkdtempSync(join(tmpdir(), 'window-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = '12345678-1234-1234-1234-123456789012';
  const entry = (count, at, sequence) => ({ type: 'usage_raw', recordId: `record-${sequence}`, sequence, turn: sequence, at,
    rawUsageMetadata: { promptTokenCount: count, responseTokenCount: 0, promptTokensDetails: [{ modality: 'TEXT', tokenCount: count }], responseTokensDetails: [] } });
  const records = [ { type: 'session_start', at: '2026-10-04T23:58:00Z' },
    entry(100, '2026-10-04T23:59:00Z', 1), entry(150, '2026-10-05T00:01:00Z', 2), { type: 'session_end', at: '2026-10-05T00:02:00Z' } ];
  appendFileSync(join(dir, `${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/reprice.js', '--logs', dir, '--strategy', 'positive-deltas', '--from', '2026-10-05T00:00:00Z'], { encoding: 'utf8' }));
  assert.equal(result.totalEstimatedUsd, .000025);
  assert.equal(result.sessions[0].details[0].counts.inputText, 50);
});
