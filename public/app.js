const $ = id => document.getElementById(id);
let socket, stream, audio, recorder, source, silent;
let session = null, startedAt = 0, running = false, muted = false, connected = false, starting = false;
let playbackAt = 0, generation = 0, config;
const playing = new Set();
let transcriptTurn = 1;
const transcriptNodes = new Map();
const usd = value => `$${value.toFixed(6)}`;
function status(text, live = false) { $('status').textContent = text; $('status').classList.toggle('live', live); }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function clearPlayback() { for (const node of playing) { try { node.stop(); } catch {} } playing.clear(); playbackAt = 0; }
function releaseAudio() {
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  recorder?.disconnect(); source?.disconnect(); silent?.disconnect();
  recorder = source = silent = null;
  clearPlayback();
  audio?.close().catch(() => {}); audio = null;
}
function controls() {
  $('start').disabled = running || starting || !config?.configured;
  $('mute').disabled = !connected;
  $('stop').disabled = !running;
  $('mute').textContent = muted ? 'Unmute mic' : 'Mute mic';
  $('mute').setAttribute('aria-pressed', String(muted));
  document.querySelectorAll('#history-list button').forEach(button => { button.disabled = running || starting; });
}
function resetView() {
  $('transcript').replaceChildren(); transcriptNodes.clear(); transcriptTurn = 1;
  $('ledger-rows').replaceChildren(); $('ledger-count').textContent = '0 reports';
  showSummary({ counts: {}, usageReports: 0, complete: false, unpricedReports: 0 });
}
function showSummary(summary) {
  for (const key of ['inputText', 'inputAudio', 'outputText', 'outputAudio', 'thoughts']) $(key).textContent = (summary.counts[key] || 0).toLocaleString();
  $('cost').textContent = summary.complete ? usd(summary.estimatedUsd) : '—';
  $('reports').textContent = summary.usageReports;
  $('ledger-count').textContent = `${summary.usageReports} reports`;
  $('cost-caption').textContent = summary.complete ? 'Estimated from received usage · not an invoice' : summary.unpricedReports ? `${summary.unpricedReports} unpriced reports · priced subtotal ${usd(summary.pricedSubtotalUsd)}` : 'Waiting for Google usage metadata';
  if (summary.warnings?.length) notice(`Incomplete estimate: ${summary.warnings.join('; ')}`);
  if (summary.logWarnings?.length) notice(`Log needs review: ${summary.logWarnings.join('; ')}`);
}
function transcript(speaker, text, turn = transcriptTurn) {
  const key = `${turn}-${speaker}`;
  if (!transcriptNodes.has(key)) {
    const row = document.createElement('div'); row.className = 'utterance';
    const label = document.createElement('strong'); label.textContent = speaker === 'user' ? 'YOU' : 'GEMINI';
    const body = document.createElement('p'); row.append(label, body); $('transcript').append(row); transcriptNodes.set(key, body);
  }
  transcriptNodes.get(key).append(document.createTextNode(text));
  $('transcript').scrollTop = $('transcript').scrollHeight;
}
function usageRow(record) {
  const row = document.createElement('tr'); const c = record.cost.counts;
  for (const value of [`#${record.sequence} / turn ${record.turn}`, new Date(record.at).toLocaleTimeString(), (c.inputText + c.inputAudio).toLocaleString(), (c.outputText + c.outputAudio + c.thoughts).toLocaleString(), record.cost.complete ? usd(record.cost.estimatedUsd) : 'Unpriced']) {
    const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
  }
  const cell = document.createElement('td'); const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Raw + calculation';
  const pre = document.createElement('pre'); pre.className = 'raw'; pre.textContent = JSON.stringify(record, null, 2); details.append(summary, pre); cell.append(details); row.append(cell); $('ledger-rows').prepend(row);
}
function playAudio(data, mime) {
  if (!audio || !connected) return;
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  if (bytes.length % 2) return;
  const rate = Number(mime?.match(/rate=(\d+)/)?.[1] || 24000);
  const buffer = audio.createBuffer(1, bytes.length / 2, rate);
  const view = new DataView(bytes.buffer); const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  const node = audio.createBufferSource(); node.buffer = buffer; node.connect(audio.destination);
  playbackAt = Math.max(audio.currentTime + .025, playbackAt);
  node.start(playbackAt); playbackAt += buffer.duration; playing.add(node);
  node.onended = () => playing.delete(node);
}
function finishUI() {
  generation++; running = false; starting = false; connected = false; muted = false;
  releaseAudio(); controls(); status('Session ended');
  $('voice-label').textContent = 'Conversation ended'; $('voice-help').textContent = 'Your received usage reports are saved. Start again for a new session.';
}
async function start() {
  notice(); starting = true; controls(); status('Requesting microphone');
  const attempt = ++generation;
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Use a current browser on localhost with microphone and AudioWorklet support.');
    const newStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (attempt !== generation) { newStream.getTracks().forEach(t => t.stop()); return; }
    stream = newStream;
    audio = new AudioContext(); await audio.resume(); await audio.audioWorklet.addModule('/audio-worklet.js');
    source = audio.createMediaStreamSource(stream); recorder = new AudioWorkletNode(audio, 'pcm-recorder');
    silent = audio.createGain(); silent.gain.value = 0;
    source.connect(recorder); recorder.connect(silent); silent.connect(audio.destination);
    recorder.port.onmessage = ({ data }) => {
      if (connected && !muted && socket?.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 256 * 1024) { notice('Network cannot keep up with microphone audio. Conversation stopped.'); stop(); return; }
        socket.send(data);
      }
    };
    resetView(); session = null; running = true; starting = false; startedAt = Date.now(); $('timer').textContent = '00:00'; $('download').hidden = true; $('session-id').textContent = 'Connecting'; $('log-status').textContent = 'Waiting for server'; controls(); status('Connecting to Google');
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/live`);
    socket.onopen = () => {
      if (attempt !== generation) return;
      socket.send(JSON.stringify({ type: 'client_info', browser: navigator.userAgent,
        audioContextSampleRate: audio?.sampleRate, captureSettings: Object.fromEntries(Object.entries(stream?.getAudioTracks()[0]?.getSettings() || {}).filter(([key]) => ['sampleRate', 'sampleSize', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl', 'latency'].includes(key))),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, clientAt: new Date().toISOString() }));
    };
    socket.onmessage = ({ data }) => {
      if (attempt !== generation) return;
      const event = JSON.parse(data);
      if (event.type === 'session') {
        session = { id: event.id, token: event.token }; $('session-id').textContent = event.id;
        $('log-status').textContent = 'Recording on server'; $('download').href = `/api/sessions/${event.id}/download`; $('download').hidden = false;
      }
      if (event.type === 'ready') { connected = true; controls(); status('Live', true); $('voice-label').textContent = 'You can speak now'; $('voice-help').textContent = 'Gemini will reply aloud. You can interrupt naturally.'; }
      if (event.type === 'usage') { usageRow(event.record); showSummary(event.summary); }
      if (event.type === 'content') {
        const c = event.content;
        if (c.interrupted) clearPlayback();
        if (c.inputTranscription?.text) transcript('user', c.inputTranscription.text);
        if (c.outputTranscription?.text) transcript('gemini', c.outputTranscription.text);
        if (!c.interrupted) for (const part of c.modelTurn?.parts || []) if (part.inlineData?.mimeType?.startsWith('audio/pcm')) playAudio(part.inlineData.data, part.inlineData.mimeType);
        if (c.turnComplete) transcriptTurn++;
      }
      if (event.type === 'notice' || event.type === 'error') notice(event.message);
      if (event.type === 'stopping') { connected = false; releaseAudio(); controls(); $('stop').disabled = true; status('Saving final usage'); }
      if (event.type === 'ended') { showSummary(event.summary); $('log-status').textContent = 'Saved locally'; finishUI(); refreshHistory(); }
    };
    socket.onclose = () => {
      if (attempt !== generation) return;
      finishUI(); if (session) $('log-status').textContent = 'Disconnected · refresh saved log'; refreshHistory();
    };
    socket.onerror = () => notice('Connection failed. Check that the Node server is running.');
  } catch (error) { finishUI(); status('Unable to start'); notice(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access for localhost, then try again.' : error.message); }
}
function stop() {
  if (!running) return;
  connected = false; releaseAudio(); controls(); $('stop').disabled = true; status('Saving final usage');
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
  else { socket?.close(); finishUI(); }
}
$('start').onclick = start;
$('stop').onclick = stop;
$('mute').onclick = () => {
  muted = !muted; stream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  if (muted) socket.send(JSON.stringify({ type: 'mute' }));
  controls(); $('voice-label').textContent = muted ? 'Microphone muted' : 'You can speak now';
};
function beacon(event) {
  if (!session || !running) return;
  const payload = JSON.stringify({ sessionId: session.id, token: session.token, eventId: crypto.randomUUID(), event, clientAt: new Date().toISOString() });
  const blob = new Blob([payload], { type: 'application/json' });
  // true means queued, not delivered. Server-side WebSocket logging is authoritative.
  if (!navigator.sendBeacon?.('/api/beacon', blob)) fetch('/api/beacon', { method: 'POST', body: blob, keepalive: true }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon('hidden'); });
window.addEventListener('pagehide', () => { beacon('pagehide'); releaseAudio(); socket?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) { finishUI(); refreshHistory(); } });
setInterval(() => { if (running) { const seconds = Math.floor((Date.now() - startedAt) / 1000); $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; } }, 1000);
async function refreshHistory() {
  try {
    const response = await fetch('/api/sessions'); if (!response.ok) throw new Error('Unable to read session logs.');
    const sessions = await response.json(); $('history-list').replaceChildren();
    const subtotal = sessions.reduce((n, s) => n + s.pricedSubtotalUsd, 0);
    const incomplete = sessions.filter(s => !s.complete).length;
    $('history-total').textContent = `${sessions.length} sessions · priced subtotal ${usd(subtotal)}${incomplete ? ` · ${incomplete} without a complete estimate` : ''}`;
    if (!sessions.length) { const p = document.createElement('p'); p.className = 'section-head empty'; p.textContent = 'No saved conversations. Each session creates its own JSONL file.'; $('history-list').append(p); }
    for (const s of sessions) {
      const row = document.createElement('div'); row.className = 'history-item'; const left = document.createElement('div'); left.textContent = new Date(s.startedAt).toLocaleString();
      const small = document.createElement('small'); small.textContent = `${s.id.slice(0, 8)} · ${s.usageReports} reports · ${s.status === 'ended' ? s.reason : 'open / interrupted'}`; left.append(small);
      const right = document.createElement('div'); const cost = document.createElement('span'); cost.className = 'mono'; cost.textContent = s.complete ? usd(s.estimatedUsd) : 'Incomplete';
      const view = document.createElement('button'); view.className = 'secondary'; view.textContent = 'View log'; view.disabled = running || starting;
      view.onclick = async () => { if (running || starting) return; const viewGeneration = generation; try {
        const response = await fetch(`/api/sessions/${s.id}`); if (!response.ok) throw new Error('Unable to load this session.');
        const data = await response.json(); if (running || starting || generation !== viewGeneration) return; notice(); resetView(); showSummary(data.summary);
        for (const r of data.records) { if (r.type === 'usage') usageRow(r); if (r.type === 'transcript') transcript(r.speaker, r.text, r.turn); }
        $('session-id').textContent = s.id; $('log-status').textContent = s.status === 'ended' ? 'Saved locally' : 'Open / interrupted';
        $('download').href = `/api/sessions/${s.id}/download`; $('download').hidden = false; status('Viewing saved session');
      } catch (error) { notice(error.message); } };
      right.append(cost, view); row.append(left, right); $('history-list').append(row);
    }
  } catch (error) { $('history-total').textContent = error.message; }
}
$('refresh').onclick = refreshHistory;
try {
  const response = await fetch('/api/config'); if (!response.ok) throw new Error('Cannot load server configuration.'); config = await response.json();
  $('model').textContent = config.pricing.model; status(config.configured ? 'Ready' : 'API key needed'); controls();
  if (!config.configured) notice('Add GEMINI_API_KEY to your local .env file, then restart npm start. Your key stays on the Node server.');
} catch (error) { notice(error.message); status('Server unavailable'); }
refreshHistory();
