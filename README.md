# Proto3D — a 3D project-management platform that runs

Proto3D is a browser-based workspace where **components** live as blocks in a calm 3D room,
connected by typed, animated cables, and **actually run**: a dataflow engine evaluates the graph
every frame. The scene you land in is a **project-management system**: a standing 3D Kanban
board with draggable cards, executable flowchart shapes, a 3D Gantt timeline, people,
milestones, sticky notes, checklists and a dashboard — all ordinary components in the same
registry (see [Project management](#project-management)), so a board's `done` event can run a
flow that writes a message on a laptop.

Underneath is a **platform**: one component schema, a registry that drives the toolbar / panel /
engine / serialization, six port types with strict compatibility, an event bus, groups that
collapse into a single slab, level-of-detail for large systems, undo / redo, save / load and a
left **Add** toolbar with search and drag-and-drop. Media, text, data, logic, action, transform,
layout, output and device components are all still in the toolbar.

This round is about **making the wiring self-explanatory** (see [Wiring](#wiring)): ports have
shapes (chevron = event, circle = data) and states (filled = connected, hollow = free), hovering a
port tells you what it is and lights every port it can connect to, cables snap while you drag
them, either end of an existing cable can be **grabbed and moved** to another port or dropped on
empty space to disconnect, a selected block labels where each of its cables goes, and a
first-run tour points at the real things on screen.

Shots: [`overview-lod.png`](docs/shots/overview-lod.png) (zoomed out: far LOD, a collapsed
group), [`connection-hover.png`](docs/shots/connection-hover.png) (hovered link isolated with its
type / value label), [`light-theme.png`](docs/shots/light-theme.png).

## Run

Static files, no build step.

- **Any static server**: `python3 -m http.server` in this folder, then open `http://localhost:8000/`.
- **GitHub Pages**: publish the folder as-is (all paths are relative).
- **file://**: open `index.html` in a browser that allows module scripts from disk (Chrome does).

Three.js r160 comes from `https://unpkg.com/three@0.160.0/` through the import map in
`index.html`; to run offline, copy `node_modules/three` next to the page and point the two
import-map entries at it. The first load shows the *Project management* scene and starts a short
four-step tour (once; **? → Show tour** replays it); after that the workspace restores your
autosaved world from `localStorage` (**File → New** clears it and shows an empty-scene hint).

## Try it in one minute

1. **Drag a card** on the board into **Done**: a token runs through the flow below and the laptop
   reads *Urgent item shipped: …* (for urgent cards) or the Log records it. Click a card to edit
   it in the panel on the right; the timeline, the people and the dashboard follow.
2. **Hover a pin.** The tooltip names it, its type and value and where it is connected; every pin
   it could connect to lights up, the rest dim. Chevrons are events, circles carry values;
   hollow pins are free.
3. **Wire something.** Drag from `Launch checklist.done` (chevron, right side) to a lit chevron
   such as `Card done.trigger`: the cable snaps when you are close. Try dragging onto a circle:
   the red ring says no. Dragging *from* an empty input backwards to an output works too.
4. **Move a cable.** Grab the end of any cable (the tube near a pin, cursor turns to a hand),
   drop it on another lit pin to re-route it, or on empty space to disconnect. `Ctrl+Z` undoes
   either. Click a block: its cables stay bright and their far ends are labelled.
5. Open the left **Add** toolbar, drag a **Layout** into the scene, connect a few nodes into its
   `items` input and switch its `mode` between row / column / grid / circle: the nodes move.
   Select two nodes, `Ctrl+G`, then `C`: the group folds into one slab whose ports are the
   connections that cross its boundary. `F` frames the selection, `Home` frames everything.

## Architecture

```
src/
  core/         component schema, registry, port types, engine, world model, commands, history
  components/   one file per component type, grouped by category; index.js registers them all
  block3d.js    Block3D: what nodes and devices share (typed port pins, rim, shadow, face, LOD, serialize)
  node3d.js     Node3D: rounded slab with header, port rows, optional face, footer
  device3d.js   Device3D: phone / tablet / laptop / monitor whose screen is the component face
  shape3d.js    Shape3D: custom 3D bodies from def.body3d (boards, flow shapes, timeline…) + child pickables
  pm/           model.js (cards, columns, boards, stats, burndown — no Three.js), board-ops.js, panel-pm.js
  faces.js      2D drawing helpers for faces and screens (text, JSON, media, grids)
  connection3d.js + routing.js   typed tubes with flow sheen; lanes, lift, obstacle avoidance
  groups.js     Group3D: frame on the floor, collapse to a slab with proxy ports
  interaction.js  pointer model: hover guidance, cable drags (forward / backward), cable-end re-route, selection emphasis
  selection.js, lod.js, serialize.js, gizmo.js, panel.js, workspace.js, theme.js
  ui/           toolbar-left.js (Add toolbar), file-menu.js, overlays.js (tooltips, drag label, toast, end labels, empty hint), tour.js
  examples/     the project scene + the tiny builder API
```

The full design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The short version:

| Layer | Module | Responsibility |
| --- | --- | --- |
| **Schema** | `core/component.js` | `defineComponent(def)` validates one definition object: `id, category, label, description, icon, inputs[], outputs[], params[], size, evaluate(ctx), onEvent?, face?, onCreate?, onDestroy?`. |
| **Registry** | `core/registry.js` | Every type registers here. The registry drives the Add toolbar (categories, icons, search), the properties panel (params → controls), the engine (`evaluate`), node construction (ports) and serialization (type id + params + state). |
| **Types** | `core/types.js` | Six port types `number, text, boolean, data, media, event` plus `any`. `compatible(from, to)` → `ok / coerce / invalid` (only `number → text` coerces); `formatValue`, `equal`, pulses. |
| **Engine** | `core/engine.js` | Evaluates every frame in topological order (cycles: back-edges use previous-frame values), pulls values along connections (multi inputs → arrays; several links into one input → most recently changed wins), coerces, runs the event bus so pulses propagate within the pass, caches values on connections and tracks `changedAt` per output. |
| **World** | `core/world.js` | `nodes`, `connections`, `groups` and the low-level mutations; `layoutVersion` bumps when anything moves so connections re-route. |
| **Commands / History** | `core/commands.js`, `core/history.js` | Every edit (add, remove, move, param, connect, group, collapse, duplicate, rename, enable) is a command; `History` gives undo / redo and coalesces rapid param edits. |
| **Serialization** | `serialize.js` | World ↔ JSON (`version 2`): components (type, params, serializable state, transform), connections (node uid + port key), groups, camera. Debounced autosave to `localStorage`. |
| **UI** | `ui/toolbar-left.js`, `panel.js`, `ui/file-menu.js`, `interaction.js`, `ui/overlays.js`, `ui/tour.js` | Add toolbar, properties panel, File / help menus, the pointer / keyboard model (selection, marquee, drag, cable drags and re-routing, face clicks), the HTML guidance layers and the first-run tour. |

### Component schema, worked example

Create `src/components/transform/smooth.js` and import it from `src/components/index.js`.
Nothing else changes: it appears in the toolbar under Transform, gets its params in the panel,
evaluates, serializes and can be searched.

```js
// Smooth — exponential moving average of a number.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawText } from '../../faces.js';

export default registry.register({
  id: 'smooth', category: 'transform', label: 'Smooth', icon: icons.transform, size: 'M',
  description: 'Exponential moving average of a number',
  inputs:  [{ key: 'in', label: 'in', type: 'number' }, { key: 'reset', label: 'reset', type: 'event', optional: true }],
  outputs: [{ key: 'out', label: 'out', type: 'number' }],
  params:  [{ key: 'alpha', label: 'smoothing', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01 }],
  // ctx = { inputs, params, state, time, dt, emit(key, payload), touch(key), instance, upstream(key), engine }
  evaluate({ inputs, params, state }) {
    if (inputs.reset) state.value = undefined;            // an event input is a pulse this frame, else undefined
    if (typeof inputs.in !== 'number') return {};         // no output → downstream sees undefined
    state.value = state.value === undefined ? inputs.in : state.value + (inputs.in - state.value) * params.alpha;
    return { out: +state.value.toFixed(4) };
  },
  footer: ({ outputs }) => (outputs.out === undefined ? 'waiting' : `≈ ${outputs.out}`),
  face: {                                                 // optional live 2D face on the node body
    render(g, w, h, { outputs }) { clear(g, w, h); drawText(g, outputs.out === undefined ? '—' : String(outputs.out), 0, 0, w, h, { size: 64, mono: true }); },
  },
});
```

Rules of the schema: `id` is lowercase with dashes; port keys are unique per direction; port
types are one of the seven; params are `number | text | boolean | select | json | color`. Event
outputs are pulsed with `ctx.emit(key, payload)` (or by returning a value for that key); `state`
is a plain object that persists per instance and is saved when it is JSON-serializable;
`face.onPointer(ctx, { type, u, v })` receives clicks and drags on the face in 3D; `onCreate` /
`onDestroy` are for listeners (the Input component's key mode uses them).

## Core components (17)

| id | Category | Inputs | Outputs | Params (mode first) | Purpose |
| --- | --- | --- | --- | --- | --- |
| `media` | Media | — | `media` media | mode image/video/audio · source sample 1–6 / custom URL · url · title | One asset; samples are generated offline (images, animated poster for video, WAV for audio). Face shows it. |
| `media-grid` | Media | `items` media\* | `layout` data | columns (0 = auto) · gap · fit | Gallery of every connected media; face renders it; layout `{items, cols, rows}` feeds screens. |
| `text` | Text | `in` any\* | `text` text | mode source/uppercase/lowercase/template/join · text · template (`{value} {name} {0}`) · separator | Strings and string operations. Face shows the result. |
| `data` | Data | `in` data\* | `data` data · `value` any | mode value/pick/filter/count/merge · JSON · path · key · op · value | JSON source, path pick, filter a list, count, merge. |
| `input` | Input | — | `trigger` event · `value` any | mode button/toggle/key/timer/slider · label · key · interval · value/min/max | Interactive face: tap, flip, press a key, tick, drag a slider. |
| `compare` | Logic | `a` any · `b` any | `result` boolean | op = ≠ < > ≤ ≥ contains · b fallback | a ⋈ b. |
| `gate` | Logic | `in` boolean\* | `result` boolean | mode AND/OR/NOT/XOR | Combine booleans. |
| `branch` | Logic | `condition` boolean · `value` any · `trigger` event | `then` any · `else` any · `on true` event · `on false` event | — | if / else: routes a value and fires when the condition flips (or on trigger). |
| `action` | Action | `trigger` event · `payload` any | `result` any · `done` event | mode pass/toggle/count/latch/delay · payload fallback · delay ms | Do something on an event. |
| `transform` | Transform | `a` number · `b` number | `result` number | mode math/map range/clamp/round/invert · op + − × ÷ mod pow min max · ranges | Number processing. |
| `layout` | Layout | `items` any\* | `list` data | mode row/column/grid/circle · spacing · columns · distance · arrange | Physically arranges the connected components around itself. |
| `display` | Output | `in` any | — | caption | Face renders any value: text, number, boolean, JSON, media, gallery. |
| `log` | Output | `in` any · `trigger` event | `count` number | keep (≤ 8) | Last entries with timestamps on its face. |
| `phone` | Devices | `screen` any | `tap` event · `tilt` number · `battery` number | caption · tilt speed | Handheld; clicking the screen emits `tap`. |
| `tablet` | Devices | `screen` any | `tap` event · `tilt` number | caption · tilt speed | Tablet. |
| `laptop` | Devices | `screen` any | `tap` event · `load` number | caption · load speed | Laptop; the screen renders whatever arrives. |
| `monitor` | Devices | `screen` any | `tap` event · `ambient` number | caption · ambient speed | Large screen. |

`*` = multi input (accepts many links; the component receives an array in connection order).
Devices are components with the same anatomy as nodes; they stand on the floor at rough real
scale. Video playback is not attempted: a video asset is an animated poster frame with a play
glyph and a progress bar (honest fallback for headless and offline use).

## Project management

The **Project** category (toolbar glyph: three kanban columns; header tint teal-green) adds ten
components. They are registry components like every other — typed ports, params, `evaluate`, a
live face or a custom 3D body — so they compose with Logic, Actions, Text and Devices. The data
model (`src/pm/model.js`) is plain JSON stored in params / state and saved in the world file:
`Card { id, title, description, assignee, due, priority, tags, checklist, estimate, createdAt,
movedAt, blockedBy }`, `Column { id, title, wipLimit, cards }`, `Board { columns }`, plus people
and milestones.

| id | Size · body | Inputs | Outputs | Params | What it does |
| --- | --- | --- | --- | --- | --- |
| `kanban-board` | XL · standing board | `add card` event · `move` event | `card moved` event · `done` event · `stats` data · `cards` data | board (columns, WIP limits, cards — edited in the panel) · dependency arcs | Columns are translucent panels on a plinth; cards are slabs stacked top-down (title, priority stripe, assignee initials, due date — red when overdue, tag pills, checklist progress, lock glyph when blocked). Click a card to edit it, **drag it** to another column / position (ghost + drop slot), click the **+** tile to add one. `done` pulses when a card enters the last column. Far away, columns collapse to count bars. |
| `flow-terminal` | M · stadium | `trigger` event | `out` event | mode start / end · payload | Start: the **Run** disc or a trigger emits a token. End: counts arrivals. |
| `flow-step` | M · rounded box | `in` event | `out` event | duration ms | Passes the token on (after an optional delay, with a progress bar); flashes as it goes. |
| `flow-decision` | M · diamond | `in` event · `condition` boolean | `yes` event · `no` event | payload field · op · value | Routes the token by the boolean input or by a test on the payload (`priority = urgent`). |
| `timeline` | XL · standing Gantt | `tasks` data\* · `milestones` data\* | `overdue` data · `next milestone` data | own tasks (panel) · units per day · colour by assignee / priority / column | Day ticks and week labels on a rail, weekend shading, one bar per task with its title, a translucent **today** plane, milestone flags. Feed it a board's `cards`; own tasks get a right-hand handle you drag to change the due date. |
| `person` | S · face | `cards` data | `person` data · `load` number | name · role · colour · capacity | Initials avatar, name, role and a load bar; `load` = open cards assigned to this name. Every Person in the world appears in the card editor's assignee list. |
| `milestone` | S · flag on a pole | — | `reached` event · `milestone` data | date | Flag colour follows the state (ahead / soon / reached); `reached` fires once when today ≥ date. |
| `sticky-note` | S · tilted square | `text` text | `text` text | text · colour · tilt | Paper-coloured slab with the note on its face. |
| `checklist` | M · face | — | `progress` number · `done` event | items (panel) | Rows with checkboxes; click a row on the 3D face to toggle it (undoable); `done` fires when all are complete. |
| `project-dashboard` | L · face | `stats` data · `tasks` data · `milestone` data | `progress` number | caption | Done-ratio ring, per-column bars (red over WIP), overdue / blocked counts, burndown line from the board's history, next milestone. |

**Dependencies** are a card field, not a component: `blockedBy: [cardId]` draws a dashed red
arc from the blocker to the blocked card and a lock glyph on it; the card editor's *Blocked by*
section is a multi-select over the other cards.

**How boards connect to flows and timelines.** `stats` and `cards` are ordinary `data`
outputs re-evaluated every frame, so a Timeline (`tasks`), a Dashboard (`stats`), a Person
(`cards`) or any Data / Display node reads them live. `card moved` and `done` are `event`
outputs whose payload is the card, so a Flow Terminal → Flow Step → Flow Decision chain can
inspect `priority`, and an Action with an empty payload passes the triggering card on to a Text
template (`Urgent item shipped: {value.title}`) and a device screen. The reverse works too:
an Input button wired into `add card` creates cards, and a pulse with `{ cardId, column }` on
`move` moves them. Tokens are visible: every event link grows a bright bead that runs from source
to destination when a pulse passes, and flow shapes flash as the token goes through.

**Card controls.** Click a card → the panel shows the card editor (title, description,
assignee select + free text, due date, priority, tags, estimate, column, checklist add / toggle /
remove, blocked-by, delete). Drag a card → move it (ghost lifts off the board, a slot shows where
it lands; drop on another column or between cards). Click a column panel → column editor (title,
WIP limit); the Board section adds, reorders and removes columns and lists every card. Click the
**+** tile → new card in that column. Every edit is one undoable command (`Ctrl+Z`); engine-driven
edits (event inputs) are not undoable but still autosave.

## Workspace controls

| Action | Input |
| --- | --- |
| Orbit / pan / zoom | left-drag on empty space / right-drag / wheel |
| Focus | `F` frames the selection · double-click a block · `Home` or **Frame all** frames everything (camera flights are smooth) |
| Add | left toolbar → category → click a component (adds at the camera target on a free slot) or **drag it into the scene** (ghost footprint, drops where the ray hits the floor) · `Shift+A` opens search |
| Move | drag a block (all selected blocks move together; `Shift` for height) · gizmo `G`, `W` / `E` / `R` · Transform fields in the panel |
| Connect | drag from an **OUT** pin to a lit **IN** pin on another node (or backwards from an empty input to an output); the cable snaps within ~1.2 units; a red ring + not-allowed cursor mark an incompatible pin; dropping on empty space cancels |
| Re-route | grab a cable near either end (hand cursor) and drop it on another compatible pin · drop on empty space to **disconnect** · `Esc` puts it back · pressing a connected single input picks up its cable · dragging from a connected output adds a second cable |
| Inspect | hover a pin: tooltip with name, type, value and links; compatible pins glow, others dim · hover a block: label + description · click a block: its cables stay bright with far-end labels · click a cable: midpoint label, both pins pulse, panel shows from → to |
| Select | click · `Shift`+click adds / toggles · `Shift`+drag on the floor draws a marquee · `Ctrl+A` all · click empty space clears |
| Edit | `Ctrl+D` duplicate (with internal connections) · `Delete` · `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) undo / redo · the top bar has ↶ ↷ |
| Group | `Ctrl+G` group the selection · `C` collapse / expand · `Ctrl+Shift+G` ungroup · drag the frame to move the whole group · rename in the panel |
| Interact | click a device screen (`tap`), an Input face (button, toggle, slider) or press the configured key · click / drag a **card** on a Kanban board, click the **+** tile, click a checklist row, press the **Run** disc on a Flow Terminal, drag a Timeline bar's end handle |
| File | **File** → New · Save JSON · Load JSON · Examples; autosave to `localStorage` on every change |
| View | `T` theme · `N` properties panel · `H` help & legend · **?** → Show tour · `Esc` cancel |

Shortcuts are ignored while typing in a panel field.

## Wiring

**Port anatomy.** Every port is a short stem out of the side face plus a typed pin: **event**
ports are chevron pins pointing in the flow direction (into the body on the left for inputs, away
from it on the right for outputs, like exec pins in a node editor); **data** ports (number, text,
boolean, data, media, any) are spheres. A **connected** pin is filled and bright in its type
colour; an **unconnected** pin is a hollow ring (dark core, coloured outline). Optional ports are
slightly smaller; multi inputs carry a small **+**. Port names sit beside the pins at working zoom
(outside the slab on devices) and a tiny **IN** / **OUT** caption tops each side of a block.

**Hover.** Over a pin (crosshair cursor) an HTML tooltip follows it with the name, type label,
current value and one line per link (`→ Notify team.in`); every compatible port on other blocks
glows with a pulsing rim in the type colour, incompatible ones dim to 35 %, the hovered pin grows.
Over a block body (hand cursor) a small tooltip gives the component label and description after
half a second. Over a cable end (grab cursor) the end ring enlarges and the tooltip reads *drag
to re-route · drop on empty space to disconnect*.

**Creating a cable.** Drag from an output (or backwards from an empty input): the preview tube
follows the pointer, compatible targets glow and the cable **snaps** to the nearest one within
~1.2 units, an incompatible pin under the pointer shows a red ring and a not-allowed cursor, and a
label beside the pointer reads `type · from Node.port` (or `into Node.port` when dragging
backwards) plus the target it will connect to. Dropping on a compatible pin connects (undoable
*Connect*); dropping on empty space or an incompatible pin creates nothing and the preview fades.
Dragging from an already connected output adds another cable (fan-out); pressing a connected
single input picks up its existing cable instead (multi inputs start a new one).

**Moving and removing a cable.** Either end of an existing cable — the tube within ~0.9 units of a
pin and the end ring — is a grab handle. Drag it: the cable detaches (the pin goes hollow) and
follows the pointer with the same snapping and red-ring feedback. Drop on a compatible pin →
*Re-route connection* (one undo step); drop on empty space → *Disconnect* with a short toast;
`Esc` while dragging puts it back. Clicking a cable still selects it (`Delete` removes it; the
panel shows from → to, type, value and a **Disconnect** button).

**Selection.** A selected block keeps its cables bright and dims every other cable to 40 %; each
of its cables shows a label at the far end (`→ Release plan.tasks`, `Card done.out →`). A selected
cable makes both pins pulse, dims the others and shows the midpoint label
`Card done.out → Notify team.in · event · value`.

**Onboarding.** A four-step tour (toolbar → a real output pin with a ghost cable running to a
compatible input → a card on the board → cable ends) runs once and is replayable from **? → Show
tour**; an empty scene shows *Add a component from the left to start*; every toolbar button has a
tooltip with its key; the help panel's legend shows the pin shapes, the type colours and the three
wiring rules.

### Connection semantics

- **Type** = the output port's type; a link is **valid** when `compatible(from, to)` is not
  `invalid`: same type, either side `any`, or `number → text` (coerced, drawn in the
  destination colour). Invalid links are red and dashed, carry nothing and flag both ends as
  `error` — they are created on purpose so the mismatch is visible and fixable.
- **Direction** is left → right (inputs face −X, outputs +X), shown by the chevron pins and the
  continuous flow sheen; the hover label reads `type · From.port → To.port · value`.
- **Active** = the source changed or pulsed within 1.5 s (thicker, brighter, faster sheen);
  **idle** = carries a stable value; **inactive** = carries nothing (thin, dim).
- **Routing** (`routing.js`): cubic Bezier with horizontal tangents; connections sharing a
  source or destination fan out into lanes (small vertical / depth offsets); long links lift
  slightly; any link whose samples pass through another block's bounding box raises its control
  points until it clears the box. Backward links widen their handles into a readable loop.
- **Hover** isolates the path: every other connection dims to 25 %; **click** selects and the
  panel shows from / to / type / state / value / changes per second.
- **Multi inputs** receive an array (connection order). A single input with several links takes
  the **most recently changed** upstream value (this is how two Actions can share one screen).
- **Events** are pulses `{ t, n, payload }` that exist for one pass; a collapsed group exposes
  every boundary-crossing link on a proxy port so the interface stays visible.

## Design language

The good parts of round two are kept: two palettes in `theme.js` (dark near-black blue-grey /
light off-white; port-type hues are identical across themes, darkened for contrast in light),
colour reserved for meaning (types and states), the gradient floor with a 1 / 5-unit grid and
exponential fog (which now thins as the camera pulls back), hemisphere + key + fill light with
fake contact shadows, `1 unit = 10 cm`, a 10 × 6.5 unit layout pitch, flow left to right.

**Node anatomy**: header band tinted by category (eleven low-saturation hues) with the title,
port rows just under the header (in left, out right; chevron pins for events, spheres for data;
filled when connected, hollow when free; multi ports slightly larger with a "+"), an optional
live canvas **face** below the rows (size M or L), a dim footer with the output value, a rim for
hover / selected / error, and a contact shadow. Devices share ports, rim, shadow and states;
their screen is the face. **Groups** are translucent rounded frames on the floor with a title
at the front edge; collapsed, they become a slab with a header band and proxy ports.
**Custom bodies** (`Shape3D`) keep the header tint, the port anatomy, the rim and the contact
shadow: the Kanban board and the Timeline are header-banded standing panels on a plinth / rail,
the flow shapes are extruded flowchart outlines tinted with the Project colour, the milestone is
a flag, the sticky note a tilted paper square. Cards and bars are canvas faces on small slabs.

**States** are derived by the engine, never hard-coded: `disabled` (unchecked *enabled*) >
`error` (invalid link attached or `evaluate` threw) > `active` (an output changed / pulsed within
1.5 s) > `idle`; selection and hover overlay them as rims.

**Level of detail**: beyond the LOD distance (110 units, editable in the workspace panel) port
labels and footers fade out, titles lift above the slab and grow with distance like map labels,
connections thin, group titles enlarge; below it everything crossfades back.

**Port & connection colours** (dark / light): number teal `#2dd4bf` / `#0f9f8f`, text amber
`#f5b942` / `#c07f0c`, boolean magenta `#e25aa6` / `#c2388a`, data violet `#8b7cf6` / `#6a5cd6`,
media coral `#ff8a5b` / `#d9633a`, event white `#f4f6fa` / slate `#48556b`, any grey `#9aa7bb` /
`#6b7788`. The same table colours ports, tubes, rings, panel dots and the legend.

## Roadmap

1. **More primitives, same schema**: HTTP / WebSocket sources, a Script component with a sandboxed
   `evaluate`, a Table view, a Chart output, a Store (persisted key-value) component.
   *Project management next*: swimlanes (rows by assignee) on the board, card attachments
   (Media into a card), a Sprint component that scopes a board by date range, drag a Timeline bar
   bodily to shift both dates, a Calendar body, import / export of cards as CSV / JSON, and
   collaborative editing once a transport exists.
2. **Real devices**: pair a phone through WebRTC so `tap` / `tilt` / `battery` are real; device
   presence drives the states.
3. **Routing at scale**: bundle parallel links, avoid group frames, and an auto-layout command
   (the Layout node already does it for its neighbours).
4. **Editing**: copy / paste across worlds, snapping, comments on the floor, sub-graphs
   (a group as a reusable component).
5. **Media**: real `<video>` / `<audio>` playback where the browser allows it, drag-and-drop of
   files onto a Media node, thumbnails in the panel.
6. **Hardening**: instanced ports for thousands of nodes, occlusion-aware LOD, keyboard-only
   navigation, contrast checks for both themes.
