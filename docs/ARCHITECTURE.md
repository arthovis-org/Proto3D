# Proto3D architecture

Proto3D is a platform for composing running systems out of components in a 3D workspace. This
document describes the layers, the invariants each one keeps and how they fit together. Read
`README.md` first for the user-level picture.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ UI          ui/menubar.js (menus + quick toggles)  ui/toolbar-left.js  panel.js  interaction.js  ui/field-editor.js │
│             ui/mini-toolbar.js (above the selection)  ui/command-palette.js (Ctrl+K)          │
│             ui/tab-strip.js (project tabs + autosave indicator)  ui/version-history.js  ui/confirm.js │
│             ui/overlays.js  ui/tour.js  ui/help-dialogs.js  ui/stats.js  selection.js  gizmo.js  lod.js │
│             ui/start-panel.js (first run, File → New, Help → Start panel)  ui/hint-bar.js       │
│             ui/guides.js (snap guides)  layout.js (Auto-layout)  plan.js (2D mode + snap settings) │
│             controls/presets.js + controls/navigation.js (camera + bindings) │
│             main.js (boot + render loop)                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Scene       block3d.js → node3d.js / device3d.js / shape3d.js   connection3d.js  cable-chips.js │
│             routing.js  groups.js  faces.js  face-canvas.js  workspace.js  theme.js │
│             geometry.js (panelGeometry)  wiring.js (the Wiring switch)       │
│ Persistence tabs.js (open projects, autosave, snapshots)  project-store.js (IndexedDB)  serialize.js │
├──────────────────────────────────────────────────────────────────────────────┤
│ Core        core/component.js  core/registry.js  core/types.js              │
│             core/engine.js  core/world.js  core/commands.js  core/history.js │
├──────────────────────────────────────────────────────────────────────────────┤
│ Components  components/<category>/<name>.js  (17 core + 10 project + 5 generate) │
│ PM layer    pm/model.js (data)  pm/relations.js (links → meaning)  pm/board-ops.js  pm/panel-pm.js │
│ AI layer    ai/providers/* (openrouter, fal, kie, demo)  ai/vault.js  ai/jobs.js  ai/pricing.js  ai/store.js  ai/http.js │
│             ui/connections.js  ui/model-browser.js  ui/jobs-tray.js  (reached through ai/ui-hooks.js) │
│ Examples    examples/showcase.js (the full scene)  examples/project-board.js · ai-pipeline.js · │
│             device-flow.js (the starter templates)  examples/index.js (builder API)               │
│ Persistence serialize.js                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Dependencies point downward: components import only `core/*`, `icons.js`, `faces.js` and
`theme.js` (project components also `pm/*` and `shape3d.js`'s canvas-plane helper; generate
components also `ai/*`, which has no Three.js and reaches the UI only through `ai/ui-hooks.js`,
see `docs/AI-GENERATION.md`); the scene
layer imports core; the UI imports everything. `main.js` is the only module that knows about all
of them.

## 2. Component schema (`core/component.js`)

A component type is one plain object, validated and frozen by `defineComponent`:

| Field | Meaning |
| --- | --- |
| `id` | `^[a-z][a-z0-9-]*$`, unique in the registry |
| `category` | one of the registry categories (`media, text, data, input, logic, action, transform, layout, output, project, devices`) or a new one (it appears automatically) |
| `label`, `description`, `icon` | toolbar / panel presentation; `icon` is an inline SVG string |
| `inputs` | `[{ key, label, type, subtype?, loose?, multi?, optional? }]` — `multi` inputs receive arrays and render as a growing slot rectangle (§4b); `subtype` narrows a `data` port (§4a) |
| `outputs` | `[{ key, label, type, subtype? }]` |
| `describeLink(fromPort, toDef, toPort, names)` | optional: a sentence for a cable leaving this component (`pm/relations.js` has a table for the project components) |
| `params` | `[{ key, label, type: number\|text\|boolean\|select\|json\|color, default, min?, max?, step?, options? }]` |
| `size` | `S \| M \| L \| XL` node footprint (`M`/`L` have a face area); ignored by devices and by `body3d` bodies, which size themselves |
| `device` | `phone \| tablet \| laptop \| monitor` — render as a device (screen = face) |
| `evaluate(ctx)` | returns `{ [outputKey]: value }`; omit a key (or return `undefined`) to output nothing |
| `onEvent(ctx, inputKey, pulse)` | optional hook called before `evaluate` for each pulsed event input |
| `footer(ctx)` | optional footer text (nodes) |
| `face` | `{ render(g, w, h, ctx), onPointer?(ctx, ev), portAnchors?(info), fields?(ctx), live?, fps? }` — a live 2D canvas on the body; `portAnchors` puts each pin level with the face region it affects (§7c); `render` may register editable regions with `beginFields` (§8d) |
| `onCreate(instance)`, `onDestroy(instance)` | lifecycle (listeners, timers) |
| `body3d` | custom 3D body (see §8b): `dims, build, ports?, portAnchors?, fields?, refresh?, update?, applyLOD?, onSubPointer?, onSubHover?, titleAt?` — the instance becomes a `Shape3D`; `fields(node)` lists regions editable in place (§8d) |
| `panel(api, instance)` | optional component-owned editor section in the properties panel (see §8b) |
| params `hidden: true` | a param the generic panel skips because `panel()` edits it (a board, a task list); `multiline: true` on a `text` param gives it a textarea in the panel (a note) |

`ctx` = `{ inputs, params, state, time, dt, emit(key, payload), touch(key), instance, upstream(key), downstream(key), engine }`.
`state` is the per-instance persistent object (serialized when JSON-safe). `touch(key)` marks an
output as changed even if its value is equal (an Action re-firing the same payload).

**Relationship links.** `upstream(inputKey)` and `downstream(outputKey)` return the instances on
the other end of a port's cables — `[{ node, port, key, connection }]` — so a component can act
on *who it is plugged into*, not only on the value that arrives. A Person reads
`downstream('person')` to find the boards whose `people` slot it feeds and lists the cards
assigned to it there; a Dashboard reads `upstream('progress')[0].node.title` to name its board.
`pm/relations.js` wraps the same idea for the UI (`connectedPeople(board)`, `personTasks(person)`)
straight from `world.connections`, so panels and 3D bodies can use it outside evaluation.
Signatures of such relationships are kept on the instance (`_relSig`, `_sig`), never in saved
`state`, so a loaded world re-applies them.

**Port naming rules.** Ports are named as plain words a newcomer can read on the block (`people`,
`tasks`, `progress`, `add task`); event outputs start with *when* (`when a card is done`, `when
reached`, `when complete`) except the flow shapes' `next` / `yes` / `no`; a description is one
plain sentence. Keys stay short camelCase (`addTask`, `moved`); `serialize.js` maps the previous
keys of renamed ports so older documents still reconnect.

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

### 4a. Subtypes of `data`

A `data` port may declare a `subtype` — `person | task | tasks | board | milestone | stats |
layout` (`SUBTYPES`, `subtypeInfo`) — so a cable carries meaning: a Person's `person` output only
fits a `people` slot, a board's `tasks` output fits a Timeline's `tasks` slot, never the other way
round. `compatiblePorts(fromPort, toPort)` is what the world, the engine and the connection use:
base types as `compatible`; `any` on either side ignores subtypes; two subtypes must match; a
subtyped input takes a plain `data` output only when its definition says `loose: true` (the
Timeline's `tasks` and `milestones` slots are loose so a Data node can still feed them).
`portTypeName(port)` ("person") and `portTypeText(port)` ("data · person") label tooltips, the
midpoint label and the panel; `mismatchReason(from, to)` explains a refusal ("person is not a
tasks"). Subtypes have their own hues in both palettes (`theme.subtypes`, `portColorFor(type,
subtype)`): person coral, task / tasks green-teal, board indigo, milestone gold, stats grey-blue,
layout lavender; a subtyped port, its cable and its legend swatch all use that colour.

### 4b. Multi-input sockets

A `multi` input is drawn as a vertical rounded rectangle (`shape: 'slot'`, Blender's
multi-input socket) instead of a sphere: height = pad + slot height × max(1, cables); each cable
ends in its own slot, stacked top to bottom in connection order (`Connection3D.slotIndex()` →
`port.getWorldPosition(target, index)`), so cables never overlap at the socket. The rectangle is a
hollow outline while empty, shows a filled bar per connected slot, and grows a spare slot with a
"+" while a cable hovers it (`setHover` / `'glow'` emphasis). `World.addConnection /
removeConnection` call `port.setLinkCount(n)`; a change rebuilds the geometry and calls
`owner.relayoutPorts()`, which re-places every port from its `basePos` so the ports (and labels)
under a grown socket shift down (shapes, devices); on a `Node3D` it re-stacks the side along the
edge (`stackPorts`, §7c) and extends the card downward only for what no longer fits (top edge
stays, footer moves, `bodyOffsetY` keeps `getAABB` honest). Event multi inputs stack chevrons the
same way.

## 5. Engine (`core/engine.js`)

`Engine.tick(dt)` runs once per frame (`engine.emit(instance, key, payload)` queues a pulse on
an **output**; `engine.trigger(instance, key, payload)` queues one on an event **input** — the
mini toolbar's Run on an Action or a Flow Step — which the node sees on the next pass exactly as
if an upstream output had fired, once):

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
transform, setParam, setTitle, setEnabled, setShowPorts, addGroup, removeGroup, setCollapsed,
setGroupTitle, duplicate` and `composite`. `setShowPorts(world, nodes, true | false | null)` is
the per-block ports override (§7c) — the panel eye, *View → Ports on selection* and the mini
toolbar all go through it, so it undoes. `disconnect.do` tolerates a link the interaction layer already lifted
off the world (a cable end being dragged); `reroute(world, conn, from, to)` removes `conn` (if
still present) and creates the new link, its undo puts the original object back. `History.execute` pushes; `executeCoalesced(key, cmd)` merges rapid edits with
the same key (typing in a param field, dragging a transform field). `undo / redo` are bound to
`Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y` and the ↶ ↷ buttons. Removing a node keeps the instance alive
(not disposed) so undo can re-add the very same object with its connections.

## 7b. Body geometry (`geometry.js`)

Every body is one shape, `panelGeometry(w, h, depth, { radius, bevel, bevelSegments, curveSegments })`:

1. the **outer** size `w × h` is what the caller asks for; the 2D `THREE.Shape` is a rounded
   rectangle (`roundedRectShape`, arcs not quadratics) shrunk by the bevel on each side, with its
   corner radius reduced by the bevel, so that after extrusion the outset walls land exactly on
   `w × h` (radius defaults to 18 % of the short side);
2. `ExtrudeGeometry` with `depth − 2 · bevel`, `bevelEnabled`, `bevelThickness = bevelSize =
   bevel` (0.02 by default, clamped to 60 % of the radius and 30 % of the depth), two bevel
   segments and 12 curve segments (6 on port sockets, 8 on pills). In three.js the **caps are the
   outermost layers** (the original contour at `z = −bevel` and `z = depth − bevel` before
   centring) and the bevel curves inward from them to the outset walls, so the front face is flat
   and crisp and only the bevel is curved;
3. the geometry is translated so it is centred on `z = 0` (front face at `+depth / 2`), normals
   recomputed, `type = 'PanelGeometry'` and `userData.panel = { w, h, depth, radius, bevel, capW,
   capH }` recorded for tests and rebuilds;
4. **UVs**: a custom `UVGenerator`. `generateTopUV` maps a cap vertex to `(x / capW + 0.5,
   y / capH + 0.5)`, so the front cap spans exactly 0..1 and a canvas texture lands corner to
   corner; `generateSideWallUV` gives the walls and bevel a single neutral texel `(0.5, 0.02)`.
   ExtrudeGeometry emits two material groups — 0 = caps, 1 = walls + bevel — so a mesh may take
   `[faceMaterial, sideMaterial]`; board cards do (their canvas is the front-cap `map` +
   `emissiveMap`, the sides are a plain satin panel).

`slabGeometry(w, d, thickness)` is the same shape rotated to lie flat (plinths, device bases,
group frames); `outlineGeometry(w, h, depth, grow)` is a panel `grow` (0.08) larger with a tiny
bevel, rendered `BackSide` as the thin selection / hover / error outline (`materials.rim`).
Materials come from `theme.materials`: `panel()` is a `MeshPhysicalMaterial` with roughness 0.45,
clearcoat 0.4, clearcoat roughness 0.3, no metalness and `envMapIntensity` 0.45; `device()` is a
touch smoother; `frosted()` is the translucent column panel; `face()` is the canvas material
(`emissiveMap` + `map`, transparent so `faces.clear()` can round the corners). The environment
that makes bevels read is built in `workspace.js → buildEnvironment()`: a 128 × 64 equirect canvas
(sky / horizon / ground gradient from `palette.env` plus one soft highlight) through
`PMREMGenerator.fromEquirectangular`, set as `scene.environment` and rebuilt on theme change.
`RoundedBoxGeometry` is no longer used anywhere in `src/` (the `h.RoundedBoxGeometry` helper is
kept for add-ons).

## 7c. The Wiring switch (`wiring.js`)

`isWiringOn()` / `setWiring(v)` / `toggleWiring()` / `onWiringChange(cb)`; persisted in
`localStorage["proto3d.wiring.v1"]` (default **off** for a new visitor) and in documents
(`serializeWorld` writes `wiring`, `loadWorld` applies it). Propagation:

- `Block3D` subscribes in its constructor and keeps `showPorts: true | false | null` (the
  per-block override, set from the eye icon in the panel header, the mini toolbar's Ports button
  or *View → Ports on selection*, always through `cmd.setShowPorts` → `setShowPorts`, saved as
  `showPorts` in the node record). `portsVisible` = override ?? global. `applyWiring()` sets
  `visible` on every port group and port label (tracked in `wiringLabels` so `_applyLOD` never
  re-shows them) and calls `_onWiringChange()` once when the state flips. **No body changes size
  with the switch**: ports sit beside the content, so a card is the same card with pins or without;
- `Connection3D` defines `visible` as an accessor: what the owner set (collapsed groups hide
  internal links) AND `cableVisibleFor(conn)` — true when wiring is on or when both blocks show
  their ports; a preview with a free end is always visible. Tour ghosts and previews therefore
  work while the switch is off;
- `Group3D` hides its proxy ports and labels with the switch;
- `Interaction._allPorts()` lists only ports on blocks whose `portsVisible` is true, so hidden pins
  are never picked, hovered, snapped to or emphasised; `_tubeMeshes()` already reads `c.visible`;
- `main.js` owns the quick toggle (`#btn-wiring` in the menu bar), the `P` key, the toast and `syncToolbar`; the panel
  shows the checkbox in the workspace section; the tour sets wiring on for steps flagged
  `wiring: true` and restores the previous value in `finish()`.

**Node layout** (`Node3D._layout`, `stackPorts` / `alignPorts` in `block3d.js`). The card is
header + content band + footer; the band holds the face with its margins (or a small spacer on a
faceless card). The ports of each side sit on the left / right edge **beside the band**: stacked
and centred on it at `sizes.port.gap` pitch, compressed down to `sizes.port.minGap` when the band
is short; a definition whose busier side still does not fit gets a taller band from
`nodeDimensions(def)` (computed once, independent of wiring). The reference height `_h0` is that
card and the node origin is its centre; the top edge stays at `+h0 / 2`. Grown multi-input slots
(`extraHeight`) push the ports below them down: the stack first slides up along the edge inside
the band and only what still does not fit (`overflow`) extends the card downward (never under
the floor) — `bodyOffsetY` = the body centre, so `getAABB` stays honest for routing and framing.
The wiring switch never re-lays out anything.

**Port anchors** (`alignPorts`). A cable should visibly point at what it changes, so a face may
say where each port's data lives: `def.face.portAnchors({ w, h, params, state, inputs, instance })`
returns face-logical y (px from the top of the face, the same coordinates `render` draws in) per
port key — flat (`{ in: 216 }`) or split (`{ in: { progress: 101 }, out: { progress: 206 } }`)
when a key exists on both sides. `Node3D._portAnchors` converts them to card units and
`alignPorts(list, anchors, top, bottom)` places the side: a port without an anchor keeps its
`stackPorts` position, the set is sorted top to bottom by target (definition order on ties) and
neighbours closer than `sizes.port.minGap` are nudged apart (a grown slot counts its extra height
below it), kept inside the band; a set that no longer fits keeps its top and reports `overflow`
like a stack. Each port records `anchorY` (the target, or null). Anchors are definition-side —
nothing is saved. The Display's pin points at its value line, the Prompt's `variables` / `text`
at the first lines of the prompt and its output at the middle of the text, the Generate faces'
`prompt` at the prompt preview, `run` / `when done` / `usage` at the Run button row, the
Dashboard's inputs at the panel each one fills (tiles, ring, header line, side tile), the
Checklist's `progress` at its bar and `when complete` at the list. Custom bodies use
`body3d.portAnchors(node)` in body units (§8b): the Kanban board's `people` slot sits at the first
swimlane header (the column header row without lanes), `milestone` at the header line, `cover`
at the top card, `add task` at the "+" tiles, `progress` at the column counts, `tasks` and the
events at the cards; the Timeline's `tasks` / `overdue` at the first bar row, `milestones` /
`next milestone` at the flags on the rail. Devices keep their centred stack.

**Port names** are hidden by default. A name fades in over `NAME_FADE` (0.12 s,
`Block3D._fadeNames`) while its port is hovered, while its cable is hovered, while it is a
compatible target of a hovered port or a dragged cable (`nameMode` 'full'; incompatible ports
show a dimmed name only during a drag, 'dim' = 40 %) and while its block is selected (all of that
block's names); the interaction layer sets `nameMode` in `_recomputeEmphasis`, the block reads
`selected` / `hovered` itself. Names still sit outside the body (`_placePortLabel`) and never
show at the far LOD or with wiring off.

## 7d. Drop-to-link (`pm/relations.js`, `interaction.js`)

Relationships without cables. While a single block is dragged, `Interaction._updateBlockDrop`
first tests child pickables (`body3d.acceptsDrop` — a Person over a card assigns it), then the
bodies and faces of every other block; on a hit it asks `dropLinkCandidates(dragged, target,
world)`: every `dragged.output × target.input` pair that matches a row of `DROP_LINKS`
(`'fromType.port>toType.port'`, `*` for any type, `*.screen` for the four devices), plus the
generic flow rule (an event output named `out | next | yes | no | done | tap | trigger | reached`
onto an event input named `in | start | trigger`). Pairs that already exist, would replace the
cable on an occupied single input, or fail `world.canConnect` are dropped; each candidate carries
the sentence from `describePorts`. The target block lights (`setDropTarget`) and the drag label
shows the sentence (one candidate) or *"N ways to link · choose on drop"*. On release the dragged
block springs back to where it was; one candidate runs `cmd.connect` (undoable) and toasts the
sentence; several open `Overlays.chooser(items, { x, y, title }, onPick)` — a small popover at the
drop point that closes on pick, Esc or a click outside.

## 8. Scene objects

- **`Block3D`** (`block3d.js`): shared base — uid, definition, params, state, enabled, ports,
  rim, contact shadow, canvas labels, optional face (`_initFace`, `renderFace`, `onFacePointer`,
  `emit`), derived state / hover / selected visuals, LOD blend, `getAABB` (routing), `footprint`
  (group frames, ghosts, free-slot search), `serialize`, the wiring state (`showPorts`,
  `portsVisible`, `applyWiring`, §7c).
  **Ports** (`createPort`): a stem plus a typed pin — `shape: 'chevron'` (an extruded pentagon
  pointing +X, the flow direction) for `event`, `'slot'` (a growing rounded rectangle, §4b) for
  multi inputs, `'sphere'` for every other value — and a back-face `shell` of the same geometry. The look is derived in `applyLook()` from four flags:
  `connected` (filled, bright) vs not (dark core + coloured shell = hollow ring), `hovered`
  (×1.5), `disabled` (grey) and `emphasis` (`'glow'` pulsing rim for compatible targets,
  `'dim'` 35 % for incompatible ones, `'reject'` red ring under the pointer). Optional ports are
  scaled 0.85, multi ports 1.15 with a "+" glyph. `_addLabelledPort` / `_placePortLabel` put
  the name just **outside** the body: past the pin and lifted `sizes.port.labelLift` above the
  wire's axis, so it reads like a net label and never covers face content (`portLabelSide`
  'outside', the default; 'inside' is for plain slabs). Names are dim, ellipsised past
  `sizes.port.labelMax` units, hidden until hover, cable drag or selection (§7c) and never shown
  at the far LOD or with wiring off. There are no IN / OUT captions: pins on the left are inputs,
  on the right outputs. `proxy` redirects the world position while the owner sits in a collapsed
  group.
- **`Node3D`**: an extruded card (`panelGeometry`, depth 0.16, radius 0.32) with a slim accent
  line in the category colour along the top edge (`accent`, also exposed as `header` for older
  callers), a left-aligned title and a small-caps kind label, the content band (the face) with
  the ports stacked on its left / right edges, and a footer. Height = header + band + footer,
  the same with wiring on or off (§7c); width by `size` (S 3.6, M 4.6, L 6.4 units). Far LOD:
  detail labels fade, the title lifts above the card, centres and scales with distance.
- **`Device3D`**: form factors from `sizes.device` (thin bezels, `radius`), slabs are panels, bases
  are flat slabs; the screen plane is the face (emissive canvas, full bleed).
- **`Connection3D`** + **`routing.js`**: tube along the routed curve, one continuous flow sheen
  (shader), rings at both ends, outline for hover / selected, `far` for LOD. Either end may be a
  **free point** instead of a port (`from` / `fromPoint`, `to` / `toPoint`; `complete` is true
  for a real link) — that is the preview while a cable is dragged forwards or backwards
  (`setPreviewPoint(side, p)` / `setPreviewPort(side, port)`). A hidden fat `pickTube`
  (radius ≥ 0.16) plus the two rings are what the raycaster tests, so a 1-px cable is easy to
  hover; `endNear(point)` says whether a hit lies within `sizes.connection.grabReach` (0.9) of an
  end. **Emphasis**: `_applyDim` derives a target level from `dimHover` (another cable is
  hovered, 25 %), `dimSelect` (a block this cable does not touch is selected, 25 %) and
  `highlight` (a port or end of this cable is hovered: full strength whatever else is selected),
  plus `hovered` / `selected` (full); `update(dt)` eases `uniforms.dim` towards it over ~0.15 s
  and scales the flow speed with it (a dimmed cable's sheen slows to a crawl), so the emphasised
  paths are the ones that move. `setEndHover(end)` enlarges the grabbed ring. Rebuilt only when
  an endpoint moved, the world `layoutVersion` changed or the radius changed.
- **`CableChips`** (`cable-chips.js`): value chips at cable midpoints. A chip is a fixed-size
  canvas `THREE.Sprite` (faces the camera, `depthTest` off, Inter, theme tokens): a type glyph in
  the cable's colour (dot for values, chevron for events) and `chipText(value, type, subtype)` —
  numbers formatted, text cut to 24 chars, booleans on / off, an event as `pulse` (`· payload
  name` when it has one; `no pulse yet` before the first) with a 0.35 s flash and scale bump when
  one passes, data as `{3 keys}` / `[12 items]`, media as `kind · title`, project kinds by name
  (`person · Maya Chen`, `12 tasks`, `stats · 2/10 done`, `milestone · Public launch`). A hovered
  or selected cable adds a second, dimmer line with the endpoints (`Prompt.prompt → Generate
  Text.prompt`). Chips show for the hovered cable, the selected cable and every cable of a
  selected block (the union for a multi-select; `anySelected && !dimSelect`), never at the far
  LOD, at most `max` (40) nearest to the camera. `update` recycles chips by connection and
  repaints a canvas only when its signature (text, second line, colour, flash, theme) changes;
  the text is recomputed when the source port's `changedAt` / `lastPulseAt` moves, not per frame.
  The canvas is never resized (WebGL allocates a texture's storage at the first size it sees);
  the on-screen text height is clamped to 12–22 CSS px, world-sized in between. The DOM
  `#conn-label` under the cable keeps only the type and the link sentence (`describeLink`), or
  the mismatch reason for an invalid link.
- **`Group3D`** (`groups.js`): frame (flat slab fill + ring) sized from members' footprints
  every frame, title at the front edge; `setCollapsed` hides members and internal links, builds a
  panel slab with an accent line and proxy ports for boundary links (`inner.proxy = proxyPort`),
  `refreshProxies` on connect / disconnect; proxies follow the wiring switch.
- **`faces.js`** — the face design system (§8c): `clear` (rounded face card), `drawCaps`,
  `drawDivider`, `drawTile`, `drawChip`, `drawBar`, `drawAvatar`, `drawStat`, `fitLine`,
  `tabular`, `drawText`; `drawValue` dispatches on `kindOf` (text, number, boolean chip, JSON,
  media, media list, media layout); `drawMedia` (image / video poster with progress / audio
  waveform); `drawMediaGrid` + `gridShape`; `drawScreen` for devices; bitmap cache with
  `onBitmapReady`; `beginFields` registers the regions a face lets the user edit in place (§8d).
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
| `ports(node)` | once | `{ in: [[x, y, z]], out: [...] }` — explicit pin positions, same stem + pin + label anatomy as nodes |
| `portAnchors(node)` | `layoutPorts` (construction, resize, a body's `refresh` when its regions moved) | `{ key: y }` or `{ in, out }` in body units: each pin level with the content it affects (`alignPorts`, §7c); without `ports` or anchors the ports are stacked on the left / right edges, centred on the body (`stackPorts`) |
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
change — a 3D drag, a panel field, an `add task` pulse, a card dropped on a Person — is one
`setParam('board', next)` produced by the pure functions in `pm/model.js` and committed by
`pm/board-ops.js` (`commitBoard`), which also pulses `when a card moves` / `when a card is done`. Undo therefore restores cards, columns and positions in one
step, serialization needs nothing new, and `duplicate` clones a board with its cards. The
burndown history is per-instance `state` (saved, not undoable). Timelines keep their own tasks in
`params.tasks` the same way; fed tasks are read from `rt.inputs` and never written.

**Relationship-driven layout (`kanban-board.js`, `pm/relations.js`).** The board's `people`
slot changes how it is drawn: `peopleMode(node)` reads `connectedPeople(node)` and the `people
view` param (`auto` = swimlanes for 2+ people, highlight for 1; or `highlight` / `filter` /
`swimlanes`). Highlight dims the other cards to 30 % and tags the connected people's cards with
their colour; filter shows only theirs; swimlanes draw a horizontal lane per person across every
column (cable order) plus an *Unassigned / others* lane, and the board grows taller
(`dims(node)` → `colHeightFor(lanes)`; the bottom stays anchored at −H0/2 so the plinth keeps
standing on the floor while `bodyOffsetY` shifts the AABB). Dropping a card into another
person's lane re-assigns it in the same undoable command. A card dragged onto a Person block
(`_personUnderRay`) or a Person block dragged onto a card (`interaction._updateBlockDrop` →
`body3d.acceptsDrop / onDropBlock`) assigns the card (`Assign card`). The board's `evaluate`
hashes the relationships that affect its look (people, `people view`, the milestone on its
`milestone` input) on the instance (`_relSig`) and sets `faceDirty` when they change. **Link
sentences**: `describeLink(conn)` (a table keyed by `type.port>type.port`, overridable per
definition with `describeLink`) feeds the midpoint label, the connection panel and the toast
shown when a cable is created.

## 8c. Face design tokens (`theme.js`, `faces.js`)

Faces are canvases at `sizes.face.pxPerUnit` = 120 px / unit. That is the **logical** coordinate
system every renderer draws in and every hit-test reads (`face.cw × face.ch`); the bitmap behind it
is scaled like a HiDPI DOM canvas (`face-canvas.js`: `canvas.width = cw × scale`,
`setTransform(scale)`). A surface starts at `min(devicePixelRatio, 2)`; each frame the LOD pass
(`lod.js → fitFaceResolutions`) computes the device pixels one world unit covers at the block's
distance (perspective fov + drawing-buffer height, or the orthographic frustum), ranks the blocks
that own canvas surfaces by that ratio and calls `Block3D.fitFaceResolution(ratio, allowance)`,
which picks a tier from `sizes.face.tiers` (0.5 … 4×, hysteresis `sizes.face.hysteresis`, bitmap
side ≤ `sizes.face.maxSide`) and re-bakes every surface on the block once when the tier changes:
the face, a device screen, and board cards / timeline bars made with `makeCanvasPlane(w, h, { owner })`.
Only the nearest on-screen blocks may exceed 1× (`sizes.face.nearBudget`: 6 up to 4×, 16 up to
2×), far and off-screen faces drop to 1× or 0.5×, and at most `sizes.face.rebakesPerFrame` blocks
redraw per frame so a camera sweep never hitches. Texture anisotropy comes from
`renderer.capabilities.getMaxAnisotropy()` (`theme.js → gpu`). The tokens every component reads:

| token | dark | light | use |
| --- | --- | --- | --- |
| `faceBg` | `#161d2a` | `#ffffff` | the face card (`clear`, rounded corners `RADIUS` 18 px, transparent outside) |
| `faceCard` | `#1f2838` | `#eef0f3` | inner tiles, chips, tracks |
| `faceLine` | `rgba(255,255,255,.08)` | `rgba(28,33,48,.12)` | 1 px dividers, bar tracks, ring tracks |
| `faceEdge` | — | `rgba(28,33,48,.16)` | hairline `clear()` strokes around the face card (a white face on a near-white body needs an edge) |
| `faceText` / `faceDim` | `#eaf1ff` / `#8b9ab5` | `#1c2130` / `#5f6675` | primary / secondary text (≥ 4.5 : 1 on the face in both themes) |
| `faceAccent` | `#5aa9ff` | `#2b7fe0` | the one accent (bars, rings, links) |
| `faceGood` / `faceWarn` / `faceBad` | `#34c99a` / `#f5b942` / `#ff5c6c` | `#13906a` / `#b8830c` / `#d93848` | meaning only: done, soon, overdue / over WIP |
| `categories.*` | saturated hues | darker hues | the accent line on a node, flow shape tint, LOD bars |

**Why the light palette is layered the way it is.** The floor is an unlit shader (its colour is
the token, no tone mapping), while bodies and faces are lit and go through ACES filmic tone
mapping, which compresses whites: a white body under the dark theme's lights renders around
`#e0` and a white face at emissive 0.55 around `#d4` — darker than the body — so in round 6 the
light room read as one wash of near-identical greys (body vs floor 1.06 : 1, face vs body 1.11 : 1
with the face the darker one). The fix keeps the three surfaces in a fixed order — **floor pool
(mid grey `ground` 0xc6ccd4, fading to `bg` 0xdfe3e8) < body (near white) < face (white with a
hairline)** — and gives the light palette render tokens that leave the dark theme pixel-identical
(`exposure` 1.2 / `keyLight` 2.0 / `faceBoost` 1 / `fogScale` 1 / `poolScale` 1 there):
`exposure` 1.5 and `keyLight` 2.6 lift the lit surfaces (`workspace.js` reads them on boot and on
theme change), `faceBoost` 2.4 multiplies every face material's emissive (`materials.face` records
the base value, `retuneFace` re-applies it in `Block3D.refreshTheme`, `Node3D` scales its state
and LOD intensities by it), `faceEdge` strokes the face card, `fogScale` 0.55 thins the fog and
`poolScale` 1.7 widens the floor pool so far blocks stay on the grey mat. Sampled on the Showcase
after the change: node body vs floor 1.31 : 1, board vs floor 1.49 : 1, face brighter than the body
with the hairline drawing the edge, grid line vs floor 1.85 : 1, face text 14 : 1. The CSS tokens
(`--bg`, `--panel-solid`, `--field-solid`, `--dim`) follow the same cooler greys so the shell and
the room agree.

Type: `typography.family` (Inter → SF Pro Text → Segoe UI → system-ui), `typography.scale` (title
30 / subtitle 18 / label 17 / value 17 / small 14 / caps 12 / big 44 px), weights 600 / 500 / 400,
`capsSpacing` 0.08 em. Spacing: `PAD` 24 px margins on an 8-pt grid (`GRID`). Rules: structure by
spacing and dividers, not boxes; tiles for sections; chips for tags and people; thin rounded bars
(4–6 px) for progress; tabular numbers right-aligned; muted timestamps; colour only for meaning.
Components: Person (avatar · name / role · load bar · tasks grouped by small-caps column with a
3-px priority stripe and muted dates), Checklist (progress caps + bar, rows with 20 px rounded
boxes and dividers), Dashboard (board title · stat tiles · ring + column bars · burndown tile ·
people / checklist tile), board cards (`drawCard`: edge-to-edge on the extruded card, 3-px
priority stripe, title 600, assignee avatar, due, checklist bar, tag chips, estimate), timeline
bar faces (title on the bar), device screens (`drawScreen`: flat gradient, slim status bar).
Canvas labels (`makeLabel`) share the family and support `caps` + `spacing` for small caps (column
titles, kind labels).

## 8d. Face fields: editing in place (`faces.js`, `block3d.js`, `ui/field-editor.js`)

The properties panel is optional for the text a face shows: a renderer declares **fields** and the
user edits them where they are drawn. In `render`, `const F = beginFields(instance)` resets the
block's list and `F.add(spec)` registers a region; a custom body lists its regions from
`body3d.fields(node)` (body units) and a face may also compute them on demand in
`face.fields(ctx)`. A spec is

```
{ id, kind: text | multiline | number | select | date | checkbox | action,
  param: 'key' | prop: 'title' | get(block) / set(value, api),         // the value; set gets { history, world, selection, block, cmd }
  rect: { x, y, w, h }            // face px (origin top-left), the coordinates render draws in
  | local: { x, y, w, h, z? }     // body units, centre-based (a card title, a flag's date)
  font?: { size | labelSize, weight, align, color, mono, lineHeight }, bg?,   // how the editor is typeset: the face's own type and colours
  placeholder?, options?, min?, max?, step?, validate(v) → message | null, parse(text) → value, format(value) → text,
  mode?: edit | open | through | delay, label?, sub?, run?(block, api) }
```

`F.add` returns the spec with `editing` set while the editor is open on it, so the renderer leaves
that text out (`if (!F.add({…}).editing) drawText(…)`) and nothing doubles up; a body reads
`node._editing` (`Block3D.setEditing`, which also marks the face dirty) for the same purpose.
`Block3D.fields()` merges the three sources, `fieldAt({ uv, point })` hit-tests them (face fields by
canvas uv, body fields by the hit point in local space; the smallest region wins, so a chip inside a
text block is picked over the block) and `fieldCorners(field)` gives the world corners the editor
projects. **Modes** decide what a press does: `edit` (default) captures the press — never a block
drag — a click selects, a double-click edits, a click on an *empty* field with a placeholder edits;
`open` edits on a single click (the checklist's and the board's "+" rows); `through` leaves presses,
drags and clicks as they were and edits only on a double-click (cards still drag, the Input button
still fires); `delay` captures the press and hands a single click to the face after the double-click
window (a checklist row still toggles) unless a second click arrives (`Interaction._fieldClick`,
`DBL_MS` 300). `Enter` with one block selected opens its first field.

**The editor** (`FieldEditor`, `#field-editor`, `#field-hover`): hovering a field shows a faint
accent outline over its projected rect and a text cursor (hidden at the far LOD and while anything
is dragged, `Interaction.fieldBusy`). `open(block, field)` builds an HTML control — a textarea that
grows with its content for text and multiline, a text input with ↑ ↓ nudges (`step`, Shift ×10) for
numbers, a themed list for select, a date input, nothing for a checkbox (it toggles at once) or an
action (it runs: the Generate model chip opens the model browser) — and every frame `_place`
re-projects the four corners (`screenRect`), so the box follows the camera in 3D and in the plan.
It is sized to the region and typeset like the face: Inter (or the mono stack), the face font
scaled by css px per face px at that spot and clamped to **11–28 px** (`FONT_MIN / FONT_MAX`; when
the clamp raises the type the box grows around the region's centre), the face background and text
colours (`--fe-bg`, `--fe-color`, or the field's `bg` / `font.color`: a note keeps its paper, a
card its card colour), an accent focus ring and a small hint pill (*Enter saves · Esc cancels · Tab
next*). Enter commits (Shift+Enter is a newline in multiline), Esc cancels, blur commits (an invalid
value is dropped instead), Tab / Shift+Tab commit and open the next / previous field on the same
block (`tabbable`). A commit parses (`parse`, the Data face's JSON) and validates (`validate`); an
error shows under the field and keeps it open. Writes go through `cmd.setParam` (label *Edit
<label>*), `cmd.setTitle` for `prop: 'title'`, or the field's own `set` (boards use `commitBoard`,
the timeline its task command), so every edit undoes and the panel's live fields show it; an
unchanged value leaves no history entry. While open, `Interaction.editing` hides the mini toolbar
and `isTyping` keeps the workspace shortcuts off. Fields are wired on: Sticky Note (text, unless fed),
Text (text in source mode, template in template mode), Data (JSON in value mode, with a face),
Input (the button label, `through`), Display (caption), Person (name, role), Prompt (the template
as multiline plus every variable chip as its name), the Generate faces (the fallback prompt while
nothing is connected; the model chip as an action), Checklist (item text, `delay`; a "+" row that
adds an item), Kanban board (card titles and column titles, `through`; the "+" tile types the new
card's title), Timeline (its own bars' labels), Milestone (title, date) and the flow shapes
(their label = title).

## 9. Interaction model (`interaction.js`, `ui/overlays.js`, `ui/tour.js`, `selection.js`, `gizmo.js`, `lod.js`)

**Navigation** (`controls/`): `Navigator` replaces OrbitControls with the same surface (`target`,
`update()`, `enabled`, `minDistance` / `maxDistance` / `maxPolarAngle`, damping, `start` / `end`
events) and reads its bindings from the active **preset** (`presets.js`: `PRESETS.blender |
unreal | maya | simple`, each `{ mouse: [{ button, mods, action }], wheel: { plain, shift, ctrl },
keys: { action: ['Code', 'Mod+Code'] }, addModifier, fly?, settings }`). The `nav` facade is the
single decision point: `resolveMouse(e)` → `orbit | pan | dolly | turn | marquee | marqueeAdd |
contextSelect | null`, `resolveWheel(e)`, `keyAction(e)`, `isAddModifier(e)`, `sheet()`
(the generated cheat sheet), `binding(action)`; the preset id and per-preset settings (invert
orbit / zoom, sensitivities, zoom to cursor, fly speed) persist in `localStorage["proto3d.nav.v1"]`
and `nav.onChange` re-renders the panel section, the help sheet and the tour hint. The controller
handles pointer / wheel / key events on the canvas: orbit and turn deltas, screen-space pan scaled
to the target distance, dolly (drag or wheel, optionally towards the cursor by shifting the
target along the cursor plane), Unreal fly (right-drag + WASD / QE moves camera and target
together; the wheel scales `flySpeed` while flying), numpad views (`viewTo(theta, phi)` animates
the spherical angles over 0.45 s), 15° steps (`rotateBy`), and the orthographic toggle
(`setOrtho`: swaps in an `OrthographicCamera` whose frustum is derived from the orbit distance
every frame, and notifies `ws.onCameraSwap` listeners — interaction, overlays and the gizmo follow;
`ws.camera` is a getter). Damping is frame-rate independent (`dampingFactor` per 60 Hz frame);
`moving` reports whether anything is still settling. The interaction layer asks the same facade:
a press on empty space starts a marquee only when the preset says so (Blender / Unreal / Maya:
plain left-drag; Simple: Shift+left-drag), the add modifier decides toggling, `contextSelect`
(right-click in Blender / Maya) selects and opens the panel, and `_presetKey` handles the preset's
key actions (focus, frame all, views, ortho, steps, select all / none, delete, duplicate + move,
gizmo modes, panel) before the fixed shortcuts. The controller ignores a press the interaction
took (it disables `controls` while dragging a block, as before).

**Picking** (`pick()`): ports on blocks that show them (pin + shell meshes) > sub pickables > faces > bodies > connections
(the `pickTube` and the end rings; the hit carries `end: 'from' | 'to' | null` from
`Connection3D.endNear`) > group frames. A hit on a face, sub or body is first asked for a **field**
(`_fieldAt` → `Block3D.fieldAt`, §8d): a field whose mode is not `through` captures the press
(`pressField`, no block drag), and a double-click on any field opens the editor. Otherwise faces
receive `{ type: down | drag | up | click, u, v }`
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
and `update(time)` pulses the glowing set each frame. The same pass sets every port's `nameMode`
(§7c: the hovered port, the ports of a hovered cable, compatible targets and — during a drag —
dimmed names on incompatible ones) and `Connection3D.setHighlight` on the cables of a hovered
port or the hovered cable, so they brighten even while another block's selection dims them. Step 1
of the tour reads the preset's orbit / pan bindings; steps 2, 3 and 5 set the wiring switch on
and `finish()` restores it.

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
selected nodes (plus members of selected groups) keep their cables at full brightness, show all
their port names and get a value chip on each cable (`CableChips`); every other cable eases to
`dimSelect` (25 %, flow slowed); each cable leaving the set is labelled at its far end through
`Overlays.setEndLabels` (`→ To.port` at the input end, `From.port →` at the output end). A
selected cable dims the others, its chip carries the endpoint line and the DOM label under it
(`main.js → updateConnectionLabel`) shows `type · link sentence` when there is one.

**Overlays** (`ui/overlays.js`) own the HTML layers — tooltip (anchored to a world position and
re-projected per frame, optional delay), drag label beside the pointer, toast, cable end labels
(DOM rebuilt only when the label set changes), empty-scene hint (driven by `world.onChange`).
**Overlays** also own the **chooser** popover (`chooser(items, { x, y, title }, onPick)`, §7d).
**Tour** (`ui/tour.js`): seven steps with a spotlight (`.tour-spot`, a box-shadow cut-out that
follows a DOM rect or a projected world point) and a card; step 1 spots the Start panel's card
while it is open (and talks about picking a template), else the Add rail; step 2 picks a real output port with
a compatible, preferably unconnected, input on another block, frames both and animates a ghost
`Connection3D` from the output to the input; step 3 frames the board with its people and spots
the `people` slot; step 4 frames the board and spots its first card; step 5 spots a cable's
input end. The backdrop does not capture pointer events. Seen state is
`localStorage["proto3d.tour.v1"]`; **Help → Take the tour** replays it. A new visitor lands on the
Start panel, so the tour starts after the first template they open (`main.js → loadExample`)
rather than over an empty room.

`Selection` holds nodes, groups and connections and notifies the panel, the gizmo and the
interaction layer. `lod.js` computes camera distance per node / connection / group with
hysteresis; the blocks animate the crossfade.

## 9b. Menu bar (`ui/menubar.js`)

A 32 px desktop-style bar along the top — *Proto3D · File · Edit · View · Add · Help* on the
left and a row of **quick toggles** on the right — above the Add rail, the viewport and the
properties panel (all three start at `--menubar-h`, so nothing overlaps and the viewport keeps
the whole height under the bar; there is no floating toolbar). The toggles are icon buttons with
tooltips built in `main.js` and handed to `MenuBar` as `tools` (appended after a flexible gap):
undo · redo | wiring (`#btn-wiring`) · flow animation · gizmo | theme · frame all | help & legend
· properties panel | command palette (`#btn-palette`, §9d). `syncToolbar()` keeps their `on` / `off` / disabled / `aria-pressed` state
current (history, wiring, theme, gizmo, panel and help changes all call it); Connections lives in
the File and View menus. `MenuBar` is presentation and keyboard model only: `main.js` hands it
the menus as data, `[{ id, label, items: () => Item[] }]`, and **every item calls the same
function as the toggle, key or panel control it mirrors** (undo goes through `History`, delete
through `Interaction.deleteSelection`, wiring through `toggleWiring`, adding through
`addComponent`), so each edit stays undoable and the toggles, panel and menu never disagree. Items are rebuilt each
time a menu opens, which is how disabled states (*Undo* with an empty history, *Delete* with
nothing selected, *Paste* with an empty clipboard), check marks (theme, grid, wiring, gizmo,
panel, rail, stats), radio groups (navigation preset, gizmo mode, LOD distance, ports on the
selection) and labels such as *Undo Delete 2 items* stay current. An item is `{ label, hint?,
shortcut?, icon?, checked?, radio?, disabled?, run }`, `{ label, items }` for a fly-out submenu
(*Open recent*, *Export*, *Examples*, *Navigation*, one per component category under *Add*) or
`{ sep: true }`. Mouse: click a title to open, hover another to switch, hover an item to open its
submenu, Esc or a click outside closes, a leaf runs after the menus have closed. Keys while open
(captured before the workspace sees them): ← → switch menus, ↑ ↓ move, → opens a submenu, ←
closes it, Enter runs, a letter jumps to the next item starting with it. Below 720 px the titles
fold into one ☰ button whose menu lists the five menus as submenus.

What the menus add beyond the older controls, all in `main.js` and `serialize.js`:

- **Projects.** Every open project is a tab (§10b): *New project* opens one and shows the Start
  panel over it (§9g), *Open…* / *Open recent* / *Examples* open in a new tab unless the active
  tab is an untouched empty project (a starter template names its tab after itself),
  *Save* downloads under the tab's name (`safeFileName`, a dated name the first time) and marks
  it saved, *Save as…* and *Rename project…* ask in a themed prompt, *Version history…* opens the
  drawer, *Close tab* asks about unsaved changes. *Open recent* lists every project in the
  browser's IndexedDB with a thumbnail, its component count and when it was last opened; open
  ones are checked and come to the front. `project.name` (also `document.title`) is the active
  tab's name.
- **Import and clipboard.** `serializeSelection(world, nodes)` is a document holding only those
  blocks plus the links and groups among them (Copy, *Export → Selection as JSON…*);
  `importCommand(world, doc)` is one undoable command that builds fresh instances (new uids),
  their connections and groups and places them to the right of the existing scene (*Import…*,
  Paste, `Ctrl+V` through the `paste` event so the system clipboard can carry a document between
  tabs). *Export → Screenshot* renders once more and reads the canvas as a PNG.
- **Shortcuts** the menus bind: `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O`, `Ctrl+X` / `Ctrl+C`
  (with a selection), `Shift+?` for the shortcut sheet, `I` for the performance stats, `Ctrl+K`
  for the command palette (§9d; a capture-phase listener, so it also works from a panel field),
  `2` for the 2D editing mode, `L` for Auto-layout and `M` for the snap master switch (§9f).
  `Enter` with one block selected edits its first face field in place (§8d).
- **Help pages** (`ui/help-dialogs.js`, on the Connections modal shell): the keyboard shortcut
  sheet (fixed keys from `GLOBAL_SHORTCUTS` plus the active preset's `nav.sheet()`) and About.

## 9c. Mini toolbar (`ui/mini-toolbar.js`)

A 32 px floating toolbar in screen space (`#mini-toolbar`, an HTML overlay — not a 3D object)
above whatever is selected. Every frame `update()` takes the union of the selection's world AABBs
(`Block3D.getAABB`; a group contributes its members, or its slab when collapsed), projects the
eight corners (`projectBox`) and places the bar centred over the top edge with a 10 px gap,
clamped 8 px inside the canvas, **flipped below** the box when there is no room above
(`data-placement="below"` turns the caret), and pushed above (or to the left of) any element in
`avoid()` — the job tray / stats column and the selection readout — so it never covers them; the
menu bar and the panel are outside the canvas rect, so the clamp keeps clear of them by
construction. It is **hidden** the moment anything is in flight — a block, cable, marquee, face or
sub drag, `pendingDetach`, a hot or dragging gizmo, a camera drag (`controls.drag`), camera
damping (`controls.moving`), a flight (`ws.inFlight()`), a component being placed — and fades in
over 120 ms (`.show`, one frame after it is unhidden so the transition runs) when things are still.

The buttons are rebuilt only when their **signature** changes (selection uids, each block's ports
override and visibility, its group's collapsed state, what Run would do), so the per-frame cost
is a string compare and a transform. `actions(items)` returns what applies to *every* selected
item: Duplicate (`Ctrl+D`) and Delete (`Del`) always; **Ports** (blocks only) cycles the per-block
override follow → show → hide, its icon mirroring the current state (wiring glyph = follow, eye =
always shown, crossed eye = always hidden; a mixed selection shows follow); **Collapse / expand**
(`C`) when every item is a group or sits in one; **Run** when every block has a run spec
(`runSpecFor`): a Generate face's Run / Stop button (the toolbar sends the same face click the
pointer would, at the centre of the `_hits` rect, so the label follows the job state), an Input
in button / toggle mode (face click), a Flow Terminal in start mode (`onSubPointer` on the run
disc), or any block with an event input named `run` / `trigger` / `in` / `start` (Action, Flow
Step: `engine.trigger`); **Frame** (`F`); and **More** (`N`), which opens the properties panel and
focuses its first field. Every edit runs the same function as its menu item or key
(`interaction.duplicateSelection / deleteSelection / toggleCollapseSelection / focusSelection`,
`cmd.setShowPorts`), so it lands in `History` and undoes. The bar swallows `pointerdown`, so a
click on it never starts a marquee or clears the selection.

## 9d. Command palette (`ui/command-palette.js`)

`Ctrl+K` / `⌘K` (also *Help → Command palette…* and the search toggle at the right end of the menu
bar) opens a centred overlay on the modal shell (`.modal-backdrop.cmdk-backdrop`, so `isTyping`
keeps workspace shortcuts off while it is open; `anyModalOpen()` includes it). `sources()` is
read each time it opens and merges three kinds of item, `{ id, kind, group, label, hint?,
shortcut?, icon?, disabled?, checked?, run }`:

- **Commands** — `menuCommands(menubar.menus)` flattens the menu model: every leaf with a `run`,
  grouped under its menu label, submenus as *Parent › Child* (*Open recent › Launch plan*,
  *Examples › Showcase*, *Navigation › Blender*, *Gizmo mode › Rotate*…). Items are produced by
  the same `items()` functions the menus use, so *Undo Delete 2 items*, disabled and checked
  states are current at open time; the Add menu's category submenus are skipped (the Add source
  covers them with icons). Disabled commands render dimmed with `aria-disabled` and neither Enter
  nor a click runs them. Ids are stable (`cmd:edit/Undo`) so recents survive label changes.
- **Add** — `Add <label>` for every registry definition, running `addComponent(def, null)` — the
  same placement as a toolbar click (the next free slot around the camera target).
- **Go to** — `Go to <title>` for every block: `selection.set([n])` + `frameBlocks([n])`.

**Ranking** (`scoreItem`): the query is split into words and every word must match; a word scores
`fuzzy()` against the label (prefix 100 > word prefix 80 > substring 60 > subsequence ≤ 40, gaps
and a late start cost points), the hint at 50 % and the group at 40 % (both without the
subsequence rule — scattered letters in a description are not a match); the last eight run ids
(`localStorage["proto3d.palette.v1"]`) add a recency boost (15 → 4.5). Ties break on shorter
label, then alphabetically. With an empty query the recents lead as a *Recent* group, then every
item in source order; the list is capped at 200 rows and grouped by headings. Matched characters
are marked in the accent colour.

**Keys** (`_onKey`, on the overlay): ↑ ↓ move (skipping disabled rows, wrapping), Enter runs,
Esc closes, Tab / Shift+Tab cycle the source filter *All · Commands · Add · Go to* (chips under
the field, also clickable), Home / End when the field is empty; everything else is typing and is
stopped from reaching the workspace. A run closes the palette first, then calls `item.run()`
(like a menu leaf) and records the id. **Focus**: `open()` remembers `document.activeElement`;
`close()` gives focus back to a panel field that had it, otherwise to the canvas (given
`tabindex="-1"` so it can take focus without joining the Tab order), so shortcuts work again at
once. The menu bar's search toggle reflects `isOpen` through `onOpenChange`.

## 9e. Performance stats (`ui/stats.js`)

*View → Performance stats* (`I`, persisted in `localStorage["proto3d.stats.v1"]`) shows a
readout at the bottom right, stacked under the job tray in `#bottom-right` (a flex column, so
either may grow without covering the other). Collapsed it is one line — fps · frame time · JS
heap, colour-coded ok / warn / danger (`--ok`, `--warn`, `--danger`; fps ≥ 50 / ≥ 30, heap < 60 %
/ < 85 % of the limit); hover expands it, a click pins it open. The render loop calls
`stats.frame(dt)` after `renderer.render`; off, that is a single boolean test, on, it records the
frame time and every 500 ms one `_collect()` pass reads the numbers and patches the DOM in place.
What is measured versus estimated:

| figure | source |
| --- | --- |
| fps, frame time, sparkline of the last 60 frames | measured from the render loop's `dt` (rolling 1 s) |
| draw calls, triangles, geometry / texture counts | `renderer.info.render` / `renderer.info.memory` (measured by three.js) |
| est. GPU memory | **estimated**: every unique geometry's attribute + index bytes and every unique texture's `width × height × bytes per pixel` (× 4⁄3 with mipmaps; PMREM half floats count 8 bytes) found by walking the scene — browsers do not expose VRAM |
| GPU name | `WEBGL_debug_renderer_info` when the browser exposes it |
| JS heap used / limit | `performance.memory` — Chromium only; Firefox and Safari show *n/a* |
| device RAM | `navigator.deviceMemory` — a coarse class, Chromium only |
| components, connections, groups, far-LOD blocks, faces above 1× (`faceScale` tiers) | the world and `lod.js` state |
| browser storage | `navigator.storage.estimate()` (usage / quota, every 5 s) and the bytes held in `localStorage` |

## 9f. 2D editing mode, snapping and Auto-layout (`plan.js`, `layout.js`, `ui/guides.js`)

**The plan view** (*View → 2D editing mode*, key `2`, the menu bar toggle `#btn-plan`, the panel's
checkbox and the palette) is a *view* setting held in `plan.js` (`isPlanOn / setPlan / onPlanChange`,
never saved, off at boot). Turning it on does four things at once:

- **Blocks lie flat.** `Block3D.applyPlan` sets `planFlat`; `updateMatrix` then appends a local
  matrix that rotates the block −90° about X around its `planPivot()` (the centre of the front
  face: `(0, bodyOffsetY, depth / 2)`; a device uses its screen slab and a `lift` of 1.2 so the
  screen floats clear of the floor and the cables) and puts that pivot at the origin. The same
  card, canvas, title, pins and sub pickables now face up at `(x, position.y, z)` — inputs still
  left, outputs right, nothing re-rendered, and `position` stays the single source of truth (the
  plan's x / z are the room's x / z, y is untouched). Everything that reads `matrixWorld`
  (raycasts, `worldToLocal` in the board and the timeline, labels) follows; `getAABB` and
  `footprint` swap the card's height into z while flat; contact shadows hide. `Group3D` lays its
  title flat at the frame's top-left, a collapsed slab flat at its spot, and measures members by
  their plan AABBs.
- **Cables go planar.** `Connection3D.rebuild` passes `planar` to `routeCurve`: a cubic whose
  middle runs at `PLAN_CABLE_Y` (0.35) — under the cards, rising only at the ends to the pins —
  lanes fan out in z, no lift, no obstacle avoidance. Chips, dimming, previews, drop-to-link and the
  end labels are unchanged.
- **The camera flies top-down.** `workspace.enterPlan(blocks)` remembers the 3D pose (`planSaved`
  — also what a document saved in 2D writes as its camera), puts the Navigator in `planMode`
  (orbit / turn off: a middle or right button that would orbit pans, `Space` + left-drag pans, the
  wheel always zooms about the cursor with the preset's invert settings, numpad views ignored,
  polar clamp lowered to `PLAN_PHI`) and flies 0.35 s to `planPose` — the target at the centre of
  the blocks' plan AABBs, the camera straight above at the distance whose orthographic frustum
  shows them at 80 % of the visible width / height. On landing it swaps in the orthographic camera
  and sets `planLock`, which holds θ = 0 / φ = `PLAN_PHI` every frame (screen-up is −z, so a card's
  title reads upright). `frameBlocks`, F, Home and *Go to* frame top-down while the plan is on; fog
  is off. `exitPlan` unlocks, restores the projection at once (still top-down, so no visible jump)
  and flies back to the remembered pose.
- **The rest adapts.** `lod.js` keeps every block at full detail (faces still fit their
  resolution), the gizmo is `suspended` (moves are drags), a left press on empty space always
  box-selects whatever the preset, the marquee tests plan AABB centres, the mini toolbar anchors to
  the flat card's projected box, the block tooltip sits past its top edge, `Shift` while dragging
  means "no snap" instead of "lift".

**Snapping** (`snap` in `plan.js`, *View → Snap ▸*, the magnet toggle `#btn-snap`, the `M` key, the
*Snap* section of the Workspace panel, `localStorage["proto3d.snap.v1"]`, 2D and 3D alike). The
settings are a **master switch** (`snap.on`, `set / toggle`) plus independent, persisted toggles
(`snap.setOption(key, v)`, `snap.active(kind)` = master and toggle both on): `grid` with `gridSize`
(one of `GRID_SIZES` 0.25 / 0.5 / 1 / 2 units), `objects`, `ports`, `rotation` and `scale`. The
round-4 shape `{ on, size, fine }` is migrated on load; `snap.summary()` is the one-line state the
toggle's tooltip and the toasts show. While a set of blocks is dragged, `Interaction._applySnap`
decides per axis, the most specific kind winning within `_snapThreshold` (8 px in world units,
clamped 0.12–0.9): on z, **ports** first — among the cables between a dragged block and a block that
stays, the one whose two pins come closest to level (same world z, the axis cables run across;
`_portSnap`) shifts the set so the cable runs straight; then **objects** — an edge or centre (x:
left / right / centre, z: top / bottom / centre) of the dragged set's footprint box that lands within
the threshold of any other visible block's; then the **grid** — the anchor block's centre lands on
`gridSize` (`Ctrl` while dragging halves the pitch). Grid and objects may be on together; everything
off (or the master off, or `Shift` held during the drag) is free movement. The gizmo follows the same
settings (`Gizmo.applySnap`): `rotationSnap` 15° (`ROTATION_STEP`), `scaleSnap` 0.25 (`SCALE_STEP`)
and `translationSnap` = the grid pitch; `snap.rotationValue / scaleValue` apply the steps to a bare
number. The guides live in `ui/guides.js`: an SVG over the window (`#guides`, pointer-events none)
holding world-space segments re-projected every frame — an accent line spanning both blocks for an
alignment, a dashed accent line pin to pin for a port snap, dashed ticks beside the block's centre
lines for a grid snap — set on every move and cleared on release or cancel.

**Auto-layout** (`layout.js`; *Edit → Auto-layout*, key `L`, the mini toolbar with two or more
blocks selected, the palette). `layoutPlan(world, nodes)` arranges the selection (two or more) or
every visible block as a left-to-right layered graph along the cables: an expanded group's members
form a **cluster** laid out first by the same algorithm and placed as one item (so groups stay
contiguous), members of collapsed groups are left alone; edges are the cables among the items,
cycles are broken by dropping the back edges a DFS finds (`backEdges`); layers by longest path from
the sources, order within a layer by eight barycentre sweeps, x by cumulative layer widths plus
`gapX`, z by stacking with `gapZ` then pulled towards the neighbours' mean without overlapping;
items without cables go into a tidy grid below the graph. Footprints are the cards as seen from
above (width × height, `layoutSize`) in both modes, the arranged set keeps its former centre and y
is untouched. `layoutCommand` is one undoable command whose `do` / `undo` glide the blocks with
`tweenTo` (0.25 s, `updateTweens` in the render loop; a dragged block is left alone), so the same
positions read as rows of standing cards in 3D and as a diagram in 2D.

## 9g. Start panel, starter templates and the hint bar (`ui/start-panel.js`, `examples/*`, `ui/hint-bar.js`)

**First run.** With no stored projects (`tabs.init()` restored nothing) `main.js` opens one empty
tab and the **Start panel** over it; the same happens on a reload that lands on an untouched empty
tab and on **File → New**. The panel is a centred card in the viewport (`#start`, `z-index` 4,
`pointer-events: none` outside the card), not a modal: the room behind it stays live. It offers
**Blank project**, the three **starter templates** with a thumbnail, **Open recent** (the closed
projects from `tabs.recent()`, patched into the card when the IndexedDB read resolves), **Open
file…** and **More examples · Showcase**, plus a **Show this panel on startup** checkbox persisted
as `localStorage["proto3d.start.v1"]` (`'0'` = off; `startOnLaunch()` / `setStartOnLaunch()`). It
closes on any pick, on Esc, on ×, when a tab with content becomes active and when anything lands
in the room (`world.onChange` in `main.js`); **Help → Start panel** reopens it (also in the
command palette). While it is open the empty-scene arrow is hidden (`syncEmptyHint`).

**Templates** live beside the Showcase in `src/examples/` and use the same builder API
(`add`, `connect`, `group`): an example object with `template: true`, a `label` (the tab name),
a `description` (the tile), a one-line `hint` (what to try first) and `focus(named)` (what the
camera frames). `examples/index.js` exports `templates` (panel order) and `examples` (templates
then the Showcase, what *File → Examples* lists).

| id | contents | hint |
| --- | --- | --- |
| `project-board` | *Website relaunch* board (3 columns, 5 cards) with two People in its `people` slot (swimlanes), a Milestone into the board, a Timeline and a Dashboard fed by the board's `tasks` / `progress`, the people and the milestone — 6 components, 9 cables | drag a card into Done |
| `ai-pipeline` | a Data source (`{Product.name}`, tagline, audience, colour) feeding two Prompts, Generate Text → Display and Generate Image → Media Grid on the Demo provider, one Run button into both `run` inputs — 8 components, 8 cables | press Run |
| `device-flow` | Input button and Phone `tap` → Action (count) → Compare (≥ 3) → Gate (NOT) → Display; the count's `done` and Compare's result into a flow decision whose *yes* triggers an Action that writes *Unlocked* on the Laptop and whose *no* feeds a Log; the Phone shows the count — 10 components, 12 cables | press the button three times |

`main.js → loadExample(id)` builds the scene through `tabs.replaceActive` (into the untouched empty
tab, else a new one), names the tab after a template, frames `focus`, hides the Start panel and
puts `{ text, dismissed }` on the tab for the **hint bar** (`#hint-bar`, `ui/hint-bar.js`): a
dismissible pill at the top of the viewport that `syncHint(tab)` shows or hides on every tab
switch, so a dismissal sticks per tab and never persists. The first template a new visitor opens
starts the tour.

**Thumbnails** are `assets/templates/<id>-<dark|light>.png` (320 × 200), rendered headless once
by the round's verification script (`scratchpad/tools/shoot17.mjs`: a 640 × 400 viewport with
the rail and panel hidden, `frameAll({ fill: 1.08 })`, downscaled in a canvas) and committed;
the panel picks the file for the active theme and re-renders on theme change, and a missing file
falls back to the category icon (`<img onerror>`). Re-render them when a template changes.

**Adding a template**: a file under `src/examples/` built like the three above, an import and a
row in `templates` in `examples/index.js`, its icon in `TEMPLATE_ICON` (`ui/start-panel.js`), a
thumbnail pair and a row in this table.

## 10. Serialization (`serialize.js`)

```json
{ "app": "proto3d", "version": 2, "name": "…", "savedAt": "…",
  "nodes": [{ "uid", "type", "title", "params", "state", "enabled", "showPorts?", "position", "rotationY", "scale" }],
  "connections": [{ "uid", "from": { "node", "port" }, "to": { "node", "port" } }],
  "groups": [{ "uid", "title", "members": ["uid"], "collapsed" }],
  "wiring": false,
  "camera": { "position", "target" } }
```

`showPorts` is written only when a block overrides the wiring switch; `wiring` is the switch
itself and is applied on load (an autosaved world keeps its setting). The 2D editing mode is not
saved: a document written while it is on carries the remembered 3D camera (`pose` in
`serializeWorld`), and loading a document while it is on keeps the plan (`main.js →
afterLoadInPlan`).

`loadWorld` clears the world, instantiates known types (unknown ids are reported in `skipped`),
reconnects by uid + port key, rebuilds groups (collapsing after their members exist) and restores
the camera. Autosave and the recent list moved to `tabs.js` / `project-store.js` (§10b).

Also in `serialize.js`: `serializeSelection`, `importCommand`, `safeFileName` and
`pickJSONFile({ withName })` (§9b).

## 10b. Persistence: project tabs, autosave and version history (`tabs.js`, `project-store.js`)

**One World, many tabs.** There is a single `World`, `Engine`, `History`, `Selection` and
renderer. Each open project is a *tab* in `Tabs` (`tabs.js`); the active tab's content is in the
world, every other tab keeps its scene objects detached (`World.detach()` removes nodes,
connections and groups from the scene without disposing them; `World.attach()` puts them back —
no render cost, no rebuild, uids and instances survive), its undo / redo stacks
(`History.swap()`), its camera pose (the remembered 3D pose while the 2D mode is on, plus the
plan camera), 2D mode, orthographic flag, selection (by uid) and wiring setting. Switching parks
the active tab (`_park`: capture view, serialize, detach, swap stacks) and shows the next
(`_show`: attach or `loadWorld` from its stored document, swap stacks back, apply the view
instantly, reselect). `main.js` hands `Tabs` hooks for what only it can do: `serialize`, `load`,
`captureView` / `applyView` (2D mode through `setPlanView(on, { instant })`), `beforeSwitch` /
`afterSwitch` (cancel interactions, title, toolbar, panel), `thumbnail`, `confirmClose`,
`download`, `toast`. At most 8 tabs; the 9th is refused with a toast and the "+" is disabled.

- **Dirty** means the document differs from the one last saved (*Save* / *Save as…*) or opened
  (`docHash` of the content: nodes, connections, groups — not the camera, name, time or wiring).
  It is the dot on the tab and what the close dialog (`ui/confirm.js`, Save / Discard / Cancel)
  asks about. *Discard* keeps the project in *Open recent* as it was last saved or opened
  (`baseDoc`) or, for a never-saved project, removes it from the browser.
- **Untouched empty**: a new, unnamed, never edited tab. Documents open into it instead of beside it.
- **Preview**: a read-only tab showing an old version — `history.locked` refuses `execute`, it is
  never persisted, the indicator says *Read-only preview*, the drawer offers *Restore this
  version* and *Close preview*.

**Autosave** (`Tabs._onWorldChange` → `saveNow`) writes the active tab 1.5 s after the last
change (`autosaveDelay`, a test hook) into IndexedDB and reports its state to the strip's
indicator: *Unsaved changes → Saving… → Saved · just now*, *Autosave off* (the switch in the hover
card, `localStorage["proto3d.autosave.v1"]`), *No browser storage*, *Could not save*. `Ctrl+S`
still downloads JSON and marks the tab saved (a manual snapshot follows). A late save never
reports *Saved* over a newer change (a change sequence number).

**IndexedDB `proto3d-projects` v1** (`project-store.js`, best effort — without IndexedDB the app
runs in memory and says so):

```
projects   keyPath id, index openedAt
           { id, name, doc, baseDoc, dirty, view: { camera: { position, target }, ortho, plan, planCamera },
             savedAt, autosavedAt, openedAt, createdAt, thumb (256 px JPEG data URL), bytes, nodes, connections,
             lastSnapshotAt, lastSnapshotHash }
snapshots  keyPath id, index project (projectId)
           { id, projectId, at, kind: 'auto' | 'manual' | 'before', label, doc, bytes, name, nodes, connections,
             summary: { added, removed, renamed, connections, params, moved, groups, first, text } }
localStorage["proto3d.tabs.v1"]  { open: [projectId…], active }   — the open tab set (small settings stay in localStorage)
```

The round-5 keys `proto3d.world.v2` (autosave) and `proto3d.recent.v1` (recents) are migrated
once on boot (`readLegacy`: the autosave becomes the first tab, each recent entry a closed
project) and removed. A reload restores every tab from its record and the active one; background
tabs load their document lazily when first switched to.

**Version history** (`ui/version-history.js`, *File → Version history…*, a right-side drawer over
the properties panel). A snapshot is taken on autosave when the content hash changed and the last
snapshot is older than `snapshotInterval` (2 minutes, a test hook), on every manual save, before
a restore (`kind: 'before'`) and by hand (*Snapshot now*). Each row: time, kind (*Auto*, *Saved*,
*Before restore*, *Named*), size, a one-line diff against the previous snapshot
(`summarizeDiff`: "+2 components · −1 component · 1 renamed · 3 cables changed · 4 params changed",
"First version · 33 components", "No content change") and an optional label (*Name…*; named
versions are never pruned). Actions: *Preview* (a read-only tab), *Restore* (one undoable
*Restore version* command holding both documents, camera kept, a *before* snapshot first),
*Duplicate as tab*, *Delete*, *Clear older than…* (1 h / 1 d / 7 d / every unnamed one, confirmed).
At most 50 unnamed snapshots per project (`pruneSnapshots` drops the oldest). The footer shows
the project's bytes, all projects' bytes and `navigator.storage.estimate()` as a bar, turning to a
warning above 80 % of the quota. The thumbnail for *Open recent* is one 256 px `drawImage` of the
canvas right after a render (`captureThumb` in the render loop), at most every 10 s per tab.

**Keys**: `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle tabs and `Ctrl+W` closes when the browser hands the
key to the page (Chrome keeps both for its own tabs); the fallbacks that always work are `Alt+]`
/ `Alt+[` and `Alt+W`, `Alt+N` opens a new project. In the strip: click activates, middle-click or
× closes, double-click or F2 renames inline, a pointer drag reorders (window listeners: moving a
captured element in the DOM would drop its capture), ← → move focus, Delete closes.

## 11. Adding to the platform

- **A component**: one file under `src/components/<category>/`, `registry.register({...})`, import
  it in `components/index.js`. See the worked example in `README.md`. Give the face
  `portAnchors({ w, h })` (face px per port key) when it has an identifiable region per port, so
  the pins sit level with what they change (§7c); leave it out to get the centred stack. Register
  the text a user should be able to change on the face with `beginFields` in `render` (§8d), so
  a double-click edits it in place and the panel is only needed for the rest.
- **A custom 3D body**: add `body3d` to the definition (§8b) — `portAnchors(node)` in body units
  for content-aligned pins, or `ports(node)` for explicit positions; add `panel(api, block)` when
  it owns data the generic param controls cannot edit, and mark those params `hidden`.
- **A category**: add a row to `CATEGORIES` in `core/registry.js` (label, kind, description) and an
  icon in `icons.js`; the toolbar picks it up. Unknown categories still work (auto-labelled).
- **A port type**: add it to `TYPES` / `typeInfo` in `core/types.js`, to `portTypes` in both
  palettes in `theme.js`, and a `compatible` rule if it coerces. `portShapeFor` in `block3d.js`
  decides the pin shape (`event` is a chevron, multi inputs are slots).
- **A subtype**: add it to `SUBTYPES` / `subtypeInfo` in `core/types.js` and to `subtypes` in
  both palettes in `theme.js`; declare it on ports with `subtype: 'name'` (and `loose: true` on
  inputs that should still take plain `data`).
- **A link sentence**: a row in the `TABLE` of `pm/relations.js` (`'fromType.port>toType.port'`,
  `'fromType.port>*'` or `'*>toType.port'`) or a `describeLink` hook on the definition.
- **A drop-to-link pair**: a row in `DROP_LINKS` (`pm/relations.js`, §7d); flow-ish event ports
  pair up without a row.
- **A navigation preset**: an entry in `PRESETS` (`controls/presets.js`); the panel select, the
  ? menu, the help sheet and the tour hint pick it up.
- **A starter template**: an example object with `template: true`, `hint` and `focus` under
  `src/examples/`, listed in `templates` (`examples/index.js`), plus its thumbnails (§9g).
- **An AI provider or model**: `registerProvider({...})` in a file under `ai/providers/` (import it
  in `providers/index.js`), or a row in `FAL_MODELS` / `KIE_MODELS` — see `AI-GENERATION.md` §6.
- **A body**: build it from `panelGeometry` / `slabGeometry` (`h.panelGeometry` inside `body3d`)
  and `materials.panel`; use `outlineGeometry` for its rim.
- **A param control**: extend `PARAM_TYPES` in `core/component.js` and `_buildBlock` in `panel.js`.
- **An undoable operation**: a command in `core/commands.js` built from `World` mutations.
- **A 2D-mode behaviour**: subscribe with `onPlanChange` (`plan.js`) or read `isPlanOn()`; a body
  that should pivot differently when flat overrides `planPivot()` (§9f).

## 11b. AI generation (`ai/`, `components/generate/`)

Provider adapters (`ai/providers/base.js` interface: `testKey`, `listModels`, `estimateCost`,
`run`), the encrypted key vault (`ai/vault.js`, WebCrypto AES-GCM, PBKDF2 from a passphrase or a
device secret), the job queue (`ai/jobs.js`: states, progress, logs, cancel through
`AbortSignal`, retry, concurrency), pricing and session spend (`ai/pricing.js`), the IndexedDB
blob store for generated media (`ai/store.js`, `faces.setBitmapFallback`) and the shared
component lifecycle / face / panel (`components/generate/common.js`) are described in
[`AI-GENERATION.md`](AI-GENERATION.md). Invariants: keys are never in `params`, `state` or the
world JSON; live job handles stay on the instance (`_job`, `_approval`, `_err`), results in
`state.current / history`; `when done` is emitted from `evaluate` on the frame after a job
finishes so it travels the normal event bus; cards may carry a `cover` media record
(`pm/model.js → coverRecord`), set through the board's `cover` input.

## 12. Invariants worth keeping

1. The world is the only source of truth; the engine annotates, the UI reads and writes through
   commands, serialization walks it.
2. Definitions are frozen and stateless; all per-instance data lives in `instance.params`,
   `instance.state` and `instance.rt`.
3. Type colours, category tints and state colours come from `theme.js` only; both palettes define
   every key.
4. Anything visible about a connection (validity, activity, direction, type) is derived from data,
   never set by hand.
5. Removing scene objects for undo never disposes them; `World.clear()` does (and clears the selection).
6. Every body is a `panelGeometry` panel in a `materials.panel` finish; faces follow the tokens in
   §8c; nothing draws a header band.
7. Cables are optional: every relationship the Showcase uses can be made by a drop
   (`DROP_LINKS`), and nothing about a block's behaviour depends on the wiring switch.
