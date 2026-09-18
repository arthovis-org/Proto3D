// main.js — wires the workspace, demo scene, graph engine, interaction, gizmo, panel and toolbar.
import * as THREE from 'three';
import { createWorkspace } from './workspace.js';
import { buildDemo, createBlock } from './scene-demo.js';
import { Interaction, isTyping } from './interaction.js';
import { Gizmo } from './gizmo.js';
import { Graph, blockTypes } from './graph.js';
import { Panel } from './panel.js';
import { setFlowEnabled, isFlowEnabled, setFlowSpeed, getFlowSpeed } from './connection3d.js';
import { portTypes, states, hex, getTheme, toggleTheme, onThemeChange } from './theme.js';

const $ = (id) => document.getElementById(id);
const container = $('viewport');
const ws = createWorkspace(container);
const world = buildDemo(ws.scene);
const graph = new Graph(world, { interval: 0.1 });
world.graph = graph;

/* ---- Gizmo + interaction ---- */
const gizmo = new Gizmo({
  camera: ws.camera, renderer: ws.renderer, scene: ws.scene, controls: ws.controls,
  onModeChange: () => panel.refresh(),
});
const selectionEl = $('selection');
const interaction = new Interaction({
  camera: ws.camera, renderer: ws.renderer, controls: ws.controls, world, gizmo,
  onSelect: (item) => {
    panel.setSelection(item);
    if (!item) { selectionEl.textContent = 'Nothing selected'; return; }
    if (item.kind === 'connection') {
      const toName = item.to ? `${item.to.owner.title} · ${item.to.name}` : '—';
      selectionEl.textContent = `Connection  ${item.from.owner.title} · ${item.from.name}  →  ${toName}  (${item.type}${item.state === 'invalid' || item.derivedState === 'invalid' ? ', invalid' : ''})`;
    } else {
      selectionEl.textContent = `${item.kind === 'node' ? 'Node' : 'Device'}  ${item.title}  ·  ${item.inputs.length} in / ${item.outputs.length} out`;
    }
  },
});

/* ---- Properties panel ---- */
const panel = new Panel({
  el: $('panel'), world, graph, ws, gizmo,
  flow: { isEnabled: isFlowEnabled, setEnabled: (v) => { setFlowEnabled(v); syncToolbar(); }, getSpeed: getFlowSpeed, setSpeed: setFlowSpeed },
  onRename: (block, name) => { block.setTitle(name); interaction.onSelect(block); },
  onModeChange: () => graph.evaluate(),
});
panel.setSelection(null);

/* ---- Legend swatches come from the theme so the overlay never drifts from the 3D language ---- */
function buildLegend() {
  const legend = $('legend-types'); legend.innerHTML = '';
  for (const [name, t] of Object.entries(portTypes)) {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${hex(t.color)}"></i>${name}`;
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

/* ---- Toolbar ---- */
function syncToolbar() {
  $('btn-flow').classList.toggle('off', !isFlowEnabled());
  $('btn-gizmo').classList.toggle('on', gizmo.enabled);
  $('btn-theme').textContent = getTheme() === 'dark' ? 'Light theme' : 'Dark theme';
  $('btn-panel').classList.toggle('on', !document.body.classList.contains('panel-hidden'));
}
const addType = $('add-type');
for (const [id, t] of Object.entries(blockTypes)) {
  const op = document.createElement('option'); op.value = id; op.textContent = `${t.kind === 'device' ? '▭ ' : '▣ '}${t.title}`;
  addType.appendChild(op);
}
addType.value = 'transform';
$('btn-add').addEventListener('click', () => {
  const block = createBlock(addType.value);
  const slot = world.nextFreeSlot(ws.controls.target);
  if (block.kind === 'device') slot[1] = 0;
  world.addBlock(block, slot);
  graph.evaluate();
  interaction.select(block);
});
$('btn-flow').addEventListener('click', () => { setFlowEnabled(!isFlowEnabled()); syncToolbar(); panel.refresh(); });
$('btn-theme').addEventListener('click', () => toggleTheme());
$('btn-gizmo').addEventListener('click', () => setGizmo(!gizmo.enabled));
$('btn-panel').addEventListener('click', () => togglePanel());
$('btn-reset').addEventListener('click', () => ws.resetCamera());
$('btn-help').addEventListener('click', () => toggleHelp());

function setGizmo(on) {
  gizmo.setEnabled(on);
  gizmo.setTarget(interaction.selected);
  syncToolbar();
  panel.build(); // Transform section shows the mode buttons only while the gizmo is on
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

/* ---- Render loop ---- */
const clock = new THREE.Clock();
let panelAcc = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  ws.controls.update();
  graph.tick(dt);
  world.blocks.forEach((b) => b.update(t));
  world.connections.forEach((c) => c.update(dt));
  panelAcc += dt;
  if (panelAcc >= 0.1) { panel.refresh(); panelAcc = 0; }
  ws.renderer.render(ws.scene, ws.camera);
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging / automated screenshots
window.__proto = { ws, world, graph, interaction, gizmo, panel, THREE, setGizmo, togglePanel };
