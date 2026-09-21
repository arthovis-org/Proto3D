# Proto3D add-ons

Proto3D is a build-less app: `index.html` loads `src/main.js` as plain ES modules and GitHub Pages serves the repository root. Add-ons live beside it in this directory as isolated packages that run on the **unchanged** core, can be tested without a browser, and cannot break the core 3D node system. The repository is treated as a monorepo: one root `package.json` (tooling only, nothing the served pages need), one npm workspace per add-on, one versioned SDK they all program against.

```
addons/
  README.md            this file
  index.html           the Pages listing of add-ons (reads registry.json)
  registry.json        add-ons shown on the listing (the template is deliberately not listed)
  sdk/                 @proto3d/addon-sdk — the only code that knows core internals
    host.js            createHost(proto, manifest, core): the versioned host API (SDK_VERSION = 1)
    shell.js           page bootstrap: manifest → storage isolation → core skeleton → register → boot core → install
    storage.js         page-level storage isolation (localStorage / sessionStorage / IndexedDB prefixed per add-on)
    manifest.js        addon.json schema + validation
    testing/           fake-host.js · headless-engine.js · browser.js · drift-guard.js · run-addons.js
    test/              contract.test.js · host.test.js · storage.test.js · drift-guard.test.js · addons-registry.test.js · browser/core-smoke.test.js
  _template/           the smallest complete add-on; copy it to start a new one (tested, not listed)
  gateway-credits/     a real add-on: an agent with slot sub-nodes, per-step metering, ledger, routing policy, app-like faces, flow layout (see its README)
```

## The contract

An add-on is a directory with an `addon.json`:

```json
{ "id": "gateway-credits", "name": "Gateway Credits", "version": "0.2.0", "prefix": "gw", "sdk": 1,
  "entry": "./src/index.js", "description": "…", "styles": ["./src/gateway.css"] }
```

* `id` — `^[a-z][a-z0-9-]*$`; names the storage namespace (`proto3d.addon.<id>.`), the page prefix (`addon.<id>:`), the CI matrix entry and the badge.
* `prefix` — every node type the add-on registers must have an id of the form `<prefix>-name`; the host refuses anything else, and core ids never carry a dash-prefix that collides.
* `sdk` — the host API major the add-on was written for. `createHost` refuses another major.
* `entry` — a module exporting `register(host)` (optional; runs **before** the core boots) and `install(host)` (optional; runs **after** `window.__proto` exists).

The page is a near-empty `index.html` that loads `../sdk/shell.js`. The shell reads the manifest, installs storage isolation, fetches the core `../../index.html`, copies its import map (injected dynamically; verified in Chromium 141), its stylesheets and its `<body>` skeleton into the add-on page, imports the entry and calls `register(host)` so node types exist before the core restores an autosaved graph, imports `../../src/main.js`, waits for `window.__proto`, calls `install(host)`, sets the title and adds the bottom-left badge "Add-on: `<name>` · SDK 1". The document gets a `<base>` pointing at the core root, so page-relative core URLs (the Start panel's `assets/templates/*.png`) resolve correctly; add-on code resolves its own files from `import.meta.url`. Add-on pages therefore never carry a copy of the core DOM and are immune to core skeleton changes (the failure that broke the previous gateway page).

### The host API (SDK 1)

| Member | What it wraps |
| --- | --- |
| `host.version`, `host.manifest`, `host.booted` | SDK major, the validated manifest, whether `window.__proto` exists yet |
| `host.nodes.register(def)` · `get` · `has` · `ids()` · `owns(id)` · `onRegister(cb)` · `unregisterAll()` | `registry.register` with the prefix rule; `unregisterAll` throws a named error because the core registry has no remove (see seams) |
| `host.engine.onError(cb) → off` · `emit` · `trigger` · `order()` · `evaluate()` · `time` | chains onto `engine.onError` without clobbering another handler |
| `host.world.onChange(cb) → off` · `nodes()` · `connections()` · `get()` | `world.onChange`; `get()` is the raw World, logged once as an escape hatch |
| `host.ui.menu({ id, label, items })` · `panelSection(title, build)` · `toast` · `togglePanel` · `frameBlocks` · `hideStart` · `stylesheet` | a real top-level menu in the core menu bar; a `<details class="sec">` in `#panel` outside `#panel-body`, so `panel.build()` never clears it |
| `host.selection.clear()` · `set()` · `nodes()` | the core selection |
| `host.draw.{clear, drawText, roundRect, font}` + `beginFields, drawCaps, drawDivider, drawTile, drawChip, drawBar, drawStat, drawAvatar, fitLine, wrapLines, tabular, jsonLines, PAD, GRID, RADIUS` · `host.theme.palette` · `host.theme.current()` · `onChange` · `host.icons.set/get/has` | `faces.js` — the whole face design language, so add-on faces read like core faces and register editable regions the core's inline field editor hit-tests, marks and edits (`beginFields`); the live palette; the mutable icon table (core icons cannot be overwritten). A helper this core lacks throws a named `HostError` when called |
| `host.commands.setParam(block, key, value, label?)` · `setTitle` · `execute(cmd)` | `cmd.setParam` / `cmd.setTitle` through `history.execute`: undoable writes from a face click, the same commands the panel and the field editor use |
| `host.fields.open(block, field \| id)` · `editing()` · `leave()` | `fieldEditor.open`: open the core inline editor on a face field from add-on code (a single click on a select outside edit mode); who is in edit mode |
| `host.layout.graph()` · `apply(positions, { label, frame })` | the graph as plain data (`{ uid, type, size, w, d, h, x, y, z }` / `{ from, to, fromKey, toKey }`) for pure layout code, and one undoable `cmd.transform` that moves blocks to `uid → [x, z]` (height kept) or `uid → [x, y, z]` (height set — the gateway flow layout puts governance, flow and resources on three levels) and frames them |
| `host.ui.wiring(on?)` | the core Wiring switch (ports and cables shown), read or set |
| `host.ui.plan(on?)` | the core 2D plan view (`window.__proto.plan`), read or set — a layout picks its flat variant while the plan is on |
| `host.examples.build(example)` | `buildExample` through `tabs.replaceActive`, so the graph lands in a tab, autosaves and is framed |
| `host.storage.get/set/remove/keys()` | JSON values under `proto3d.addon.<id>.` in `localStorage` |
| `host.persist.serialize()` · `load(doc)` | `proto.serialize` / `proto.load` |

Only add-on-owned nodes can be metered or hooked: core definitions are frozen, and the engine offers just `onError` (see "Proposed core seams").

### Menus and the import map: what worked

* **Menu.** `ui/menubar.js` is declarative: `new MenuBar({ menus })` keeps `this.menus` and re-renders it in `_build()`; the collapsed ☰ menu and the command palette both read the same array. `host.ui.menu` pushes an entry (id `<addon>:<menu>`) and calls `_build()`, so the menu survives re-renders and shows up in Ctrl+K. No DOM insertion fallback was needed; `_build` is checked by the contract test.
* **Import map.** Chromium 141 accepts an import map inserted by a module script as long as none of the mapped specifiers has been resolved yet. The shell injects the core's map before it imports `host.js` / `main.js`; the browser tests assert `window.__addon.importMap === 'injected'`. If a browser ever refuses, an add-on page may declare the same import map statically (the shell detects and keeps it) and the contract test pins the core entry the tests route.

## Isolation rules

1. **Imports.** Add-on code may import only from `addons/sdk/**` and its own directory. Never `../../src/...`, never the core page or stylesheet. `sdk/testing/drift-guard.js` scans every add-on (JS imports, dynamic imports, re-exports, `<script src>`, `<link href>`, CSS `@import`) and fails on any specifier resolving into `src/`, `index.html` or `styles.css`. It runs in the SDK tests and as a CLI (`node addons/sdk/testing/drift-guard.js`). Add-ons that predate the SDK and still import the core directly are listed in `LEGACY_ADDONS` in that file (currently `jev`) and skipped until they are ported onto the SDK; a new add-on never goes on that list.
2. **Node ids** start with `<prefix>-`. A graph with add-on nodes opened in the core page drops them (`loadWorld` reports `skipped`) instead of crashing.
3. **Storage.** `host.storage` namespaces keys; the shell additionally redirects the whole page's `localStorage` / `sessionStorage` (`addon.<id>:` prefix) and IndexedDB (`addon.<id>.` prefix), passing `proto3d.theme` through so the theme stays shared. The add-on page owns its tabs, autosave, projects and vault; the core page's data is never written. Verified by the browser test from the raw storage's point of view.
4. **Core untouched.** Nothing under `src/**`, `index.html`, `styles.css`, `docs/**` changes for an add-on. When a seam is missing, the fix is a proposal below, never a private core edit.
5. **Failures are named.** A moved core seam fails `sdk/test/contract.test.js` with the seam's name and the SDK version; at runtime the host throws `HostError('core seam missing: window.__proto.overlays.toast …')` instead of a stray `TypeError`.

## Creating an add-on

```
cp -r addons/_template addons/my-addon
```

1. Edit `addons/my-addon/addon.json`: `id`, `name`, `prefix`, `description`.
2. Rename the node ids in `addon.js` to your prefix; put more code in `src/` if you like (`entry` points at it).
3. Keep `index.html` as it is (it only loads the shell). Add stylesheets through `styles`.
4. Write tests under `test/` (Node: fake host + headless engine) and `test/browser/` (Playwright).
5. Add the add-on to `addons/registry.json` so the Pages listing shows it; `sdk/test/addons-registry.test.js` checks the two agree.
6. Serve the repo root (`python3 -m http.server 8000`) and open `http://localhost:8000/addons/my-addon/`.

## Tests

```
npm install           # tooling only: playwright + three (the served pages need none of it)
npm test              # SDK tests, then every add-on's unit + engine tests (plain node --test)
npm run test:sdk      # contract, host, storage, drift guard, registry
npm run test:addons   # node addons/sdk/testing/run-addons.js  (add an id to run one add-on)
npm run test:browser  # Playwright: core smoke + every add-on page, hermetic (three from node_modules, fonts blocked)
```

Layers:

* **Unit** — pure modules (ledger, rates, routing, providers) with in-memory storage.
* **Engine** — add-on node definitions on the **real** `src/core/engine.js` in Node. `sdk/testing/headless-engine.js` supplies the minimal world / node / connection stand-ins the engine reads (`core/world.js` and `block3d.js` need Three); `fake-host.js` supplies the host with recording menus, sections, toasts and an in-memory namespaced storage. Async provider calls are pinned through the add-on's `sim` knobs.
* **Browser** — `sdk/testing/browser.js` serves the repo root with `node:http`, launches Chromium (uses `PLAYWRIGHT_BROWSERS_PATH`, defaulting to `/opt/pw-browsers` when present), routes `https://unpkg.com/three@0.160.0/**` to `node_modules/three`, blanks Google Fonts, and collects `pageerror` + console errors. Tests assert zero errors.
* **Contract** — `sdk/test/contract.test.js` names every core seam the SDK uses.

## CI (`.github/workflows/addons.yml`)

Node 22, on push to `main` and on pull requests: `sdk` (SDK tests + drift guard), `addons` (a matrix over every directory with an `addon.json`, discovered by `run-addons.js --list`), `browser` (Playwright over every add-on's `test/browser`), `core-smoke` (the core page boots with zero errors and no add-on types).

## Proposed core seams (not implemented; the SDK works around each)

The core is untouched. These additive changes would let the SDK drop its workarounds; each is a few lines.

**(a) Engine hooks around a node's evaluation** — lets an add-on meter *core* node types (frozen defs cannot be wrapped). Today only add-on-owned nodes are metered.

```diff
 // src/core/engine.js
   constructor(world) {
     …
     this.onError = null;        // optional (instance, error) hook
+    this.hooks = { beforeNode: [], afterNode: [] };   // add-ons: (node, ctx) → void; afterNode gets (node, ctx, outputs, error)
   }
   …
       if (node.enabled !== false) {
         try {
+          for (const h of this.hooks.beforeNode) h(node, ctx);
           if (def.onEvent) for (const [port, pulse] of pulsed) def.onEvent(ctx, port.key, pulse);
           outputs = def.evaluate(ctx) || {};
         } catch (e) { … this.onError?.(node, e); }
+        for (const h of this.hooks.afterNode) h(node, ctx, outputs, node.rt.error);
       }
```

**(b) A boot config read by main.js** — lets the core page itself load add-ons and gives storage a namespace without the accessor shim.

```diff
 // src/main.js (top)
+const config = window.__protoConfig || {};          // { storageNamespace?: 'addon.x:', addons?: ['../addons/x/src/index.js'] }
+if (config.storageNamespace) installNamespace(config.storageNamespace);   // one tiny wrapper around localStorage/indexedDB
+for (const url of config.addons || []) await import(url).then((m) => m.register?.(hostFor(m)));
 …
 window.__proto = { … };
+for (const url of config.addons || []) (await import(url)).install?.(hostFor(url));
```

**(c) `registry.unregister(id)`** — hot-reload in tests; `host.nodes.unregisterAll()` would stop throwing.

```diff
 // src/core/registry.js
   register(def) { … },
+  unregister(id) { const d = defs.get(id); if (!d) return false; defs.delete(id); listeners.forEach((cb) => cb(null, id)); return true; },
```

**(d) `menubar.addMenu(menu)`** — not needed today (`menus` + `_build()` do the job), but a public method would stop the SDK relying on an underscored one.

```diff
 // src/ui/menubar.js
+  addMenu(menu) { this.menus = this.menus.filter((m) => m.id !== menu.id).concat(menu); this._build(); return () => { this.menus = this.menus.filter((m) => m !== menu); this._build(); }; }
```

The contract test flags each of these the moment it appears in the core, so the SDK can switch over.

**(e) Slot cables and slot ports** — an agent's sub-nodes (Chat model, Memory, Tools) stand on the floor *beneath* their parent (gateway-credits `flowLayout`), but the parent's slot inputs sit on its left edge like any input, so their cables loop over the block. n8n draws these as short dashed drop-lines from the parent's bottom edge. Proposed: a port flag `slot: true` (`inputs: [{ key: 'model', type: 'data', slot: true }]`) that (1) places the port on the block's bottom edge and (2) styles its cable dashed and thinner. The add-on works around it by drawing the three slot chips on the agent's face (lit when connected) and by relying on the type hue (slot cables are `data`, so they already read differently from the event chain).

```diff
 // src/core/component.js normPort
-  return Object.freeze({ key: p.key, label: …, multi: …, optional: !!p.optional });
+  return Object.freeze({ key: p.key, label: …, multi: …, optional: !!p.optional, slot: !!p.slot && dir === 'in' });
 // src/node3d.js: slot inputs on the bottom edge; src/connection3d.js: u.dashed.value = to.slot ? 1 : 0 (thin, no travel crest)
```

**(f) Per-instance dynamic `icon`** — `def.icon` is one SVG per type, so a Model call on Anthropic and one on OpenAI look the same in the Add rail, the panel header and the mini toolbar. Proposed: `def.iconFor?(instance) → svg` consulted wherever `def.icon` is read (panel, tabs, command palette). The add-on works around it by putting a large service badge (glyph + accent ring) on every face, which is what reads on the canvas anyway; the glyphs are already registered as icons (`gw-svc-<id>`).

**(g) Single-click face actions outside edit mode** — the core opens a face field only in edit mode (double-click, Enter, the pencil) except for `mode: 'open'` fields, which *enter* edit mode. An app-like face wants a Run button or a segmented control to react to one click without an edit-mode round trip. The add-on does this through `def.face.onPointer` (capture the press on a field, run / toggle / `fieldEditor.open` on click), which works but re-implements the hit test the core already has (`Block3D.fieldAt`). Proposed: a field `mode: 'click'` in `ui/field-editor.js` / `interaction.js` — a single press on such a region runs an `action`, toggles a `checkbox` or opens the editor, no edit mode needed.

**(h) `layoutCommand` / tweened moves exposed** — `window.__proto.layout` exposes `arrange` and `plan` but not `layoutCommand(world, nodes, positions)`, so `host.layout.apply` moves blocks instantly through `cmd.transform` instead of gliding them like Auto-layout does. Proposed: add `layoutCommand` (or `tweenTo`) to `window.__proto.layout`.

## How this beats depending on n8n

n8n's Gateway credits are a hosted feature: the balance, the provider keys, the price page and the `nodeNotCovered` eligibility rule all live in n8n Cloud and reach a workflow only through n8n's own nodes. Here the same capability is an add-on on a node system you already run: the ledger, the rate card and the routing policy are code in this repository, the provider keys stay in your vault, eligibility is decided per node before a run and shown in the panel, budgets are graph nodes that travel with a project, and the add-on can be tested end-to-end (unit, real engine, real browser) without any vendor account. The core stays a plain static site; the add-on is one directory that CI proves compatible on every push.
