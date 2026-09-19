# Proto3D architecture

Proto3D is a platform for composing running systems out of components in a 3D workspace. This
document describes the layers, the invariants each one keeps and how they fit together. Read
`README.md` first for the user-level picture.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ UI          ui/toolbar-left.js  panel.js  ui/file-menu.js  interaction.js   │
│             ui/overlays.js  ui/tour.js  selection.js  gizmo.js  lod.js      │
│             main.js (boot + render loop)                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Scene       block3d.js → node3d.js / device3d.js / shape3d.js   connection3d.js │
│             routing.js  groups.js  faces.js  workspace.js  theme.js         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Core        core/component.js  core/registry.js  core/types.js              │
│             core/engine.js  core/world.js  core/commands.js  core/history.js │
├──────────────────────────────────────────────────────────────────────────────┤
│ Components  components/<category>/<name>.js  (17 core + 10 project)        │
│ PM layer    pm/model.js (data, no Three.js)  pm/board-ops.js  pm/panel-pm.js │
│ Examples    examples/project.js (the default scene) + examples/index.js      │
│ Persistence serialize.js                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Dependencies point downward: components import only `core/*`, `icons.js`, `faces.js` and
`theme.js` (project components also `pm/*` and `shape3d.js`'s canvas-plane helper); the scene
layer imports core; the UI imports everything. `main.js` is the only module that knows about all
of them.

## 2. Component schema (`core/component.js`)

A component type is one plain object, validated and frozen by `defineComponent`:

| Field | Meaning |
| --- | --- |
| `id` | `^[a-z][a-z0-9-]*$`, unique in the registry |
| `category` | one of the registry categories (`media, text, data, input, logic, action, transform, layout, output, project, devices`) or a new one (it appears automatically) |
| `label`, `description`, `icon` | toolbar / panel presentation; `icon` is an inline SVG string |
| `inputs` | `[{ key, label, type, multi?, optional? }]` — `multi` inputs receive arrays |
| `outputs` | `[{ key, label, type }]` |
| `params` | `[{ key, label, type: number\|text\|boolean\|select\|json\|color, default, min?, max?, step?, options? }]` |
| `size` | `S \| M \| L \| XL` node footprint (`M`/`L` have a face area); ignored by devices and by `body3d` bodies, which size themselves |
| `device` | `phone \| tablet \| laptop \| monitor` — render as a device (screen = face) |
| `evaluate(ctx)` | returns `{ [outputKey]: value }`; omit a key (or return `undefined`) to output nothing |
| `onEvent(ctx, inputKey, pulse)` | optional hook called before `evaluate` for each pulsed event input |
| `footer(ctx)` | optional footer text (nodes) |
| `face` | `{ render(g, w, h, ctx), onPointer?(ctx, ev), live?, fps? }` — a live 2D canvas on the body |
| `onCreate(instance)`, `onDestroy(instance)` | lifecycle (listeners, timers) |
| `body3d` | custom 3D body (see §8b): `dims, build, ports?, refresh?, update?, applyLOD?, onSubPointer?, onSubHover?, titleAt?` — the instance becomes a `Shape3D` |
| `panel(api, instance)` | optional component-owned editor section in the properties panel (see §8b) |
| params `hidden: true` | a param the generic panel skips because `panel()` edits it (a board, a task list) |

`ctx` = `{ inputs, params, state, time, dt, emit(key, payload), touch(key), instance, upstream(key), downstream(key), engine }`.
`state` is the per-instance persistent object (serialized when JSON-safe). `touch(key)` marks an
output as changed even if its value is equal (an Action re-firing the same payload).

## 3. Registry (`core/registry.js`)

`registry.register(def)` → frozen definition. `get(id)`, `all()`, `categories()` (ordered, with
components), `search(q)` (id, label, description, category, param labels and select options,
port labels), `onRegister(cb)`. The registry is the **single source of truth** for:

- the Add toolbar (rail buttons = categories, flyout items = components, search),
- the properties panel (`params` → controls; `inputs`/`outputs` → the Ports list),
- node construction (`Node3D` / `Device3D` build their ports and face from the definition),
- the engine (`def.evaluate`, `def.onEvent`, `def.face`),
- serialization (`type` id + `params` + `state`; unknown ids are skipped and reported on load).

## 4. Port types (`core/types.js`)

Six types plus `any`:

| type | carries | notes |
| --- | --- | --- |
| `number` | finite number | coerces to `text` |
| `text` | string | |
| `boolean` | true / false | |
| `data` | plain JSON object / array | |
| `media` | `{ kind: image\|video\|audio, src, title, w?, h? }` | `faces.bitmapFor(src)` caches bitmaps |
| `event` | pulse `{ __pulse, t, n, payload? }` | lives for one evaluation pass |
| `any` | anything | generic passthrough (Branch, Action payload, Display, device screens) |

`compatible(from, to)` → `'ok' | 'coerce' | 'invalid'`: same type, either `any`, `number → text`
(coerce); everything else is invalid. `coerce(value, from, to)` performs the conversion.
`kindOf(value)` classifies a runtime value (used by faces and hover labels), `formatValue`
prints compactly, `equal` is a structural comparison that never stringifies (media data URLs are
long).

## 5. Engine (`core/engine.js`)

`Engine.tick(dt)` runs once per frame:

1. **Validity + inbound map.** Each connection gets `valid` from `compatible`; invalid links flag
   both owner nodes (`rt.hasInvalid`) and carry `undefined`.
2. **External pulses.** `engine.emit(instance, key, payload)` (face clicks, key presses) queues a
   pulse; one pulse per port is applied per pass, the rest wait — four quick taps are four
   distinct events.
3. **Order.** Kahn's algorithm over valid connections. Nodes caught in cycles are appended, so
   back-edges read the upstream port's previous-frame value.
4. **Per node.** Pulses this node emitted in an earlier pass are cleared (everyone downstream has
   seen them). Inputs are gathered per port: event inputs fire when any upstream output pulsed;
   multi inputs collect coerced values in connection order; single inputs with several links
   take the **most recently changed** upstream value. `onEvent` runs for pulsed inputs, then
   `evaluate`; outputs are written (`event` outputs pulse). Errors are caught into `rt.error`.
   `instance.afterEvaluate(ctx, t)` refreshes the footer and, when any port changed / pulsed this
   pass or `face.live` says so, redraws the face.
5. **States.** Node: `disabled > error > active > idle` (active = an output changed / pulsed within
   `ACTIVE_WINDOW` = 1.5 s; sinks and devices use their inputs). Connection: `invalid >
   inactive (no value) > active > idle`.

Values are cached on `connection.value` for the hover label and the panel; every port keeps
`value, changedAt, lastPulseAt, rate, changes`.

## 6. World model (`core/world.js`)

`World` owns `nodes` (component instances: `Node3D` / `Device3D` / `Shape3D`), `connections`
(`Connection3D`) and `groups` (`Group3D`), all in one `THREE.Scene`. It offers only low-level
mutations (`addNode / removeNode / addConnection / removeConnection / addGroup / removeGroup`) and
helpers (`connectionsOf`, `nextFreeSlot`, `canConnect`, `compatiblePorts(port)` — the ports on
other visible blocks a cable from `port` may land on — `detectMoves`, `clear`). `addConnection` /
`removeConnection` keep every port's `connected` flag in sync (filled vs hollow pin). It emits
`change` events (autosave) and bumps `layoutVersion` whenever geometry moved (connections
re-route). Undoable behaviour lives one layer up.

## 7. Commands and history (`core/commands.js`, `core/history.js`)

Every edit is a `{ label, do(), undo() }`: `addNode, removeNodes, connect, disconnect, reroute,
transform, setParam, setTitle, setEnabled, addGroup, removeGroup, setCollapsed, setGroupTitle,
duplicate` and `composite`. `disconnect.do` tolerates a link the interaction layer already lifted
off the world (a cable end being dragged); `reroute(world, conn, from, to)` removes `conn` (if
still present) and creates the new link, its undo puts the original object back. `History.execute` pushes; `executeCoalesced(key, cmd)` merges rapid edits with
the same key (typing in a param field, dragging a transform field). `undo / redo` are bound to
`Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y` and the ↶ ↷ buttons. Removing a node keeps the instance alive
(not disposed) so undo can re-add the very same object with its connections.

## 8. Scene objects

- **`Block3D`** (`block3d.js`): shared base — uid, definition, params, state, enabled, ports,
  rim, contact shadow, canvas labels, optional face (`_initFace`, `renderFace`, `onFacePointer`,
  `emit`), derived state / hover / selected visuals, LOD blend, `getAABB` (routing), `footprint`
  (group frames, ghosts, free-slot search), `serialize`.
  **Ports** (`createPort`): a stem plus a typed pin — `shape: 'chevron'` (an extruded pentagon
  pointing +X, the flow direction) for `event`, `'sphere'` for every data type — and a back-face
  `shell` of the same geometry. The look is derived in `applyLook()` from four flags:
  `connected` (filled, bright) vs not (dark core + coloured shell = hollow ring), `hovered`
  (×1.5), `disabled` (grey) and `emphasis` (`'glow'` pulsing rim for compatible targets,
  `'dim'` 35 % for incompatible ones, `'reject'` red ring under the pointer). Optional ports are
  scaled 0.85, multi ports 1.15 with a "+" glyph. `_addLabelledPort` places the name beside the
  pin (inside the body; outside on devices, `portLabelSide`), and `positionSideCaptions()` keeps
  a tiny **IN** / **OUT** caption above the first port of each side (re-placed per frame from the
  first port's position, so bodies that move their ports — the board when columns change — stay
  correct). `proxy` redirects the world position while the owner sits in a collapsed group.
- **`Node3D`**: slab + header + port rows + face + footer. Height = header + port rows + face +
  footer; width by `size` (S 3.6, M 4.6, L 6.4 units). Far LOD: detail labels fade, the title lifts
  above the slab and scales with distance.
- **`Device3D`**: form factors from `sizes.device`; the screen plane is the face (emissive canvas).
- **`Connection3D`** + **`routing.js`**: tube along the routed curve, one continuous flow sheen
  (shader), rings at both ends, outline for hover / selected, `far` for LOD. Either end may be a
  **free point** instead of a port (`from` / `fromPoint`, `to` / `toPoint`; `complete` is true
  for a real link) — that is the preview while a cable is dragged forwards or backwards
  (`setPreviewPoint(side, p)` / `setPreviewPort(side, port)`). A hidden fat `pickTube`
  (radius ≥ 0.16) plus the two rings are what the raycaster tests, so a 1-px cable is easy to
  hover; `endNear(point)` says whether a hit lies within `sizes.connection.grabReach` (0.9) of an
  end. Dimming has two independent levels combined in `_applyDim`: `dimHover` (another cable is
  hovered, 25 %) and `dimSelect` (a block this cable does not touch is selected, 40 %).
  `setEndHover(end)` enlarges the grabbed ring. Rebuilt only when an endpoint moved, the world
  `layoutVersion` changed or the radius changed.
- **`Group3D`** (`groups.js`): frame (fill + ring) sized from members' footprints every frame,
  title at the front edge; `setCollapsed` hides members and internal links, builds a slab and
  proxy ports for boundary links (`inner.proxy = proxyPort`), `refreshProxies` on connect /
  disconnect.
- **`faces.js`**: `drawValue` dispatches on `kindOf` (text, number, boolean pill, JSON, media,
  media list, media layout); `drawMedia` (image / video poster with progress / audio waveform);
  `drawMediaGrid` + `gridShape`; `drawScreen` for devices; bitmap cache with `onBitmapReady`.
- **`Connection3D` token bursts**: an `event` link watches its source port's `lastPulseAt`; each
  new pulse spawns a bead (white core + type-coloured halo) that runs the curve in 0.35–1.1 s.
  Nothing else is needed for tokens to be visible on any event path, flowchart or not.

## 8b. Custom 3D bodies and sub-selection (`shape3d.js`)

A definition with `body3d` is instantiated as a **`Shape3D`** (`instance.js` picks
`Device3D` / `Shape3D` / `Node3D`). `Shape3D` keeps everything from `Block3D` — uid, params,
state, typed ports with labels, rim, contact shadow, face canvas, LOD blend, `serialize` — and
hands geometry to the definition:

| hook | called | purpose |
| --- | --- | --- |
| `dims(defOrNode)` | before build, and by the toolbar for the ghost footprint | `{ width, height, depth }`; may depend on params (a board grows with its columns) |
| `build(node, h)` | once | static parts through helpers: `h.part(geo, mat, { theme })` (pickable body, recoloured on theme change), `h.label(text, opts, pos)`, `h.sub(mesh, { kind, id })`, `h.face(w, h, pos)` (the `def.face` canvas), `h.rim(geo)` |
| `ports(node)` | once | `{ in: [[x, y, z]], out: [...] }` — same stem + sphere + label anatomy as nodes |
| `refresh(node)` | whenever `faceDirty` is set: param / state change (any `setParam`, undo, redo, load), theme change, `setTitle` | rebuilds the **data-driven children** in `node.children3d` after `node.clearChildren()`: columns, cards, bars, ticks, arcs |
| `update(node, time, dt)` | every frame | animation (flash, progress bar, ripple) |
| `applyLOD(node, blend)` | every frame with the LOD blend | far look (the board hides cards and shows per-column count bars) |
| `onSubPointer(node, ev)` / `onSubHover(node, sub)` | pointer on a child pickable | see below |

**Child pickables (subs).** Any mesh registered with `h.sub` / `node.childSub` carries
`userData.sub = { block, kind, id, ... }`. `Interaction.pick()` tests subs right after ports and
before faces and bodies, so a card wins over the board behind it. A press on a sub is captured by
the owning block (the board does not start moving): the block receives `down`, then `drag` while
the pointer moves, then `drop` or `click` on release, or `cancel` on `Esc`. `ev` carries the
pointer `ray` (the board intersects it with its own front plane and converts to local space),
plus `history` and `selection` so the component can record an undoable command and set the
sub-selection. Hover on a sub calls `setSubHover` (the board repaints the hovered card).

**Sub-selection → panel.** `block.subSelection = { kind, id }` names the child the panel should
edit; `Shape3D.selectSub(sub, selection)` sets it and calls `selection.refresh()` so the panel
rebuilds with the block still selected. Clearing happens when the block is deselected
(`setSelected(false)`) or when its body (not a sub) is pressed. The panel builds the generic
sections (Transform, Component params, Ports) and then calls `def.panel(api, block)`; the
component's builder reads `block.subSelection` and adds its own sections (card editor, column
editor, board editor). `api` bundles the panel's DOM helpers (`section, row, text, area, date,
num, select, check, buttons, action, readonly, h, live`) and undoable writes (`setParam(key,
value, coalesceKey)`, `exec(cmd)`), plus `persons()` for assignee lists and `rebuild()`.

**Data ownership.** Boards keep their whole model in `params.board` (hidden param): every
change — a 3D drag, a panel field, an `add card` pulse — is one `setParam('board', next)` produced
by the pure functions in `pm/model.js` and committed by `pm/board-ops.js` (`commitBoard`), which
also pulses `card moved` / `done`. Undo therefore restores cards, columns and positions in one
step, serialization needs nothing new, and `duplicate` clones a board with its cards. The
burndown history is per-instance `state` (saved, not undoable). Timelines keep their own tasks in
`params.tasks` the same way; fed tasks are read from `rt.inputs` and never written.

## 9. Interaction model (`interaction.js`, `ui/overlays.js`, `ui/tour.js`, `selection.js`, `gizmo.js`, `lod.js`)

**Picking** (`pick()`): ports (pin + shell meshes) > sub pickables > faces > bodies > connections
(the `pickTube` and the end rings; the hit carries `end: 'from' | 'to' | null` from
`Connection3D.endNear`) > group frames. Faces receive `{ type: down | drag | up | click, u, v }`
in canvas coordinates; a face that handles `down` captures the drag (slider), otherwise the press
is a normal block drag and a click (no movement) is delivered on release (device tap, button).
Moves are recorded as one `transform` command per drag; the gizmo records one per handle drag.

**Hover.** `_setHover(item, end)` drives one cursor state (`_cursor`: default, `grab` over a
draggable body / group / cable end, `grabbing` while dragging, `crosshair` over a pin,
`not-allowed` over an incompatible target, `pointer` over a live face / cable body / sub,
`move` while the gizmo is hot) and the tooltip (`Overlays.tip`): a port tooltip with name, type,
value, links and the drag hint; a block tooltip (label + description) after 500 ms; the cable-end
hint. `_recomputeEmphasis()` rebuilds every port's `emphasis` from scratch — the selected cable's
two ports glow; when a port is hovered or a cable is being dragged, `world.compatiblePorts(src)`
glow, every other port on other blocks dims, and the rejected pin under the pointer goes red —
and `update(time)` pulses the glowing set each frame.

**Cable drags** share one state object `connect = { need, fixed, side, preview, plane, detached,
origin, snapped, reject }`: `fixed` is the real port the cable stays attached to, `need` the
direction being looked for (`'in'` when dragging from an output, `'out'` when dragging backwards
from an input), `side` the preview's free end. `_beginConnect(port)` starts a new cable from an
output or from an empty / multi input. Pressing a connected single input, or the tube / ring near
either end of a cable, records `pendingDetach = { conn, end }`; the first movement beyond 4 px
runs `_beginDetach`, which removes the link from the world **without history**, and the drop
decides: `_updateConnect` snaps to a port under the pointer (or the nearest compatible port within
`sizes.connection.snapReach` = 1.2 along the ray), marks a wrong-side / same-block / mismatched
pin as `reject`, colours the preview and writes the drag label; `_endConnect` then executes
`connect` (new cable), `reroute` (detached end onto another port), `disconnect` (detached end on
empty space, with a toast) or puts the link back with no history (dropped on its own port, on an
incompatible pin, or `Esc` via `cancel()`); a cancelled new cable fades over 0.28 s
(`fading`). An incompatible drop never creates a link.

**Selection emphasis** (`applySelectionEmphasis`, on every selection and world change): the
selected nodes (plus members of selected groups) keep their cables at full brightness and every
other cable gets `dimSelect`; each cable leaving the set is labelled at its far end through
`Overlays.setEndLabels` (`→ To.port` at the input end, `From.port →` at the output end). A
selected cable dims the others and the midpoint label in `main.js` shows
`From.port → To.port · type · value`.

**Overlays** (`ui/overlays.js`) own the HTML layers — tooltip (anchored to a world position and
re-projected per frame, optional delay), drag label beside the pointer, toast, cable end labels
(DOM rebuilt only when the label set changes), empty-scene hint (driven by `world.onChange`).
**Tour** (`ui/tour.js`): four steps with a spotlight (`.tour-spot`, a box-shadow cut-out that
follows a DOM rect or a projected world point) and a card; step 2 picks a real output port with
a compatible, preferably unconnected, input on another block, frames both and animates a ghost
`Connection3D` from the output to the input; step 3 frames the board and spots its first card;
step 4 spots a cable's input end. The backdrop does not capture pointer events. Seen state is
`localStorage["proto3d.tour.v1"]`; **? → Show tour** replays it.

`Selection` holds nodes, groups and connections and notifies the panel, the gizmo and the
interaction layer. `lod.js` computes camera distance per node / connection / group with
hysteresis; the blocks animate the crossfade.

## 10. Serialization (`serialize.js`)

```json
{ "app": "proto3d", "version": 2, "name": "…", "savedAt": "…",
  "nodes": [{ "uid", "type", "title", "params", "state", "enabled", "position", "rotationY", "scale" }],
  "connections": [{ "uid", "from": { "node", "port" }, "to": { "node", "port" } }],
  "groups": [{ "uid", "title", "members": ["uid"], "collapsed" }],
  "camera": { "position", "target" } }
```

`loadWorld` clears the world, instantiates known types (unknown ids are reported in `skipped`),
reconnects by uid + port key, rebuilds groups (collapsing after their members exist) and restores
the camera. `AutoSave` debounces `world.onChange` into `localStorage["proto3d.world.v2"]`.

## 11. Adding to the platform

- **A component**: one file under `src/components/<category>/`, `registry.register({...})`, import
  it in `components/index.js`. See the worked example in `README.md`.
- **A custom 3D body**: add `body3d` to the definition (§8b); add `panel(api, block)` when it owns
  data the generic param controls cannot edit, and mark those params `hidden`.
- **A category**: add a row to `CATEGORIES` in `core/registry.js` (label, kind, description) and an
  icon in `icons.js`; the toolbar picks it up. Unknown categories still work (auto-labelled).
- **A port type**: add it to `TYPES` / `typeInfo` in `core/types.js`, to `portTypes` in both
  palettes in `theme.js`, and a `compatible` rule if it coerces. `portShapeFor` in `block3d.js`
  decides the pin shape (only `event` is a chevron).
- **A param control**: extend `PARAM_TYPES` in `core/component.js` and `_buildBlock` in `panel.js`.
- **An undoable operation**: a command in `core/commands.js` built from `World` mutations.

## 12. Invariants worth keeping

1. The world is the only source of truth; the engine annotates, the UI reads and writes through
   commands, serialization walks it.
2. Definitions are frozen and stateless; all per-instance data lives in `instance.params`,
   `instance.state` and `instance.rt`.
3. Type colours, category tints and state colours come from `theme.js` only; both palettes define
   every key.
4. Anything visible about a connection (validity, activity, direction, type) is derived from data,
   never set by hand.
5. Removing scene objects for undo never disposes them; `World.clear()` does.
