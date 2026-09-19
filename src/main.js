// main.js — boots the platform: theme, workspace, registry (all core components), world model,
// engine, history, selection, gizmo, interaction, properties panel, Add toolbar, File menu,
// LOD, autosave, examples and the render loop. Exposes window.__proto for debugging / tests.
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
import { createInstance } from './instance.js';
import { updateLOD } from './lod.js';
import { serializeWorld, loadWorld, downloadJSON, pickJSONFile, AutoSave } from './serialize.js';
import { examples, exampleById, buildExample } from './examples/index.js';
import { setFlowEnabled, isFlowEnabled, setFlowSpeed, getFlowSpeed } from './connection3d.js';
import { portTypes, states, hex, getTheme, toggleTheme, onThemeChange } from './theme.js';
import { formatValue, typeInfo, kindOf } from './core/types.js';
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
const interaction = new Interaction({
  camera: ws.camera, renderer: ws.renderer, controls: ws.controls, world, selection, history, gizmo, createInstance,
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
  frameAll({ instant: true });
  engine.evaluate();
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
function buildLegend() {
  const legend = $('legend-types'); legend.innerHTML = '';
  for (const [name, t] of Object.entries(portTypes)) {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${hex(t.color)}"></i>${name}`; li.title = typeInfo[name]?.description || '';
    legend.appendChild(li);
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
$('btn-help').addEventListener('click', () => toggleHelp());
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

/* ---- First scene: the autosave if there is one, otherwise the phone → laptop demo ---- */
const saved = autosave.load();
let restored = false;
if (saved && saved.nodes && saved.nodes.length) {
  try { loadWorld(world, saved, { camera: ws.camera, controls: ws.controls }); restored = true; } catch (e) { console.warn('autosave ignored:', e.message); }
}
if (!restored) loadExample('phone-to-laptop');
autosave.enabled = true;

/* ---- Render loop ---- */
const clock = new THREE.Clock();
let panelAcc = 0;
const _mid = new THREE.Vector3();
function updateConnectionLabel() {
  const c = hoveredConnection;
  if (!c || !c.visible) { connLabel.hidden = true; return; }
  c.midpoint(_mid).project(ws.camera);
  const r = ws.renderer.domElement.getBoundingClientRect();
  const x = r.left + (_mid.x + 1) / 2 * r.width, y = r.top + (1 - _mid.y) / 2 * r.height;
  connLabel.hidden = _mid.z > 1;
  connLabel.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -120%)`;
  const dest = c.to ? `${c.to.owner.title} · ${c.to.label}` : '—';
  const typeText = !c.valid ? 'invalid' : c.type === 'any' && c.value !== undefined ? `any · ${kindOf(c.value)}` : c.type;
  connLabel.innerHTML = `<b style="color:${hex(c.color.getHex())}">${typeText}</b> ${c.from.owner.title} · ${c.from.label} → ${dest}<br><span>${c.valid ? formatValue(c.value, 36) : `${c.from.type} → ${c.to?.type}: incompatible`}</span>`;
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
  updateConnectionLabel();
  panelAcc += dt;
  if (panelAcc >= 0.1) { panel.refresh(); panelAcc = 0; }
  ws.renderer.render(ws.scene, ws.camera);
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging / automated tests
window.__proto = {
  ws, world, engine, history, selection, interaction, gizmo, panel, leftBar, fileMenu, registry, autosave, examples, THREE,
  setGizmo, togglePanel, frameAll, loadExample, addComponent, createInstance, cmd,
  serialize: () => serializeWorld(world, { camera: ws.camera, controls: ws.controls }),
  load: (doc) => loadWorld(world, doc, { camera: ws.camera, controls: ws.controls }),
};
