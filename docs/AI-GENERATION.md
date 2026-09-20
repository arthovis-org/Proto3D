# Generating content with AI

Proto3D can write, paint, film and compose from inside the 3D workspace. Four **Generate**
components (Prompt, Generate Text, Generate Image / Video / Audio) talk to hosted services —
**OpenRouter** for language models, **fal.ai** and **kie.ai** for media — or to the offline
**Demo** provider, and their results are ordinary values: text feeds a Display, a device screen,
a Text template or a board's *add task*; media feeds a Media Grid, a screen or a card cover. This
document explains how the layer is built, what it does with your keys, what a static site can and
cannot promise, and how to extend it.

```
components/generate/  prompt.js · generate-text.js · generate-media.js (image / video / audio) · common.js
ui/                   connections.js (keys)  model-browser.js  jobs-tray.js
ai/                   providers/{base,openrouter,fal,kie,demo,index}.js  vault.js  jobs.js  pricing.js  store.js  http.js  ui-hooks.js
proxy/                cloudflare-worker.js (optional CORS proxy)
```

## 1. Architecture

**Provider adapters** (`src/ai/providers/`) implement one interface (`base.js`):

| member | purpose |
| --- | --- |
| `id, label, description, url, keyUrl, glyph` | presentation on the Connections page |
| `capabilities` | any of `text, vision, json, image, video, audio` |
| `needsKey, keyHint, corsNote` | key field placeholder; when a proxy may be needed |
| `testKey({ key, proxy, signal })` | `→ { ok, latencyMs, balance?, message }` — the **Test** button |
| `listModels({ key, proxy, kind, force })` | `→ [ModelInfo]` (live from OpenRouter, curated for fal / kie / demo) |
| `estimateCost(spec)` | USD before the call (drives *approve above $*) |
| `run(spec, job, { key, proxy, signal })` | does the work, reports through `job.update(...)`, returns the result |

`createJob(providerId, spec)` (in `base.js`) checks the key through the vault, wraps `run` in a
**Job** and puts it on the **queue** (`jobs.js`): states `queued → running → succeeded | failed |
cancelled`, `progress 0..1`, `stage`, `queuePosition`, `logs`, `startedAt / elapsed`, `tokens`,
`cost`, `result`, `error { code, message, fix }`; `cancel()` aborts the fetch through an
`AbortSignal` (fal jobs also `PUT` their cancel URL), `retry()` re-queues. The queue runs at most
`vault.settings.concurrency` (3) jobs at once and emits change events for the faces, the panel and
the **job tray**. `pricing.js` formats money, computes text costs from token counts and keeps the
**session spend** (per provider and kind, in `sessionStorage`).

**Adapters as implemented** (the docs sites were not reachable while this was written, so the
shapes follow the public docs from memory and are marked *unverified* in the code where it matters):

- `openrouter.js` — `POST /api/v1/chat/completions` with `stream: true` and `usage: { include:
  true }`; the SSE body is read chunk by chunk (`http.readSSE` skips `: OPENROUTER PROCESSING`
  comments and stops at `[DONE]`), `delta.content` streams to the face, the final chunk carries
  `usage` (tokens and OpenRouter's `cost`). `GET /models` gives every model with per-token prices,
  context length and input modalities (cached 10 min); `GET /auth/key` (and `/credits`) the label,
  usage and remaining limit for **Test**. Headers: `Authorization: Bearer`, `HTTP-Referer` (this
  page), `X-Title: Proto3D`. Vision inputs are `image_url` parts; JSON mode is
  `response_format: { type: 'json_object' }` plus a parse (with a `{…}` fallback) into `data`.
- `fal.js` — the **queue API**: `POST https://queue.fal.run/{model}` → `request_id` plus
  `status_url / response_url / cancel_url` (used as returned; rebuilt from the app alias when
  missing). The status is polled with `?logs=1` and back-off (0.7 → 3 s): `IN_QUEUE`
  (`queue_position`), `IN_PROGRESS` (logs; a `NN%` in a log line drives the bar), `COMPLETED`,
  then the response is fetched and normalised (`images[]`, `video`, `audio_file / audio`).
  `FAL_MODELS` is the curated list — id, label, kind, schema-driven `params` (size / aspect /
  duration / voice / steps…), approximate price, whether it needs a reference input.
- `kie.js` — the **task API**: `POST /api/v1/jobs/createTask { model, input }` → `taskId`; `GET
  /api/v1/jobs/recordInfo?taskId=` polled until `state` is `success` (`resultJson.resultUrls`) or
  `fail`; `GET /api/v1/chat/credit` for **Test**. `KIE_MODELS` is its curated list.
- `demo.js` — always available, no network, free: text streams a paragraph composed from the
  prompt's own words (JSON mode returns a small object), images and video posters are painted on a
  canvas from a hash of the prompt, audio is a generated WAV melody. Every Generate component
  starts on Demo so a scene runs without keys.

**Components** (`src/components/generate/`) keep their configuration in `params` and their
results in `state` (`current`, `history` ≤ 8, `lastPrompt`); live handles (`_job`, `_approval`,
`_err`, `_partial`) stay on the instance and never reach the world JSON. `common.js` holds the
shared lifecycle (`startRun → approval → createJob → finishJob → history → when done`), the face
(model chip, status ring with elapsed and tokens, streaming body, Run / Stop, history strip,
errors with a fix action), the panel section (provider, model browser, schema-driven params,
auto-run, approval threshold, run controls, history) and the media finishing step.

**UI** (`src/ui/`): `connections.js` is the settings page (one card per provider with a masked key
field, Test, an optional proxy URL and a status chip; the Demo card; the vault's passphrase
section; spend and stored-result totals). `model-browser.js` picks a model with search, filters
(provider, price band, context length, vision, favourites), sorting, per-1M or per-run prices and
*recommended* badges. `jobs-tray.js` sits bottom-right with running / queued jobs, progress,
cancel, and the session spend; clicking a job frames its component. Components reach these
through `ai/ui-hooks.js` (`openConnections`, `openModelBrowser`, `focusBlock`, `toast`), which
`main.js` installs, so the dependency direction stays *components → ai → (hooks) → ui*.

## 2. Security model — and its limits in a static site

Proto3D is static files. There is no server of ours between you and a provider, which is the
point (nothing to trust, nothing to run) and the constraint (the browser holds the key).

- **Keys live in the vault** (`ai/vault.js`): in memory while the page is open, persisted in
  `localStorage["proto3d.vault.v1"]` **encrypted with WebCrypto AES-GCM 256**. The AES key is
  derived with PBKDF2 (310 000 rounds, SHA-256, random salt) from either
  - a **passphrase** you set on the Connections page — the vault is then *locked* after every
    reload until you enter it (a hint can be stored; nobody can recover the passphrase); or
  - a random **device secret** the vault generates and keeps in `localStorage` next to the
    ciphertext. This hides keys from a glance and from casual scraping of storage, **not** from
    anyone who can read this browser profile. The Connections page says so; add a passphrase for
    real protection.
- Keys are **never logged, never toasted, never written into world JSON** (`serialize.js` walks
  `params` and `state`; keys are in neither) and are sent only in the `Authorization` header of
  requests to the provider host you chose — or to the proxy URL *you* configured for that provider.
- **Per-provider proxy URLs** and cost settings are ordinary settings
  (`localStorage["proto3d.ai.settings.v1"]`), not secrets.
- **Limits you should know**: a key in the browser is reachable by any script that runs on the
  page (browser extensions, a compromised CDN copy of three.js). Use keys with a **spending
  limit** (OpenRouter lets you set one per key; fal and kie are prepaid) and rotate them. On a
  shared computer, prefer the passphrase mode or *Forget key* before leaving.
- Generated media that is not a hosted URL (Demo output, and provider files that were fetched
  into the page) is stored as Blobs in **IndexedDB** (`proto3d-ai / blobs`, keyed by job id); the
  world JSON stores the small media record with `storeId`. Clear it from the Connections footer.

## 3. The proxy (when the browser cannot reach a provider)

OpenRouter and fal.ai answer browser requests directly (CORS). Some networks block them, and
kie.ai may not send CORS headers to browsers. `proxy/cloudflare-worker.js` is a ~60-line Cloudflare
Worker that forwards a request unchanged to an **allow-list of provider hosts** — method, path,
query, body and the browser's own `Authorization` header — and adds the CORS headers on the way
back. It injects nothing and holds no key, so it is not a secret. Deploy:

1. Cloudflare dashboard → *Workers & Pages* → *Create* → the "Hello world" worker → *Deploy*.
2. *Edit code*, replace everything with `proxy/cloudflare-worker.js`, *Deploy*.
3. Optional: set `ALLOWED_ORIGINS` to your Proto3D origin(s).
4. Proto3D → Connections → the provider's *Proxy URL* → paste `https://<name>.<you>.workers.dev`.

The app then calls `https://<worker>/<provider-host>/<path>` (`http.viaProxy`). Media files
(`fal.media`, kie's CDN) are fetched directly, not through the proxy.

## 4. Job model and cost controls

- **Estimate first.** `estimateCost(spec)` runs before a job exists: OpenRouter from live
  per-token prices (≈ 4 characters per token in, `max tokens` out, +1000 tokens per image), fal /
  kie from the curated price (× duration for per-second video, × count for images).
- **Approve above $** (per component, default $0.05, 0 = never ask): a run above the threshold
  waits on the face — *Estimated $2.05 — above your $0.05 approval limit. Run it anyway?* — with
  *Run for $2.05* / *Cancel*; the panel offers the same.
- **Auto-run** (off by default) re-runs when the prompt changes, debounced ~0.9 s of engine time,
  still subject to approval.
- **Gate with the graph**: `run` is an event input, so an Input button, a Flow Decision or any
  `when …` output can hold a job until someone clicks — an approval step is a component away.
- **Concurrency** is 3 jobs at once (`vault.settings.concurrency`); the rest queue and show their
  position. **Cancel** on the face, in the panel or in the tray; **Retry** re-queues a failed job.
- **Actual cost** comes from the provider when it reports one (OpenRouter's `usage.cost`), else
  from tokens × price, else the estimate. It shows on the face's cost line, in `usage`, in the
  tray and in the Connections footer as the **session spend**.

## 5. Component reference

| id | inputs | outputs | params | face |
| --- | --- | --- | --- | --- |
| `prompt` | `variables` any\* · `text` text | `prompt` text | template (panel editor with insert chips, resolved preview, char count) | the template typeset with `{variables}` as chips showing their values (amber when unresolved) |
| `generate-text` | `prompt` text · `context` any\* · `image` media · `run` event | `text` text · `data` data · `when done` event (payload: the text) · `usage` data | provider (OpenRouter / Demo) · model (browser) · fallback prompt · system prompt · temperature · max tokens · JSON mode · auto-run · approve above $ | provider + model chips, status ring (elapsed, tokens), prompt preview, the answer streaming in, Run / Stop, cost line, history strip (8) |
| `generate-image` | `prompt` text · `reference` media · `run` event | `image` media · `all` data (media[]) · `when done` (payload: the media) · `usage` | provider (fal / kie / Demo) · model · fallback prompt · schema-driven options (size, aspect, steps…) · count · seed · auto-run · approve above $ | queue position → progress bar with the provider's log line → the image; batches as a grid |
| `generate-video` | same | `video` media … | model options: duration, aspect… | video poster with a play glyph and progress |
| `generate-audio` | same | `audio` media … | model options: length, voice… | waveform |

**Variables in a Prompt.** Every component plugged into `variables` is a variable named after
its **title**: `{Card title}`, `{Public launch}`. `{1}`, `{2}` pick by position, `{Name.path}`
reaches into an object (`{Card.due}`), `{text}` is the explicit text input. An object without a
path reads as its `title` / `name` (a milestone, a card, a person), not as JSON. Unresolved
variables stay in the text and are counted in the footer.

**Where results go.** `text` → Display, Text (`{value}` template), any screen, a Prompt variable,
another Generate's prompt; `when done` → a board's `add task` (the text becomes a card) or any
flow start. Media → Media Grid, screens, Display, a board's **`cover`** input (the card named in
the board's *cover goes to card* param, else the first card, gets a thumbnail), a Generate
Image's `reference`, a Generate Video's `reference`. All of these are also **drop-to-link** pairs
(`pm/relations.js → DROP_LINKS`), so dropping a Generate Image on the board makes the cover link
without a cable.

**Media records** are `{ kind, src, title, provider, model, createdAt, cost, w, h, duration?,
storeId?, hosted? }`: `src` is a blob URL for stored files (Demo output and provider files that
could be fetched) or the provider's hosted URL, `hosted` keeps the original, `storeId` is the
IndexedDB key; `store.hydrate` gives stored records a fresh blob URL after a reload and
`faces.bitmapFor` falls back to the store when an old blob URL fails.

## 6. Adding a provider or a model

**A model** on fal or kie: add a row to `FAL_MODELS` / `KIE_MODELS` — `id` (the provider's
endpoint id), `label`, `kind`, `price` (+ `perSecond`, `seconds`), `priceText`, `params` (each
`{ key, label, type: select | number | boolean | text, options?, default, min?, max?, step? }`
maps 1:1 to a request field), `promptField` when the prompt is not called `prompt`,
`needsReference` + `referenceField` for image-to-image / voice clone, `recommended` for a badge.
Remove `unverified` once you have run it. The panel, the browser and the request body follow.

**A provider**: one file in `src/ai/providers/` calling `registerProvider({...})` with the
members in §1 (use `http.request / requestJSON / readSSE / sleep` for fetches with timeouts,
abort and error mapping; report through `job.update({ stage, progress, queuePosition, log,
partial, tokens, cost })`; return `{ text, data?, usage, cost }` for text or `{ media: [{ kind, src
| blob, w, h, duration }], cost }` for media), then import it in `providers/index.js`. Add its id
to the `provider` param options of the components that should offer it and to the worker's
`ALLOWED_HOSTS` if a proxy makes sense. The Connections card, the status chip, the model browser
and the job tray need nothing else.

**Errors** are `ProviderError(code, message, { fix })` with `code ∈ no-key · auth · rate ·
bad-request · server · network · cors · cancelled · timeout · parse` and `fix ∈ connections ·
retry · null`; faces turn them into a sentence with a matching button.

## 7. Verification

`shoot8.mjs` (scratchpad harness) drives the page headlessly with Playwright: mocked
`https://openrouter.ai/api/v1/*` (auth/key, models, a streamed SSE completion with usage) and
`https://queue.fal.run/*` (submit → IN_QUEUE → IN_PROGRESS with logs → COMPLETED → result, a
stuck request for cancel, a 422 for failures) plus `https://fal.media/*`. It checks the Connections
entry points, key save / test, the encrypted vault and the passphrase round trip, Demo and
OpenRouter runs (streaming, usage, cost, JSON mode, approval), the fal job (queue → progress →
image → Media Grid / Monitor / card cover), cancel, failures with their fix, Prompt variables, the
tray, session spend, the Showcase zone, save / load and a reload with IndexedDB — with zero
console errors. The earlier harnesses (shoot3–7) still pass.
