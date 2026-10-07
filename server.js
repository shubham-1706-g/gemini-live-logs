import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { Ledger, validId } from './lib/ledger.js';
import { PRICING } from './lib/pricing.js';
import { protocolEvidence } from './lib/protocol-log.js';

const publicDir = new URL('./public/', import.meta.url);
const endpoint = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export function createApp({ apiKey = process.env.GEMINI_API_KEY, logDir = fileURLToPath(new URL('./logs/', import.meta.url)),
  projectLabel = process.env.GOOGLE_CLOUD_PROJECT_LABEL || '', connectProvider = () => new WebSocket(endpoint, { headers: { 'x-goog-api-key': apiKey }, handshakeTimeout: 15000 }),
  retainAudio = process.env.LOG_AUDIO_PAYLOADS === 'true', drainMs = 5000, maxSessionMs = 10 * 60 * 1000 } = {}) {
  const ledger = new Ledger(logDir);
  const sessions = new Map();
  let active = null;
  const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
    ['/audio-worklet.js', ['audio-worklet.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  // Localhost always; ngrok tunnels (HTTPS, so the browser allows the mic) via suffix allowlist. Extend with ALLOWED_HOST_SUFFIXES=.example.com,...
  const tunnelSuffixes = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io', ...(process.env.ALLOWED_HOST_SUFFIXES || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)];
  function allowedHost(host = '') {
    if (/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return true;
    const h = host.toLowerCase();
    return /^[a-z0-9.-]+$/.test(h) && tunnelSuffixes.some(s => h.endsWith(s));
  }
  function sameOrigin(req) {
    const host = req.headers.host;
    return req.headers.origin === `http://${host}` || (req.headers.origin === `https://${host}` && !/^(localhost|127\.0\.0\.1):/.test(host));
  }
  const server = http.createServer(async (req, res) => {
    try {
      // Local-only tool. Host check also rejects DNS rebinding to this listener.
      if (!allowedHost(req.headers.host)) return json(res, 403, { error: 'Host not allowed' });
      if (req.headers.origin && !sameOrigin(req)) return json(res, 403, { error: 'Origin rejected' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/config') return json(res, 200, { configured: Boolean(apiKey), pricing: PRICING, maxSessionSeconds: maxSessionMs / 1000 });
      if (req.method === 'GET' && path === '/api/sessions') return json(res, 200, ledger.list());
      const match = path.match(/^\/api\/sessions\/([a-f0-9-]{36})(\/download)?$/);
      if (req.method === 'GET' && match) {
        if (match[2]) {
          const data = await readFile(ledger.path(match[1]));
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="${match[1]}.jsonl"`, 'Cache-Control': 'no-store' });
          return res.end(data);
        }
        return json(res, 200, { summary: ledger.summary(match[1]), records: ledger.records(match[1]) });
      }
      if (req.method === 'POST' && path === '/api/beacon') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'Origin required' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(res, 413, { error: 'Beacon too large' }); }
        let data; try { data = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        const s = sessions.get(data.sessionId);
        if (!s || data.token !== s.token) return json(res, 403, { error: 'Invalid session token' });
        if (typeof data.eventId !== 'string' || data.eventId.length > 80 || !['hidden', 'pagehide'].includes(data.event)) return json(res, 400, { error: 'Invalid event' });
        if (!s.beacons.has(data.eventId)) {
          if (s.beacons.size >= 200) return json(res, 429, { error: 'Too many events' });
          s.beacons.add(data.eventId);
          ledger.append(s.id, { type: 'browser_event', eventId: data.eventId, event: data.event,
            clientAt: typeof data.clientAt === 'string' ? data.clientAt.slice(0, 40) : null });
          // Hidden is telemetry only: changing tabs must not end a call.
          if (data.event === 'pagehide') s.stop('pagehide');
        }
        res.writeHead(204); return res.end();
      }
      if (req.method === 'GET' && files.has(path)) {
        const [name, mime] = files.get(path);
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
        return res.end(await readFile(new URL(name, publicDir)));
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Session not found' : 'Unable to read or persist logs' });
      else res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/live' || !sameOrigin(req) || !allowedHost(req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', browser => {
    const send = data => { if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(data)); };
    if (!apiKey || active) { send({ type: 'error', message: !apiKey ? 'Set GEMINI_API_KEY in .env and restart Node.' : 'Another conversation is active. End it first.' }); browser.close(); return; }
    let id;
    try { id = ledger.create(projectLabel, { protocolEnvelopes: true, fullAudioPayloads: retainAudio, binaryMeasurements: true }); } catch { send({ type: 'error', message: 'Cannot create session log. Check logs directory permissions.' }); browser.close(); return; }
    let upstream, ready = false, stopping = false, ended = false, sequence = 0, turn = 1, stopReason;
    let drainTimer, durationTimer, setupTimer;
    const token = randomBytes(24).toString('hex');
    const s = { id, token, beacons: new Set(), stop };
    sessions.set(id, s); active = s;
    function safeLog(record) {
      try { return ledger.append(id, record); } catch { fail('Logging failed; conversation stopped to avoid untracked usage.'); }
    }
    function writeProvider(message) {
      const encoded = JSON.stringify(message);
      ledger.append(id, { type: 'protocol', direction: 'to_google', operation: 'write', stage: 'send_attempt', jsonBytes: Buffer.byteLength(encoded),
        turn, envelope: protocolEvidence(message, { retainAudio, secret: apiKey }) });
      upstream.send(encoded, error => { if (error) { safeLog({ type: 'provider_send_error', code: error.code || null }); fail('Failed to send a recorded message to Google.'); } });
    }
    function finish(reason, closeCode, closeReason) {
      if (ended) return; ended = true;
      clearTimeout(drainTimer); clearTimeout(durationTimer); clearTimeout(setupTimer);
      if (active === s) active = null;
      try {
        ledger.append(id, { type: 'session_end', reason, closeCode: closeCode ?? null, providerCloseReason: closeReason ? String(closeReason).replaceAll(apiKey, '[REDACTED_API_KEY]') : null,
          finalUsageGuaranteed: false, note: 'Only received provider usage reports can be priced; abrupt exits may omit final usage.' });
        send({ type: 'ended', summary: ledger.summary(id) });
      } catch { send({ type: 'error', message: 'Session ended but final log write failed.' }); }
      browser.close();
      const expiry = setTimeout(() => sessions.delete(id), 60000); expiry.unref();
    }
    function closeUpstream() {
      if (!upstream || upstream.readyState === WebSocket.CLOSED) return finish(stopReason || 'closed');
      upstream.close();
      const timer = setTimeout(() => { if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate(); }, 1500); timer.unref();
    }
    function fail(message) {
      send({ type: 'error', message }); stopping = true; stopReason = 'error';
      closeUpstream();
    }
    function stop(reason = 'user_stop') {
      if (stopping || ended) return; stopping = true; stopReason = reason;
      safeLog({ type: 'stop_requested', reason });
      send({ type: 'stopping' });
      if (ready && upstream.readyState === WebSocket.OPEN) {
        try { writeProvider({ realtimeInput: { audioStreamEnd: true } }); } catch { return fail('Failed to persist final stream event.'); }
        // Keep receiving late usage metadata for a short, bounded drain period.
        drainTimer = setTimeout(closeUpstream, drainMs);
      } else closeUpstream();
    }
    send({ type: 'session', id, token, pricing: PRICING });
    try { upstream = connectProvider(); } catch { fail('Unable to connect to Google.'); return; }
    setupTimer = setTimeout(() => fail('Google session setup timed out.'), 20000);
    durationTimer = setTimeout(() => stop('time_limit'), maxSessionMs);
    upstream.on('open', () => {
      if (stopping) return closeUpstream();
      try { writeProvider({ setup: {
        model: `models/${PRICING.model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
        systemInstruction: { parts: [{ text: 'You are a friendly voice conversation assistant. Respond naturally and concisely. Follow the language the user speaks.' }] },
        inputAudioTranscription: {}, outputAudioTranscription: {},
        contextWindowCompression: { triggerTokens: '25000', slidingWindow: { targetTokens: '8000' } },
      } }); } catch { fail('Could not persist or send Google setup.'); }
    });
    upstream.on('message', bytes => {
      if (ended) return;
      try {
        let message;
        try { message = JSON.parse(bytes.toString()); } catch {
          ledger.append(id, { type: 'protocol_unparsed', direction: 'from_google', jsonBytes: bytes.length, rawText: bytes.toString().replaceAll(apiKey, '[REDACTED_API_KEY]') });
          return fail('Google sent an invalid JSON message; the raw frame was saved.');
        }
        const providerRecord = ledger.append(id, { type: 'protocol', direction: 'from_google', operation: 'read', jsonBytes: bytes.length, turn,
          envelope: protocolEvidence(message, { retainAudio, secret: apiKey }) });
        if (Object.hasOwn(message, 'usageMetadata')) {
          const record = ledger.usage(id, message.usageMetadata, ++sequence, turn, providerRecord.recordId);
          send({ type: 'usage', record, summary: ledger.summary(id) });
        }
        if (message.setupComplete) { ready = true; clearTimeout(setupTimer); safeLog({ type: 'connected' }); send({ type: 'ready' }); }
        const content = message.serverContent;
        if (content) {
          for (const [field, speaker] of [['inputTranscription', 'user'], ['outputTranscription', 'gemini']]) {
            if (content[field]?.text) safeLog({ type: 'transcript', turn, speaker, text: content[field].text });
          }
          if (browser.bufferedAmount > 2 * 1024 * 1024) return fail('Browser audio connection is too slow.');
          send({ type: 'content', content });
          if (content.turnComplete) { safeLog({ type: 'turn_complete', turn }); turn++; }
          if (content.interrupted) safeLog({ type: 'interrupted', turn });
        }
        if (message.goAway) { safeLog({ type: 'go_away', details: message.goAway }); send({ type: 'notice', message: 'Google is ending this connection. Start a new conversation after it closes.' }); stop('provider_go_away'); }
        if (message.error) { safeLog({ type: 'provider_error', code: message.error.code, status: message.error.status }); fail(`Google rejected the session (${message.error.status || message.error.code || 'API error'}). Check model access and API key.`); }
      } catch { fail('Could not parse or persist a Google response.'); }
    });
    upstream.on('error', () => { safeLog({ type: 'provider_connection_error' }); fail('Google connection failed. Check API key, network, quota, and model access.'); });
    upstream.on('close', (code, reason) => finish(stopReason || 'provider_closed', code, reason));
    browser.on('message', (bytes, binary) => {
      if (stopping || ended) return;
      try {
        if (!binary && JSON.parse(bytes.toString()).type === 'stop') return stop();
        if (!binary) {
          const report = JSON.parse(bytes.toString());
          if (report.type === 'client_info') {
            if (s.clientInfoLogged) return; s.clientInfoLogged = true;
            ledger.append(id, { type: 'client_info', browser: String(report.browser || '').slice(0, 512),
              audioContextSampleRate: Number(report.audioContextSampleRate) || null,
              captureSettings: Object.fromEntries(['sampleRate', 'sampleSize', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl', 'latency'].filter(key => report.captureSettings?.[key] !== undefined).map(key => [key, report.captureSettings[key]])),
              timezone: String(report.timezone || '').slice(0, 100), clientAt: String(report.clientAt || '').slice(0, 40) });
            return;
          }
        }
        if (!ready) return;
        if (upstream.bufferedAmount > 1024 * 1024) return fail('Google connection is too slow.');
        if (binary) {
          if (bytes.length > 8192 || bytes.length % 2) return fail('Invalid PCM audio frame.');
          writeProvider({ realtimeInput: { audio: { data: bytes.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
        } else {
          const data = JSON.parse(bytes.toString());
          if (data.type === 'stop') stop();
          if (data.type === 'mute') { writeProvider({ realtimeInput: { audioStreamEnd: true } }); safeLog({ type: 'microphone_muted' }); }
        }
      } catch { fail('Invalid browser message.'); }
    });
    browser.on('close', () => stop('browser_disconnected'));
    browser.on('error', () => stop('browser_error'));
  });
  return { server, ledger, shutdown() { active?.stop('server_shutdown'); for (const client of wss.clients) client.close(); server.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 3210);
  app.server.listen(port, '127.0.0.1', () => console.log(`Gemini Live: http://127.0.0.1:${port}\nLogs: ./logs/\nAPI key: ${process.env.GEMINI_API_KEY ? 'configured' : 'missing — set GEMINI_API_KEY in .env'}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.shutdown());
}
