import { parseArgs } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readLog } from '../lib/read-log.js';
import { calculateSession, usageEvidence, STRATEGIES } from '../lib/reprice.js';

const { values } = parseArgs({ options: {
  logs: { type: 'string', default: fileURLToPath(new URL('../logs/', import.meta.url)) },
  strategy: { type: 'string', default: 'event-sum' }, rates: { type: 'string' }, formula: { type: 'string' },
  from: { type: 'string' }, to: { type: 'string' }, 'actual-usd': { type: 'string' },
  project: { type: 'string' }, session: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log(`Offline repricing; never calls Google or changes logs.\n\nnode scripts/reprice.js [--logs DIR] [--strategy ${STRATEGIES.join('|')}]\n  [--rates rates.json] [--formula formulas/my-formula.mjs]\n  [--from ISO_TIMESTAMP] [--to ISO_TIMESTAMP] [--actual-usd NUMBER]\n  [--project EXACT_LABEL] [--session SESSION_ID]\n\nTime range is [from, to) using usage-report receipt timestamps.\nCustom modules must export calculateSession({ records, usage, previousUsage, pricing, rates, strategy }).\nReturn { estimatedUsd: number|null, ...diagnostics }. Custom code runs locally.`);
  process.exit(0);
}
try {
  if (!STRATEGIES.includes(values.strategy)) throw new Error('Unknown strategy; use --help');
  const from = values.from ? Date.parse(values.from) : -Infinity;
  const to = values.to ? Date.parse(values.to) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) throw new Error('Invalid date range');
  const actual = values['actual-usd'] === undefined ? null : Number(values['actual-usd']);
  if (actual !== null && (!Number.isFinite(actual) || actual < 0)) throw new Error('actual-usd must be a nonnegative number');
  const rates = values.rates ? JSON.parse(readFileSync(resolve(values.rates), 'utf8')) : {};
  let calculate = calculateSession, formulaSource;
  if (values.formula) {
    formulaSource = readFileSync(resolve(values.formula));
    calculate = (await import(pathToFileURL(resolve(values.formula)))).calculateSession;
    if (typeof calculate !== 'function') throw new Error('Formula must export calculateSession');
  } else formulaSource = readFileSync(new URL('../lib/reprice.js', import.meta.url));
  const sessions = [];
  for (const filename of readdirSync(values.logs).filter(name => /^[a-f0-9-]{36}\.jsonl$/.test(name)).sort()) {
    const id = filename.slice(0, -6);
    if (values.session && values.session !== id) continue;
    const path = join(values.logs, filename);
    const { records, warnings } = readLog(path);
    const start = records.find(r => r.type === 'session_start');
    if (values.project && start?.projectLabel !== values.project) continue;
    const allUsage = usageEvidence(records);
    const usage = allUsage.filter(r => Date.parse(r.at) >= from && Date.parse(r.at) < to);
    const previousUsage = allUsage.filter(r => Date.parse(r.at) < from).at(-1) ?? null;
    // Include a no-usage session if its start is in-range, to expose missing evidence.
    const startTime = Date.parse(start?.at);
    if (!usage.length && !(startTime >= from && startTime < to)) continue;
    const result = await calculate({ records, usage, previousUsage, pricing: start?.pricing, rates, strategy: values.strategy });
    if (result.estimatedUsd !== null && (!Number.isFinite(result.estimatedUsd) || result.estimatedUsd < 0)) throw new Error(`Invalid formula result for ${id}`);
    sessions.push({ id, projectLabel: start?.projectLabel ?? null, model: start?.model ?? null,
      fileSha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      evidenceWarnings: [...warnings, ...(!records.some(r => r.type === 'session_end') ? ['No session_end record; capture may be incomplete'] : [])],
      rawReportsInWindow: usage.length, ...result });
  }
  const incomplete = sessions.filter(s => s.estimatedUsd === null || s.evidenceWarnings.length).length;
  const subtotal = sessions.reduce((n, s) => n + (s.estimatedUsd ?? s.pricedSubtotalUsd ?? 0), 0);
  const total = sessions.length && !incomplete ? subtotal : null;
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), currency: 'USD',
    engineHashes: Object.fromEntries(['../lib/reprice.js', '../lib/pricing.js', '../lib/read-log.js'].map(path => [path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')])),
    strategy: values.strategy, formula: values.formula ?? 'built-in', formulaSha256: createHash('sha256').update(formulaSource).digest('hex'),
    filters: { from: values.from ?? null, toExclusive: values.to ?? null, project: values.project ?? null, session: values.session ?? null },
    notes: ['Offline calculation only. Compare equivalent project/model/time/SKU coverage and cost before credits.',
      'Transport read/write events are evidence of API messages, not separately invented billable read/write tokens.',
      'A formula matching one invoice is a hypothesis; validate across independent sessions and billing periods.'],
    totalEstimatedUsd: total, pricedSubtotalUsd: subtotal, incompleteSessions: incomplete,
    googleActualUsd: actual, differenceUsd: total !== null && actual !== null ? total - actual : null,
    differencePercent: total !== null && actual ? (total - actual) / actual * 100 : null,
    sessions }, null, 2));
} catch (error) { console.error(`Repricing failed: ${error.message}`); process.exitCode = 1; }
