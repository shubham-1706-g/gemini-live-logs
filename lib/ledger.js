import { mkdirSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readLog } from './read-log.js';
import { PRICING, priceUsage, summarize } from './pricing.js';
export const validId = id => /^[a-f0-9-]{36}$/.test(id);
export class Ledger {
  constructor(directory) { this.directory = directory; mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  create(projectLabel = '', capture = {}) {
    const id = randomUUID();
    this.append(id, { type: 'session_start', model: PRICING.model, pricing: PRICING, projectLabel,
      configuration: { transcription: true, compressionTriggerTokens: 25000, compressionTargetTokens: 8000 },
      estimateOnly: true, capture, runtime: { node: process.version, platform: process.platform, arch: process.arch },
      sourceHashes: Object.fromEntries(['../server.js', './ledger.js', './pricing.js', './protocol-log.js', '../public/app.js', '../public/audio-worklet.js', '../package-lock.json'].map(path => [path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')])) });
    return id;
  }
  path(id) { if (!validId(id)) throw new Error('Invalid session ID'); return join(this.directory, `${id}.jsonl`); }
  append(id, record) {
    // Sync append ensures the provider report is persisted before it is displayed.
    const stamped = { ...record, schemaVersion: 1, recordId: randomUUID(), sessionId: id, at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() };
    appendFileSync(this.path(id), JSON.stringify(stamped) + '\n', { mode: 0o600, flush: ['usage_raw', 'session_start', 'session_end'].includes(record.type) });
    return stamped;
  }
  usage(id, raw, sequence, turn, providerRecordId = null) {
    const original = this.append(id, { type: 'usage_raw', sequence, turn, providerRecordId, rawUsageMetadata: raw });
    return this.append(id, { type: 'usage', sequence, turn, rawRecordId: original.recordId, providerRecordId, rawUsageMetadata: raw,
      pricingVersion: PRICING.version, cost: priceUsage(raw) });
  }
  records(id) { return readLog(this.path(id)).records; }
  summary(id) {
    const { records, warnings: readWarnings } = readLog(this.path(id));
    const start = records.find(r => r.type === 'session_start') || {};
    const end = records.findLast(r => r.type === 'session_end');
    return { id, startedAt: start.at || '', logWarnings: readWarnings, finalUsageGuaranteed: false, endedAt: end?.at ?? null, reason: end?.reason ?? null,
      status: end ? 'ended' : 'open_or_interrupted', model: start.model, ...summarize(records) };
  }
  list() {
    return readdirSync(this.directory).filter(f => f.endsWith('.jsonl') && validId(f.slice(0, -6)))
      .map(f => { const id = f.slice(0, -6); try { return this.summary(id); } catch { return { id, startedAt: '', status: 'unreadable', complete: false, usageReports: 0, pricedSubtotalUsd: 0, logWarnings: ['Unable to read session file'] }; } }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
