import { createHash } from 'node:crypto';

// Retain every JSON field. Replace binary base64 bodies with reproducible physical
// measurements unless full payload capture was explicitly enabled locally.
export function protocolEvidence(value, { retainAudio = false, secret = '' } = {}) {
  function visit(node) {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return typeof node === 'string' && secret ? node.replaceAll(secret, '[REDACTED_API_KEY]') : node;
    const out = {};
    for (const [key, item] of Object.entries(node)) {
      if (['newHandle', 'accessToken', 'authToken', 'apiKey', 'authorization'].includes(key)) { out[key] = '[REDACTED_CREDENTIAL]'; continue; }
      if (key === 'data' && typeof item === 'string' && typeof node.mimeType === 'string') {
        const bytes = Buffer.from(item, 'base64');
        const rate = Number(node.mimeType.match(/rate=(\d+)/)?.[1]) || null;
        const pcm = node.mimeType.startsWith('audio/pcm');
        out.payloadEvidence = { encoding: 'base64', base64Characters: item.length, decodedBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sampleRateHz: rate, pcmBitsPerSample: pcm ? 16 : null,
          channels: pcm ? 1 : null, samples: pcm ? bytes.length / 2 : null,
          durationSeconds: pcm && rate ? bytes.length / 2 / rate : null,
          dataRetained: retainAudio };
        if (retainAudio) out[key] = item;
      } else out[key] = visit(item);
    }
    return out;
  }
  return visit(value);
}
