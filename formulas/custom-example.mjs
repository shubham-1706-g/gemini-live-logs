// Copy this file and edit the formula, then pass --formula path/to/your-copy.mjs.
// All original protocol records and unknown usage fields are available locally.
// Do not modify the captured logs to try a hypothesis.
import { calculateSession as baseline } from '../lib/reprice.js';
export function calculateSession({ records, usage, previousUsage, pricing, rates, strategy }) {
  const result = baseline({ usage, previousUsage, pricing, rates, strategy });
  return {
    ...result,
    observedCounterFields: [...new Set(usage.flatMap(event => Object.keys(event.rawUsageMetadata || {})))],
    // Preserve 'not reported' separately from an explicit zero.
    cacheReadEvidence: usage.map(event => ({
      sequence: event.sequence,
      cachedContentTokenCount: event.rawUsageMetadata?.cachedContentTokenCount ?? null,
      cacheTokensDetails: event.rawUsageMetadata?.cacheTokensDetails ?? null,
    })),
    cacheWriteEvidence: 'No separate cache-write count is defined in this model’s current Live usage schema; do not infer zero.',
    protocolMessages: records.filter(record => record.type === 'protocol').length,
  };
}
