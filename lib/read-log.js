import { readFileSync } from 'node:fs';
export function readLog(path) {
  const text = readFileSync(path, 'utf8');
  const records = [], warnings = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Not an object');
      records.push(record);
    } catch { warnings.push(`Unreadable JSON at line ${index + 1}; original file retained unchanged`); }
  });
  if (!text.endsWith('\n') && text.length) warnings.push('File does not end with a newline; last append may have been interrupted');
  return { records, warnings };
}
