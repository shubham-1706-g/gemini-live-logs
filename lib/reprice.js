import { priceUsage, PRICING } from './pricing.js';

export const STRATEGIES = ['event-sum', 'last-report', 'last-per-turn', 'positive-deltas'];
export function usageEvidence(records) {
  // New logs persist raw evidence before calculation. Older logs embed it in usage.
  const originals = records.filter(r => r.type === 'usage_raw');
  const covered = new Set(originals.map(r => r.sequence));
  const selected = [...originals, ...records.filter(r => r.type === 'usage' && !covered.has(r.sequence))];
  const protocolIds = new Set(selected.map(r => r.providerRecordId).filter(Boolean));
  // Recover a report when the process stopped after the wire record but before
  // usage_raw or the calculated usage record could be appended.
  records.forEach((record, index) => {
    if (record.type === 'protocol' && record.direction === 'from_google' && record.envelope &&
      Object.hasOwn(record.envelope, 'usageMetadata') && !protocolIds.has(record.recordId)) {
      selected.push({ ...record, rawUsageMetadata: record.envelope.usageMetadata,
        sequence: `recovered-${index}`, recoveredFromProtocol: true });
    }
  });
  const positions = new Map(records.map((record, index) => [record.recordId ?? record, index]));
  return selected.sort((a, b) => (positions.get(a.recordId ?? a) ?? 0) - (positions.get(b.recordId ?? b) ?? 0));
}
function deltaDetails(current, previous) {
  if (!Array.isArray(current)) return current;
  return current.map(detail => {
    if (!detail) return detail;
    const prior = Array.isArray(previous) ? previous.filter(x => x?.modality === detail.modality).reduce((sum, x) => sum + (x.tokenCount || 0), 0) : 0;
    return { ...detail, tokenCount: Math.max(0, detail.tokenCount - prior) };
  });
}
export function calculateSession({ usage, pricing = PRICING, strategy = 'event-sum', rates = {}, previousUsage = null }) {
  if (!STRATEGIES.includes(strategy)) throw new Error(`Unknown strategy: ${strategy}`);
  const tariff = { ...pricing, perMillion: { ...pricing.perMillion, ...rates } };
  for (const key of ['inputText', 'inputAudio', 'outputText', 'outputAudio']) {
    if (!Number.isFinite(tariff.perMillion[key]) || tariff.perMillion[key] < 0) throw new Error(`Invalid rate: ${key}`);
  }
  let selected = usage;
  if (strategy === 'last-report') selected = usage.slice(-1);
  if (strategy === 'last-per-turn') selected = [...new Map(usage.map(r => [r.turn, r])).values()];
  let previous = previousUsage?.rawUsageMetadata ?? {};
  const details = selected.map(record => {
    let raw = record.rawUsageMetadata;
    if (strategy === 'positive-deltas' && raw && typeof raw === 'object') {
      const original = raw;
      raw = { ...raw };
      for (const field of ['promptTokenCount', 'responseTokenCount', 'thoughtsTokenCount', 'cachedContentTokenCount', 'toolUsePromptTokenCount', 'totalTokenCount']) {
        if (typeof raw[field] === 'number') raw[field] = Math.max(0, raw[field] - (previous[field] || 0));
      }
      for (const field of ['promptTokensDetails', 'responseTokensDetails', 'cacheTokensDetails', 'toolUsePromptTokensDetails']) raw[field] = deltaDetails(raw[field], previous[field]);
      previous = original;
    }
    const result = priceUsage(raw, tariff);
    return { sequence: record.sequence, turn: record.turn, at: record.at, rawRecordId: record.recordId, ...result };
  });
  const unpricedReports = details.filter(r => !r.complete).length;
  const subtotal = details.reduce((n, r) => n + (r.estimatedNanoUsd || 0), 0) / 1e9;
  return { estimatedUsd: details.length && !unpricedReports ? subtotal : null, pricedSubtotalUsd: subtotal,
    unpricedReports, reportsUsed: details.length, rates: tariff.perMillion, details,
    notes: [strategy === 'event-sum' ? 'Generation-record sum; validate report semantics against actual billing.' : 'EXPERIMENTAL aggregation hypothesis, not a claim about Google billing.'] };
}
