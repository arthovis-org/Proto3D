# Gateway Credits — a Proto3D add-on

**Add-on page:** `addons/gateway-credits/` (on Pages: `…/Proto3D/addons/gateway-credits/`)
**Core app (unchanged):** the repository root

A shared, prepaid **credit balance** that provider-calling nodes can spend instead of each holding its own API key, delivered as an add-on *beside* Proto3D rather than inside it. It brings six components (Research agent with model / memory / tool sub-nodes, Model call, Tool call, Memory, Budget, Credits meter) whose faces are working UIs, a metering ledger (estimate → hold → settle / refund, idempotent), a routing policy (capability tiers, cheapest-capable, fallback on provider error, per-workflow budgets) and an admin panel — without editing a single core file. It is built on the add-on SDK in `addons/sdk/` (see `addons/README.md`) and is tested at three levels: pure units, the real core engine in Node, and the real page in Chromium.

Providers are **simulated**: no network call is made, no key is read or sent, prices are illustrative. The point of the demo is the metering and routing mechanics running on the real Proto3D engine and 3D scene.

## Try it

Open `addons/gateway-credits/` on the served repo root (GitHub Pages: `https://arthovis-org.github.io/Proto3D/addons/gateway-credits/`). A fresh page loads the **Research desk** sample, laid out n8n-style: **New research request** → **Research agent** → **Draft summary** (own key) → **Report** left to right, with the agent's sub-nodes — **Chat model** (Anthropic), **Memory**, **Web search** (Brave), **Crawl pages** (Firecrawl), **Parse PDFs** (PDF.co) — hanging under it, and **Research budget** / **Credits meter** in a top row. Cables are on. Then:

* **Credits → Run sample** (or the Run button on the trigger, or the **Run** button on the agent's face): the agent plans, calls its three tools and answers — five metered rows titled "Research agent · step 1…5" — then the own-key draft adds a bypassed row and the Report logs it. The flow is re-laid out afterwards (undoable).
* **Click the faces.** Each node's face is its UI: on the Chat model pick a **model** (▾ opens the core's list on the face), click a **tier** chip, flip **Gateway credits ⇄ Own key**, double-click the prompt to type; the agent face shows the three slots (lit when connected) and a step timeline that lights up as steps settle, with credits under each; the meter has a **Top up** button and an **auto top-up** checkbox; the budget's limit and period are editable in place. Every write is an undoable `setParam`.
* **Credits → Set balance to 0.5 cr**, run again: the agent declines at step 1 and skips the rest. Tick **auto top-up** on the meter face (or in the admin block) and run again: the top-up fires and the run completes.
* **Credits → Flow layout** after dragging blocks around: back to the arranged flow in one undo step.

## Architecture

```
addons/gateway-credits/
  addon.json        id gateway-credits · prefix gw · sdk 1 · entry ./src/index.js · styles ./src/gateway.css
  index.html        loads ../sdk/shell.js and nothing else
  src/index.js      register(host): ledger over host.storage + the four gw- types · install(host): hooks, toasts, menu, admin, sample graph
  src/nodes.js      gw-llm, gw-tool, gw-budget, gw-meter (host.nodes.register in category 'gateway'); the metering flow
  src/ledger.js     append-only ledger, derived balance / holds / spend / budgets, auto top-up, tiny event emitter; createLedger(storage)
  src/rates.js      illustrative rate card (credits per 1M tokens, per tool unit), tiers, estimates
  src/routing.js    resolveModel (fixed / tier / cheapest-capable) and fallbackFor — pure policy
  src/providers.js  adapter interface + simulated implementations behind injectable `sim` knobs; the marked seam for a real gateway service
  src/admin.js      Credits menu (host.ui.menu) and the admin block (host.ui.panelSection)
  src/example.js    the bundled sample graph (core example shape, loaded through host.examples.build)
  src/gateway.css   admin / panel styles on the core CSS variables (light + dark)
  test/unit/        ledger · rates · routing · providers          (node --test, in-memory storage)
  test/engine/      the nodes on the REAL core Engine in Node     (sdk/testing/headless-engine.js + fake-host.js)
  test/browser/     the page in Chromium: boot, menu, run sample, decline, auto top-up, storage isolation, core untouched
```

### Seams, all through the SDK

| Need | SDK member | What it is in the core |
| --- | --- | --- |
| four node types that cannot collide with core ids | `host.nodes.register(def)` (enforces the `gw-` prefix) | `registry.register`, frozen defs, ids `^[a-z][a-z0-9-]*$`; the Gateway rail button appears by itself (auto-labelled categories) |
| icons for the category and the nodes | `host.icons.set(name, svg)` | the mutable `icons` table |
| release holds when a node's evaluate throws | `host.engine.onError(cb)` (chained, unsubscribable) | `engine.onError`, the engine's one hook |
| refund holds of removed nodes | `host.world.onChange(cb)` for `remove-node` / `clear` / `load` / `example` + `def.onDestroy` | `world.onChange`, `Block3D.dispose` |
| live faces and footers | `host.draw.{clear, drawText, roundRect}`, `host.theme.palette` | `faces.js`, the live palette |
| the Gateway credits section on each node | `def.panel(api, block)` (a core component feature, unchanged) | `panel.js` `_api`: `section, readonly, action, live, h` |
| the Credits menu | `host.ui.menu({ id, label, items })` | the declarative `MenuBar.menus` + `_build()`; also listed by the command palette |
| the admin block that survives panel rebuilds | `host.ui.panelSection(title, build)` | a `<details class="sec">` inside `#panel`, outside `#panel-body` |
| toasts | `host.ui.toast(text, ms)` | `overlays.toast` |
| the sample graph in a tab, autosaved | `host.examples.build(example)` | `buildExample` through `tabs.replaceActive` |
| "Run sample" pulses the Input | `host.engine.emit(instance, key, payload)` + `host.engine.order()` | `engine.emit`, Kahn order |
| ledger + settings persistence | `host.storage.get/set` (keys `ledger.v1`, `settings.v1`) | `localStorage` under `proto3d.addon.gateway-credits.`; on the page the shell prefixes that again with `addon.gateway-credits:` |
| own tabs / autosave / projects for this page | nothing to do: the shell's storage isolation | core Tabs + IndexedDB, under `addon.gateway-credits.proto3d-projects` |

Boot order is still the trick, now owned by the shell: `register(host)` runs before `src/main.js`, so a graph with gw- nodes restored from this page's own storage is rebuilt instead of skipped. The old namespaced `AutoSave` is gone; the core's tab autosave already lands in the add-on's isolated IndexedDB.

## Nodes

| Type | Size | What it is |
| --- | --- | --- |
| `gw-agent` **Research agent** | L | An n8n-style agent. Slot inputs `model` (Chat model *), `memory`, `tools` (**multi**: one slot per cable) take **sub-nodes** through their `handle` outputs; `trigger` / `prompt` start a run; outputs `answer`, `steps`, `cost`, `done`, `failed`. A run is plan → one step per attached tool (capped by `maxTools`) → answer, every step its own ledger row. |
| `gw-llm` **Model call** | M | A metered (or own-key) model call, as before, plus `handle` (`as model`) so it can hang under an agent. |
| `gw-tool` **Tool call** | M | A metered tool call (Brave Search · Firecrawl · Browserbase · LlamaParse · PDF.co), plus `handle` (`as tool`). |
| `gw-memory` **Memory** | S | Keeps the last `window` exchanges an attached agent produced; `handle` (`as memory`), `count`, `recent`; a `clear` pulse empties it. |
| `gw-budget` **Budget** | M | Per-workflow cap enforced at hold time; workflow, limit and period editable on the face. |
| `gw-meter` **Credits meter** | M | Balance, a 12-point spend sparkline, Top up, auto top-up, the last 3 rows. |

**Slots.** The core supports several cables into one input only when the port is `multi` (the value is then an array in connection order), so `tools` is one multi input and `model` / `memory` are single inputs; `flowLayout.isSlotKey` recognises `model`, `memory`, `tools`, `tool`, `tool1…`. A handle is `{ kind, uid, title, params, glyph }` — configuration, never the key (`hasKey` only); the agent resolves the live sub-node by uid (`world.nodeByUid`) so an edit on the sub-node's face applies to the next step.

**Agent run (`src/nodes.js`).** On a pulse: `attachments()` reads the slots, `planSteps()` builds `state.gw.steps` `[{ n, kind, role, service, status, credits, ms }]`, `startStep()` meters step 1 through the same `startAttempt` gw-llm / gw-tool use (with `params` / `title` / `step` overrides: idempotency key `<agent uid>:<pulse>:s<n>`, row title "<agent> · step n", the agent's workflow and budget). `drainAgent()` settles a returned step, appends its credits to the running total and starts the next one on the same frame; the answer step finishes the run: `answer` / `steps` / `cost` outputs, `done`, and the exchange is written into the attached gw-memory. A provider error refunds the hold and, for a model step with the fallback policy on, retries once elsewhere (key `…:s<n>:a2`); otherwise — and on a decline (budget, balance) — the step is `failed`, the remaining ones `skipped`, `failed` fires, and the agent's error shows on the block. Own-key attached models produce `bypassed` rows exactly as a standalone own-key node does. A second pulse while running is refused (toast), never double-billed.

## Faces: the node is the UI (`src/faces.js`)

Faces are drawn with the core face design language (`host.draw`: `beginFields`, `drawCaps`, `drawChip`, `drawBar`, `drawTile`…) at the core's face sizes (S 365×288 · M 485×288 · L 701×432 logical px). Every editable region is registered with **`beginFields`** — kinds `select` (model, provider, service, period), `number` (units, window, limit), `text` / `multiline` (prompt, query, workflow), `checkbox` (auto top-up, bound with `get` / `set` to the ledger settings) and `action` (Run, Top up, tier chips, the credential toggle) — so the core hit-tests them, marks them in edit mode, Tab-walks them and writes through an undoable `setParam`; while the editor is open on a field the face leaves that text out (`spec.editing`). `def.face.onPointer` adds app-like **single clicks outside edit mode**: a press on a field is captured (elsewhere the block still drags), the click runs an action, toggles a checkbox (`host.commands.setParam` / the field's `set`) or opens the core editor on the face plane (`host.fields.open`) for a select / number / text.

Every gw- face carries a **service badge** top-left — a circular disc with the service glyph and its accent ring — plus the service name, so nodes are tellable apart at a glance in 3D. `gw-llm`: badge · provider ▾ · **model ▾** · status pill · **tier** chips · **Gateway credits ⇄ Own key** · prompt · result preview · est / last cost · **Run**. `gw-tool`: badge · **service ▾** · units · credential · query · result · cost per unit · Run. `gw-agent`: badge · request · status · three **slot cards** (Chat model *, Memory, Tools — lit with the attached glyphs when connected, dashed when empty) · **step timeline** (a dot per step with its service glyph, lit as it settles, credits under each; the planned run shows before the first run) · running total · answer preview · Run. `gw-budget`: workflow (text) · limit (number) · period ▾ · ring and bar with spent / held. `gw-meter`: big balance · 12-point spend sparkline · **auto top-up** checkbox · **Top up +500** · last 3 rows with glyphs. `gw-memory`: badge · count · window (number) · last exchange. `def.panel` sections remain for the properties panel.

## Service glyphs (`src/glyphs.js`)

No trademarked logos: each provider and tool service (and each node role) has an **original monochrome monogram** in the core icon style (24×24, `stroke: currentColor`, round caps) with a **distinct silhouette and accent colour** — a hexagon-and-dot, an A with a crossbar, a four-point sparkle, a cloud, a wave, a crescent, a plinth, a leaf; a magnifier-plus, a flame, a browser window with a cursor, a document with lines, a page with a gear; a form, a database, a robot, a wallet, a gauge. One segment list per glyph renders both as SVG (`host.icons.set('gw-svc-<id>')`, used in the admin block and available to the rail) and as canvas paths (`drawGlyph` / `drawBadge`: `moveTo` / `lineTo` / `quadraticCurveTo` / `arc` / `arcTo`, no image loading). `glyphFor(kind, params)` returns `{ id, svg, color, label }` for a node's current provider / service; the unit test checks every rate-card entry has one, ids and colours are unique. The rate card gained **Baseten** and **Eden AI** (illustrative rows) so every provider in the reference screenshot is covered.

## Flow layout (`src/flowLayout.js`, Credits → Flow layout)

`flowLayout(nodes, connections, opts) → Map(uid → [x, y, z])` is a pure function that organises the graph on **three levels along y** (`LEVELS = { flow: 9, top: 17, ground: 0.2 }`, overridable through `opts.levels`):

* **Level 1 · the flow** (eye level, y = 9): the main chain runs **left → right by topological rank** with equal column gaps (a column is as wide as its widest item, including the row of slot children standing under it); parallel branches spread in z inside a column, ordered by their predecessors and centred on the chain; loose blocks land in a trailing column.
* **Level 0 · resources** (the floor): **slot children** (anything cabled into `model` / `memory` / `tool…`) leave the ranking and stand on the floor **directly beneath their parent** in a centred horizontal row, one unit toward the camera (`FLOW.slotForward`) so their faces read from the front — their cables drop vertically from the agent like n8n's drop-lines. The core keeps a block's bottom at y ≥ 0.2, so a resource's centre is `ground + h / 2`: `host.layout.graph()` hands the measured height `h`, `DEFAULT_SIZE` has one per size for the sample. A child of a child steps down too when there is vertical room under its parent (`FLOW.levelGap`), otherwise it steps forward in z in front of it.
* **Level 2 · governance** (y = 17, lifted when the flow is taller): `gw-budget` / `gw-meter` float **above the workflow they govern**, in a row centred over the chain's x-extent.

`overlapping()` checks the result as boxes (w × h × d): blocks apart on any one axis are clear. **`flat: true`** returns the old one-level plan arrangement as `Map(uid → [x, z])` (children one z-step *behind* their parent, budget / meter behind the chain, heights untouched); **Credits → Flow layout (flat)** applies it, and **Credits → Flow layout** picks it automatically while the core's 2D plan is on (`host.ui.plan()`). `host.layout.apply()` moves the blocks as **one undoable `cmd.transform`** through the core history — a `[x, z]` pair keeps a block's height, an `[x, y, z]` triple sets it — then frames the view (the core frames from the current azimuth at a fixed elevation, so the sample camera looks at the chain from the front, elevated, and all three levels stay in the frame). The sample is built from the same function (`samplePositions()`), and Run sample re-applies it. Slot cables carry the core's `data` type hue, so they already read differently from the event chain; dashed drop-lines from the parent's bottom edge need a core seam (proposal (e) in `addons/README.md`) — until then the agent face shows the three slot chips lit when connected.

## Metering flow (inside `gw-llm` / `gw-tool`, `src/nodes.js`)

```
trigger pulse (or "Run now" kick)
  → eligibility: credential mode, provider adapter present, rate on card   (eligibility())
  → 'Own key'?  → adapter.call(mode: 'own-key') → ledger.bypass(row, 0 cr)  (never metered, still visible)
  → estimate:  adapter.estimate(params, prompt, route) → credits + units
  → ledger.hold({ idem, workflow, budget, credits })
        ├─ budget:  spent(workflow, period) + held(workflow) + est > limit → DECLINE row, emit('failed', reason)
        ├─ balance: available < est → try auto top-up → still short → DECLINE row, emit('failed', reason)
        └─ ok:      HOLD row (available drops, held rises); node.rt.error shows any decline for 6 s (red rim)
  → adapter.call(...) async (300–1500 ms simulated; 10 % failure on model calls when fallback policy is on)
  → resolve/reject pushed into a per-instance queue (WeakMap, never serialized)
  → next evaluate() drains the queue:
        ├─ ok:    ledger.settle(holdId, actual, units) → SETTLED row; touch('result'), touch('cost'), emit('done', result)
        └─ error: ledger.refund(holdId) → REFUNDED row; fallback policy on and first attempt?
                    → new attempt with fallbackFor(model) (same tier or better, other provider; new idem suffix :a2)
                    → else emit('failed', reason)
```

* **Idempotency.** The key is `${node.uid}:${pulseId}` (`:a2` for a fallback attempt). `pulseId` is the engine pulse number prefixed with a page-session epoch, because engine pulse numbers restart on reload. `ledger.hold()` with a key it has seen returns `{ duplicate: true }` and places no hold; `settle()` / `refund()` on a closed hold are no-ops. A real gateway would key on `runId + nodeId + attempt`.
* **Holds are released** on `engine.onError` (node threw), on `def.onDestroy`, and for any node that is no longer in the world after `remove-node` / `clear` / `load` / `example`. A late-resolving call for a refunded hold cannot re-charge (the hold is closed).
* **Balance is derived**, never stored: `available = Σ(open + top-ups + adjustments) − Σ(settled) − Σ(open holds)`. Every entry is appended; the admin table collapses `hold → settle | refund` into one row whose status moves `held → settled | refunded`.

## Routing policy (`src/routing.js`, `ledger.settings.policy`)

* A node either **pins a model** (`tier: fixed` + `model`) and is never swapped, or declares a **capability tier** (`economy | standard | premium`).
* **Prefer cheapest capable** (off by default): among all models at the tier or above, the lowest estimate on the rate card wins across providers; the row's note records what it beat. Off: the node's own provider at that tier.
* **Fallback on provider error** (on by default): a simulated 503 refunds the hold and retries once on the cheapest capable model of another provider; the fallback row says where it came from. Off: the node fails visibly instead.
* **Budgets** are `gw-budget` nodes in the graph (so they travel with Save JSON): `workflow`, `limit`, `period` (monthly / daily). A gateway node's workflow is its `workflow` param, else its group title, else `default`. The ledger enforces `spent + held + est ≤ limit` at hold time; a decline is a normal, explained row.
* **Eligibility is decided up front** and shown in the node's panel section (yes / no / bypass + reason) — the way to avoid an n8n-style `nodeNotCovered` surprise at run time.

## Tests

```
npm test                     # SDK + every add-on (Node): 31 SDK · 6 template · 54 gateway-credits
npm run test:browser         # Playwright: core-smoke, template page, gateway page (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers if needed)
```

* **Unit** (`test/unit`): ledger (double entry, idempotency, declines, budgets, auto top-up), rates, routing, providers, **glyphs** (every provider / service has a glyph, unique ids and colours, SVG ↔ canvas segments), **flowLayout** (ranks, branches, three y bands with slot children on the floor under their parent's x-centre, the governance row above the chain, no 3D overlaps, `flat` reproducing the one-level plan arrangement, determinism, purity, nested children).
* **Engine** (`test/engine`, the real core `Engine` on the headless world): the gw-llm / gw-tool metering flow, declines, auto top-up, refunds on error / removal, own-key bypass, budgets, fallback; **agent** (handles carry no key; plan → tools → answer each metered with unique `:s<n>` keys and "· step n" titles; provider error mid-way refunds and skips; decline mid-way; own-key model = bypassed rows; fallback inside a step; auto top-up mid-run; no model attached; memory window / clear; Run sample prefers the agent and applies the flow layout through `host.layout`); **faces** (every face renders at its size and registers fields inside it; the gw-llm fields — model select, provider select, tier chips, credential toggle, prompt, Run — and what a click on each does through `host.commands` / `host.fields`; tool / memory / budget / meter fields; the meter's Top up row and settings binding; the agent timeline before and after a run; the sample's gateway part runs end to end).
* **Browser** (`test/browser/gateway.test.js`): the page boots with zero errors; the Research desk sample loads with the six gw- types, the Credits menu (Run sample, **Flow layout**), the admin block and the Gateway rail category; a gw-llm block exposes its face fields (`select model`, `action run`…) to the core field editor; sub-nodes stand on the floor under the agent (lower y, same z within one unit), the chain left → right at eye level, budget / meter floating above it, slot cables in the data hue; **Run sample** produces five settled agent-step rows plus one bypassed row, the answer, the memory exchange and the log entry, and re-applies the flow layout as one `Flow layout` undo entry (three scrambled blocks return to the [x, y, z] positions the pure function gives the live graph); in the 2D plan, Flow layout applies the flat variant and leaves every height untouched; a face **Run** field and a face **Run** click (`onFacePointer`) settle rows; a tier chip sets the param undoably; decline at 0.5 cr (the agent fails at step 1 and skips the rest); auto top-up; storage isolation from the raw storage's point of view; the core page afterwards has zero errors, no `gw-` types and byte-identical core storage.

## Swapping the simulated providers for a real gateway

`src/providers.js` is the only file that would change on the client. Each adapter implements `{ id, kind, models, estimate(params, prompt, route), call(params, prompt, route, opts) }`; the marked `REAL GATEWAY SEAM` shows the `fetch` to **your own gateway service**, authenticated with a workspace-scoped gateway token (never a provider key), carrying the idempotency key as a header.

## Production design

How this runs for real against the node system, with the same add-on code and the core untouched:

**Gateway service (yours).** One HTTPS service in front of every provider:
* *Provider adapters + vault* — the organisation's keys live in a KMS-backed vault; adapters hold per-provider quotas, allow-lists and timeouts; the page only ever holds a workspace-scoped gateway token.
* *Versioned rate cards* — synced from provider price pages on a schedule, stored as immutable versions; every ledger row cites the version it was priced with, so an old row stays explainable after a price change.
* *Append-only double-entry ledger* — the source of truth. Each request is `hold` (debit reserved / credit available) then `settle` or `refund`, unique on the idempotency key (`runId:nodeId:attempt`), so retries from a flaky page or a duplicate pulse can never bill twice. Balance is a projection, never a stored number.
* *Balance, top-up, billing* — Stripe-style top-ups (manual and rules: threshold / target / monthly cap), invoices from settled rows, usage export.
* *Per-workspace policy* — allowed providers and tiers, default routing (cheapest-capable on/off, fallback on/off), per-workflow budgets, whether own-key bypass is permitted.

**The browser is a cache.** `src/ledger.js` becomes a read-through cache of the server's rows for this workspace (paged, with the server's balance projection); holds and settles are server calls carrying the idempotency key; the admin block renders the same rows. Offline or unauthenticated, nodes are ineligible and say so.

**Per-node eligibility before a run.** `eligibility()` keeps its shape but asks the server: is this node's credential mode allowed, is the provider adapter live, is the model on the current rate card, does the workflow still have budget. The answer is shown in the node's panel section and cached per node until params change, so a run never fails with a `nodeNotCovered`-style surprise.

**Routing policy, yours.** Budget per workflow (a `gw-budget` node, enforced server-side at hold time), cheapest-capable model across providers for a requested tier, and one fallback attempt on a retryable provider error to another provider at the same tier or better — the policy is code and configuration you own and can test, not a vendor's fixed model-per-node rule.

**Own-key bypass, visible.** A node with its own key goes to the provider directly (or, safer, through the gateway with a per-user vaulted key). Either way the gateway writes a `bypass` row with 0 credits, so spend outside the balance stays in the same ledger and the same charts.

**Any node type, through the proposed engine hooks.** Today only add-on-owned nodes meter themselves inside `evaluate`. With the proposed `engine.hooks.beforeNode / afterNode` (see `addons/README.md`), the add-on would hold on any core node that declares a `cost` (future HTTP / Script / Generate components) and settle from its outputs, unchanged.

**Why this beats depending on n8n's gateway.** You own the keys and the balance (no vendor account, no vendor price page), the routing policy and budgets are yours and per workflow rather than instance-wide, eligibility is decided and displayed before a run, there is no lock-in (the gateway is a small service with a stable contract; the add-on is a directory in this repo), and it works with any node type once the engine hooks land — all while the core stays a plain static site.

## Open questions for the real integration

* **Credential resolution.** Where does the gateway token come from on a static-hosted page: a login flow to the gateway service, or a pasted token stored per browser? Provider keys for 'Own key' mode should not live in `node.params` (they serialize into Save JSON); a per-browser vault keyed by node uid is the safer shape.
* **Streamed / long calls.** Streamed model output settles when the stream closes; holds must survive a reload (they do here because the ledger is in storage, and orphaned holds are refunded on load).
* **Tenancy.** One balance per browser today; a multi-tenant gateway needs `tenantId` on every row and per-tenant provider allow-lists from day one.
* **Concurrency.** Two tabs of the add-on page share the same isolated ledger without coordination; the server ledger removes that problem.

## Run locally

Serve the **repo root** with any static server (paths are relative and the import map points at unpkg) and open the add-on folder:

```
cd Proto3D
python3 -m http.server 8000      # or: npx serve .
# → http://localhost:8000/addons/gateway-credits/   (core app: http://localhost:8000/)
```
