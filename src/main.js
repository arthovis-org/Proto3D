// main.js — boots the platform: theme, workspace, registry (all core components), world model,
// engine, history, selection, gizmo, interaction, guidance overlays, properties panel, Add
// toolbar, File / help menus, first-run tour, LOD, autosave, the example and the render loop. Exposes window.__proto for debugging / tests.
import * as THREE from 'three';
import { createWorkspace } from './workspace.js';
import { registry } from './components/index.js';
import { World } from './core/world.js';
import { Engine } from './core/engine.js';
import { History } from './core/history.js';
import * as cmd from './core/commands.js';
import { Selection } from './selection.js';
import { Interaction, isTyping } from './interaction.js';
import { Gizmo } from './gizmo.js';
import { Panel } from './panel.js';
import { LeftToolbar } from './ui/toolbar-left.js';
import { FileMenu } from './ui/file-menu.js';
import { Overlays } from './ui/overlays.js';
import { Tour, tourSeen } from './ui/tour.js';
import { createInstance } from './instance.js';
import { updateLOD } from './lod.js';
import { serializeWorld, loadWorld, downloadJSON, pickJSONFile, AutoSave } from './serialize.js';
import { examples, exampleById, buildExample, DEFAULT_EXAMPLE } from './examples/index.js';
import { setFlowEnabled, isFlowEnabled, setFlowSpeed, getFlowSpeed } from './connection3d.js';
import { portTypes, subtypes, states, hex, getTheme, toggleTheme, onThemeChange } from './theme.js';
import { formatValue, typeInfo, subtypeInfo, kindOf, portTypeName, mismatchReason } from './core/types.js';
import { describeLink } from './pm/relations.js';
import { onBitmapReady } from './faces.js';

const $ = (id) => document.getElementById(id);
const container = $('viewport');
const ws = createWorkspace(container);
const world = new World(ws.scene);
const engine = new Engine(world);
const history = new History();
const selection = new Selection();
world.history = history;      // components with 3D editing (cards, checklists) record undoable commands
world.selection = selection;

/* ---- Gizmo + interaction ---- */
const gizmo = new Gizmo({ camera: ws.camera, renderer: ws.renderer, scene: ws.scene, controls: ws.controls, world, history, onModeChange: () => panel.refresh() });
const connLabel = $('conn-label');
let hoveredConnection = null;
const overlays = new Overlays({ camera: ws.camera, renderer: ws.renderer, world, els: { tip: $('tip'), dragLabel: $('drag-label'), toast: $('toast'), endLabels: $('cable-labels'), emptyHint: $('empty-hint') } });
world.overlays = overlays;    // components may toast ("Assigned to Maya")
const interaction = new Interaction({
  camera: ws.camera, renderer: ws.renderer, controls: ws.controls, world, selection, history, gizmo, createInstance, overlays,
  onHoverConnection: (c) => { hoveredConnection = c; connLabel.hidden = !c; },
  onFocus: (blocks) => ws.frameBlocks(blocks, { insetLeft: leftBar?.isOpen ? 300 : 0 }),
  onFrameAll: () => frameAll(),
});
function frameAll(opts = {}) { return ws.frameBlocks([...world.nodes.filter((n) => n.visible), ...world.groups.filter((g) => g.collapsed)], { insetLeft: leftBar?.isOpen ? 300 : 0, ...opts }); }

/* ---- Properties panel ---- */
const panel = new Panel({
  el: $('panel'), world, engine, ws, gizmo, history, selection, interaction,
  flow: { isEnabled: isFlowEnabled, setEnabled: (v) => { setFlowEnabled(v); syncToolbar(); }, getSpeed: getFlowSpeed, setSpeed: setFlowSpeed },
  onGizmoToggle: () => syncToolbar(),
});

/* ---- Selection readout ---- */
const selectionEl = $('selection');
selection.onChange((sel) => {
  const item = sel.primary;
  if (!item) { selectionEl.textContent = 'Nothing selected'; return; }
  if (sel.size > 1) { selectionEl.textContent = `${sel.size} selected`; return; }
  if (item.kind === 'connection') selectionEl.textContent = `Connection  ${item.from.owner.title} · ${item.from.label}  →  ${item.to ? `${item.to.owner.title} · ${item.to.label}` : '—'}  (${item.type}${item.valid ? '' : ', invalid'})`;
  else if (item.kind === 'group') selectionEl.textContent = `Group  ${item.title}  ·  ${item.members.length} components${item.collapsed ? ' (collapsed)' : ''}`;
  else selectionEl.textContent = `${item.def.label}  ${item.title}  ·  ${item.inputs.length} in / ${item.outputs.length} out`;
});

/* ---- Add toolbar (left) ---- */
function addComponent(def, position) {
  const node = createInstance(def);
  const pos = position ? [position.x, node.kind === 'device' ? 0 : node.height / 2 + 0.4, position.z] : world.nextFreeSlot(ws.controls.target, node);
  history.execute(cmd.addNode(world, node, pos));
  selection.set([node]);
  return node;
}
const leftBar = new LeftToolbar({ el: $('left-bar'), ws, world, interaction, onAdd: addComponent });

/* ---- File menu ---- */
const autosave = new AutoSave(world, { extras: () => ({ camera: ws.camera, controls: ws.controls }) });
function loadExample(id) {
  const ex = exampleById(id); if (!ex) return null;
  selection.clear(); history.clear();
  const named = buildExample(world, ex, { camera: ws.camera, controls: ws.controls });
  engine.evaluate();
  const focus = ex.focus ? ex.focus(named).filter(Boolean) : [];
  if (focus.length) ws.frameBlocks(focus, { instant: true, fill: 0.7, insetLeft: leftBar?.isOpen ? 300 : 0 }); else frameAll({ instant: true });
  return named;
}
const fileMenu = new FileMenu({
  button: $('btn-file'), menu: $('file-menu'), examples,
  onNew: () => { selection.clear(); history.clear(); world.clear(); world.named = {}; },
  onSave: () => downloadJSON(serializeWorld(world, { camera: ws.camera, controls: ws.controls }), `proto3d-${new Date().toISOString().slice(0, 10)}.json`),
  onLoad: () => pickJSONFile().then((doc) => { selection.clear(); history.clear(); loadWorld(world, doc, { camera: ws.camera, controls: ws.controls }); }).catch((e) => { if (e.message !== 'cancelled') alert(`Could not load: ${e.message}`); }),
  onExample: (id) => loadExample(id),
});

/* ---- Legend swatches come from the theme so the overlay never drifts from the 3D language ---- */
const SHAPE_SVG = {
  chevron: (c, filled) => `<svg viewBox="0 0 16 12"><path d="M1 1h8l6 5-6 5H1z" fill="${filled ? c : 'none'}" stroke="${c}" stroke-width="1.6"/></svg>`,
  sphere: (c, filled) => `<svg viewBox="0 0 16 12"><circle cx="8" cy="6" r="4.6" fill="${filled ? c : 'none'}" stroke="${c}" stroke-width="1.6"/></svg>`,
  slot: (c) => `<svg viewBox="0 0 16 12"><rect x="4.5" y="0.8" width="7" height="10.4" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="6.5" y="2.6" width="3" height="2.2" fill="${c}"/><rect x="6.5" y="5.6" width="3" height="2.2" fill="${c}"/></svg>`,
};
function buildLegend() {
  const ev = hex(portTypes.event.color), num = hex(portTypes.number.color), per = hex(subtypes.person.color);
  const shapes = $('legend-shapes'); shapes.innerHTML = '';
  for (const [svg, text, title] of [
    [SHAPE_SVG.chevron(ev, true), 'chevron = event (a pulse)', 'Event pins point in the flow direction: into the body on the left, away from it on the right'],
    [SHAPE_SVG.sphere(num, true), 'circle = data (a value)', 'Number, text, boolean, data, media and any carry values'],
    [SHAPE_SVG.slot(per), 'rectangle = accepts several cables', 'A multi input grows one slot per cable (people on a board, tasks on a timeline); each cable ends in its own slot'],
    [SHAPE_SVG.sphere(num, false), 'hollow = not connected', 'A connected pin is filled and bright; an unconnected pin is a hollow ring'],
  ]) { const li = document.createElement('li'); li.innerHTML = `${svg}${text}`; li.title = title; shapes.appendChild(li); }
  const legend = $('legend-types'); legend.innerHTML = '';
  for (const [name, t] of Object.entries(portTypes)) {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${hex(t.color)}"></i>${name}`; li.title = typeInfo[name]?.description || '';
    legend.appendChild(li);
  }
  const sub = $('legend-subtypes'); sub.innerHTML = '';
  for (const [name, t] of Object.entries(subtypes)) {
    if (name === 'task') continue;   // same hue as tasks
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${hex(t.color)}"></i>${name}`; li.title = `data · ${name}: ${subtypeInfo[name]?.description || ''}`;
    sub.appendChild(li);
  }
  const legendStates = $('legend-states'); legendStates.innerHTML = '';
  for (const [name, c] of Object.entries(states)) {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${hex(c)}"></i>${name}`;
    legendStates.appendChild(li);
  }
}
buildLegend();
onThemeChange(() => { buildLegend(); panel.refresh(); syncToolbar(); });
onBitmapReady(() => world.nodes.forEach((n) => { n.faceDirty = true; }));

/* ---- Top bar ---- */
function syncToolbar() {
  $('btn-flow').classList.toggle('off', !isFlowEnabled());
  $('btn-gizmo').classList.toggle('on', gizmo.enabled);
  $('btn-theme').textContent = getTheme() === 'dark' ? 'Light theme' : 'Dark theme';
  $('btn-panel').classList.toggle('on', !document.body.classList.contains('panel-hidden'));
  $('btn-undo').disabled = !history.canUndo; $('btn-redo').disabled = !history.canRedo;
}
history.onChange(syncToolbar);
$('btn-flow').addEventListener('click', () => { setFlowEnabled(!isFlowEnabled()); syncToolbar(); panel.refresh(); });
$('btn-theme').addEventListener('click', () => toggleTheme());
$('btn-gizmo').addEventListener('click', () => setGizmo(!gizmo.enabled));
$('btn-panel').addEventListener('click', () => togglePanel());
$('btn-frame').addEventListener('click', () => frameAll());
const helpMenu = $('help-menu');
const closeHelpMenu = () => { helpMenu.hidden = true; $('btn-help').classList.remove('on'); };
$('btn-help').addEventListener('click', (e) => { e.stopPropagation(); helpMenu.hidden = !helpMenu.hidden; $('btn-help').classList.toggle('on', !helpMenu.hidden); });
helpMenu.querySelector('[data-action="help"]').addEventListener('click', () => { closeHelpMenu(); toggleHelp(); });
helpMenu.querySelector('[data-action="tour"]').addEventListener('click', () => { closeHelpMenu(); tour.start(); });
window.addEventListener('pointerdown', (e) => { if (!helpMenu.contains(e.target) && e.target !== $('btn-help')) closeHelpMenu(); });
$('btn-undo').addEventListener('click', () => { history.undo(); selection.prune(world); });
$('btn-redo').addEventListener('click', () => { history.redo(); selection.prune(world); });

function setGizmo(on) {
  gizmo.setEnabled(on);
  gizmo.setTarget(selection.nodes[selection.nodes.length - 1] || null);
  syncToolbar();
  panel.build();
}
function togglePanel(force) {
  const hide = force === undefined ? !document.body.classList.contains('panel-hidden') : !force;
  document.body.classList.toggle('panel-hidden', hide);
  syncToolbar();
  ws.resize();
}
function toggleHelp() {
  const help = $('help'); help.open = !help.open;
  if (help.open) { togglePanel(true); help.scrollIntoView({ block: 'nearest' }); }
}
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
  if (e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); leftBar.open('search'); return; }
  if (e.shiftKey) return;
  switch (e.key.toLowerCase()) {
    case 'h': toggleHelp(); break;
    case 't': toggleTheme(); break;
    case 'g': setGizmo(!gizmo.enabled); break;
    case 'n': togglePanel(); break;
    case 'w': if (gizmo.enabled) gizmo.setMode('translate'); break;
    case 'e': if (gizmo.enabled) gizmo.setMode('rotate'); break;
    case 'r': if (gizmo.enabled) gizmo.setMode('scale'); break;
    default: break;
  }
});
syncToolbar();

/* ---- First scene: the autosave if there is one, otherwise the project-management scene ---- */
const saved = autosave.load();
let restored = false;
if (saved && saved.nodes && saved.nodes.length) {
  try { loadWorld(world, saved, { camera: ws.camera, controls: ws.controls }); restored = true; } catch (e) { console.warn('autosave ignored:', e.message); }
}
if (!restored) loadExample(DEFAULT_EXAMPLE);
autosave.enabled = true;
overlays.setEmptyHint(world.nodes.length === 0);

/* ---- First-run tour: once per browser, re-openable from "?" → Show tour ---- */
const tour = new Tour({ ws, world, el: $('tour'), onDone: () => frameAll() });
if (!tourSeen()) setTimeout(() => { if (!tour.active) tour.start(); }, 600);

/* ---- Render loop ---- */
const clock = new THREE.Clock();
let panelAcc = 0;
const _mid = new THREE.Vector3();
/** Midpoint label: the hovered cable, else the selected one ("Board.done → Start.trigger · event · value"). */
function updateConnectionLabel() {
  const c = hoveredConnection || (selection.size === 1 ? selection.connections[0] : null);
  if (!c || !c.visible || !c.complete || interaction.connect) { connLabel.hidden = true; return; }
  c.midpoint(_mid).project(ws.camera);
  const r = ws.renderer.domElement.getBoundingClientRect();
  const x = r.left + (_mid.x + 1) / 2 * r.width, y = r.top + (1 - _mid.y) / 2 * r.height;
  connLabel.hidden = _mid.z > 1;
  connLabel.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -120%)`;
  const typeText = !c.valid ? 'invalid' : c.type === 'any' && c.value !== undefined ? `any · ${kindOf(c.value)}` : portTypeName(c.from);
  const path = `${c.from.owner.title}.${c.from.label} → ${c.to.owner.title}.${c.to.label}`;
  const meaning = c.valid ? describeLink(c) : null;   // "Maya's tasks appear on Website relaunch"
  connLabel.classList.toggle('selected', c !== hoveredConnection);
  connLabel.innerHTML = `<b style="color:${hex(c.color.getHex())}">${typeText}</b> ${meaning || path}<br><span>${meaning ? path + ' · ' : ''}${c.valid ? formatValue(c.value, 36) : mismatchReason(c.from, c.to)}</span>`;
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  ws.updateFlight(dt);
  ws.controls.update();
  ws.updateFog();
  engine.tick(dt);
  world.detectMoves();
  world.nodes.forEach((b) => b.update(t, dt));
  world.groups.forEach((g) => g.update(dt));
  updateLOD(world, ws.camera, dt);
  world.connections.forEach((c) => c.update(dt));
  interaction.update(t, dt);
  overlays.update();
  tour.update(dt);
  updateConnectionLabel();
  panelAcc += dt;
  if (panelAcc >= 0.1) { panel.refresh(); panelAcc = 0; }
  ws.renderer.render(ws.scene, ws.camera);
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging / automated tests
window.__proto = {
  ws, world, engine, history, selection, interaction, gizmo, panel, leftBar, fileMenu, registry, autosave, examples, THREE, overlays, tour,
  setGizmo, togglePanel, frameAll, loadExample, addComponent, createInstance, cmd,
  serialize: () => serializeWorld(world, { camera: ws.camera, controls: ws.controls }),
  load: (doc) => loadWorld(world, doc, { camera: ws.camera, controls: ws.controls }),
};
