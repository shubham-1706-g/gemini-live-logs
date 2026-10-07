// Snapshot of https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-native-audio
export const PRICING = Object.freeze({
  model: 'gemini-2.5-flash-native-audio-preview-12-2025',
  version: 'google-list-usd-2026-10-05',
  checkedOn: '2026-10-05',
  currency: 'USD',
  source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-native-audio',
  perMillion: { inputText: 0.5, inputAudio: 3, outputText: 2, outputAudio: 12 },
  aggregation: 'Sum provider usage reports; each report is treated as a generation usage record, including its full prompt context. Not a session-cumulative delta.',
});

const validCount = value => Number.isSafeInteger(value) && value >= 0;
export function priceUsage(raw, pricing = PRICING) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { warnings.push('Invalid usageMetadata object'); raw = {}; }
  const fieldPresence = Object.fromEntries(['promptTokenCount', 'responseTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'toolUsePromptTokenCount', 'promptTokensDetails', 'responseTokensDetails', 'cacheTokensDetails', 'toolUsePromptTokensDetails'].map(key => [key, Object.hasOwn(raw, key)]));
  const counts = { inputText: 0, inputAudio: 0, outputText: 0, outputAudio: 0, thoughts: 0 };
  function details(field, totalField, side) {
    const total = raw[totalField] ?? 0;
    if (!validCount(total)) warnings.push(`Invalid ${totalField}`);
    const entries = raw[field];
    if (!Array.isArray(entries)) {
      // Google omits zero-valued response fields on prompt-only reports; accept that only when totalTokenCount reconciles.
      const omittedZero = side === 'output' && raw[totalField] === undefined && raw.totalTokenCount === (raw.promptTokenCount ?? 0) + (raw.thoughtsTokenCount ?? 0);
      if (!omittedZero && (total !== 0 || raw[totalField] === undefined)) warnings.push(`Missing ${field}`);
      return;
    }
    let sum = 0;
    for (const entry of entries) {
      if (!entry || !validCount(entry.tokenCount)) { warnings.push(`Invalid count in ${field}`); continue; }
      sum += entry.tokenCount;
      if (entry.modality === 'TEXT') counts[`${side}Text`] += entry.tokenCount;
      else if (entry.modality === 'AUDIO') counts[`${side}Audio`] += entry.tokenCount;
      else if (entry.tokenCount) warnings.push(`Unpriced ${side} modality: ${entry.modality}`);
    }
    if (sum !== total) warnings.push(`${field} sum (${sum}) differs from ${totalField} (${total})`);
  }
  details('promptTokensDetails', 'promptTokenCount', 'input');
  details('responseTokensDetails', 'responseTokenCount', 'output');
  if (raw.thoughtsTokenCount !== undefined && !validCount(raw.thoughtsTokenCount)) warnings.push('Invalid thoughtsTokenCount');
  else counts.thoughts = raw.thoughtsTokenCount ?? 0;
  // No cached-input tariff is published for this Live model. Do not invent one.
  if (raw.cachedContentTokenCount || (Array.isArray(raw.cacheTokensDetails) && raw.cacheTokensDetails.some(x => x?.tokenCount))) warnings.push('Cached usage has no configured Live tariff');
  if (raw.toolUsePromptTokenCount || (Array.isArray(raw.toolUsePromptTokensDetails) && raw.toolUsePromptTokensDetails.some(x => x?.tokenCount))) warnings.push('Tool usage requires separate pricing review');
  for (const key of ['cacheTokensDetails', 'toolUsePromptTokensDetails']) if (raw[key] !== undefined && !Array.isArray(raw[key])) warnings.push(`Invalid ${key}`);
  const componentsNanoUsd = {};
  for (const key of ['inputText', 'inputAudio', 'outputText', 'outputAudio']) {
    componentsNanoUsd[key] = counts[key] * pricing.perMillion[key] * 1000;
  }
  componentsNanoUsd.thoughts = counts.thoughts * pricing.perMillion.outputText * 1000;
  const calculatedNanoUsd = Object.values(componentsNanoUsd).reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(calculatedNanoUsd)) warnings.push('Cost exceeds safe integer precision');
  const complete = warnings.length === 0;
  return { counts, fieldPresence, componentsNanoUsd, complete, warnings,
    estimatedNanoUsd: complete ? calculatedNanoUsd : null,
    estimatedUsd: complete ? calculatedNanoUsd / 1e9 : null };
}

export function summarize(records) {
  const usage = records.filter(r => r.type === 'usage');
  const priced = usage.filter(r => r.cost.complete);
  const pricedSubtotalNanoUsd = priced.reduce((sum, r) => sum + r.cost.estimatedNanoUsd, 0);
  const counts = { inputText: 0, inputAudio: 0, outputText: 0, outputAudio: 0, thoughts: 0 };
  for (const r of usage) for (const key of Object.keys(counts)) counts[key] += r.cost.counts[key];
  const complete = usage.length > 0 && priced.length === usage.length;
  return { usageReports: usage.length, unpricedReports: usage.length - priced.length, counts, complete,
    estimatedUsd: complete ? pricedSubtotalNanoUsd / 1e9 : null,
    pricedSubtotalUsd: pricedSubtotalNanoUsd / 1e9,
    warnings: [...new Set(usage.flatMap(r => r.cost.warnings))] };
}
