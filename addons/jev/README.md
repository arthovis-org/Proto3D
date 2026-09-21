# Jev for Proto3D — a decision layer for the node system

Live: **https://arthovis-org.github.io/Proto3D/addons/jev/** · core: https://arthovis-org.github.io/Proto3D/

An add-on page that boots the unmodified Proto3D core and adds a **Jev** category of five components,
a TypeSafe Jev provider card in Connections, an "Ask to add" bar (Ctrl+J) that lets Jev choose and
wire components from a sentence, four click-through demos and a movable tutorial. **No file outside
`addons/jev/` changed.** Everything runs without a key on a clearly labelled simulated decider; with a
TypeSafe key the same nodes call the real API.

## 1. What Jev is

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is TypeSafe AI's first
"System One" model (early access since 2026-09-15). It is **not a chat LLM**: it takes a `state`
(text, JSON or a list of texts) and a map of typed questions, and answers every question in one
parallel pass with a **typed value plus calibrated probabilities** — no text, no streaming, no
generation. Three primitives ([docs](https://docs.typesafe.ai/)):

| primitive | question | answer |
| --- | --- | --- |
| `noul` | `{ type: 'noul', instructions, criteria?: { true, false } }` | `{ noul: 0..1 }` |
| `choice` | `{ type: 'choice', instructions, criteria: { option: description } }` (≤ 255 options) | `{ choice, probabilities, confidence }` |
| `score` | `{ type: 'score', instructions, criteria: [lowest … highest] }` (2–10 levels) | `{ score, probabilities, confidence, legend }` |

`POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>` and
`{ state, model: 'jev-latest', questions }` → `{ model: 'jev-1.13.0', answers, usage }`. 70–500 ms,
**$0.042 per million input tokens, output free**; 401 / 422 / 429 / 529 errors, the last two retried
with backoff. Documented weaknesses that shaped the design: literal reading of instructions, poor
counting and date arithmetic, accuracy falls with irrelevant context, no free-text arguments, not
injection-resistant by default ([model jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)).

## 2. Why it fits a node system

Proto3D already generates (Prompt → Generate Text / Image / Video / Audio). What the graph lacked
is a **cheap, fast, calibrated decision** between generation and action: which branch, whether to
proceed, how urgent, in what order. Jev's answers are values a dataflow engine can carry — a text
lane, a number, a boolean, an event pulse — so a decision becomes a node with ports rather than a
prompt asking an LLM to please answer in JSON. Threshold + `unsure` turns TypeSafe's recommended
act / confirm / escalate bands into a flow shape.

## 3. The components (category `jev`)

| id | label | inputs | outputs | params |
| --- | --- | --- | --- | --- |
| `jev-route` | Route by meaning | `state` any·multi, `run` event | `choice` text, `confidence` number, `probabilities` data, `lane1..lane6` event (labels follow the lanes), `unsure` event, `decided` event | `instructions`, `lanes` json `[{ key, label, description }]` (2–6), `threshold` 0–1 (0.6), `mode` auto/manual |
| `jev-check` | Yes / no check | `state`, `run` | `probability` number, `yes` boolean, `pass` event, `fail` event | `instructions`, `criteria_true`, `criteria_false`, `threshold` (0.5), `mode` |
| `jev-score` | Score on a rubric | `state`, `run` | `score` number (expected level), `level` text, `confidence`, `probabilities`, `scored` event | `instructions`, `levels` json (2–10), `mode` |
| `jev-rank` | Rank a list | `items` any·multi (arrays, a board's `tasks`, values, lines), `run` | `ranked` data, `top` text, `ranked_text` text, `ranked_event` event | `instructions` (what "higher" means), `levels`, `limit`, `mode` |
| `jev-ask` | Ask Jev | `state`, `run` | `answers` data, `summary` text, `answered` event | `state` text, `questions` json in the raw API shape, `mode` |

Shared behaviour (`components/common.js`): the engine calls `evaluate` every frame, so the API is
never called from there — a job parked in a `WeakMap` per instance is kicked when the state hash
changes (auto mode, 300 ms debounce) or on `run` / the face's Run button / the panel's "Decide now",
at most one in flight — a newer state supersedes the decision in flight, and an answer that lands
after the state moved on is kept as `last` (marked stale) but never pulses events. The result lands
in `instance.state.last = { answers, usage, model, latencyMs, cost, simulated, at, stateHash }`
(plain JSON, so save / load restores the last answer and a restored node does not re-decide until
its state changes); live handles stay on non-serialised `_` fields. The five faces are `XL` and
draw the L design scaled up (`scaled` / `anchorsOf` in common.js), so the decision reads from
the demo's framing distance. Each face shows the question, the answer, probability bars (accent for the winner), a
confidence chip, a **Simulated** / **Live · jev-1.13.0** badge and a footer `model · latency · cost`.
Lane events of the router carry the routed text; `decided` carries the whole verdict.

## 4. The demos (Jev ▾ menu, or the tutorial's demo picker)

1. **Route a customer message** — Text → Phone screen and → Route by meaning (Returns / Shipping /
   Billing) → three Actions → three desk laptops, `unsure` → Ask a human. Four sample messages
   in the tutorial; "hello??" lands below the 0.6 floor.
2. **Guard a generation** — Prompt → Yes / no check ("on-topic for a product launch and free of
   personal data?") → `pass` presses Run on Generate Text (offline Demo provider), `fail` lights a
   "Blocked before spending" display; a note carries the cost comparison (~$0.00003 vs a generation).
3. **Triage a board** — a Kanban board with eight cards in varied urgency language → Rank a list
   ("how urgent for the launch?", one score question per card in one request) → Display + Sticky
   Note with the top item; Score on a rubric grades one card picked by a Data node.
4. **Ask the system to build** — four Media nodes and a Person. Smart Add: "put these images on a
   wall" → Media Grid wired to the pictures; "show the person's tasks on a board" → Kanban board
   with the person in its people slot.

## 5. Smart Add — the system helps build the system

`smart-add.js` (Ctrl+J, or Jev ▾ → Ask to add…): one `choice` question whose criteria are every
component in `registry.all()` as one string each, `"Label: description"` (the API's shape; the
selected types left out, plus `none`, ≤ 255). The winner is instantiated (`createInstance`), placed beside the selection
(`world.nextFreeSlot`) and linked to every selected block whose output fits one of its inputs
(`world.canConnect`), all as one undoable composite through `history`. A toast reports what was
added and linked with Jev's probability; the top-3 alternatives stay clickable as chips (a click
undoes the add and places the alternative).

## 6. Core seams used — and the guarantee

No core file is modified, moved or deleted. The add-on reaches the core only through shared module
instances and `window.__proto`:

| file | imports | core module |
| --- | --- | --- |
| `boot.js` | `./isolate.js`, `./provider.js`, `./components/index.js`, **`../../src/main.js`**, `./plugin.js` | boots the whole app into the add-on page's DOM |
| `isolate.js` | `Tabs` from `src/tabs.js`, `StartPanel` from `src/ui/start-panel.js` | prototype patches before boot (see §7) |
| `components/*.js` | `registry` (core/registry.js), `icons` (icons.js), `palette`, `palettes`, `categories`, `setLabelText` (theme.js), `clear, drawCaps, drawDivider, drawTile, drawChip, drawBar, drawText, fitLine, font, roundRect, tabular, PAD` (faces.js), `asText` (components/util.js), `fmtUSD` (ai/pricing.js), `ui` (ai/ui-hooks.js), `ProviderError` (ai/http.js) | the component contract and the face language |
| `components/icons.js` | `CATEGORIES` (core/registry.js) | pushes the `jev` category row (label, description) |
| `jev-client.js` | `requestJSON, ProviderError, sleep` (ai/http.js), `vault` (ai/vault.js), `spend` (ai/pricing.js), `providerStatus` (ai/providers/base.js) | the live call, key + proxy, session spend |
| `provider.js` | `registerProvider` (ai/providers/base.js) | the Connections card |
| `plugin.js` | `buildExample` (examples/index.js), `loadWorld` (serialize.js), `ui`, `vault`, `fmtUSD` | scenes and persistence |
| `scenes/triage-board.js` | `isoDate, addDays` (pm/model.js) | card due dates |
| `tutorial.js` | `three` (import map), `ui` | projecting the spotlight ring; Go live opens Connections |
| `frame.js` | `three`, `isPlanOn` (plan.js) | framing that projects each block's own box and keeps the blocks out from under the add-on's layers; defers to `ws.frameBlocks` in the 2D plan |
| `index.html` | `../../styles.css` + `./jev.css`, the same import map, every element id `main.js` requires, the `#tour` markup | the current root skeleton |

Runtime, through `window.__proto`: `world, engine, ws, history, selection, interaction, overlays,
leftBar, tabs, menubar, start, tour, hintBar, registry, cmd, createInstance, serialize, load,
togglePanel, frameAll, ai.connections, THREE, icons, setTheme`.

**Private seams** (underscore or prototype-level; a reviewer should look here first):
`Tabs.prototype.init / _writeKey / _persist / saveNow` and `StartPanel.prototype.open` (isolate.js),
`tabs._t / _setStatus`, `menubar._build()` (the bar renders its titles once, in its constructor),
`instance._placePortLabel()` (re-seating a renamed lane label). Shared mutable objects extended in
memory: `icons.jev*`, `palettes.{dark,light}.categories.jev`, `categories.jev`, `CATEGORIES` (one
row). Everything else is public API.

## 7. Storage: what the add-on owns, how the core is protected

Owned keys (localStorage): `proto3d.jev.world.v1` (the add-on world, saved 800 ms after a change,
`wiring` stripped so restoring never touches the core's wiring preference), `proto3d.jev.demo.v1`,
`proto3d.jev.tutorial.v1` (card position, dock, collapsed, demo, step), `proto3d.jev.settings.v1`
(the simulated / live switch). Read only: `proto3d.theme` (shared preference — toggling the theme
writes it, as on any page), vault keys and proxies through `vault` (encrypted, the core's).

Protected: the core's project tabs and autosave. `main.js` constructs `Tabs` and would restore the
core's tab set from `proto3d.tabs.v1` + IndexedDB `proto3d-projects` and autosave into them, so
`isolate.js` patches the prototypes **before** `main.js` runs: `init` never reads the core's tabs,
`_writeKey` never writes `proto3d.tabs.v1`, `_persist` never writes a project record, `saveNow` is
inert; `plugin.js` then flips `tabs.autosaveOn` off (without `setAutosave`, which would write
`proto3d.autosave.v1`), points `tour.start` and `start.open` at the tutorial (so `proto3d.tour.v1` and
`proto3d.start.v1` are never written and no template thumbnail 404s) and hides the tab strip's
autosave indicator. `test/check.mjs` asserts the full key list after a whole session and that the
root page still boots.

## 8. Going live

1. Jev ▾ → Connections… (or File → Connections…), paste a key from https://console.typesafe.ai/keys
   into the **TypeSafe Jev** card, Save, **Test** (one tiny `noul` on `state: 'ping'`; the chip reports
   `jev-1.13.0 answered in N ms`).
2. Every jev node now calls `POST api.typesafe.ai/v1/systemone` with `model: 'jev-latest'`; badges
   turn **Live**, footers show `jev-1.13.0 · 142 ms · $0.00003`, the status pill counts decisions,
   average latency and spend (also booked on the core's session `spend` as kind `decision`).
3. Jev ▾ → Use simulated Jev / Use live Jev switches without removing the key.
4. **CORS**: if the browser blocks the call, set the proxy URL on the card — the repo ships
   `proxy/cloudflare-worker.js`; the browser still sends its own key.
5. Cost: `input_tokens / 1e6 × $0.042`. A routing decision on a 300-token message ≈ $0.000013; the
   whole triage board (8 score questions in one request, ~700 tokens) ≈ $0.00003; Smart Add's
   35-option choice (~1.5 k tokens) ≈ $0.00006. Output tokens are free.

The simulated decider (`simulate.js`) is deterministic keyword overlap through a small synonym table
for the demo domains, softmax to probabilities, confidence = top1 − top2, a Gaussian over the ladder
for scores, and phone / email detectors as extra tokens. It exists so the page demonstrates the
*shape* of the integration offline; it is not a model and says "Simulated" everywhere it appears.

## 9. How Jev's limitations shaped the design

- **Literal instructions** → every node has explicit criteria fields (lane descriptions, `true means` /
  `false means`, named levels) instead of one prompt; the panel hint says so.
- **Calibrated probabilities, not certainty** → thresholds are first-class params and the router has an
  `unsure` lane (act / confirm / escalate as ports).
- **No free-text arguments** → Smart Add asks *which component*, then links by port compatibility
  (`canConnect`) rather than asking Jev for a wiring plan.
- **Degrades with irrelevant state** → the ranker scopes each score question to one item; the router
  sends only the message.
- **Weak numeric proximity** → levels are named, not numbered (`['low','medium','high','critical']`).
- **Not injection-resistant** → the guard demo checks the *request*, and the check's criteria live in
  params, never in the state.

## 10. Running the checks

```
node addons/jev/test/check.mjs                       # PASS / FAIL per check, exit 1 on failure
node addons/jev/test/check.mjs --shots out/ --video out/
node addons/jev/test/check.mjs --three /path/to/three-r160   # serve three.js locally (offline sandboxes)
```

Needs `python3` (static server at the repo root) and `playwright` resolvable from the working
directory or the global npm root (`npm i -g playwright`; never `playwright install` — it picks up
`/opt/pw-browsers/chromium-*/chrome-linux/chrome` when present, else `--chromium <path>`). Checks:
clean boot; 5 components in `jev`; provider card present and absent from every Generate picker;
each demo loads and frames; demo 1 routes the four samples (returns · shipping · billing · unsure)
and lights the right desk; demo 2 blocks the risky prompt and generates on the clean one (Demo
provider job count); demo 3 ranks all 8 cards with the crash / data-loss bug on top; Smart Add
adds a `media-grid` wired to the four pictures and a `kanban-board` with the person plugged in;
the tutorial card drags (6 px dead zone, clamped to the viewport) and keeps its position across a
reload; save / load round-trip restores `jev-*` nodes with `state.last`; storage isolation; the root
page still boots; zero console errors during the whole run. `window.__jevFast = true` makes the
simulated latency zero and the auto debounce immediate.

## 11. Roadmap — further integration ideas

- **Cable type inference**: a `choice` over an output's compatible inputs when a block is dropped
  onto another with several fits ("which link did you mean?").
- **Auto-grouping**: `choice` per block over a handful of intent groups → Ctrl+G suggestions.
- **Natural-language command palette**: the palette's command list as choice criteria — "make it
  brighter" → View → Light theme.
- **Guardrails before Actions**: a `jev-check` template on every Action's trigger (Flow decision
  nodes could take a Jev probability as their condition).
- **Device intent routing**: phone `tap` payloads and screen text routed to flows by meaning.
- **Confirm / escalate bands as a flow shape**: a three-way node (act / confirm / human) with two
  thresholds, fed by any Jev confidence.
- **Live data**: a Person's summary scored for overload, a Timeline's late tasks ranked.

## 12. Note on `addons/gateway-credits/`

The older add-on is stale against the current core: `plugin.js` imports `AutoSave` from
`src/serialize.js` (removed when autosave moved to `tabs.js` / `project-store.js`), so its module
graph fails to link, and its `index.html` reproduces the pre-menubar DOM (`#toolbar`, `#btn-*`,
`#file-menu`) while today's `main.js` requires `#menubar, #tabstrip, #start, #hint-bar,
#mini-toolbar, #bottom-right, #jobs-tray, #stats, #guides, #field-hover, #field-editor,
#help-preset, #legend-controls(-title)`. It needs the same skeleton refresh this add-on's
`index.html` / `isolate.js` / `plugin.js` show (copy the root skeleton, drive `proto.tabs`,
`proto.menubar.menus`, `proto.start`, and persist with a namespaced key on `world.onChange`).

## 13. Files

```
addons/jev/
  index.html          the root skeleton + jev.css and the add-on layers (#jev-tutorial, #jev-spot, #jev-ask, #jev-status, #jev-badge)
  boot.js             isolate → provider → components → ../../src/main.js → plugin.install
  isolate.js          prototype patches so boot never touches core storage
  jev-client.js       decide(): live (backoff, cost, spend) or simulated; result cache; session stats
  simulate.js         the offline decider
  provider.js         registerProvider({ id: 'jev', capabilities: [] })
  components/         common.js (runner, faces, panel), icons.js, jev-route/check/score/rank/ask.js, index.js
  scenes/             route-message, guard-generation, triage-board, smart-build, index.js
  smart-add.js        Ask to add (Ctrl+J)
  tutorial.js         the movable tutorial card and spotlight ring
  frame.js            framing: per-block hull, fill 0.9, the tutorial card / Ask bar / pills cut out of the visible canvas
  plugin.js           install(proto): isolation, persistence, Jev menu, status pill, window.__jev
  jev.css             styles on the core tokens, both themes
  test/check.mjs      the Playwright checks, --shots, --video
```
