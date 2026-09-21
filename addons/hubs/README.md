# Client Hubs (`hubs`, prefix `hub-`)

A demo of how Imagine OS builds a complete client deliverable hub on the Proto3D canvas: the public website, the customer app, the staff surfaces by role, the ops manual, docs, plan, design system and dev tools, mockups and the machine surface, **embedded live as nodes**, with the canvas re-arrangeable into different flows. Four real clients on imagine-os.github.io are included: CTL OS (`cal-tenant-law`), Petrock (`petrock`), HoyOS (`hoy`, Spanish) and Llave OS (`dorum-lifestyle`, a static multi-page site).

Page: `addons/hubs/index.html` (SDK shell). Live: https://arthovis-org.github.io/Proto3D/addons/hubs/

## What is on the canvas

| Node | Size | What it is |
| --- | --- | --- |
| `hub-blueprint` | XL | The "fill in a client" form: name, slug, brand, language, base URL, industry, roles, the eleven-section checklist with page counts and a **Generate pages** button (Regenerate when pages exist). Outputs `pages` (descriptors), `tasks` (`data · tasks`, one card per enabled section in the core PM shape), `count`, `generated` (event). Input `generate` (event). |
| `hub-page` | XL | One deliverable page: `url`, `title`, `section`, `audience`, `role`, `device` (desktop / tablet / phone / none), `status` (planned / building / live), `live`, `client`, `order`. The canvas face is an app-like card (brand accent bar, section badge, title, route, chips, status dot, browser chrome or phone bezel) and is the fallback whenever the live frame is not shown. Clicking the face emits `opened` and opens the page for interaction; the `open` event input does the same. |
| `hub-section` | M | A header card (section name, audience, description) the flows use as a lane / column label. |

**Hubs menu**: Demos (one per client, all four in the Compare flow, a blank New client), Arrange (five flows), Live pages (on/off, budget), Open selected page, Generate pages for the selected blueprint. **Panel section "Client Hubs"**: live toggle, budget slider, counts, flow buttons. **Flow bar** (bottom-centre HUD): the five flows, a client filter when several clients are on the canvas, the live counter.

## The deliverable process as nodes

`blueprint → pages → tasks → plan`. A blueprint holds the client; **Generate** turns it into `hub-page` nodes (real routes for the four known slugs from `src/clients.js`, template defaults with status `planned` for any other slug) placed in the Delivery flow beside the blueprint, as one undoable command (Ctrl+Z removes them all). Regenerating removes the client's old pages first and keeps a status you edited by hand. The `tasks` output ("Public website for Petrock", …) is in the shape `src/pm/model.js` uses for cards (`id, title, description, assignee, due, priority, tags, checklist, estimate, createdAt, movedAt, blockedBy, column, done`), so the core **Timeline**, **Person** and **Project Dashboard** consume it directly; the demo wires it into a Timeline. The core **Kanban Board has no `tasks` input** (it owns its cards), so the demo pre-fills a board's `board` param with the same tasks as cards instead of forcing a link.

## The live layer (`src/live-layer.js`)

A `CSS3DRenderer` (three/addons, the same three 0.160 the core loads) draws a DOM layer inside `#viewport` above the WebGL canvas, rendered every frame with the core's current camera (`ws.camera` is a getter; the Navigator's orthographic swap is followed). Every live-eligible `hub-page` gets a `<div class="hub-live">` holding a browser-chrome strip, a screen and an `<iframe loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups">`, scaled by `1 / 120` (`sizes.face.pxPerUnit`) and positioned on the node's face mesh world transform, nudged 0.01 along the face normal. `faceLayout(device, cw, ch)` in `nodes.js` gives both the canvas face and the DOM element the same frame rectangle, so a phone iframe (390 × 844 CSS px, scaled into the drawn bezel), a tablet (1024 × 768) or a desktop page (1280 px wide) lands exactly where the face drew its frame.

* **Budget.** Only the N nearest on-screen pages with `live = true` and `status = live` get an iframe (default 8; menu / panel, persisted in `host.storage`). The ranking runs 4× a second with hysteresis (a live page counts as 20 % closer) so frames do not thrash. Others show the canvas card. An element out of the budget for 20 s is dropped (its iframe unloads); the `src` is set once when a node becomes live, never per frame.
* **Hidden when** the face is back-facing the camera, off-screen, at far LOD (`node.lod === 1`), the node is hidden (collapsed group), or live frames are off. In the 2D plan the cards lie flat and the layer follows them (top-down, orthographic).
* **Interaction.** The layer is `pointer-events: none`, so dragging, selecting and the camera work as usual. A click on a page face (core raycast → `face.onPointer`) makes that one element interactive: `pointer-events: auto`, an accent outline, a Done button, wheel events kept from the camera, and the camera flies to face the page at ~70 % of the viewport (the `facingPose` idea from `ui/field-editor.js`). Done, Escape or a pointerdown on the WebGL canvas leave. `window.__addon.api.interact(uid)` does the same for tests.
* **Limits.** A DOM layer is always drawn over the WebGL scene: a live frame is never occluded by a nearer block (nothing in front of it hides it). Cross-origin pages cannot be read, styled or screenshotted; the add-on never tries. A page whose `status` is not `live` never loads a frame. Iframe text is rendered by the browser under a `matrix3d` transform, so it is crisp only when the face is roughly screen-parallel.

## Flows (`src/flows.js`)

Pure functions: `layoutFlow(id, items) → Map uid → [x, null, z]` (y = null keeps the block's height), deterministic in the items' order.

| Flow | Layout |
| --- | --- |
| Delivery | one row per client, left→right in template phase order (hub → website → app → staff → owner → manual → docs → plan → dev tools → mockups → machine), blueprint first, a wider gap between sections |
| Audience | swimlanes by audience (everyone, customers, staff, owner, developers, machine), pages left→right within a lane |
| Site map | the hub page at the front-centre, sections in an arc behind it, their pages in columns behind each section |
| Compare | clients as rows × sections as columns: the same section of every client lines up |
| Devices | phone, tablet and desktop pages in three bands |

Applying a flow (`src/arrange.js`) is one undoable history command that tweens the blocks (wall-clock, 0.45 s), keeps the set's centre where it was and frames the moved blocks when they land.

## Adding a client

Either add an entry to `CLIENTS` in `src/clients.js` (slug, name, brand, lang, base URL, industry, roles, and the page list: section → route, title, role, device), or drop a `hub-blueprint` on the canvas, fill in the client, slug, brand and base URL, untick sections you do not need and click **Generate pages**. An unknown slug gets the template's default routes (`src/template.js › DEFAULT_ROUTES`) under the base URL with status `planned`; set the blueprint's status to `live` once the hub exists.

## Seams used off-contract, and a proposal

Everything the SDK offers is used through `host` (nodes, icons, draw, theme, menu, panel section, toasts, frameBlocks, examples, storage, selection, world/engine hooks). The live layer, the flows and generation also reach the core through `window.__proto`, which the drift guard allows (it scans imports) but the contract test does not cover:

* `window.__proto.ws.{renderer, camera, controls, flyTo, onCameraSwap}` — to size and render the CSS3D layer with the core camera, to fly to a face, to leave interact mode on a canvas pointerdown.
* `window.__proto.world.nodes` (read per frame), `node.face.{mesh, cw, ch}`, `node.lod`, `node.getAABB()` — face transforms, LOD and frustum tests.
* `window.__proto.{createInstance, cmd, history}` — creating the generated pages as one undoable command; `history.execute` for the flow moves.
* `window.__proto.sizes.face.pxPerUnit`, `window.__proto.THREE` (only checked; the add-on imports `three` itself through the page's import map).

**Proposed SDK seam: `host.view`.** With the following the add-on drops the escape hatch entirely:

```js
host.view.camera            // getter: the current camera (perspective or orthographic)
host.view.onCameraSwap(cb)  // → off
host.view.viewport          // the #viewport element; host.view.size() → { width, height } in CSS px
host.view.onFrame(cb(dt))   // per-frame hook after the core update, before render → off
host.view.flyTo(position, target, duration?) / host.view.faceOf(node) → { position, quaternion, scale, cw, ch, visible, lod }
host.view.onCanvasPointerDown(cb) → off
host.commands.addNodes(defs → [{ typeId, title, params, position }]) / removeNodes(nodes) / moveNodes(nodes, positions, { animate }) — undoable, returned as commands for host.history.execute / composite
host.sizes                  // the frozen theme sizes (face.pxPerUnit)
```

## Layout

```
addons/hubs/
  addon.json  index.html  package.json  README.md
  src/index.js        register(host) / install(host) → api (window.__addon.api, window.__hubs)
  src/template.js     the eleven sections, audiences, devices, statuses, default routes
  src/clients.js      the four clients and their pages
  src/nodes.js        hub-page / hub-blueprint / hub-section, faces, faceLayout
  src/generate.js     pagesFor / tasksFor / boardFor / planGeneration / generate (undoable)
  src/flows.js        the five flow layouts (pure)
  src/arrange.js      apply a flow as an undoable tweened move
  src/motion.js       the tween
  src/live-layer.js   the CSS3D iframe layer
  src/examples.js     demo scenes
  src/ui.js           Hubs menu, panel section, flow bar
  src/hubs.css
  test/unit/          template, flows, generate (node --test)
  test/engine/        nodes on the real core engine, faces on a stub 2D context
  test/browser/       Playwright: boot, demo, live layer (imagine-os stubbed), interact, flows, undo, storage
```

Tests: `node addons/sdk/testing/run-addons.js hubs` (unit + engine), `node --test addons/hubs/test/browser/hubs.test.js` (Chromium), plus the SDK suite and drift guard from the repo root.
