# Proto3D architecture

Proto3D is a platform for composing running systems out of components in a 3D workspace. This
document describes the layers, the invariants each one keeps and how they fit together. Read
`README.md` first for the user-level picture.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ UI          ui/toolbar-left.js  panel.js  ui/file-menu.js  interaction.js   │
│             selection.js  gizmo.js  lod.js  main.js (boot + render loop)     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Scene       block3d.js → node3d.js / device3d.js   connection3d.js          │
│             routing.js  groups.js  faces.js  workspace.js  theme.js         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Core        core/component.js  core/registry.js  core/types.js              │
│             core/engine.js  core/world.js  core/commands.js  core/history.js │
├──────────────────────────────────────────────────────────────────────────────┤
│ Components  components/<category>/<name>.js  (17 core definitions)          │
│ Examples    examples/*.js                                                    │
│ Persistence serialize.js                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Dependencies point downward: components import only `core/*`, `icons.js`, `faces.js` and
`theme.js`; the scene layer imports core; the UI imports everything. `main.js` is the only
module that knows about all of them.

## 2. Component schema (`core/component.js`)

A component type is one plain object, validated and frozen by `defineComponent`:

| Field | Meaning |
| --- | --- |
| `id` | `^[a-z][a-z0-9-]*$`, unique in the registry |
| `category` | one of the registry categories (`media, text, data, input, logic, action, transform, layout, output, devices`) or a new one (it appears automatically) |
| `label`, `description`, `icon` | toolbar / panel presentation; `icon` is an inline SVG string |
| `inputs` | `[{ key, label, type, multi?, optional? }]` — `multi` inputs receive arrays |
| `outputs` | `[{ key, label, type }]` |
| `params` | `[{ key, label, type: number\|text\|boolean\|select\|json\|color, default, min?, max?, step?, options? }]` |
| `size` | `S \| M \| L` node footprint (`M`/`L` have a face area); ignored by devices |
| `device` | `phone \| tablet \| laptop \| monitor` — render as a device (screen = face) |
| `evaluate(ctx)` | returns `{ [outputKey]: value }`; omit a key (or return `undefined`) to output nothing |
| `onEvent(ctx, inputKey, pulse)` | optional hook called before `evaluate` for each pulsed event input |
| `footer(ctx)` | optional footer text (nodes) |
| `face` | `{ render(g, w, h, ctx), onPointer?(ctx, ev), live?, fps? }` — a live 2D canvas on the body |
| `onCreate(instance)`, `onDestroy(instance)` | lifecycle (listeners, timers) |

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

`World` owns `nodes` (component instances: `Node3D` / `Device3D`), `connections`
(`Connection3D`) and `groups` (`Group3D`), all in one `THREE.Scene`. It offers only low-level
mutations (`addNode / removeNode / addConnection / removeConnection / addGroup / removeGroup`) and
helpers (`connectionsOf`, `nextFreeSlot`, `canConnect`, `detectMoves`, `clear`). It emits
`change` events (autosave) and bumps `layoutVersion` whenever geometry moved (connections
re-route). Undoable behaviour lives one layer up.

## 7. Commands and history (`core/commands.js`, `core/history.js`)

Every edit is a `{ label, do(), undo() }`: `addNode, removeNodes, connect, disconnect, transform,
setParam, setTitle, setEnabled, addGroup, removeGroup, setCollapsed, setGroupTitle, duplicate`
and `composite`. `History.execute` pushes; `executeCoalesced(key, cmd)` merges rapid edits with
the same key (typing in a param field, dragging a transform field). `undo / redo` are bound to
`Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y` and the ↶ ↷ buttons. Removing a node keeps the instance alive
(not disposed) so undo can re-add the very same object with its connections.

## 8. Scene objects

- **`Block3D`** (`block3d.js`): shared base — uid, definition, params, state, enabled, ports
  (`createPort`: stem + coloured sphere; `proxy` redirects the world position while collapsed),
  rim, contact shadow, canvas labels, optional face (`_initFace`, `renderFace`, `onFacePointer`,
  `emit`), derived state / hover / selected visuals, LOD blend, `getAABB` (routing), `footprint`
  (group frames, ghosts, free-slot search), `serialize`.
- **`Node3D`**: slab + header + port rows + face + footer. Height = header + port rows + face +
  footer; width by `size` (S 3.6, M 4.6, L 6.4 units). Far LOD: detail labels fade, the title lifts
  above the slab and scales with distance.
- **`Device3D`**: form factors from `sizes.device`; the screen plane is the face (emissive canvas).
- **`Connection3D`** + **`routing.js`**: tube along the routed curve, one continuous flow sheen
  (shader), rings at both ends, outline for hover / selected, `dim` uniform for hover isolation,
  `far` for LOD. Rebuilt only when an endpoint moved, the world `layoutVersion` changed or the
  radius changed.
- **`Group3D`** (`groups.js`): frame (fill + ring) sized from members' footprints every frame,
  title at the front edge; `setCollapsed` hides members and internal links, builds a slab and
  proxy ports for boundary links (`inner.proxy = proxyPort`), `refreshProxies` on connect /
  disconnect.
- **`faces.js`**: `drawValue` dispatches on `kindOf` (text, number, boolean pill, JSON, media,
  media list, media layout); `drawMedia` (image / video poster with progress / audio waveform);
  `drawMediaGrid` + `gridShape`; `drawScreen` for devices; bitmap cache with `onBitmapReady`.

## 9. Interaction model (`interaction.js`, `selection.js`, `gizmo.js`, `lod.js`)

Picking order: ports > faces > bodies > connections > group frames. Faces receive
`{ type: down | drag | up | click, u, v }` in canvas coordinates; a face that handles `down`
captures the drag (slider), otherwise the press is a normal block drag and a click (no movement)
is delivered on release (device tap, button). Moves are recorded as one `transform` command per
drag; the gizmo records one per handle drag. `Selection` holds nodes, groups and connections and
notifies the panel and the gizmo. `lod.js` computes camera distance per node / connection /
group with hysteresis; the blocks animate the crossfade.

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
- **A category**: add a row to `CATEGORIES` in `core/registry.js` (label, kind, description) and an
  icon in `icons.js`; the toolbar picks it up. Unknown categories still work (auto-labelled).
- **A port type**: add it to `TYPES` / `typeInfo` in `core/types.js`, to `portTypes` in both
  palettes in `theme.js`, and a `compatible` rule if it coerces.
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
