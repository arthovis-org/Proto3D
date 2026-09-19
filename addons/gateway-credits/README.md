# Gateway Credits — a Proto3D add-on

**Live demo:** https://arthovis-org.github.io/empty1/addons/gateway-credits/
**Core app (unchanged):** https://arthovis-org.github.io/empty1/

A shared, prepaid **credit balance** that provider-calling nodes can spend instead of each holding its own API key, delivered as an add-on *beside* Proto3D rather than inside it. It brings four new components (Model call, Tool call, Budget, Credits meter), a metering ledger (estimate → hold → settle / refund, idempotent), a routing policy (capability tiers, cheapest-capable, fallback on provider error, per-workflow budgets) and an admin panel — and it does all of this without editing a single core file.

Providers are **simulated**: no network call is made, no key is read or sent, prices are illustrative. The point of the demo is the metering and routing mechanics running on the real Proto3D engine and 3D scene.

## Try it

1. Open the live link. The sample graph loads: **New ticket** (Input) → **Summarize** (Model call, Anthropic, tier `standard`, Gateway credits) → **Web search** (Tool call, Brave Search) → **Draft reply** (Model call, OpenAI GPT‑5 mini, *Own key*) → **Reply log**; plus a **Triage budget** (50 cr / month for the workflow "Support inbox triage") and a **Credits meter**.
2. Top bar → **Credits ▾ → Run sample** (or click the Input's *Run* button in 3D). Watch: a toast per hold and settle, the ledger rows in the right-hand **Gateway Credits** block, the balance dropping, the Budget and Meter faces updating, and one **bypassed (own key)** row for Draft reply with 0 credits.
3. **Credits ▾ → Set balance to 0.5 cr**, then Run sample again: Summarize **declines** up front (red rim, `failed` pulse, decline row with the reason); nothing downstream fires and no provider is touched.
4. In the admin block, enable **Auto top-up**: an *auto top-up fired* row appears and the run succeeds. Toggle **prefer cheapest capable** and select Summarize: its Gateway section now explains the re-route (`cheapest capable for tier standard; beat Claude Sonnet 4.5`).
5. Select any gateway node: the properties panel shows the normal undoable param controls (credential, provider, model, tier…) plus a **Gateway credits** section — eligibility (yes / no / bypass + why), est. cost / run, held, last cost, runs, and a *Run now* button.

## How it stays isolated

Only new files were added, all under `addons/gateway-credits/`. The core `index.html`, `src/**`, `styles.css`, `README.md` and `docs/**` are untouched, and the core page behaves exactly as before. The add-on page reuses the core app by *importing* it and attaching to seams that already exist:

| Seam | Where in core | Used for |
| --- | --- | --- |
| `registry.register(def)` | `src/core/registry.js:26-32` (frozen defs, `component.js:38`; ids `^[a-z][a-z0-9-]*$`, `component.js:25`) | four new component types with ids prefixed `gw-` (can never collide with core ids; duplicates throw, `registry.js:28`) |
| auto-labelled categories + `registry.onRegister` | `registry.js:40-41`, `ui/toolbar-left.js:24,43` | the **Gateway** rail button appears by itself; its icon comes from the mutable `icons` object (`src/icons.js:4`) |
| `window.__proto` | `src/main.js:252-257` | the only global; gives the plugin `world, engine, ws, panel, history, selection, overlays, autosave, togglePanel…` |
| `engine.onError` | `src/core/engine.js:20` (declared), `:153` (called); never set by `main.js` | release a node's open holds when its `evaluate` throws |
| `def.evaluate` runs every frame; `state` is the per-instance persistent object | `engine.js:64-69, 133-166`; `block3d.js:257-258` | async provider calls are parked in a per-instance queue and drained on a later frame, exactly like the Action component's `delay` mode (`src/components/action/action.js:31-35`) |
| `def.panel(api, block)` | `src/panel.js:226` (call), `:249-273` (api: `section, readonly, action, live…`) | the **Gateway credits** section on each gw- node; the generic param renderer (`panel.js:211-223`) gives the `credential` select for free |
| `def.footer`, `def.face { render, live, fps }` | `block3d.js:381-393`, `component.js:13` | node footers with model · status · cost; live faces on Budget and Meter |
| `def.onDestroy(instance)` | `block3d.js:504` (called from `dispose()`), plus `world.onChange('remove-node')` (`world.js:45`) | refund holds of removed nodes (`removeNode` does not dispose, so the world listener covers undoable deletes) |
| `#toolbar` + `.menu-anchor > .menu` | `index.html:32-53`, `styles.css:63-71` | the **Credits ▾** dropdown, styled like the File menu |
| `<aside id="panel">` after `#panel-body` | `index.html:55-56`; `panel.build()` clears only `#panel-body` (`panel.js:129`) | the admin `<details class="sec">` block survives every panel rebuild |
| `world.overlays.toast(text, ms)` | `src/main.js:44`, `src/ui/overlays.js:77` | hold / settle / decline / refund / top-up toasts |
| `AutoSave` class with a `key` option; `loadWorld` skips unknown types | `src/serialize.js:87-104`; `:36-38` | the add-on autosaves to **its own** key `proto3d.gateway.world.v1` and disables the core autosave on its page, so the core page's saved world is never overwritten; a graph with gw- nodes opened in the core page simply drops them (reported in `skipped`) |
| `buildExample(world, example, …)` | `src/examples/index.js:12-32` | the bundled sample graph uses the same `{ add, connect, group }` builder shape as `src/examples/project.js` |
| import map is per document; all core paths are relative | `index.html:13-20`, survey §7 | `addons/gateway-credits/index.html` repeats the same import map (same unpkg URLs) and links `../../styles.css` |

Storage keys owned by the add-on: `proto3d.gateway.ledger.v1` (append-only ledger), `proto3d.gateway.settings.v1` (auto top-up + policy), `proto3d.gateway.world.v1` (this page's autosaved world). The core's `proto3d.world.v2`, `proto3d.theme` and `proto3d.tour.v1` are only read (theme, tour), never written.

Boot order is the whole trick (`boot.js`): `import './nodes.js'` registers the components **before** `import '../../src/main.js'` boots the app, so an autosaved graph containing gw- nodes is restored instead of skipped; then `install(window.__proto)` attaches the UI and hooks. Both files resolve `../../src/core/registry.js` to the same URL, so the add-on and the core share one module instance of `registry`, `icons` and the theme.

## Files

```
addons/gateway-credits/
  index.html    core DOM skeleton + same import map + ../../styles.css + ./gateway.css + badge; loads ./boot.js
  boot.js       nodes → main.js → install(window.__proto)
  nodes.js      gw-llm, gw-tool, gw-budget, gw-meter (registry.register in category 'gateway'); the metering flow
  ledger.js     append-only ledger, derived balance / holds / spend / budgets, auto top-up, tiny event emitter
  rates.js      illustrative rate card (credits per 1M tokens, per tool unit), tiers, resolveModel / fallbackFor
  providers.js  adapter interface + simulated implementations; the marked seam for a real gateway service
  plugin.js     install(proto): Credits menu, admin block, engine.onError, toasts, namespaced autosave, Run sample
  example.js    the bundled sample graph (buildExample shape)
  gateway.css   admin / menu / badge styles on the core CSS variables (light + dark)
  README.md     this file
```

## Metering flow (inside `gw-llm` / `gw-tool`, `nodes.js`)

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
* **Holds are released** on `engine.onError` (node threw), on `def.onDestroy`, and for any node that is no longer in the world after `remove-node` / `clear` / `load`. A late-resolving call for a refunded hold cannot re-charge (the hold is closed).
* **Balance is derived**, never stored: `available = Σ(open + top-ups + adjustments) − Σ(settled) − Σ(open holds)`. Every entry is appended; the admin table collapses `hold → settle | refund` into one row whose status moves `held → settled | refunded`.

## Routing policy (`rates.js`, `ledger.settings.policy`)

* A node either **pins a model** (`tier: fixed` + `model`) and is never swapped, or declares a **capability tier** (`economy | standard | premium`).
* **Prefer cheapest capable** (off by default): among all models at the tier or above, the lowest estimate on the rate card wins across providers; the row's note records what it beat. Off: the node's own provider at that tier.
* **Fallback on provider error** (on by default): a simulated 503 refunds the hold and retries once on the cheapest capable model of another provider; the fallback row says where it came from. Off: the node fails visibly instead.
* **Budgets** are `gw-budget` nodes in the graph (so they travel with Save JSON): `workflow`, `limit`, `period` (monthly / daily). A gateway node's workflow is its `workflow` param, else its group title, else `default`. The ledger enforces `spent + held + est ≤ limit` at hold time; a decline is a normal, explained row.
* **Eligibility is decided up front** and shown in the node's panel section (yes / no / bypass + reason) — the way to avoid an n8n-style `nodeNotCovered` surprise at run time.

## Swapping the simulated providers for a real gateway

`providers.js` is the only file that would change on the client. Each adapter implements `{ id, kind, models, estimate(params, prompt, route), call(params, prompt, route, opts) }`; the marked `REAL GATEWAY SEAM` shows the `fetch` to **your own gateway service**, authenticated with a workspace-scoped gateway token (never a provider key), carrying the idempotency key as a header. That service would own:

* **Provider adapters** with the organisation's keys in a vault, per-provider quotas and allow-lists.
* **Rate card sync** from provider price pages, versioned; each ledger row cites the version it was priced with.
* **The append-only ledger** (double-entry hold / settle, unique on the idempotency key) as the source of truth; the browser ledger in `ledger.js` becomes a cache of the server's rows.
* **Balance, top-up and billing** (Stripe-style), auto top-up rules, per-tenant policy and usage export.

'Own key' mode would then be the one path that talks to a provider directly (or, safer, still through the gateway with a per-user vaulted key), logged as *bypassed* so spend outside the balance stays visible.

## The one optional core change (not needed)

A generic `engine.hooks = { beforeNode: [], afterNode: [] }` invoked around `engine.js:146-155` would let an add-on meter **core** node types too (their definitions are frozen, `component.js:38`, so `evaluate` cannot be wrapped from outside). Gateway Credits does not need it because every provider-calling node is add-on-owned and meters itself inside its own `evaluate`; `engine.onError` (already present) covers the error path. Should such hooks be added later, this add-on would use them unchanged for its own nodes and gain coverage of any future core HTTP / Script components.

## Why this instead of depending on n8n's Gateway credits

| | n8n Gateway credits | This add-on |
| --- | --- | --- |
| Where credits live | n8n Cloud account | Your gateway, your DB |
| Who holds provider keys | n8n | Your vault |
| Pricing transparency | n8n's public price page | Versioned rate card, cited in every ledger row |
| Eligibility errors | `nodeNotCovered` at run time | Decided per node, shown before the run |
| Routing policy | Fixed model per node | Tiers, cheapest-capable, fallback |
| Budgets | Instance-wide balance only | Per workflow (and per node) |
| Self-hosting | Cloud plans only | Yes; same add-on either way |
| Data path | Node → n8n gateway → provider | Node → your gateway → provider |
| Integration with the editor | Built into n8n | Plugs into Proto3D through existing seams; core untouched |

## Open questions for the real integration

* **Hook surface.** Metering inside add-on-owned nodes is enough today. Should core nodes ever call providers, the `beforeNode` / `afterNode` hooks above become the one core change.
* **Credential resolution.** Where should the gateway token come from on a static-hosted page: a login flow to the gateway service, or a pasted token stored per browser? Provider keys for 'Own key' mode should not live in `node.params` (they would serialize into Save JSON); a per-browser vault keyed by node uid is the safer shape.
* **Streamed / long calls.** Streamed model output settles when the stream closes; holds must survive a reload (they do here because the ledger is in storage, and orphaned holds are refunded on load).
* **Tenancy.** One balance per browser today; a multi-tenant gateway needs `tenantId` on every row and per-tenant provider allow-lists from day one.
* **Concurrency.** Two tabs share the same localStorage ledger without coordination; the server ledger removes that problem.

## Run locally

Serve the **repo root** with any static server (paths are relative and the import map points at unpkg) and open the add-on folder:

```
cd empty1
python3 -m http.server 8000      # or: npx serve .
# → http://localhost:8000/addons/gateway-credits/   (core app: http://localhost:8000/)
```

`file://` also works in browsers that allow module scripts from disk, as with the core page.
