# Client Hubs (`hubs`, prefix `hub-`)

A demo of how Imagine OS builds a complete client deliverable hub on the Proto3D canvas: the public website, the customer app, the staff surfaces by role, the ops manual, docs, plan, design system and dev tools, mockups and the machine surface, **embedded live as nodes**, with the canvas re-arrangeable into different flows. Four real clients on imagine-os.github.io are included: CTL OS (`cal-tenant-law`), Petrock (`petrock`), HoyOS (`hoy`, Spanish) and Llave OS (`dorum-lifestyle`, a static multi-page site).

Page: `addons/hubs/index.html` (SDK shell). Live: https://arthovis-org.github.io/Proto3D/addons/hubs/

## What is on the canvas

| Node | Size | What it is |
| --- | --- | --- |
| `hub-blueprint` | XL | The "fill in a client" form: name, slug, brand, language, base URL, industry, roles, the eleven-section checklist with page counts and a **Generate pages** button (Regenerate when pages exist). Outputs `pages` (descriptors), `tasks` (`data · tasks`, one card per enabled section in the core PM shape), `count`, `generated` (event). Input `generate` (event). |
| `hub-page` | per card | One deliverable page: `url`, `title`, `section`, `audience`, `role`, `device` (desktop / tablet / phone / none), `status` (planned / building / live), `live`, `client`, `order`, plus its size: `height` (world units, 0 = follow the global embed height), `aspect` (page width preset: device / desktop 1280 / tablet 1024 / phone 390 / custom) and `pageWidth` (px, for custom). A `body3d` card sized per instance: the width of the page, the global or its own height. The canvas face (a slim strip: section, audience · role, route, status; then the page frame or phone bezel) is the fallback whenever the live frame is not shown. Clicking the face emits `opened` and opens the page for interaction; the `open` event input does the same. |
| `hub-section` | M | A header card (section name, audience, description) the flows use as a lane / column label. |

**Hubs menu**: Demos (one per client, all four in the Compare flow, a blank New client), Arrange (five flows), Embed height (presets), Live pages (on/off, budget), Open selected page, Generate pages for the selected blueprint. **Panel section "Client Hubs"**: the embed-height slider, live toggle, budget slider, counts, flow buttons. **Flow bar** (bottom-centre HUD): the five flows, a client filter when several clients are on the canvas, the embed-height slider with its value, the live counter.

## Card sizes (`src/sizing.js`)

A page card is **the width of the page**: the iframe renders the page at its natural CSS width for the device and is scaled so that width fills the card's frame exactly; the card's height decides how much of the page is visible (the iframe's CSS height equals the frame's height at that scale, so the visible viewport is the whole frame: no letterbox, no crop to a band).

| Kind | Page width | Card | Default frame (at embed height 8) |
| --- | --- | --- | --- |
| desktop (`device: desktop / none`, `aspect: desktop`) | 1280 px | 8.6 × 8 units | 1280 × ~1080 px of page |
| tablet | 1024 px | 7.0 × 8 | 1024 × ~1080 px |
| phone | 390 px | 3.4 × 8, with a bezel | the whole 390 × 844 page (and a little more) |
| custom (`aspect: custom`, `pageWidth`) | 240–2560 px | `pageWidth · 0.75 / 120 + 0.6` wide | width fills the frame |

The **embed height** (slider in the flow bar and the panel, presets in the Hubs menu; 4–14 units, default 8, persisted in `host.storage`) resizes every card at once: each card re-bakes its slab, face surface, rim, shadow, ports and title on the next frame (`body3d.refresh`), and the CSS3D frames are rebuilt for the new face size. It is a view setting, not a history entry. A card's own `height` param wins over the global value. `getAABB`, LOD, selection outline, gizmo and cable routing follow the new size; the size is a function of the params, so serialize → load reproduces it (and `rotationY` keeps the flow's angle). The face canvas stays under `sizes.face.maxSide` (4096) at the 4× tier: a default desktop face is 1008 × 881 logical px; `createSurface` clamps the tier for taller cards.

## The deliverable process as nodes

`blueprint → pages → tasks → plan`. A blueprint holds the client; **Generate** turns it into `hub-page` nodes (real routes for the four known slugs from `src/clients.js`, template defaults with status `planned` for any other slug) placed in the Delivery flow beside the blueprint, as one undoable command (Ctrl+Z removes them all). Regenerating removes the client's old pages first and keeps a status you edited by hand. The `tasks` output ("Public website for Petrock", …) is in the shape `src/pm/model.js` uses for cards (`id, title, description, assignee, due, priority, tags, checklist, estimate, createdAt, movedAt, blockedBy, column, done`), so the core **Timeline**, **Person** and **Project Dashboard** consume it directly; the demo wires it into a Timeline. The core **Kanban Board has no `tasks` input** (it owns its cards), so the demo pre-fills a board's `board` param with the same tasks as cards instead of forcing a link.

## The live layer (`src/live-layer.js`)

A `CSS3DRenderer` (three/addons, the same three 0.160 the core loads) draws a DOM layer inside `#viewport` above the WebGL canvas, rendered every frame with the core's current camera (`ws.camera` is a getter; the Navigator's orthographic swap is followed). Every live-eligible `hub-page` gets a `<div class="hub-live">` holding a browser-chrome strip, a screen and an `<iframe loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups">`, scaled by `1 / 120` (`sizes.face.pxPerUnit`) and positioned on the node's face mesh world transform, nudged 0.01 along the face normal. `faceLayout(params, cw, ch)` in `sizing.js` gives both the canvas face and the DOM element the same frame rectangle, so a phone iframe (390 px wide, scaled into the drawn bezel), a tablet (1024) or a desktop page (1280) lands exactly where the face drew its frame, as tall as the frame.

* **Budget.** Only the N nearest on-screen pages with `live = true` and `status = live` get an iframe (default 8; menu / panel, persisted in `host.storage`). The ranking runs 4× a second with hysteresis (a live page counts as 20 % closer) so frames do not thrash. Others show the canvas card. An element out of the budget for 20 s is dropped (its iframe unloads); the `src` is set once when a node becomes live, never per frame.
* **Hidden when** the face is back-facing the camera, off-screen, narrower than 44 px on screen, the node is hidden (collapsed group), or live frames are off. In the 2D plan the cards lie flat and the layer follows them (top-down, orthographic).
* **Interaction.** The layer is `pointer-events: none`, so dragging, selecting and the camera work as usual. A click on a page face (core raycast → `face.onPointer`) makes that one element interactive: `pointer-events: auto`, an accent outline, a Done button, wheel events kept from the camera, and the camera flies to face the page at ~70 % of the viewport (the `facingPose` idea from `ui/field-editor.js`). Done, Escape or a pointerdown on the WebGL canvas leave. `window.__addon.api.interact(uid)` does the same for tests.
* **Limits.** A DOM layer is always drawn over the WebGL scene: a live frame is never occluded by a nearer block (nothing in front of it hides it). Cross-origin pages cannot be read, styled or screenshotted; the add-on never tries. A page whose `status` is not `live` never loads a frame. Iframe text is rendered by the browser under a `matrix3d` transform, so it is crisp only when the face is roughly screen-parallel.

## Flows (`src/flows.js`)

Pure functions: `layoutFlow(id, items) → Map uid → { x, y, z, ry }` — x / z the block's centre, **y the elevation of its base** (0 = the floor; callers add height / 2 + 0.4), ry the rotation about y. Items carry their real footprint (`width`, `height`; page cards default to `cardDims`), so tall cards get taller levels: every level clears the tallest card below it plus a 1.6-unit margin (`levelBases`). Height is an organising axis, not a stagger. Deterministic in the items' order; collision-free by construction (`collides` is the test's check).

| Flow | Layout |
| --- | --- |
| Delivery | a climbing arc per client (a level each) with **one slot per section**: the section's header or first page on the ground arc (sweep ≤ 137°, radius ≥ 12, cards facing the arc's centre, later phases up to 4 units higher), its other pages rising above that slot in a short column; the blueprint front-centre inside the arc. A 21-page hub is a 74 × 23 unit arc, so framing the whole arc stays under the LOD distance and the faces stay readable |
| Audience | floors: customers at the ground, then everyone, staff, owner, developers, machine; each floor a centred row stepped back 3.2 units, narrow (phone) cards a step forward; headers at the left end of their floor, blueprints climbing the floors at the far left |
| Site map | the hub page at the base, the sections as a semicircular ring one level up behind it (each slot facing the hub), the section's remaining pages rising above their slot in a column that also steps outward |
| Compare | clients as levels with **a full card height of air** between them (plus the 1.6 margin), stepped back 3.2; sections as columns as wide as the busiest cell, split into a front and a back bank (14 back, 2 up) when the row would pass 120 units; a `hub-section` **level label** (client name in its brand colour, the `label` param) at the left end of each level, the blueprint left of it; section headers label the columns on the ground in front |
| Devices | phone (ground), tablet, desktop as three arcs, one level each, stepped back |

Applying a flow (`src/arrange.js`) is one undoable history command that tweens position and rotation (wall-clock, 0.45 s), keeps the set's floor-plan centre where it was and frames the moved blocks when they land: Delivery through `host.ui.frameBlocks` (fill 0.85); the stacked flows (Audience, Compare, Site map, Devices) through `frameFrom`, the same fit from a 40° elevation with the Add rail and the flow bar kept clear (`ws.flyTo`, off-contract), so the levels do not hide each other. Framing a whole Delivery arc of 21 desktop cards puts the camera past the core's LOD distance; the live layer therefore decides by on-screen size (a card ≥ 44 px wide may carry a frame), not by LOD, and the demos open on the front of the arc.

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
  src/sizing.js       card sizes: page widths, the embed height, faceLayout (shared by face, live layer, flows)
  src/nodes.js        hub-page (body3d card) / hub-blueprint / hub-section, faces
  src/generate.js     pagesFor / tasksFor / boardFor / planGeneration / generate (undoable)
  src/flows.js        the five 3D flow layouts (pure): levels, arcs, rotation
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
