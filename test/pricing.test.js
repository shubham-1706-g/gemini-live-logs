import test from 'node:test';
import assert from 'node:assert/strict';
import { priceUsage, summarize } from '../lib/pricing.js';
export const usage = {
  promptTokenCount: 1100, responseTokenCount: 520, thoughtsTokenCount: 10, totalTokenCount: 1630,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }, { modality: 'AUDIO', tokenCount: 1000 }],
  responseTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 500 }],
};
test('multimodal rates and thinking are priced exactly in nano-USD', () => {
  const result = priceUsage(usage);
  assert.equal(result.complete, true);
  assert.equal(result.estimatedNanoUsd, 9110000);
  assert.equal(result.estimatedUsd, .00911);
});
test('repeated prompt context and identical reports on separate generations are each charged', () => {
  const record = { type: 'usage', cost: priceUsage(usage) };
  assert.equal(summarize([record, record]).estimatedUsd, .01822);
});
test('absence of usage is unknown, not a free call', () => {
  assert.equal(summarize([]).estimatedUsd, null);
  assert.equal(summarize([]).complete, false);
});
test('missing modality breakdown never guesses audio vs text', () => {
  assert.equal(priceUsage({ promptTokenCount: 100, responseTokenCount: 50 }).estimatedUsd, null);
});
test('mismatched details, unsupported modalities, caches, tools and invalid numbers fail closed', () => {
  for (const raw of [
    { ...usage, promptTokenCount: 1101 },
    { ...usage, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 1100 }] },
    { ...usage, cachedContentTokenCount: 10 },
    { ...usage, toolUsePromptTokenCount: 10 },
    { ...usage, thoughtsTokenCount: -1 },
    { ...usage, responseTokenCount: NaN },
  ]) assert.equal(priceUsage(raw).estimatedUsd, null);
});
test('incomplete session preserves priced subtotal without claiming complete total', () => {
  const summary = summarize([{ type: 'usage', cost: priceUsage(usage) }, { type: 'usage', cost: priceUsage({}) }]);
  assert.equal(summary.estimatedUsd, null);
  assert.equal(summary.pricedSubtotalUsd, .00911);
  assert.equal(summary.unpricedReports, 1);
});
test('malformed and absent metadata retain explicit field presence without throwing', () => {
  for (const raw of [null, [], { ...usage, promptTokensDetails: [null] }, { ...usage, cacheTokensDetails: {} }]) {
    const cost = priceUsage(raw); assert.equal(cost.complete, false); assert.equal(cost.estimatedUsd, null);
  }
  assert.equal(priceUsage(usage).fieldPresence.cachedContentTokenCount, false);
  assert.equal(priceUsage({ ...usage, cachedContentTokenCount: 0 }).fieldPresence.cachedContentTokenCount, true);
});
