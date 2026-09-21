# Gateway Credits — a Proto3D add-on

**Add-on page:** `addons/gateway-credits/` (on Pages: `…/Proto3D/addons/gateway-credits/`)
**Core app (unchanged):** the repository root

A shared, prepaid **credit balance** that provider-calling nodes can spend instead of each holding its own API key, delivered as an add-on *beside* Proto3D rather than inside it. It brings four new components (Model call, Tool call, Budget, Credits meter), a metering ledger (estimate → hold → settle / refund, idempotent), a routing policy (capability tiers, cheapest-capable, fallback on provider error, per-workflow budgets) and an admin panel — without editing a single core file. It is built on the add-on SDK in `addons/sdk/` (see `addons/README.md`) and is tested at three levels: pure units, the real core engine in Node, and the real page in Chromium.

Providers are **simulated**: no network call is made, no key is read or sent, prices are illustrative. The point of the demo is the metering and routing mechanics running on the real Proto3D engine and 3D scene.

## Try it

1. Open the add-on page. On a fresh browser the sample graph loads into a tab named after it: **New ticket** (Input) → **Summarize** (Model call, Anthropic, tier `standard`, Gateway credits) → **Web search** (Tool call, Brave Search) → **Draft reply** (Model call, OpenAI GPT‑5 mini, *Own key*) → **Reply log**; plus a **Triage budget** (50 cr / month for the workflow "Support inbox triage") and a **Credits meter**. The badge at the bottom left says "Add-on: Gateway Credits · SDK 1"; the page keeps its own tabs and autosave, separate from the core page's.
2. Menu bar → **Credits → Run sample** (or click the Input's *Run* button in 3D). Watch: a toast per hold and settle, the ledger rows in the right-hand **Gateway Credits** block, the balance dropping, the Budget and Meter faces updating, and one **bypassed (own key)** row for Draft reply with 0 credits. The menu's heading shows the live balance; the same items are in the command palette (Ctrl+K).
3. **Credits → Set balance to 0.5 cr**, then Run sample again: Summarize **declines** up front (red rim, `failed` pulse, decline row with the reason); nothing downstream fires and no provider is touched.
4. In the admin block, enable **Auto top-up**: an *auto top-up fired* row appears and the run succeeds. Toggle **prefer cheapest capable** and select Summarize: its Gateway section now explains the re-route (`cheapest capable for tier standard; beat Claude Sonnet 4.5`).
5. Select any gateway node: the properties panel shows the normal undoable param controls (credential, provider, model, tier…) plus a **Gateway credits** section — eligibility (yes / no / bypass + why), est. cost / run, held, last cost, runs, and a *Run now* button.

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
npm test                                          # from the repo root: SDK + every add-on
node addons/sdk/testing/run-addons.js gateway-credits   # this add-on's unit + engine tests
node --test "addons/gateway-credits/test/browser/*.test.js"   # Chromium (npm install first)
```

* `test/unit/ledger.test.js` — opening balance, hold → settle, hold → refund, `releaseHolds`, idempotency, declines (balance, budget), auto top-up and its monthly cap, persistence round-trip, periods and grouping.
* `test/unit/rates.test.js`, `routing.test.js`, `providers.test.js` — the rate card's consistency, estimates, `resolveModel` in every mode, `fallbackFor`, deterministic adapters, simulated failures.
* `test/engine/nodes.test.js` — on the real `Engine`: hold → settle with a downstream tool call, decline at 0.5 cr with a `failed` pulse and an error rim, auto top-up, refund via `engine.onError`, refund on node removal, own-key bypass, budgets, fallback on a 503, faces, "Run sample".
* `test/browser/gateway.test.js` — the page boots with zero page errors and the sample graph; Credits → Run sample yields ledger rows and a lower balance; decline at 0.5 cr; auto top-up; the raw storage shows every write under `addon.gateway-credits:`; the core page boots afterwards with zero errors, no `gw-` types and byte-identical core storage.

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
