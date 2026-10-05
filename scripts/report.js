import { Ledger } from '../lib/ledger.js';
import { summarize } from '../lib/pricing.js';
import { fileURLToPath } from 'node:url';
const ledger = new Ledger(fileURLToPath(new URL('../logs/', import.meta.url)));
const sessions = ledger.list();
const records = sessions.flatMap(s => ledger.records(s.id));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), currency: 'USD',
  note: 'List-price estimate from received metadata, not an invoice. Compare the same project, model, UTC window and SKUs in Google Cloud Billing.',
  totals: summarize(records), sessions }, null, 2));
