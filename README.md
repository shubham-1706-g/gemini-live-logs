# Gemini Live usage lab

## Start here — purpose and exact folder

**Capture a conversation once. Keep the original Google usage reports. Tomorrow, compare them with Google spend and try revised formulas without making another API call.**

Project folder on this Mac:

```text
/Users/shubhamgupta/Documents/ChatGPT/gemini_live_logs
```

App: **http://127.0.0.1:3210**. Plain Node.js + `ws` + HTML/CSS/JavaScript; no Next.js, database, deployment or build step.

## 1. Add your API key (first time)

Open Terminal and run:

```sh
cd /Users/shubhamgupta/Documents/ChatGPT/gemini_live_logs
npm install
cp -n .env.example .env
nano .env
```

`cp -n` creates the file only if it does not already exist; it does not replace an existing key. Set these values in the editor:

```dotenv
GEMINI_API_KEY=PASTE_YOUR_REAL_KEY_HERE
PORT=3210
GOOGLE_CLOUD_PROJECT_LABEL=YOUR_ACTUAL_GOOGLE_PROJECT_ID
LOG_AUDIO_PAYLOADS=false
```

- `GEMINI_API_KEY`: your Google AI Studio API key. Enter it locally; do not paste it into chat or frontend code.
- `GOOGLE_CLOUD_PROJECT_LABEL`: use the Google project ID that owns the key. This is a label saved in the logs; it does not select a Google project or verify the key's project.
- `LOG_AUDIO_PAYLOADS=false`: keeps usage tokens and audio measurements, but not the actual voice bytes. Use `true` before a test if you also want full audio retained for later inspection; files will be larger and contain your voice.

In nano, press **Control+O**, **Enter**, then **Control+X** to save and exit. Node.js 22.9+ is required. `.env` and logs are ignored by Git.

## 2. Start and test the bot

From the project folder:

```sh
npm start
```

Keep this terminal running. Open **http://127.0.0.1:3210** and:

1. Click **Start conversation** and allow microphone access.
2. Speak normally. Gemini should reply aloud; headphones help avoid echo.
3. Watch the transcript, usage reports and estimated cost.
4. Click **End** and wait for **Session ended** (normally about five seconds, plus connection close time) so late usage can arrive.
5. Check **Saved sessions** and download the session JSONL if you want a copy.

**Changing `.env` requires a server restart.** Press Control+C in the terminal running the app, then run `npm start` again. Reload the webpage. Each conversation has a ten-minute cap.

If the page says **API key needed**, make sure the key was saved in this folder's `.env` and that you started with `npm start`, not plain `node server.js`. If Node reports `EADDRINUSE`, another process already uses port 3210: stop the old app in its terminal or ask the agent to stop only this project's server. Do not kill unrelated Node processes. If microphone access was denied, allow it for this local site in your browser settings and retry.

The server listens only on this machine's loopback address. This is a local experiment, not a public multi-user service.

## 3. Where the logs are, and how to check them

Every conversation automatically creates a file here:

```text
/Users/shubhamgupta/Documents/ChatGPT/gemini_live_logs/logs/<session-id>.jsonl
```

JSONL means one JSON event per line. The files remain after you close the browser, stop Node or restart your computer. Do not delete or edit the original files.

- In the webpage: **Saved sessions → View log** shows transcript/usage; **Download session JSONL** exports the complete evidence.
- In Finder: press **Command+Shift+G** and paste the logs folder above (without `<session-id>.jsonl`).
- In another terminal, from the project folder:

```sh
npm run report
```

That prints the original calculated totals. To recalculate from captured raw evidence:

```sh
npm run reprice
```

The report/reprice commands work even when the voice server is stopped. An **Incomplete** estimate means some evidence could not be priced, not that the call was free. Preserve that log for investigation.

## 4. Before finishing today's experiment

Use a Google project with no unrelated Gemini traffic during the comparison period if possible. A separate key inside a busy shared project alone does not isolate the project's total spend.

Write down the project ID, test date/time and timezone, and the session IDs you intend to compare. End each conversation normally. Keep all original logs; downloading them is optional because they are already on disk.

For an organized local comparison folder:

```sh
mkdir -p artifacts/billing/2026-10-05
```

Replace the date for later experiments. `artifacts/` is ignored by Git. You can keep your notes and tomorrow's Google billing CSV/screenshots there. Do not include API keys.

## 5. Tomorrow: compare with Google

On **6 October 2026** for the initial **5 October** experiment (or the next day for later tests):

1. Open [Google Cloud Billing](https://console.cloud.google.com/billing), select the appropriate billing account, and go to **Reports**.
2. Select the same key-owning **project**, use **Usage date**, choose the test period, and filter to the relevant Gemini API service/model SKUs. Group by **SKU** to see the components where available.
3. Save the report CSV or a screenshot showing the filters, period, currency, usage cost and any credits. Put it in the local comparison folder.
4. Compare usage cost on the same basis: our estimate uses published USD token rates. Do not directly enter an INR amount or compare a total reduced by credits/taxes as though it were the same USD list-price usage cost. Record currency, discounts and credits separately.
5. Reprice the matching local records with the command below. This reads files only; it does not call Google.

**Match the timezone.** Google Cloud Billing Reports use Pacific Time for daily periods, including daylight saving changes; our logs store UTC. Google may report costs late, so tomorrow is a good first check, not a guaranteed final total. [Google's Reports documentation](https://docs.cloud.google.com/billing/docs/how-to/reports)

For the Google Billing usage date **5 October 2026 in Pacific Time**, the corresponding range is **5 October 07:00 UTC to 6 October 07:00 UTC**. In India that is **5 October 12:30 PM to 6 October 12:30 PM IST**. Do not use this offset blindly on winter dates; Pacific daylight saving changes it. If your tests crossed the reporting boundary, include both Google report dates or use an appropriately matched export/window.

Example: Google shows **USD 0.42** for that period/project. Replace the example project ID and amount with the real values:

```sh
cd /Users/shubhamgupta/Documents/ChatGPT/gemini_live_logs
mkdir -p artifacts/billing/2026-10-05
node scripts/reprice.js \
  --project YOUR_ACTUAL_GOOGLE_PROJECT_ID \
  --from 2026-10-05T07:00:00Z \
  --to 2026-10-06T07:00:00Z \
  --actual-usd 0.42 \
  > artifacts/billing/2026-10-05/event-sum.json
```

Open the output JSON file. The main fields are:

| Field | Meaning |
| --- | --- |
| `totalEstimatedUsd` | Amount calculated from the selected logs; `null` means evidence is insufficient for a complete total. |
| `googleActualUsd` | The amount you entered from Google; the app does not fetch it automatically. |
| `differenceUsd` | Our calculated total minus Google's amount. Positive means our estimate is higher. |
| `differencePercent` | That difference as a percentage of Google's nonzero amount. |
| `incompleteSessions` | Sessions that need evidence/pricing review. |
| `sessions` | Per-session calculations, warnings and traceable source records. |

If it differs, **keep the same project/date filters and Google amount**, and try a revised formula on the same files. For example:

```sh
node scripts/reprice.js \
  --project YOUR_ACTUAL_GOOGLE_PROJECT_ID \
  --from 2026-10-05T07:00:00Z \
  --to 2026-10-06T07:00:00Z \
  --strategy last-per-turn \
  --actual-usd 0.42 \
  > artifacts/billing/2026-10-05/last-per-turn.json
```

An agent can also edit a custom formula and rerun it. No new conversation or additional day's wait is needed **to test a formula against evidence already captured**. If the original capture missed data or the Google amount is still changing, that limitation must be investigated rather than solved by forcing a formula to fit. A matching total across several independent experiments is better evidence than one matching total.

## 6. Handoff to another agent

You can paste this into a new chat:

> Work in `/Users/shubhamgupta/Documents/ChatGPT/gemini_live_logs`. Read `README.md` first. This is a plain Node Gemini Live voice experiment whose main purpose is collecting original usage evidence so we can reconcile with delayed Google Cloud Billing spend. Preserve all original files in `logs/`; do not call Google or start new paid conversations just to test a new pricing formula. Inspect `usage_raw` and protocol evidence, then use `scripts/reprice.js` with matching project, reporting timezone/window, currency and Google spend. The actual Google amount and its CSV/screenshot will be supplied by me; do not assume a sample amount is real. Put comparison outputs under `artifacts/billing/`. Read the server configuration code and `.env.example` instructions if needed, but do not read or expose `.env` secrets. Report missing evidence and assumptions explicitly. Do not deploy, push or merge this local experiment.

Implementation map:

| Path (relative to the project folder) | Responsibility |
| --- | --- |
| `server.js` | Local HTTP/WebSocket server, Gemini connection, protocol capture, beacon endpoint and session lifecycle. |
| `public/app.js`, `public/audio-worklet.js` | Microphone capture, resampling, audio playback, transcript/usage UI and beacon events. |
| `lib/ledger.js` | Session JSONL append/persistence; raw usage is saved before calculation. |
| `lib/protocol-log.js` | Protocol envelope preservation, audio measurements and credential redaction. |
| `lib/pricing.js` | Original rates, field validation and default token calculation. |
| `lib/read-log.js` | Readable-record recovery from damaged logs without changing the files. |
| `lib/reprice.js`, `scripts/reprice.js` | Offline formula engine/CLI, evidence recovery, filtering and spend comparison. |
| `formulas/custom-example.mjs` | Starting point for a different formula. |
| `logs/` | Original captured evidence; never overwrite to adjust a result. |
| `artifacts/billing/` | Suggested location for billing evidence, notes and comparison outputs. |

**Verified status on 5 October 2026:** 22 automated tests passed in the implementation session; independent source review approved the local capture/repricing workflow. Browser layout and the missing-key setup state were checked. Real microphone → Google → speaker behavior and agreement with Google billing were not yet verified. Do not promote those to verified facts without running the corresponding checks. No key or billing amount is recorded in this README. Future agents should update this status with the actual session IDs, evidence paths and comparison findings after live validation.

The app currently pins `gemini-2.5-flash-native-audio-preview-12-2025`; price calculations remain estimates until report semantics and billing agreement are verified. `npm test` uses a local fake provider, makes no Google calls, and should be run after code changes. Documentation-only edits do not require a paid call.

---

# Technical reference

## What is recorded

Each session creates `logs/<session-id>.jsonl`. Records include:

- Session ID, UTC timestamps, model, project label, complete pricing snapshot and configuration.
- Every provider `usageMetadata` object exactly as received, with its sequence number and observed turn.
- Parsed modality counts, per-component nano-USD costs, estimate status and warnings.
- Input/output transcript fragments, interruption/turn events, connection/end status.
- Browser lifecycle events received through `navigator.sendBeacon`.

Audio payloads are omitted by default (full capture is optional below). API keys and beacon authentication tokens are never written to logs. Transcripts **are** written locally. Logs are ignored by Git; new files are created with owner-only permissions. Logs persist across restarts and can be viewed or downloaded from the UI.

```sh
npm test
npm run report
# A machine-readable aggregate across local sessions:
node scripts/report.js > report.json
```

## Pricing calculation

Pinned model: `gemini-2.5-flash-native-audio-preview-12-2025`.
Pricing snapshot: `google-list-usd-2026-10-05`.

| Category | USD per million tokens |
| --- | ---: |
| Text input | 0.50 |
| Audio input | 3.00 |
| Text output | 2.00 |
| Audio output | 12.00 |
| Thinking | 2.00 (text output tariff) |

For each received usage report:

```text
estimate USD = (
  inputText × 0.50 + inputAudio × 3.00
  + outputText × 2.00 + outputAudio × 12.00
  + thoughtsTokenCount × 2.00
) / 1,000,000
```

Input and output modality counts come from `promptTokensDetails` and `responseTokensDetails`, checked against `promptTokenCount` and `responseTokenCount`. Costs accumulate in integer nano-USD; only the UI rounds to six decimals. Transcription text uses Google's reported text output counts, not a local word/token approximation. `totalTokenCount` is retained as evidence, not multiplied by a blended rate.

**Aggregation assumption:** Each provider usage message is treated as a generation usage record. Sum those records, including the full prompt history reported each time. Do not subtract previous prompt counts as though the context were free. Google documents periodic usage reports and per-turn context billing, but does not unambiguously specify all intra-turn report/correction semantics. The raw event sequence is retained to validate this assumption against real sessions; the app does not claim billing-exact totals. Identical metadata on different messages is not deduplicated, since separate generations may have identical token counts.

Missing or inconsistent modality details, unsupported modalities, cache usage without a published Live tariff, and tool usage mark the report **unpriced**. Such a session shows an incomplete estimate and a separately labelled subtotal of fully priced reports. No metadata means unknown cost, not a free call.

The app enables input/output audio transcriptions and context compression (25,000-token trigger / 8,000-token target). It has no tools, grounding, proactive audio, or automatic reconnection. A new conversation creates a separate session/log. If model availability or pricing changes, update `lib/pricing.js`, increment its version, and verify the model configuration. Old log calculations retain their original pricing evidence.

## sendBeacon and final events

- `visibilitychange` to hidden sends a small telemetry event; it does **not** end a conversation when switching tabs.
- `pagehide` sends an end-intent event and releases local audio.
- Payloads carry a server-issued session token and unique event ID. Duplicate deliveries are idempotent.
- A `fetch(..., { keepalive: true })` fallback is used if `sendBeacon` cannot queue the payload.
- A `true` return from `sendBeacon` means queued, not delivered. Browser/process crashes can prevent delivery.
- Usage logging occurs on the Node server as messages arrive; it does not depend on beacon delivery. A browser WebSocket disconnect also ends the upstream session after the bounded drain period.
- Closing a call or losing the process can still omit final Google usage. Session end records explicitly state that final usage is not guaranteed. A log without an end record is displayed as open/interrupted.

## Compare with Google billing

1. Use a dedicated key-owning Google Cloud project (or an isolated test window) with no unrelated traffic. Record the project label, model, UTC start/end times and pricing version.
2. Run a few short conversations: one turn, multiple turns, an interruption, a mute/unmute, and a normal End. Download the logs. Inspect whether usage reports are distinct generations or interim/cumulative updates before trusting aggregation.
3. Verify text/audio input and output counts separately. Repeated conversational context, thinking, and transcriptions all matter; call duration alone is not a billable-token measurement.
4. Export `node scripts/report.js` and compare to Google Cloud Billing filtered to the same project, Gemini API service, time window, and relevant model/SKUs. Keep list-price usage cost separate from credits, discounts, taxes, currency conversion and net billed spend.
5. Reconcile after Google billing data has arrived and stopped changing. Next-day checking is a practical cadence, not a guaranteed reporting deadline. There is no automatic per-session invoice lookup in this app.

The total shown here is an **estimate of received token usage at published paid-tier prices**, not a billing invoice or proof that all final usage was received. A free-tier key may incur no charge even when a list-price estimate is displayed.

## Validation

`npm test` uses Node's built-in test runner and a local fake WebSocket provider. It checks pricing arithmetic, thinking, re-billed context, missing/inconsistent metadata, raw persistence, audio relay, duplicate/spoofed beacons, page-close cleanup, late reports, cross-origin rejection, missing keys and cancellation during setup. This makes no Google calls and does not validate provider model access, real microphone/playback behavior, or actual billed spend.

## Official references

- [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-native-audio)
- [Live WebSocket protocol and UsageMetadata](https://ai.google.dev/api/live)
- [Live capabilities: audio and token usage](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Live best practices: context billing and transcriptions](https://ai.google.dev/gemini-api/docs/live-api/best-practices#pricing-billing)

## Offline formula experiments (the primary workflow)

**Capture once, calculate repeatedly.** The raw evidence is independent of the first formula. `usage_raw` is appended before the derived `usage` result. Each incoming protocol envelope is saved before either, so offline repricing can recover a report even if the process stopped between those writes. Unknown/new usage fields are preserved, and an omitted counter remains distinguishable from an explicit zero using the raw object and `fieldPresence`.

The protocol trace records every Google read and write attempt, including setup/system instructions, input/output transcription events, generation/turn/interruption flags, errors, and any new provider fields. The trace retains UTC and monotonic timestamps, record IDs, source-code hashes, Node version, model, pricing snapshot, context settings, and the browser audio configuration. Outbound records mean a send was attempted, not that Google processed or billed it; provider usage is the accounting evidence.

For each audio payload, logs contain its direction, MIME type, sample rate, PCM sample/byte count, duration, base64 length and SHA-256. Audio contents are omitted by default. Set `LOG_AUDIO_PAYLOADS=true` **before the experiment** if you also want the complete base64 audio retained. This produces larger files containing your actual voice. Token repricing does not ordinarily need raw audio, but this option preserves it for deeper investigation.

**Read/write distinction:** protocol read/write events are not a separate token tariff. Google Live provides prompt/response modality counts and may provide cached-content counts, cache modality details, thoughts and tool-prompt counts. All such fields are retained. There is no separate cache-write token field/rate in the pinned model's documented Live schema; its absence is recorded as unknown, not fabricated as zero. New fields remain available to custom formulas.

The repricing command only reads the files. It does not call Google or modify the original estimate/log. Every result includes file hashes, formula hash, rates, selected usage records and comparison differences.

```sh
# Recalculate all captured sessions using their original price snapshots.
npm run reprice

# Compare an isolated UTC day to an example $0.42 Google spend amount.
# Replace the date and amount with your actual test window and comparable spend.
node scripts/reprice.js \
  --from 2026-10-05T00:00:00Z --to 2026-10-06T00:00:00Z \
  --actual-usd 0.42 > comparison-event-sum.json

# Test another aggregation hypothesis on exactly the same captured usage.
node scripts/reprice.js --strategy last-per-turn --actual-usd 0.42
node scripts/reprice.js --strategy last-report --actual-usd 0.42
node scripts/reprice.js --strategy positive-deltas --actual-usd 0.42

# Override token rates locally, without editing captured evidence.
node scripts/reprice.js --rates formulas/rates.example.json

# Copy and edit a JS formula for any new theory or newly documented field.
cp formulas/custom-example.mjs formulas/my-formula.mjs
node scripts/reprice.js --formula formulas/my-formula.mjs --actual-usd 0.42

# Restrict to one session or the exact project label recorded at session start.
node scripts/reprice.js --session YOUR_SESSION_UUID
node scripts/reprice.js --project YOUR_PROJECT_LABEL
```

The built-in alternatives are **experimental hypotheses**, not equally valid claims about Google billing. `event-sum` adds received generation records; `last-per-turn` keeps the final received report for each observed turn; `last-report` uses only the last session report; `positive-deltas` subtracts the prior report's counters with a zero floor. Positive deltas can be wrong when context compression resets counts. Test the interpretations; never choose one solely because it happens to match one total. Use multiple independent sessions/billing windows and inspect components/SKUs as well as the total.

`--from` is inclusive; `--to` is exclusive. Filtering uses **usage-report receipt time** in UTC, which can differ from Google's service billing time for a turn straddling midnight. For a clean comparison, finish sessions away from the boundary. Custom formula modules receive the complete `records`, selected `usage`, pre-window `previousUsage` (for delta baselines), original `pricing`, override `rates`, and selected `strategy`; they return `estimatedUsd` plus any useful diagnostics. A missing end record, unreadable log line or unpriced report prevents the built-in tool from presenting a complete reconciled total. Unreadable/truncated lines are reported while preserving the original file and all remaining readable evidence.
