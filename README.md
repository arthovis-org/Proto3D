# Proto3D — a 3D project-management platform that runs

Proto3D is a browser-based workspace where **components** live as clean cards in a calm 3D room
and **actually run**: a dataflow engine evaluates the graph every frame. The first visit opens the
**Start panel**: a blank file, three **starter templates** (a project board, an AI content
pipeline, an interactive device flow — see [Start panel and templates](#start-panel-and-templates))
and the full **Showcase** — a product launch as a project-management system: a standing 3D Kanban board
with draggable cards and a lane per person, a milestone, a Gantt timeline, a dashboard, a
checklist, sticky notes, an executable Done flow that writes on a laptop, a phone that ships a
hotfix, a button that adds a card and a media wall on a monitor, plus a **Generate** zone that
writes a launch tweet and paints a key visual with the offline Demo provider — all ordinary
components in the same registry (see [Project management](#project-management)).

**Cables are optional.** Relationships are made by **dropping one component onto another** (a
Person onto the board, the Board onto the Timeline); the workspace says what the link means and
you can undo it. Turn **Wiring** on (`P`) and every block shows its typed pins and every cable
appears, for the people who want to see or edit the graph (see [Wiring is optional](#wiring-is-optional)).
Navigation follows **Blender by default** (middle-drag orbits, Shift pans, numpad views) with
**Unreal**, **Maya**, **Simple** and **Trackpad** presets under **? → Controls**; a pinch zooms in
every preset and touchscreens work everywhere (see [Controls](#controls)).

**Generate content with AI.** A **Generate** category adds a Prompt editor with `{variables}` and
Generate Text / Image / Video / Audio components that call **OpenRouter** (language models),
**fal.ai** and **kie.ai** (images, video, audio) or an offline **Demo** provider; keys live
encrypted in this browser behind a **Connections** page, jobs stream onto the faces with progress,
cost and a history strip, and results feed every other component. **Settings**, **Guide** and
**Mask** nodes shape a generation (size / steps / seed rules, image-to-image and edge / depth /
pose guides, inpainting), **Image Edit** and **Enhance** finish it in the browser or on a model
(see [Generate content with AI](#generate-content-with-ai)).

Underneath is a **platform**: one component schema, a registry that drives the toolbar / panel /
engine / serialization, six port types with strict compatibility, an event bus, groups that
collapse into a single slab, level-of-detail for large systems, undo / redo, save / load and a
left **Add** toolbar with search and drag-and-drop. Media, text, data, logic, action, transform,
layout, output and device components are all still in the toolbar.

This round is about **look and feel** (see [Look and feel](#look-and-feel)): every body is a
thin **extruded rounded rectangle with a tiny bevel** in a satin material lit by a soft
environment — no header bands, no puffy slabs — and every face is flat, modern UI: a slim
category accent line, Inter type on an 8-pt grid, thin dividers, chips, thin rounded bars.
Links still **mean something** (see [Meaningful links](#meaningful-links)): a Person plugged into
(or dropped on) the board's **people slot** gives it a lane and lists their tasks; data has
**subtypes** with their own colours; every link explains itself in a sentence (*"Maya's tasks
appear on Launch board"*) in the drag label, the hover label, the panel and a toast.

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
import-map entries at it. Inter is loaded from Google Fonts when online; offline the type stack
falls back to the system sans. The first load opens an empty project with the **Start panel** over
it — pick a starter template, the Showcase, a blank file or a file on disk; the first template you open
starts a short seven-step tour (once; **Help → Take the tour** replays it). After that the
workspace restores your open **project tabs** from the browser's IndexedDB — every tab's scene,
camera and 2D mode, with the active one in front (**File → New** opens an empty project in a new
tab with the Start panel over it; **Help → Start panel** brings it back any time).

## Start panel and templates

The Start panel is a card over the live room, not a modal: **Esc**, ×, any pick or anything
landing in the scene closes it, and *Show this panel on startup* switches it off for good (it
stays under **Help → Start panel** and the command palette). The four starter templates are
ordinary example scenes (`src/examples/`) built from registry components; each opens in a tab
named after it, framed, with a one-line hint bar saying what to try first:

| Template | What is in it | Try first |
| --- | --- | --- |
| **Project board** | a *Website relaunch* Kanban board with two People plugged into its people slot (a swimlane each), a Milestone, a Timeline and a Calendar fed by the board, and a Dashboard fed by the board, the people and the milestone | drag a card into **Done** — the dashboard, the timeline and the people update at once |
| **AI content pipeline** | a Data source (`{Product.name}`, tagline, audience, colour) → two Prompts → Generate Text → Display and Generate Image → Media Grid, all on the offline **Demo** provider, with one **Run** button into both generators | press **Run** (or the Run button on a Generate node); go live under **File → Connections…** |
| **Interactive device flow** | an Input button and a Phone's tap → an Action that counts → Compare (≥ 3) and Gate (NOT) → a Display; the count's pulse through a decision: *yes* → an Action writes *Unlocked* on the Laptop, *no* → a Log; the Phone shows the count | press the button (or tap the phone) three times |
| **Image studio** | a sample picture → a **Guide** (edges: a live Sobel trace) and a **Mask** (rectangle, feathered) → **Generate Image** on the offline Demo, driven by a **Settings** node (landscape 4:3, 24 steps, seed 1234 incrementing after each run) and a Prompt with a `{Product}` variable → **Image Edit** (adjust) → **Enhance** (browser ×2, auto) → Media Grid; one Run button | press **Run** — the Demo paints inside the mask along the traced edges, the grade and the ×2 upscale follow; double-click a Settings number to change it, `Ctrl+B` on the Grade to compare |

The **Showcase** stays under **File → Examples** and behind *More examples* on the panel.
Thumbnails are rendered headless and committed under `assets/templates/`. *All projects →* at
the foot of the recent list opens the Home page.

## Try it in one minute

1. **Read the board.** *Launch board* has four columns and a lane per person (Maya, Jonas,
   Priya): those People stand to its left and are plugged into its people slot — you just cannot
   see the cables yet. Each Person card lists **their tasks** by column with due dates; the
   Dashboard on the right names the board and shows done %, overdue, blocked, burndown, people
   load and the Launch checklist; the Timeline draws a bar per card.
2. **Drop to link.** Drag *Priya* off the board and onto the Dashboard: the label reads *"Priya's
   load shows on Launch health"*, the drop creates the relationship (no cable needed), a toast
   confirms it, `Ctrl+Z` removes it. Drag the board onto the dashboard: two relationships fit, so
   a small chooser asks which one.
3. **Drag a card** into **Done**: a token runs through the Done flow and the laptop reads
   *Shipped: <title>* (urgent cards) or the Log records it. **Tap the phone**: it ships a hotfix
   through the same flow. Press the **Add hotfix** button: an urgent card lands in *To do*.
4. **Press `P`.** Wiring on: every block shows its pins, the cables appear with their colours,
   the multi-input sockets show a slot per person. Hover a pin, drag a cable, grab a cable end,
   drop it on empty space — everything from the previous rounds is still there. `P` again hides
   it all; a single block can keep its ports with the eye icon in its panel header.
5. **Move around.** Middle-drag orbits, Shift+middle pans, the wheel zooms towards the cursor,
   `Numpad 1 / 3 / 7` are the front / right / top views, `Numpad 5` toggles orthographic, `Home`
   frames everything, left-drag on the floor box-selects, right-click opens a block's properties.
   Prefer Unreal or Maya? **? → Controls**. Number fields in the panel have no spinner: click
   and drag them horizontally to scrub the value (Shift coarse, Alt fine); a plain click types.
6. Open the left **Add** toolbar, drag a component into the room, `Ctrl+G` groups, `C` collapses
   the group into one slab, `F` frames the selection.

## Architecture

```
src/
  core/         component schema, registry, port types, engine, world model, commands, history
  components/   one file per component type, grouped by category; index.js registers them all
  geometry.js   panelGeometry: the one body shape — extruded rounded rectangle with a tiny bevel, exact front-face UVs
  wiring.js     the global Wiring switch (ports and cables optional), per-block overrides
  controls/     presets.js (Blender / Unreal / Maya / Simple / Trackpad bindings as data) + navigation.js (the camera controller: mouse, trackpad, touch)
  block3d.js    Block3D: what nodes and devices share (typed port pins, rim, shadow, face, LOD, serialize, portsVisible)
  node3d.js     Node3D: thin extruded card with an accent line, title, face, footer; ports stacked beside the content on the left / right edges
  device3d.js   Device3D: phone / tablet / laptop / monitor whose screen is the component face
  shape3d.js    Shape3D: custom 3D bodies from def.body3d (boards, flow shapes, timeline…) + child pickables
  pm/           model.js (cards, columns, boards, stats, burndown — no Three.js), relations.js (who is plugged into whom + link sentences), board-ops.js, panel-pm.js
  faces.js      2D drawing helpers for faces and screens (text, JSON, media, grids)
  connection3d.js + routing.js   typed tubes with flow sheen; lanes, lift, obstacle avoidance
  groups.js     Group3D: frame on the floor, collapse to a slab with proxy ports
  interaction.js  pointer model: hover guidance, cable drags (forward / backward), cable-end re-route, waypoint drags, selection emphasis
  routing.js    cable paths: smooth / orthogonal / straight, waypoints (RouteNode), lanes
  bundles.js    cable management: parallel cables merge into neutral trunks
  cables.js     the global cable settings (style, corner rounding, thickness, bundling, waypoints)
  selection.js, lod.js, serialize.js, gizmo.js, panel.js, workspace.js, theme.js
  ui/           menubar.js (File · Edit · View · Add · Help + the quick toggles), toolbar-left.js (Add toolbar), overlays.js (tooltips, drag label, toast, end labels, empty hint), tour.js, help-dialogs.js (shortcuts, About), stats.js (performance readout)
                start-panel.js (first run: blank / templates / recent / open), hint-bar.js (the template's one-line hint)
                connections.js (API keys), model-browser.js, jobs-tray.js
  ai/           providers/ (openrouter, fal, kie, demo + the adapter interface), vault.js (encrypted keys), jobs.js (queue), pricing.js, store.js (IndexedDB), http.js
  components/generate/  prompt.js, generate-text.js, generate-media.js (image / video / audio), common.js
  examples/     showcase.js (the full scene), project-board.js · ai-pipeline.js · device-flow.js (starter templates) + the tiny builder API
assets/templates/  thumbnails for the Start panel (rendered headless, both themes)
proxy/cloudflare-worker.js   optional CORS proxy (allow-listed provider hosts, injects nothing)
```

The full design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The short version:

| Layer | Module | Responsibility |
| --- | --- | --- |
| **Schema** | `core/component.js` | `defineComponent(def)` validates one definition object: `id, category, label, description, icon, inputs[], outputs[], params[], size, evaluate(ctx), onEvent?, face?, onCreate?, onDestroy?`. |
| **Registry** | `core/registry.js` | Every type registers here. The registry drives the Add toolbar (categories, icons, search), the properties panel (params → controls), the engine (`evaluate`), node construction (ports) and serialization (type id + params + state). |
| **Types** | `core/types.js` | Six port types `number, text, boolean, data, media, event` plus `any`, and the `data` subtypes `person, task, tasks, board, milestone, stats, layout`. `compatible(from, to)` → `ok / coerce / invalid` (only `number → text` coerces); `compatiblePorts(a, b)` adds the subtype rule; `formatValue`, `equal`, pulses. |
| **Engine** | `core/engine.js` | Evaluates every frame in topological order (cycles: back-edges use previous-frame values), pulls values along connections (multi inputs → arrays; several links into one input → most recently changed wins), coerces, runs the event bus so pulses propagate within the pass, caches values on connections and tracks `changedAt` per output. `ctx.upstream(key)` / `ctx.downstream(key)` hand a component the instances on the other end of its cables. |
| **World** | `core/world.js` | `nodes`, `connections`, `groups` and the low-level mutations; `layoutVersion` bumps when anything moves so connections re-route. |
| **Commands / History** | `core/commands.js`, `core/history.js` | Every edit (add, remove, move, param, connect, group, collapse, duplicate, rename, enable) is a command; `History` gives undo / redo and coalesces rapid param edits. |
| **Serialization** | `serialize.js` | World ↔ JSON (`version 2`): components (type, params, serializable state, transform), connections (node uid + port key), groups, camera. |
| **Persistence** | `tabs.js`, `project-store.js`, `ui/tab-strip.js`, `ui/version-history.js` | Project tabs over one World (detached scenes, per-tab history and view), debounced autosave into IndexedDB with an indicator, version snapshots with diff summaries, recent projects with thumbnails. |
| **UI** | `ui/menubar.js`, `ui/toolbar-left.js`, `panel.js`, `interaction.js`, `ui/overlays.js`, `ui/tour.js`, `ui/start-panel.js` | Menu bar with its quick toggles, Add toolbar, properties panel, the pointer / keyboard model (selection, marquee, drag, cable drags and re-routing, face clicks), the HTML guidance layers, the Start panel with the starter templates and the first-run tour. |

### Component schema, worked example

Create `src/components/transform/smooth.js` and import it from `src/components/index.js`.
Nothing else changes: it appears in the toolbar under Transform, gets its params in the panel,
evaluates, serializes and can be searched.

```js
// Smooth — exponential moving average of a number.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawText, beginFields } from '../../faces.js';

export default registry.register({
  id: 'smooth', category: 'transform', label: 'Smooth', icon: icons.transform, size: 'M',
  description: 'Exponential moving average of a number',
  inputs:  [{ key: 'in', label: 'in', type: 'number' }, { key: 'reset', label: 'reset', type: 'event', optional: true }],   // a data port may add subtype: 'tasks' (and loose: true to also take plain data)
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
    render(g, w, h, { outputs, instance }) {
      clear(g, w, h);
      drawText(g, outputs.out === undefined ? '—' : String(outputs.out), 0, 0, w, h - 28, { size: 64, mono: true });
      // an editable field: double-click the block to enter edit mode, then click the strip at the bottom of the face to change `smoothing`
      // right there (Enter saves, Esc cancels; the edit is undoable and the panel follows). Kinds: text, multiline, number, select, date, checkbox.
      const F = beginFields(instance);
      if (!F.add({ id: 'alpha', kind: 'number', param: 'alpha', label: 'smoothing', min: 0.01, max: 1, step: 0.01, rect: { x: 12, y: h - 30, w: w - 24, h: 24 }, font: { size: 14, weight: 500, align: 'center' } }).editing) {
        drawText(g, `smoothing ${instance.params.alpha}`, 12, h - 30, w - 24, 24, { size: 14, weight: 500 });
      }
    },
    // optional: where each port's data lives on the face (px from the top), so the pin sits level with it
    // and a cable visibly points at what it changes; flat, or { in: {…}, out: {…} } when a key is on both sides.
    // Ports without an anchor are stacked beside the face; colliding anchors are nudged apart.
    portAnchors: ({ h }) => ({ in: h / 2, out: h / 2, reset: h - 20 }),
  },
});
```

Rules of the schema: `id` is lowercase with dashes; port keys are unique per direction; port
types are one of the seven (a `data` port may carry a `subtype`); params are `number | text |
boolean | select | json | color`. **Ports are named as plain words** a newcomer can read on the
block (`tasks`, `people`, `add task`); **event outputs start with "when"** (`when a card is done`)
except a flow shape's `next` / `yes` / `no`; a description is one plain sentence. Event outputs
are pulsed with `ctx.emit(key, payload)` (or by returning a value for that key); `state` is a
plain object that persists per instance and is saved when it is JSON-serializable;
`face.onPointer(ctx, { type, u, v })` receives clicks and drags on the face in 3D; `beginFields(instance)`
+ `F.add({ id, kind, param, rect, … })` in `render` makes a region editable in place (double-click the
block for edit mode, then click the region — see `docs/ARCHITECTURE.md` §8d for the spec, edit mode and the editor's keys); `onCreate` /
`onDestroy` are for listeners (the Input component's key mode uses them); `describeLink(fromPort,
toDef, toPort, names)` may return a sentence for a cable leaving the component.

## Core components (17)

| id | Category | Inputs | Outputs | Params (mode first) | Purpose |
| --- | --- | --- | --- | --- | --- |
| `media` | Media | — | `media` media | mode image/video/audio · source sample 1–6 / custom URL / file · url · title | One asset; samples are generated offline (images, animated poster for video, WAV for audio); a file comes from *Choose file…*, a drop on the block or Ctrl+V and is stored in IndexedDB. Face shows it. |
| `media-grid` | Media | `items` media\* | `layout` data | columns (0 = auto) · gap · fit | Gallery of every connected media; face renders it; layout `{items, cols, rows}` feeds screens. |
| `text` | Text | `in` any\* | `text` text | mode source/uppercase/lowercase/template/join · text · template (`{value} {name} {0}`) · separator | Strings and string operations. Face shows the result. |
| `data` | Data | `in` data\* | `data` data · `value` any | mode value/pick/filter/count/merge · JSON · path · key · op · value | JSON source, path pick, filter a list, count, merge. |
| `input` | Input | — | `trigger` event · `value` any | mode button/toggle/key/timer/slider · label · key · interval · value/min/max | Interactive face: tap, flip, press a key, tick, drag a slider. |
| `compare` | Logic | `a` any · `b` any | `result` boolean | op = ≠ < > ≤ ≥ contains · b fallback | a ⋈ b. |
| `gate` | Logic | `in` boolean\* | `result` boolean | mode AND/OR/NOT/XOR | Combine booleans. |
| `branch` | Logic | `condition` boolean · `value` any · `trigger` event | `then` any · `else` any · `on true` event · `on false` event | — | if / else: routes a value and fires when the condition flips (or on trigger). |
| `action` | Action | `trigger` event · `payload` any | `result` any · `index` number · `done` event | mode pass/toggle/count/latch/delay/iterate · payload fallback · delay ms · auto · interval ms | Do something on an event; *iterate* walks a list one item per trigger (`index` = position, `done` at the end). |
| `transform` | Transform | `a` number · `b` number | `result` number | mode math/map range/clamp/round/invert · op + − × ÷ mod pow min max · ranges | Number processing. |
| `layout` | Layout | `items` any\* | `list` data | mode row/column/grid/circle · spacing · columns · distance · arrange | Physically arranges the connected components around itself. |
| `display` | Output | `in` any | — | caption | Face renders any value: text, number, boolean, JSON, media, gallery. |
| `log` | Output | `in` any · `trigger` event | `count` number | keep (≤ 8) | Last entries with timestamps on its face. |
| `phone` | Devices | `screen` any | `tap` event · `tilt` number · `battery` number | caption · tilt speed | Handheld; clicking the screen emits `tap`. |
| `tablet` | Devices | `screen` any | `tap` event · `tilt` number | caption · tilt speed | Tablet. |
| `laptop` | Devices | `screen` any | `tap` event · `load` number | caption · load speed | Laptop; the screen renders whatever arrives. |
| `monitor` | Devices | `screen` any | `tap` event · `ambient` number | caption · ambient speed | Large screen. |

`*` = multi input (a slot rectangle that grows one slot per cable; the component receives an array in connection order).
Devices are components with the same anatomy as nodes; they stand on the floor at rough real
scale. Video playback is not attempted: a video asset is an animated poster frame with a play
glyph and a progress bar (honest fallback for headless and offline use).

## Project management

The **Project** category (toolbar glyph: three kanban columns; header tint teal-green) adds eleven
components. They are registry components like every other — typed ports, params, `evaluate`, a
live face or a custom 3D body — so they compose with Logic, Actions, Text and Devices. The data
model (`src/pm/model.js`) is plain JSON stored in params / state and saved in the world file:
`Card { id, title, description, assignee, due, priority, tags, checklist, estimate, createdAt,
movedAt, blockedBy }`, `Column { id, title, wipLimit, cards }`, `Board { columns }`, plus people
and milestones.

| id | Size · body | Inputs | Outputs | Params | What it does |
| --- | --- | --- | --- | --- | --- |
| `kanban-board` | XL · standing board | `people` person\* · `milestone` milestone · `add task` event · `move task` event · `cover` media | `when a card moves` event · `when a card is done` event · `progress` stats · `tasks` tasks | board (columns, WIP limits, cards — edited in the panel) · people view auto / highlight / filter / swimlanes · dependency arcs | Columns are translucent panels on a plinth; cards are slabs stacked top-down (title, priority stripe, assignee initials, due date — red when overdue, tag pills, checklist progress, lock glyph when blocked, a flag when due after the milestone). **People plugged into `people`** change the layout: one connected person highlights their cards, two or more give a **swimlane per person** (the board grows taller), `filter` shows only theirs. Click a card to edit it, **drag it** to another column / lane (a lane change re-assigns), **drop it on a Person** to assign it, click the **+** tile to add one. The milestone shows in the header with its countdown. Far away, columns collapse to count bars. |
| `flow-terminal` | M · stadium | `start` event | `next` event | mode start / end · payload | Start: the **Run** disc or a trigger emits a token. End: counts arrivals. |
| `flow-step` | M · rounded box | `start` event | `next` event | duration ms | Passes the token on (after an optional delay, with a progress bar); flashes as it goes. |
| `flow-decision` | M · diamond | `start` event · `condition` boolean | `yes` event · `no` event | payload field · op · value | Routes the token by the boolean input or by a test on the payload (`priority = urgent`). |
| `timeline` | XL · standing Gantt | `tasks` tasks\* · `milestones` milestone\* | `overdue` tasks · `next milestone` milestone | own tasks (panel) · units per day · colour by assignee / priority / column | Day ticks and week labels on a rail, weekend shading, one bar per task with its title, a translucent **today** plane, milestone flags. Feed it a board's `tasks`; own tasks get a right-hand handle you drag to change the due date. |
| `person` | L · face | `tasks` tasks\* | `person` person · `load` number · `task list` text | name · role · colour · capacity | Avatar, name, role, a load bar and **the person's tasks** on every board it is plugged into (via its `person` output → a board's `people` slot, or a board's `tasks` → its `tasks` slot), grouped by column with due dates (overdue in red). The panel lists the same tasks; click one to open the card on its board. `task list` is the same as text for a Display or a screen. |
| `milestone` | S · flag on a pole | — | `when reached` event · `milestone` milestone | date | Flag colour follows the state (ahead / soon / reached); `when reached` fires once when today ≥ date. Plug it into a board (header countdown, flags on late cards), a timeline (flag on the rail) or a dashboard. |
| `sticky-note` | S · tilted square | `text` text | `text` text | text · colour · tilt | Paper-coloured slab with the note on its face. |
| `checklist` | M · face | — | `progress` number · `when complete` event | items (panel) | Rows with checkboxes; click a row on the 3D face to toggle it (undoable); `when complete` fires when all are done. |
| `calendar` | XL · face | `tasks` tasks\* · `milestones` milestone\* | `due today` tasks · `this week` tasks · `when a task is due` event · `selected day` tasks | view month / week · offset (months / weeks from now, editable on the face) · colour by priority / project / assignee · show weekends | A month or week grid: weekday header, day numbers, a ring on today, up to three chips per day (done muted, then "+n"), a flag on a milestone's day, and a **selected-day list** at the bottom — click a cell to pick the day. `when a task is due` pulses once per task on the day it comes due (a Flow Terminal or an Action can react); `due today` / `this week` feed a Display or a screen. Drop a board on it to feed it. |
| `project-dashboard` | L · face | `progress` stats · `tasks` tasks · `milestone` milestone · `people` person\* · `checklists` number\* | `progress` number | caption | Names the board it is plugged into; stat tiles (done %, overdue, blocked, days remaining), done ring, per-column bars (red over WIP), burndown line from the board's history, the milestone, a load bar per connected person and a progress bar per connected Checklist. |

Port types in the table are the `data` **subtypes** where a port has one (`person`, `tasks`,
`stats`, `milestone`); see [Meaningful links](#meaningful-links).

**Dependencies** are a card field, not a component: `blockedBy: [cardId]` draws a dashed red
arc from the blocker to the blocked card and a lock glyph on it; the card editor's *Blocked by*
section is a multi-select over the other cards.

**How boards connect to flows and timelines.** `progress` (stats) and `tasks` are ordinary
`data` outputs re-evaluated every frame, so a Timeline (`tasks`), a Dashboard (`progress`), a
Person (`tasks`) or any Display node reads them live. `when a card moves` and `when a card is
done` are `event` outputs whose payload is the card, so a Flow Terminal → Flow Step → Flow
Decision chain can inspect `priority`, and an Action with an empty payload passes the triggering
card on to a Text template (`Urgent item shipped: {value.title}`) and a device screen. The
reverse works too: an Input button wired into `add task` creates cards, and a pulse with
`{ cardId, column }` on `move task` moves them. Tokens are visible: every event link grows a
bright bead that runs from source to destination when a pulse passes, and flow shapes flash as
the token goes through.

## Meaningful links

A cable is a **relationship**, not only a value. Both ends can read it (`ctx.upstream(key)` /
`ctx.downstream(key)` return the instances on the other end), and the project components use it:

- **Person → board `people`**: the board lays the person out — one connected person
  *highlights* their cards (others dim to 30 %, theirs get a colour tag), two or more give a
  **swimlane per person** across every column plus an *Unassigned / others* lane (the board
  grows taller), and `people view` can force `highlight` / `filter` / `swimlanes`. The **Person
  card lists their tasks** on every board it is plugged into, grouped by column with due dates
  (overdue in red) and a load bar against capacity; the panel shows the same list and a click
  opens the card on its board. The card editor lists connected people first. **Assign by
  dragging**: a card slab dropped on a Person block, a Person dropped on a card, or a card dropped
  into another person's lane — all undoable.
- **Milestone → board `milestone`**: the header shows *⚑ Public launch · 10 d left* and cards
  due after it get a small flag. Milestone → Timeline draws the flag on the rail; Milestone →
  Dashboard counts down.
- **Board `progress` → Dashboard**: the dashboard names the board; **People → Dashboard `people`**
  adds a load bar per person.
- **Sentences.** Every link explains itself: *"Maya's tasks appear on Website relaunch"*,
  *"Website relaunch's tasks fill the Release plan"*, *"Website relaunch's progress drives the
  Relaunch health"*, *"When a card is done on Website relaunch, the flow starts at Card done"*,
  *"Public launch is the deadline on Website relaunch"*. The sentence shows in the cable's
  midpoint label (hover or select), in the panel for a selected cable and as a 2-second toast
  when a link is created (`pm/relations.js`; a component may provide its own `describeLink`).

**Subtypes.** `data` ports carry a subtype — `person`, `task` / `tasks`, `board`, `milestone`,
`stats`, `layout` — with its own colour (coral, green-teal, indigo, gold, grey-blue, lavender;
see the *Project types* row of the legend). A person cable only fits a person slot; a subtyped
input takes plain `data` only when its definition says `loose` (the Timeline's slots do). The
tooltip reads `data · person`, the drag label and the toast say why a drop is refused (*person
is not a tasks*).

**Multi-input sockets.** An input that accepts several cables is a **vertical rounded
rectangle** (Blender's multi-input socket) rather than a circle: it grows one slot per cable,
each cable ends in its own slot (top to bottom in connection order), the ports below shift down
as it grows (a node slab extends), it is a hollow outline while empty, shows a filled bar per
connected slot and a spare slot with a **+** while a cable hovers it. The board's `people`, the
timeline's `tasks` / `milestones`, the dashboard's `people`, the Layout's `items` and every
other `*` input work this way.

**Port names** are plain words (`people`, `tasks`, `progress`, `add task`, `move task`); event
outputs start with *when* (`when a card moves`, `when a card is done`, `when reached`, `when
complete`); flow shapes use `start` / `next` / `yes` / `no` / `condition`. Older documents that
used `cards`, `stats`, `card moved`, `add card` or `move` still load (the keys are mapped).

**Card controls.** Click a card → the panel shows the card editor (title, description,
assignee select — connected people first — + free text, due date, priority, tags, estimate,
column, checklist add / toggle / remove, blocked-by, delete). Drag a card → move it (ghost lifts
off the board, a slot shows where it lands; drop on another column, between cards, into another
person's lane to re-assign, or on a Person block to assign). Click a column panel → column editor (title,
WIP limit); the Board section adds, reorders and removes columns and lists every card. Click the
**+** tile → new card in that column. Every edit is one undoable command (`Ctrl+Z`); engine-driven
edits (event inputs) are not undoable but still autosave.

## Generate content with AI

The **Generate** category (toolbar glyph: a sparkle; accent violet) brings hosted AI into the
same registry as everything else: typed ports, params, `evaluate`, a live face — so a generated
tweet is just `text` and a generated poster is just `media`.

| id | Inputs | Outputs | What it does |
| --- | --- | --- | --- |
| `prompt` | `variables` any\* · `text` text | `prompt` text | A prompt template. Every component plugged into `variables` becomes a variable named after its title (`{Card title}`, `{Public launch}`); `{1}` picks by position, `{Name.path}` reaches into an object, `{text}` is the text input. The face typesets the template with the resolved values as chips; the panel has a proper editor with insert chips and a resolved preview. |
| `generate-text` | `prompt` text · `context` any\* · `image` media · `run` event | `text` · `data` · `when done` · `usage` | Asks a language model through **OpenRouter** (hundreds of models, live per-token pricing) or **Demo**. The answer streams onto the face and the `text` output as it arrives; `context` inputs become system context, `image` goes to vision models, **JSON mode** parses the answer into `data`, `when done` pulses with the text (→ a board's `add task` makes a card), `usage` carries tokens and cost. |
| `generate-image` · `generate-video` · `generate-audio` | `prompt` text · `negative` text · `settings` data·settings · `reference` media · `guides` data·guide\* (image, video) · `mask` media (image) · `run` event | `image / video / audio` media · `all` data · `when done` · `usage` | Text (and an optional reference) to media through **fal.ai** (FLUX, Recraft, Ideogram, Kling, MiniMax, Luma, Stable Audio, Kokoro TTS…), **kie.ai** (Nano Banana, FLUX 2, Veo 3, Kling 2.1, Suno…) or **Demo**. Model options are schema-driven per model (size, aspect, duration, voice, steps, seed, count). The face shows queue position, progress with the provider's log line, the result preview and a history strip; Cancel and Retry work on the face, in the panel and in the job tray. |
| `generate-settings` | — | `settings` data·settings | **Settings** — one sheet for every generator it feeds: size (square, portrait 3:4 / 9:16, landscape 4:3 / 16:9, custom w × h), steps, guidance (cfg), strength (denoise), seed with an **after run** rule (fixed · increment · decrement · random, ComfyUI's *control after generate*), count 1–4, and a Style section (LoRA URL + scale, a style preset appended to prompts). `applySettings` maps it onto the keys the chosen model's schema knows (image_size / aspect_ratio, num_inference_steps, guidance_scale, strength, seed, num_images); a language model takes only the seed. The face is a compact sheet whose numbers edit in place; a dice chip cycles the after-run rule. |
| `generate-guide` | `image` media | `guide` data·guide | **Guide** — an image that steers a generator: *image to image* (strength = how far to move from it), *edges* (a live Sobel trace computed in the browser, cached per source, sent as the control image), *depth*, *pose* (ControlNet conditions) or *style reference*. fal picks the endpoint (flux/dev image-to-image, flux-general `controlnets`, flux-pro ultra redux); kie says *not offered*; Demo tints its painting with the guide's average colour and draws the edges on top. |
| `generate-mask` | `image` media | `mask` media (role `mask`) | **Mask** — white where a generator may paint: solid, rectangle, ellipse (fractions), *from image* (luminance / alpha / colour key + threshold) or **paint** — press and drag on the face with a white brush (erase toggle, brush size, Clear); grow / feather / invert finish it. Rendered off-screen at the reference image's size (1024² without one). Into a Generate Image's `mask` = inpainting (fal flux-pro fill; the model chip reads *· inpaint*; Demo paints only inside it) or an Image Edit `mask`. |
| `image-edit` | `image` media · `image B` media · `mask` media | `image` media | **Image Edit** — resize (fit / keep aspect), crop, pad (fill or transparent = an outpaint canvas), rotate / flip, adjust (brightness, contrast, saturation, blur, sharpen), blend (opacity + mode), composite (B over A through the mask), invert, grayscale. Pure Canvas 2D, computed ~150 ms after a change, stored in IndexedDB under a hash of sources + params so a reload keeps it and an unchanged edit is reused. Before / after face with the numbers editable in place; a ↓ chip downloads the result. Free and offline. |
| `enhance` | `image` media · `run` event | `image` media · `when done` · `usage` | **Enhance** — upscale ×2 / ×4, remove background, restore faces. Provider **browser** (two high-quality Canvas resamples, free, instant; upscale only), **fal** (Clarity upscaler, AuraSR, BiRefNet, CodeFormer — curated, unverified), **kie** (not offered → a clear error) or **Demo** (a browser upscale behind a short fake progress, a checkerboard cut-out). Same job lifecycle, face and history as the Generate nodes. |

**Connections** (**File → Connections…**, **View → Connections…**, or the *Open Connections* action any
Generate component shows when it lacks a key) is a settings page with one card per provider:
description, masked key field, **Test** (latency, balance where the API gives one), an optional
**proxy URL**, and a status chip. Keys are encrypted with WebCrypto **AES-GCM** in this browser's
`localStorage` — with a random device key by default (which only obfuscates) or a **passphrase**
you set (PBKDF2; the vault locks after a reload until you enter it). Keys are never written into
world files and go only to the provider (or to the proxy you configured). **Demo** needs no key
and costs nothing: every Generate component starts on it, which is how the Showcase's Generate
zone runs out of the box.

**Cost controls.** Each component estimates a run before it starts (OpenRouter live prices, fal /
kie curated prices) and asks for approval on its face above a per-component threshold (**approve
above $**, default $0.05); `run` is an event input, so an Input button or a Flow Decision gates an
expensive job with a click. The **job tray** (bottom right) lists running and queued jobs with
progress, cancel and the **session spend**; clicking a job frames its component. The **model
browser** (the model row in the panel or the model chip on the face) searches, filters by
provider / price band / context / vision, sorts, keeps favourites and shows prices per 1M tokens or
per run with *recommended* badges.

**Results are values.** Generated text feeds Display, Text, screens, Kanban `add task` (via
`when done`), another Prompt or Generate; generated media feeds Media Grid, screens, Display, a
Generate Video's `reference`, an Image Edit, a Guide, a Mask, an Enhance and a board's **`cover`**
input (the card named in *cover goes to card* — else the first card — shows the picture as a
thumbnail; the card editor has a cover row). All of these are drop-to-link pairs too (*"Settings'
settings drive Render"*, *"Edges guides Render"*, *"Render paints only inside Mask"*, *"Grade edits
Render's image"*). Stored results (Demo output, provider files fetched into the page, Image Edit
and browser Enhance output) live in **IndexedDB** so a reload keeps them; the world JSON holds
the media record with its `storeId`, never a key.

**Shaping a generation.** Hosted APIs, not local diffusion: ComfyUI's loaders, latents and
samplers collapse into three primitives. A **Settings** node plugged into any generator's
`settings` input overrides size, steps, guidance, strength, seed and count where the model's
schema has the key, lends a LoRA to the fal models that take one and appends a style prefix to the
prompt; after every finished job it advances its seed by its *after run* rule (that write is
automatic, not an undo step — the panel says so). A **Guide** on `guides` (image to image, edges,
depth, pose, style reference) and a **Mask** on `mask` switch the fal endpoint (image-to-image,
flux-general with `controlnets`, redux, flux-pro fill); kie refuses them in plain words; the
offline **Demo** shows the effect (tint, edge trace, painting only inside the mask). A `negative`
input (or the panel's fallback text) becomes `negative_prompt` on the models that accept one —
the panel says *negative prompt ignored by this model* otherwise, and the field is dropped.

**Files in, files out.** A Media node takes a file three ways: **Choose file…** in its panel,
a file **dropped on the block** (a document-level drop handler resolves the block under the
pointer; a drop on empty space adds a Media block for it, a `.json` opens as a project), or
**Ctrl+V** of an image while the block is selected. Files are stored in IndexedDB and the media
record with its `storeId` sits in `params.file`, so a reload finds the picture again. Every
Generate, Enhance and Image Edit face has a small **↓** chip beside the history strip that
downloads the current result (text as `.txt`, media as its file); a Media Grid's panel has
**Download all**.

**One image per row: Iterate.** The Action component's **iterate** mode walks a list — an array
payload, an object's values, or text split on newlines / commas — one item per trigger (or every
*interval* ms with *auto* on): `result` is the item, `index` its position, `done` pulses when the
last item went out (the next trigger wraps). Wire an Input button into the Iterate's `trigger`
and into a Generate Image's `run`, and the Iterate's `result` into a Prompt's `variables`: the
Prompt reads the current row before the run pulse reaches the generator, so each press paints
the next row; with *auto* on and a timer-free graph the list runs on its own.

**Bypass.** `Ctrl+B` (or *Edit → Bypass*, with a check mark while the selection is muted)
toggles `enabled` on the selected blocks in one undoable step. A bypassed block does not evaluate;
the engine carries its first input of each output's type straight to that output (`any` matches
anything, a multi input gives its first item), so a muted Image Edit hands the picture on and a
muted Text passes its text — the graph downstream keeps working while you compare with and
without a step.

The endpoint shapes for OpenRouter, fal.ai and kie.ai follow their public docs from memory (the
docs were not reachable while this was built); curated model ids and prices are marked
*unverified* in the model browser until run against the live API. If a network blocks a provider,
deploy `proxy/cloudflare-worker.js` (a minimal allow-listed CORS proxy that injects nothing) and
paste its URL on the provider's card. Design notes, the security model and how to add a provider
or a model: [`docs/AI-GENERATION.md`](docs/AI-GENERATION.md).

## Controls

Navigation is a **preset** (`src/controls/presets.js`): plain data that maps mouse buttons +
modifiers, the wheel and keys to actions. Pick one under **? → Controls** or in the workspace
panel (*Controls* section); the help legend shows the active preset's cheat sheet, generated
from the same object. Per-preset settings — invert orbit, invert zoom, orbit / pan sensitivity,
zoom to cursor, fly speed — live in the same panel section and persist per preset
(`localStorage["proto3d.nav.v1"]`).

| Preset | Orbit | Pan | Zoom | Select | Notes |
| --- | --- | --- | --- | --- | --- |
| **Blender** (default) | middle-drag · `Alt`+left | `Shift`+middle · `Alt`+`Shift`+left · `Shift`/`Ctrl`+wheel | `Ctrl`+middle · wheel | click · `Shift`+click adds · left-drag on the floor box-selects · right-click selects + opens properties | `Numpad 1/3/7` front / right / top (`Ctrl` for the opposite side), `Numpad 5` orthographic, `Numpad 2/4/6/8` 15° steps, `Numpad .` / `Shift+F` focus, `Home` frame all, `A` all, `Alt+A` none, `X` delete, `Shift+D` duplicate + move, `G`/`R`/`S` gizmo move / rotate / scale, `Tab` panel |
| **Unreal** | `Alt`+left | middle-drag | wheel | click · `Ctrl`+click adds · left-drag box-selects | right-drag **looks around**; right-drag + `W A S D` / `Q E` **flies** (wheel changes fly speed); `F` focus |
| **Maya** | `Alt`+left | `Alt`+middle | `Alt`+right · wheel | click · `Shift`+click adds · left-drag box-selects · right-click properties | `F` focus, `A` frame all |
| **Simple** | left-drag on empty space | right-drag | middle-drag · wheel | click · `Shift`+click adds · `Shift`+left-drag box-selects | the previous scheme |
| **Trackpad** | two-finger scroll · `Alt`+left | `Shift`+two-finger scroll · right-drag (two-finger click) · `Alt`+`Shift`+left | pinch · `Ctrl`+scroll | click · `Shift`+click adds · left-drag on the floor box-selects | Simple's keys plus Blender's numpad views; in 2D the plain scroll pans |

**Trackpads.** A pinch zooms towards the cursor in every preset (the browser reports it as a
Ctrl+wheel; Proto3D tells it from a real Ctrl+wheel by watching the Control key). If you scroll
with a trackpad while the default preset is on and you have never picked a preset, a small pill
offers to switch to Trackpad controls once; × makes it never ask again. **Touchscreens** work in
every preset: one finger on empty space orbits (pans in 2D), two fingers pan and pinch-zoom at the
same time, a tap selects a block and a one-finger drag moves it (or connects, from a pin), a
long-press on empty space box-selects and a long-press on a block opens its properties. Pins and
cable ends have finger-sized hit areas; buttons grow to 40 px on coarse pointers. A one-line
hint at the bottom of the viewport explains the gestures for your device the first time.

Everything else is the same in every preset:

| Action | Input |
| --- | --- |
| Focus | `F` frames the selection · double-click a group · `Home` or **Frame all** frames everything (camera flights are smooth) |
| Add | left toolbar → category → click a component (adds at the camera target on a free slot) or **drag it into the scene** (ghost footprint, drops where the ray hits the floor) · `Shift+A` opens search |
| Move | drag a block (all selected blocks move together; `Shift` for height in 3D) · gizmo `G`, `W` / `E` / `R` (the **Gizmo** button in the viewport header at the top of the viewport shows the mode; its caret picks Move / Rotate / Scale) · Transform fields in the panel |
| Snap | `M` (or the **magnet** in the viewport header) turns snapping on and off (off by default; the choice is remembered); the magnet's caret opens Blender-style *Snap to* settings (also *View → Snap ▸*) that pick the kinds, each remembered: **grid** with a size of 0.25 / 0.5 / 1 / 2 units, **objects** (a dragged block's edges and centres line up with its neighbours', with guides), **ports** (a pin lands level with the pin it is wired to so the cable runs straight), **rotation** (gizmo steps of 15° by default — 5 / 10 / 15 / 30 / 45 / 90 or any angle under *Rotation step*) and **scale** (0.25 by default — 0.05 / 0.1 / 0.25 / 0.5 / 1 or any value under *Scale step*) · `Shift` while dragging skips snapping, `Ctrl` halves the grid · objects and ports win over the grid within their reach |
| Edit in place | **double-click a block** (or select it and press `Enter`, or the pencil in the mini toolbar, or *Edit → Edit content*) to enter **edit mode**: the block gets a frame in its category colour and every editable text on its face — a Sticky Note, a Prompt (and each of its variable chips), a Text, a Data node's JSON, a Person's name or role, a Display caption, an Input button's label, a Checklist item, a Kanban card or column title, a Timeline bar, a Milestone's title or date, a flow shape's label — is marked; click one and type where it is, in perspective: `Enter` saves (`Shift+Enter` for a new line), `Esc` closes, `Tab` / `Shift+Tab` move to the next / previous field, `↑` / `↓` nudge a number · a double-click on text opens it straight away · the camera glides to face the text when it is too small or too oblique to read and comes back after (*View → Glide to text when editing*) · `Esc`, a click elsewhere or the pencil (*Done*) leaves edit mode; nothing drags while it is on · every edit undoes and the panel follows |
| 2D | `2` (or the menu bar toggle, *View → 2D editing mode*) flips to a **top-down plan**: every block is a flat card with its face and pins, cables are flat splines under the cards, left-drag on empty space box-selects, middle-drag or `Space`+drag pans, the wheel zooms about the cursor; `2` again flies back to the 3D pose you left |
| Arrange | `L` or *Edit → Auto-layout* arranges the selection (two or more) or everything as a left-to-right graph along the cables — groups stay together, unconnected blocks go in a grid below; one undoable, animated step, in 2D or 3D |
| Link | **drop a component onto another** (a sentence shows what it will mean; a chooser appears when several links fit) · with wiring on: drag from an **OUT** pin to a lit **IN** pin (or backwards from an empty input); the cable snaps within ~1.2 units · **drop the cable on empty space** to pick a component that fits the pin (searchable, grouped, exact types first): it is added with its pin at the drop point and connected, one undo step |
| Wiring | `P` or the **Wiring** button in the viewport header shows / hides every pin and cable · its caret sets *Ports on selection* (follow the switch / always show / always hide), the flow animation and the cable settings · the eye icon in a block's panel header overrides it for that block |
| Re-route | grab a cable near either end (hand cursor) and drop it on another compatible pin · drop on empty space to **disconnect** · `Esc` puts it back |
| Route | **drag the middle of a cable** to add a waypoint there and move it (the cable passes through it) · drag a handle to move it (snaps to the grid and to other waypoints) · drop it on another cable's handle or on a bundle trunk to **share** it (the cables run together through it) · `Alt`+click a handle removes it (unpins a shared one) · double-click a handle resets the cable · handles show on hover and selection, always with *View → Cables → Show waypoints* |
| Cables | the *Cables* rows of the viewport header's **Wiring** popover (also *View → Cables ▸*; remembered like the theme): **Style** Smooth / Orthogonal (90° turns, *Corner rounding* 0–1) / Straight · **Thickness** · **Bundle parallel cables** with a *Bundle distance* (cables running side by side merge into one neutral trunk and split near the pins; hover the trunk to list them, click it to select them) |
| Inspect | hover a pin: tooltip with name, type, value and links; compatible pins glow, others dim · hover a block: label + description · click a block: its cables stay bright with far-end labels · click a cable: midpoint label, both pins pulse, panel shows from → to |
| Edit | `Ctrl+D` duplicate (with internal connections) · `Delete` · `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) undo / redo · the menu bar's quick toggles have undo / redo |
| Group | `Ctrl+G` group the selection · `C` collapse / expand · `Ctrl+Shift+G` ungroup · drag the frame to move the whole group · rename in the panel |
| Interact | click a device screen (`tap`), an Input face (button, toggle, slider) or press the configured key · click / drag a **card** on a Kanban board (drop it on a **Person** or into a lane to assign it), click the **+** tile, click a checklist row, press the **Run** disc on a Flow Terminal, drag a Timeline bar's end handle |
| File | menu bar **File** → New file (`Alt+N`, a new tab) · Open… (`Ctrl+O`) · Open recent (thumbnails, last opened) · Save (`Ctrl+S`, downloads JSON) · Save as… · Rename file… · Version history… · Close tab (`Alt+W`) · Import… (merge a JSON file) · Export (selection as JSON, screenshot PNG) · Examples · Connections…; autosave into the browser 1.5 s after every change |
| Tabs | one tab per open project under the menu bar · click / `Ctrl+Tab` (`Alt+]` where the browser keeps it) switch · `+` new · drag to reorder · middle-click or × closes (a dirty tab asks Save / Discard / Cancel) · double-click renames · dot = unsaved changes · the indicator at the right end shows Saved · just now / Saving… / Unsaved changes and offers Save now, Download JSON, Version history |
| Edit | menu bar **Edit** → Undo / Redo · Cut / Copy / Paste (`Ctrl+X` / `Ctrl+C` / `Ctrl+V`, also between tabs) · Duplicate · Delete · Select all · Deselect · Auto-layout (`L`) · Group / Ungroup · Collapse |
| View | menu bar **View** → theme (`T`) · grid · wiring (`P`) · ports on the selection · flow animation · Cables ▸ (style, corner rounding, thickness, bundling, waypoints) · 2D editing mode (`2`) · Snap ▸ (`M`, grid size, objects, ports, rotation, scale) · gizmo (`G`) and its mode · properties panel (`N`) · Add toolbar · performance stats (`I`) · frame selection / all · reset view · orthographic · navigation preset · level of detail |
| Help | menu bar **Help** → Start panel · tour · keyboard shortcuts (`Shift+?`) · help & legend (`H`) · documentation · About |

Shortcuts are ignored while typing in a panel field.

## Projects: tabs, autosave and version history

Every open project is a **tab** in the slim strip under the menu bar — its own scene, undo
history, camera, 2D mode and selection; switching swaps them into the one renderer without a
reload (background scenes stay in memory, detached; up to 8 tabs). **File → New** opens a tab;
**Open…**, **Open recent** and **Examples** open in a new tab unless the current one is an
untouched empty project. A dot on a tab means unsaved changes (changes since the last Save or
open); closing such a tab asks **Save** (downloads JSON) / **Discard** / **Cancel** in a themed
dialog. A reload brings every tab back, the active one in front.

**Autosave** writes the active project to this browser (IndexedDB) 1.5 s after you stop; the
indicator at the right end of the strip says *Saved · 2 min ago*, *Saving…*, *Unsaved changes* or
*Autosave off* (hover it for the time, where it saves, **Save now**, **Download JSON**, a switch and
**Version history**). `Ctrl+S` still downloads a JSON file. Older documents in `localStorage`
migrate on the first load.

**File → Version history…** opens a drawer with the project's snapshots: taken automatically on
autosave when the content changed (at most one every 2 minutes), on every manual save, before a
restore and with **Snapshot now**. Each shows when, its kind, size and a one-line diff ("+2
components · 1 renamed · 3 cables changed · 4 params changed"); give one a **name** to keep it
past the 50-version cap. **Preview** opens it read-only in a temporary tab, **Restore** replaces
the project as one undoable step, **Duplicate as tab** makes a new file of it, **Delete** and
**Clear older than…** free space. The footer shows what the project and all projects take and how
much of the browser's storage quota this site uses, with a warning near the limit. **File → Open
recent** lists every project in the browser with a thumbnail and when it was last opened; open
ones come to the front.

## Home: projects, tasks, calendar

The **Home** tab is the permanent first tab of the strip (also **Alt+H** and **File → Projects**):
a full page over the viewport, the rail and the panel staying put, that lists every project in
this browser. A project is one room of components plus a card of metadata — a **key** (2–6
letters derived from the name, *Website relaunch* → `WR`), description, status (*planning ·
active · on hold · done · archived*), colour, tags, members with a role (*owner · manager ·
member · viewer*), start and due dates — stored with the record and written into the JSON as
`project`, so a saved file brings it along.

- **Projects** — a grid of cards: thumbnail or colour, name and key, status chip, tags, member
  avatars, a progress ring from the project's cards (done = in the last column), next due, when it
  was last opened, a dot when it is open in a tab. Search, status chips (archived projects hide
  until you ask for them), a tag and a member select, sort by last opened, name, due or progress.
  Click a card to open it; its **⋯** menu offers *Open · Edit… · Duplicate · Archive · Delete*.
- **Tasks** — a sortable table over every card and timeline task of *this project*, *all*
  projects or *mine* (assigned to who you are): task, project, column, assignee, start, due
  (overdue in red), priority, hours logged against the estimate, comment count. Column,
  assignee (the directory, or *Other…* for a name), start, due and priority edit inline; a
  project open in a tab takes the change as an undoable command (Ctrl+Z on the board), a closed
  one is written straight to the browser (*Saved to … (closed)*). The chevron on a row opens the
  card's **activity** — created, moved, comments and time logs, a comment box (Ctrl+Enter) and a
  *Log time* row — and **New task** adds a card to any project's board and column. The task name
  opens the project and selects the card.
- **Calendar** — **Month · Week · Agenda** over the same scope (*This project · All · Mine*),
  with Today, ‹ ›, ← → and **T**. Cards with a due date are chips in their project's colour with
  a priority stripe (done struck through, overdue tinted); a card with a start and a due is a
  **span** — a bar across the days in Week view, a thin bar through the cells in Month view;
  milestones are flags, a project's own start and due small markers, and **Show time** adds the
  hours logged per day. Click a chip to open the card, a flag to open the milestone, a day's **+**
  to add a task due that day. **Drag a chip** to another day to reschedule it — open, background
  and closed projects alike (undoable when the project is the active tab); **Shift+drag** keeps
  the span length. Agenda lists the next 30 days (and what is overdue).

**New project** (the Projects tab on Home; a workspace tab is a *file*, File → New file) opens the Create Project dialog: name, key,
description, colour, status, dates, tags (Enter or comma adds), **People** from the browser's
directory with a role each (an inline row adds someone new) and **Start from** — blank, a starter
template or the Showcase. **File → Project settings…** and a card's *Edit…* reopen it for an
existing project. The **You are …** picker at the right of the Home header says who you are in
the directory. The **Person** component's panel gets a *from directory* select that fills a
Person from a directory entry (undoable) and *Add to directory* for a new name.

**Comments and time on cards.** A card's panel has an **Activity** section (the feed, a comment
box; you delete your own comments) and a **Time** section (*2.5h logged · estimate 2d (16h)* with
a bar that turns red when over, a *Log time* row — hours, date, note — and the entries). Who
writes is the person you picked as *You are …* (Home, or the one-line pick in the section). The
card shows a clock with the hours and a bubble with the comment count in its bottom row; the
Dashboard gets a **logged** tile (hours against the estimate, 8 h per estimated day); a Person
shows *2.5h this week* under its load bar and the hours beside each task.

There is no server: projects and the people directory live in this browser (IndexedDB); share a
project with **File → Save**, and open the file elsewhere. Live sync is a later step.

## Cable management

Cables route themselves, and you can take over. **Drag the middle of a cable** to add a waypoint
where you grabbed it and pull the cable through it; drag the small round handle to move it (it
snaps to the grid and lines up with other waypoints under the Snap settings), `Alt`+click to remove
it, double-click to send the cable back to automatic routing. Drop a handle on **another cable's
handle** and the two cables share that point — one node, dragged together — or drop it on a
**bundle trunk** to join the bundle. Waypoints are saved with the project (`route` on the link,
shared nodes in `routeNodes`), undo like everything else and travel with the blocks when both ends
of the cable move together. Cables that run roughly parallel and close (within *Bundle distance*,
1.2 units by default, over at least 40 % of their length) merge into one thicker neutral **trunk**
on which they ride as thin coloured stripes and from which they fan out near the pins; hover the
trunk to see which cables are in it, click it to select them, turn it off under *View → Cables →
Bundle parallel cables*. The **style** is global and remembered: **Smooth** curves, **Orthogonal**
runs with 90° turns for a schematic feel — like cable trays: a short drop beside each pin, then
horizontal runs at one height (the lower pin's, or just above the floor for long runs), a forward
link turning at a staggered mid column, a backward one going around the blocks between the rows
(*Corner rounding* 0 for sharp corners up to 1 unit) — or **Straight** segments — for every cable, in 3D and 2D, for the trunks and for the cable
you are dragging. Thickness is a setting too.

## 2D editing mode

3D shows the system; 2D is faster for wiring. Press **`2`** (or the menu bar toggle) and the camera
flies (0.35 s) to a top-down orthographic plan framing the scene or the selection. Every block lies
flat as a card showing its live face, title and pins — inputs on the left, outputs on the right —
so wiring works exactly as in 3D: drag from a pin, drop a block onto another, pick up a cable end
to re-route or disconnect. Cables become flat splines running under the cards (flat Manhattan runs
in the Orthogonal style; waypoints and bundles work here too); the value chips,
dimming and end labels stay. Orbit is off: left-drag on empty space box-selects in every preset,
middle-drag or `Space`+drag pans, the wheel zooms about the cursor. Moving a block snaps by the
kinds turned on under *View → Snap* (`M`): the grid (0.25–2 units; `Ctrl` halves it), the edges
and centres of its neighbours with design-tool guides, and the pins it is wired to so cables run
straight; `Shift` skips snapping for that drag. Double-clicking a flat card enters edit mode
exactly as in 3D and the editor lies on the card. **Edit → Auto-layout** (`L`, or the mini toolbar
with several blocks selected) arranges blocks as a left-to-right layered graph along their cables,
keeping groups together. Positions are shared between the modes (the plan's x / z are the room's
x / z), the mode itself is never saved, and `2` again flies back to the 3D view you left.

## Wiring is optional

A fresh workspace starts with **wiring off**: no pins, no port labels, no slot sockets and no
cables — blocks read as clean cards. Turning wiring on only reveals the pins beside the content;
no block changes size.
The graph is still there and still runs; you build it by **dropping one component onto another**.
While a single block is dragged over another, `pm/relations.js → dropLinkCandidates` looks up the
pairs of ports that make sense (`DROP_LINKS`): Person → board `people` / dashboard `people` /
a screen; Milestone → board / timeline / dashboard; Board → timeline `tasks`, dashboard
`progress` or `tasks`, person `tasks`, flow terminal `start`; Checklist → dashboard
`checklists`; Media → media grid / screen / display; Media Grid → screen; Input → board
`add task`; a device `tap` → a flow start; Text / Action / Sticky Note → screens and displays;
and any flow-ish event output (`out`, `next`, `yes`, `no`, `done`, `tap`, `reached`) → any
flow-ish event input (`start`, `trigger`). Pairs that already exist or would replace the cable on
an occupied single input are skipped. With **one** candidate the drag label shows the sentence
and the drop creates the link (undoable *Connect* + a toast); with **several**, a small chooser
lists the sentences at the drop point. The target block lights up while it is a drop target.
Dropping a Person on a **card** still assigns the card.

Turn wiring on with **`P`**, the **Wiring** button in the viewport header or the workspace panel: every pin, label,
caption, socket and cable appears and everything in [Wiring](#wiring) applies. The switch is
persisted in `localStorage["proto3d.wiring.v1"]` and inside saved documents (`wiring`), so an
autosaved world keeps its setting; the eye icon in a block's panel header overrides it for that
block (`showPorts: true | false`, saved with the block). The tour turns wiring on for its wiring
steps and restores it afterwards.

## Wiring

**Port anatomy.** Every port is a short stem out of the side face plus a typed pin: **event**
ports are chevron pins pointing in the flow direction (into the body on the left for inputs, away
from it on the right for outputs, like exec pins in a node editor); **data** ports (number, text,
boolean, data, media, any) are spheres; inputs that **accept several cables** are vertical
rounded rectangles that grow one slot per cable. A **connected** pin is filled and bright in its
type (or subtype) colour; an **unconnected** pin is a hollow ring (dark core, coloured outline);
an empty socket is a hollow rectangle, a connected one shows a bar per cable and a spare **+**
slot while a cable hovers. Optional ports are slightly smaller. Pins sit **level with the content
they affect** when the component says where that is (`portAnchors`: a Display's pin points at
its value, a board's `people` slot at the first swimlane header, a Timeline's `tasks` at the
first bar row, a Dashboard's inputs at the panels they fill); otherwise they are stacked beside
the content. Inputs are on the left, outputs on the right — there are no IN / OUT captions. Port
**names** are hidden until you need them: they fade in beside the pin you hover, on both ends of
a cable you hover, on every compatible target while you hover a port or drag a cable (dimmed on
incompatible ones during a drag) and on every pin of a selected block.

**Hover.** Over a pin (crosshair cursor) an HTML tooltip follows it with the name, type label
(`data · person`, *accepts several cables*), current value and one line per link (`→ Notify
team.start`); every compatible port on other blocks glows with a pulsing rim in the type colour,
incompatible ones dim to 35 %, the hovered pin grows.
Over a block body (hand cursor) a small tooltip gives the component label and description after
half a second. Over a cable end (grab cursor) the end ring enlarges and the tooltip reads *drag
to re-route · drop on empty space to disconnect*.

**Creating a cable.** Drag from an output (or backwards from an empty input): the preview tube
follows the pointer, compatible targets glow and the cable **snaps** to the nearest one within
~1.2 units, an incompatible pin under the pointer shows a red ring and a not-allowed cursor, and a
label beside the pointer reads `type · from Node.port` (or `into Node.port` when dragging
backwards) plus the target it will connect to (or why it does not fit: *person is not a tasks*).
Dropping on a compatible pin connects (undoable *Connect*) and a toast says what the new link
means; dropping on an incompatible pin creates nothing and the preview fades. Dropping a **new**
cable on **empty space** opens a chooser at the pointer (Blender / Unreal "add node from link"):
every component · port that fits the dragged end, grouped by category, exact type and subtype
matches first, then number → text, then `any`, with a search field and ↑ ↓ Enter Esc; a pick adds
the component with its matching pin on the drop point (grid-snapped when snapping is on) and
connects it as one undo step (*Add Display and connect*); Esc or a click outside fades the preview.
Dragging from an already connected output adds another cable (fan-out); pressing a connected
single input picks up its existing cable instead (multi inputs start a new one).

**Moving and removing a cable.** Either end of an existing cable — the tube within ~0.9 units of a
pin and the end ring — is a grab handle. Drag it: the cable detaches (the pin goes hollow) and
follows the pointer with the same snapping and red-ring feedback. Drop on a compatible pin →
*Re-route connection* (one undo step); drop on empty space → *Disconnect* with a short toast;
`Esc` while dragging puts it back. Clicking a cable still selects it (`Delete` removes it; the
panel shows from → to, type, value and a **Disconnect** button).

**Selection.** A selected block keeps its cables bright and dims every other cable to 40 %; each
of its cables shows a label at the far end (`→ Release plan.tasks`, `Maya.person →`). A selected
cable makes both pins pulse, dims the others and shows the midpoint label with the link's
sentence and path (`Card done passes the token to Notify team · Card done.next → Notify
team.start · value`).

**Onboarding.** A five-step tour (toolbar → a real output pin with a ghost cable running to a
compatible input → the board's people slot → a card on the board → cable ends) runs once and is
replayable from **Help → Take the tour**; an empty scene shows *Add a component from the left to start*;
every toolbar button and quick toggle has a tooltip with its key; the help panel's legend shows the pin shapes
(including the multi-input rectangle), the type colours, the project types and the three wiring
rules.

### Connection semantics

- **Type** = the output port's type; a link is **valid** when `compatiblePorts(from, to)` is not
  `invalid`: same type, either side `any`, or `number → text` (coerced, drawn in the
  destination colour), and — for `data` — matching subtypes (a subtyped input takes plain data
  only when `loose`). The interaction layer never creates an invalid link (red ring, reason in
  the label); a link that becomes invalid (a loaded file) is red and dashed, carries nothing and
  flags both ends as `error`.
- **Direction** is left → right (inputs face −X, outputs +X), shown by the chevron pins and the
  continuous flow sheen; the chip on a hovered cable reads `value` over `From.port → To.port`.
- **Active** = the source changed or pulsed within 1.5 s (thicker, brighter, faster sheen);
  **idle** = carries a stable value; **inactive** = carries nothing (thin, dim).
- **Routing** (`routing.js`): cubic Bezier with horizontal tangents; connections sharing a
  source or destination fan out into lanes (small vertical / depth offsets); long links lift
  slightly; any link whose samples pass through another block's bounding box raises its control
  points until it clears the box. Backward links widen their handles into a readable loop.
- **Hover** isolates the path: every other connection dims to 25 %; a **value chip** appears at
  the cable's midpoint with what is flowing (a number, a text preview, `on` / `off`, `pulse`
  flashing as an event passes, `person · Maya Chen`, `12 tasks`, `stats · 2/10 done`,
  `image · Key visual`) and, on hover, the endpoint names (`Prompt.prompt → Generate Text.prompt`);
  the line under it says what the link means. **Click** selects and the panel shows from / to /
  type / state / value / changes per second.
- **Selecting a block** keeps its cables at full strength, puts a chip on each of them and dims
  every other cable to 25 % (their flow slows); a multi-select shows the union. Hovering a pin
  brightens its cables again. Chips never show at the far zoom and stop at 40 (nearest first).
- **Multi inputs** receive an array (connection order) and are drawn as a slot rectangle whose
  slots are that order. A single input with several links takes the **most recently changed**
  upstream value (this is how two Actions can share one screen).
- **Events** are pulses `{ t, n, payload }` that exist for one pass; a collapsed group exposes
  every boundary-crossing link on a proxy port so the interface stays visible.

## Look and feel

**Bodies.** Every body — node cards, device slabs, group slabs and frames, the board's back
panel, plinth, column panels and cards, timeline bars, the sticky note, the milestone flag and
base, the flow step — is one shape: `geometry.js → panelGeometry(w, h, depth, { radius, bevel })`,
a **2D rounded rectangle extruded** a little (nodes 0.16 units) with `bevelEnabled`, a **tiny
bevel** (0.02, two segments) and 12+ curve segments. The front and back faces are flat and crisp,
the sides straight; only the bevel catches the light. The outer size is what you ask for (the
bevel is inside it), the front cap's UVs map the cap exactly to 0..1 so a canvas texture lands
corner to corner (board cards use this: one mesh, the canvas on the front-cap material group,
plain sides), and `slabGeometry` is the same shape lying flat. Materials are satin
`MeshPhysicalMaterial` (roughness 0.45, clearcoat 0.4, clearcoat roughness 0.3, no metalness) lit
by a small procedural **environment map** (a sky / horizon / ground gradient with one soft
highlight, run through PMREM, rebuilt per theme) so bevels read without gloss. Selection / hover
/ error is a **thin outline**: a back-face shell 0.04 wider than the body.

**Two themes.** Dark is deep navy greys. Light is a cool, paper-like room layered so every surface
stands off the next: a mid-grey **floor pool** (fading to the background, with a soft grid), **white
bodies** lit a touch brighter (the light palette carries its own exposure, key-light and face
emissive tokens; the dark theme's stay untouched) and **white faces with a hairline edge**. Measured
on screen, a node body sits 1.3 : 1 off the floor and the board 1.5 : 1 (round 6 had both within
1.1 : 1), face text reads at 14 : 1. `T` toggles.

**Faces** are flat, modern UI drawn on canvas at 120 px / unit (`faces.js`): the type stack is
*Inter → SF Pro Text → Segoe UI → system-ui* (Inter via Google Fonts when online), titles 600,
labels 500, values 400, small caps with letter-spacing (`drawCaps`), tabular numbers; margins are
≥ 24 px on an 8-pt grid; structure comes from spacing and 1 px dividers (`drawDivider`) rather
than boxes, inner sections are slightly lighter tiles (`drawTile`, `drawStat`), tags and
assignees are chips (`drawChip`), progress is a thin rounded bar (`drawBar`), timestamps are
muted. `clear()` paints a rounded face card with transparent corners so faces sit on the
bevelled body. Colour is reserved for meaning — the category accent, type hues, `faceGood` /
`faceWarn` / `faceBad` — and neutral greys otherwise. Both themes are checked for contrast:
**dark** is deep navy greys (`#0b0f17` room, `#1a2231` bodies, `#161d2a` faces), **light** is a
warm off-white (`#f1eee8` room, `#fbfaf7` bodies) with soft shadows.

**Node anatomy**: a slim **accent line** in the category colour along the top edge, the title
left-aligned under it with the component kind in small caps at the right, an optional live canvas
**face**, and a dim footer with the output value. With wiring on the pins sit on the left (in)
and right (out) edges *beside* the face, stacked and centred on it (chevron pins for events,
spheres for data; filled when connected, hollow when free; multi inputs are slot rectangles that
grow one slot per cable — the stack slides along the edge before the card grows); their names are
small dim labels just outside the edge, riding above where the wire leaves. Wiring off hides the
pins and names and changes nothing else. **Devices** have thin bezels and satin frames; their screen is the face.
**Groups** are flat rounded frames on the floor with a title at the front edge; collapsed, a slab
with the same accent line and proxy ports. **The board** is a bevelled back panel on a flat
plinth: columns are frosted panels with a small-caps title and a count pill, cards are clean
extruded cards with a 3-px priority stripe, swimlane labels are side tabs in the margin. **The
timeline** has thin bars with rounded ends, light week gridlines and small labels. **The
dashboard** has stat tiles, a ring, bars, a burndown and people / checklist bars in a restrained
palette. The HTML shell (menu bar, left rail, flyout, panel, tooltips, toasts, chooser, tour cards,
menus) uses the same type stack, 8-pt spacing, 10–12 px radii, subtle borders, 18 px stroke icons,
hover states and focus rings; the menu bar's right end groups the quick toggles *Undo/Redo |
2D | Theme · Frame all | Help · Properties*, and the viewport header holds *Wiring (with the cable settings) · Snap · Gizmo*.

**States** are derived by the engine, never hard-coded: `disabled` (unchecked *enabled*) >
`error` (invalid link attached or `evaluate` threw) > `active` (an output changed / pulsed within
1.5 s) > `idle`; selection and hover overlay them as rims.

**Level of detail**: beyond the LOD distance (110 units, editable in the workspace panel) port
labels and footers fade out, titles lift above the slab and grow with distance like map labels,
connections thin, group titles enlarge; below it everything crossfades back.

**Port & connection colours** (dark / light): number teal `#2dd4bf` / `#0f9f8f`, text amber
`#f5b942` / `#c07f0c`, boolean magenta `#e25aa6` / `#c2388a`, data violet `#8b7cf6` / `#6a5cd6`,
media coral `#ff8a5b` / `#d9633a`, event white `#f4f6fa` / slate `#48556b`, any grey `#9aa7bb` /
`#6b7788`. Project subtypes: person `#ff8fa3` / `#d6456a`, task / tasks `#34c99a` / `#13906a`,
board `#6d7cff` / `#4655d6`, milestone `#ffd36b` / `#b88a12`, stats `#7d9cc6` / `#4d6a94`, layout
`#b59cf5` / `#7a5fd0`. The same tables colour ports, tubes, rings, panel dots and the legend.

## Roadmap

1. **More primitives, same schema**: HTTP / WebSocket sources, a Script component with a sandboxed
   `evaluate`, a Table view, a Chart output, a Store (persisted key-value) component.
   *Project management next*: card attachments (Media into a card), a Sprint component that
   scopes a board by date range, drag a Timeline bar bodily to shift both dates, a Calendar body,
   import / export of cards as CSV / JSON, per-person capacity planning on the Timeline, and
   collaborative editing once a transport exists.
2. **Real devices**: pair a phone through WebRTC so `tap` / `tilt` / `battery` are real; device
   presence drives the states.
3. **Routing at scale**: bundle parallel links, avoid group frames, and an auto-layout command
   (the Layout node already does it for its neighbours).
4. **Editing**: copy / paste across worlds, snapping, comments on the floor, sub-graphs
   (a group as a reusable component).
5. **Media**: real `<video>` / `<audio>` playback where the browser allows it, thumbnails in the
   panel (files already drop, paste and upload onto a Media node).
6. **Hardening**: instanced ports for thousands of nodes, occlusion-aware LOD, keyboard-only
   navigation, automated contrast checks for both themes.
7. **Look and feel, next**: user-editable navigation bindings (a preset editor on top of the
   preset objects), a "focus mode" that fades everything but the selected zone, per-category
   face templates so new components inherit the header / section / footer layout, and drop-to-link
   suggestions rendered as ghost cables while a component hovers a target.
