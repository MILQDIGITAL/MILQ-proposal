# @parking-lingo/server

Small HTTP API for the Parking Lingo app. It keeps the Anthropic API key off the device:

```
photo ──► POST /v1/read-sign ──► Claude vision (structured output) ──► SignReading ──► evaluate() ──► Verdict
                                  only READS the sign                    zod-validated       deterministic: DECIDES
```

The model is never asked whether parking is allowed. It transcribes the sign into a `SignReading`
(`@parking-lingo/core`); `evaluate()` decides.

## Run locally

```sh
# from parking-lingo/
npm install

# no API key needed: serve fixtures from @parking-lingo/core/fixtures
MOCK_VISION=1 npm run dev -w server          # http://localhost:8787

# live (real Claude calls)
cp server/.env.example server/.env   # fill in ANTHROPIC_API_KEY (load it however you like, e.g. `set -a; . server/.env`)
ANTHROPIC_API_KEY=sk-ant-... npm run dev -w server

npm test -w server        # vitest, no network
npm run typecheck -w server

# Try one real photo end to end (costs one vision call; skips if ANTHROPIC_API_KEY is unset)
ANTHROPIC_API_KEY=sk-ant-... npm run try-image -w server -- ./sign.jpg --tz Australia/Sydney --side left --permit 12
```

Core is consumed as TypeScript source with extensionless imports, so the server runs under `tsx`
(`npm start` = `node --import tsx src/main.ts`); there is no build step.

## Environment

| Var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required unless `MOCK_VISION=1`. Never logged. |
| `PARKING_LINGO_MODEL` | `claude-opus-5-5` | Vision model. |
| `PARKING_LINGO_EFFORT` | `medium` | `low`/`medium`/`high`/`xhigh`/`max`. Trade latency/cost for care. |
| `PARKING_LINGO_REFUSAL_FALLBACK` | `1` | Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Set `0` on platforms without it. |
| `MOCK_VISION` | `0` | `1` = return fixtures instead of calling Claude. |
| `PARKING_LINGO_APP_TOKEN` | unset | When set, `/v1/*` requires `x-app-token: <value>`. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `TRUST_PROXY` | `0` | `1` behind Fly/Render/Railway so the per-IP limit uses `Fly-Client-IP` / `X-Forwarded-For`. |
| `CORS_ORIGINS` | empty | Comma-separated origins (or `*`). Not needed for the native app. |
| `MAX_IMAGE_BYTES` | `5242880` | Decoded image size limit (capped at Claude's 5 MB). |
| `MAX_BODY_BYTES` | base64(image limit) + 64 KB | |
| `READ_TIMEOUT_MS` | `60000` | Deadline for one read-sign call. |
| `UPSTREAM_MAX_RETRIES` | `1` | SDK retries on upstream 429/5xx/network errors. |
| `RATE_LIMIT_READ_SIGN` / `RATE_LIMIT_EVALUATE` | `20` / `120` | Per IP per window; `0` disables. In-memory (single instance). |
| `RATE_LIMIT_WINDOW_MS` | `60000` | |
| `LOG_REQUESTS` | `1` | One JSON line per request (no bodies, images or secrets). |

## Model choice

Default `claude-opus-5-5`: current Opus, high-resolution vision (up to 2576 px long edge), structured
outputs, and cheaper than Opus 5. Adaptive thinking is always on; `effort` (default `medium`) controls
how hard it looks. For lower latency/cost try `PARKING_LINGO_EFFORT=low` or
`PARKING_LINGO_MODEL=claude-sonnet-5-5`, and compare on real sign photos first.

The request uses `output_config.format` with `signReadingStructuredOutputSchema`, then re-validates
with `parseSignReading`. If validation fails it retries once, feeding back the problems; a second
failure returns `502 invalid_model_output`. The system prompt is static and prompt-cached; today's
date, time and zone go in the user turn so the model can resolve dates like "Mon 12 May" on
temporary signs.

## API

All errors: `{ "error": { "code": string, "message": string, "retryAfterSeconds"?: number, "details"?: [...] }, "requestId": string }`.
Every response carries `x-request-id` (send your own `x-request-id` to correlate, 8–64 chars `[A-Za-z0-9._-]`).

Headers the app sends: `content-type: application/json`, `x-app-token` (if the server has one),
optionally `x-request-id`, and in mock mode optionally `x-mock-fixture: <fixture id>`.

### `POST /v1/read-sign`

```jsonc
{
  "image": {
    "base64": "<JPEG bytes, base64; a data: URL prefix is tolerated>",
    "mediaType": "image/jpeg"            // image/jpeg | image/png | image/webp | image/gif
  },
  "context": {
    "timeZone": "Australia/Sydney",      // required, IANA
    "now": "2026-11-13T09:30:00+11:00",  // optional ISO instant with offset, or epoch ms; default server time
    "side": "left",                      // left | right | unknown (as seen facing the sign)
    "permits": ["12"],
    "hasDisabilityPermit": false,
    "vehicleType": "car",                // car | motorcycle | commercial | truck | bus | taxi
    "isElectricVehicle": false,
    "intendedStayMinutes": 90,
    "isPublicHoliday": "unknown",        // true | false | "unknown"
    "publicHolidayDates": ["2026-12-25"],
    "jurisdictionHint": "AU-NSW"         // passed to the model as a hint only
  }
}
```

**Images:** HEIC/HEIF is **not** accepted by Claude → `415 unsupported_media_type`. On iOS export JPEG
(e.g. `quality 0.8`) and resize to ≤ 2576 px on the long edge (≈1–2 MB); that keeps uploads fast and
is the model's maximum useful resolution. Max 5 MB decoded. The server sniffs the bytes and uses the
real format if `mediaType` is wrong.

`200` response:

```jsonc
{
  "reading": { /* SignReading, see packages/core/src/schema.ts */ },
  "verdict": { /* Verdict, see packages/core/src/types.ts */ },
  "requestId": "846a92ef-3bad-4fa8-b2b6-76c5e0ed4eb4",
  "meta": { "model": "claude-opus-5-5", "attempts": 1 }   // mock mode adds "mock": { fixtureId, title }
}
```

Example (mock mode, `x-mock-fixture: nsw-clearway-sandwich`, `intendedStayMinutes: 90`), trimmed:

```json
{
  "reading": {
    "isParkingSign": true,
    "panels": [
      { "kind": "clearway", "schedules": [{ "days": ["mon","tue","wed","thu","fri"], "start": "06:00", "end": "10:00", "publicHolidays": "unspecified" }], "towAway": true, "rawText": "CLEARWAY / 6am-10am / MON-FRI / TOW AWAY", "confidence": 0.95, "...": "..." },
      { "kind": "timed_parking", "timeLimitMinutes": 120, "payment": "ticket", "rawText": "2P / TICKET / 10am-3pm MON-FRI", "...": "..." },
      { "kind": "clearway", "rawText": "CLEARWAY / 3pm-7pm / MON-FRI / TOW AWAY", "...": "..." }
    ],
    "overallConfidence": 0.95, "legibilityIssues": [], "jurisdictionHint": "AU-NSW"
  },
  "verdict": {
    "status": "yes_with_conditions",
    "headline": "Yes — 1h 30m",
    "summary": "Park for up to 1 hr 30 min. Buy a ticket and display it. Move by 3:00 pm — clearway starts.",
    "maxStayMinutes": 90, "leaveBy": "2026-11-12T04:00:00.000Z", "currentLimitMinutes": 120,
    "paymentRequired": true, "payment": "ticket", "towAwayRisk": true, "fitsIntendedStay": true,
    "warnings": ["Not sure if today is a public holiday — assuming the sign's usual times apply today.", "Clearway starts 3:00 pm — vehicles are towed."],
    "timeline": [{ "from": "2026-11-12T02:30:00.000Z", "to": "2026-11-12T04:00:00.000Z", "status": "limited", "label": "2P · Ticket", "panels": [1] }, "..."],
    "side": "unknown", "bySide": null, "evaluatedAt": "2026-11-12T02:30:00.000Z", "timeZone": "Australia/Sydney"
  },
  "requestId": "846a92ef-3bad-4fa8-b2b6-76c5e0ed4eb4",
  "meta": { "model": "mock", "attempts": 1, "mock": { "fixtureId": "nsw-clearway-sandwich", "title": "Clearway / 2P Ticket / Clearway" } }
}
```

A photo that isn't a parking sign is **not** an error: `200` with `reading.isParkingSign: false` and
`verdict.status: "unsure"`, headline "Not a parking sign".

### `POST /v1/evaluate`

Re-evaluate a reading the app already has (side/permits/vehicle changed) without another vision call.
The app can also do this locally with `@parking-lingo/core`.

```json
{ "reading": { "...SignReading": "..." }, "context": { "timeZone": "Australia/Sydney", "side": "right" } }
```

→ `200 { "verdict": { ... }, "requestId": "..." }`. An invalid reading → `400 validation_failed` with
`details[].path` like `reading.panels.0.schedules.0.start`.

### `GET /healthz`

`200 { "ok": true, "version": "0.1.0", "mode": "live" | "mock", "model": "claude-opus-5-5", "authRequired": true }`. No auth.

### `GET /v1/mock-fixtures` (mock mode only)

Lists fixture ids/titles for the `x-mock-fixture` header. Without the header, read-sign cycles
through fixtures in order. In mock mode, if the request has no `now`, the fixture's demo time is used
so the demo answer is interesting; send `now` to override.

### Error codes

| Status | `code` | When | Retry? |
|---|---|---|---|
| 400 | `validation_failed` | Body/context/reading failed validation (`details` lists paths). | No |
| 400 | `invalid_json`, `image_invalid`, `bad_request` | Malformed JSON / not base64 or not an image / unknown mock fixture, bad context. | No |
| 401 | `unauthorized` | Missing/wrong `x-app-token`. | No |
| 413 | `image_too_large`, `payload_too_large` | Image > limit / body > limit. | Resize |
| 415 | `unsupported_media_type` | HEIC/HEIF/other, or non-JSON content type. | Convert to JPEG |
| 422 | `model_refused` | The model declined the image. | Another photo |
| 429 | `rate_limited` | Per-IP limit hit. `Retry-After` set. | After delay |
| 500 | `server_misconfigured`, `internal_error` | Bad server API key / bug. | Later |
| 502 | `invalid_model_output` | Reading failed validation twice. | Yes |
| 502 | `upstream_unavailable`, `upstream_error` | Network / upstream 5xx or rejected request. | Yes (unavailable) |
| 503 | `upstream_rate_limited`, `upstream_overloaded` | Anthropic 429 / 529. `Retry-After` set. | After delay |
| 504 | `upstream_timeout` | Read took longer than `READ_TIMEOUT_MS`. | Yes |

## Deploy

Any Node 22 host works; it's one process with no state besides the in-memory rate limiter.

**Docker** (build from the workspace root, because core is a sibling package):

```sh
docker build -f server/Dockerfile -t parking-lingo-server .
docker run -p 8080:8080 -e ANTHROPIC_API_KEY=... -e PARKING_LINGO_APP_TOKEN=... parking-lingo-server
```

**Fly.io:** `fly launch --dockerfile server/Dockerfile` from `parking-lingo/`, `fly secrets set ANTHROPIC_API_KEY=... PARKING_LINGO_APP_TOKEN=...`, internal port 8080, health check `/healthz`.
**Render / Railway (no Docker):** root directory `parking-lingo`, build `npm ci`, start `npm start -w server`, set env vars above plus `TRUST_PROXY=1`, health check path `/healthz`.

Notes: run a single instance (or move the rate limiter to Redis); the app token is a speed bump, not
real auth — it ships inside the app. Add per-user auth/attestation (e.g. App Attest) before a public launch.
