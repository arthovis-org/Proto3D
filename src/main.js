// main.js — wires the workspace, demo scene, interaction layer and the HTML overlay.
import * as THREE from 'three';
import { createWorkspace } from './workspace.js';
import { buildDemo } from './scene-demo.js';
import { Interaction } from './interaction.js';
import { Node3D } from './node3d.js';
import { setFlowEnabled, isFlowEnabled } from './connection3d.js';
import { portTypes, states, hex } from './theme.js';

const container = document.getElementById('viewport');
const ws = createWorkspace(container);
const world = buildDemo(ws.scene);

/* ---- Overlay ---- */
const $ = (id) => document.getElementById(id);
const selectionEl = $('selection');
const interaction = new Interaction({
  camera: ws.camera, renderer: ws.renderer, controls: ws.controls, world,
  onSelect: (item) => {
    if (!item) { selectionEl.textContent = 'Nothing selected'; return; }
    if (item.kind === 'connection') {
      const toName = item.to ? `${item.to.owner.title} · ${item.to.name}` : '—';
      selectionEl.textContent = `Connection  ${item.from.owner.title} · ${item.from.name}  →  ${toName}  (${item.type}${item.state === 'invalid' ? ', invalid' : ''})`;
    } else {
      selectionEl.textContent = `${item.kind === 'node' ? 'Node' : 'Device'}  ${item.title}  ·  ${item.inputs.length} in / ${item.outputs.length} out`;
    }
  },
});

// Legend swatches come from the theme so the overlay never drifts from the 3D language
const legend = $('legend-types');
for (const [name, t] of Object.entries(portTypes)) {
  const li = document.createElement('li');
  li.innerHTML = `<i style="background:${hex(t.color)}"></i>${name}`;
  legend.appendChild(li);
}
const legendStates = $('legend-states');
for (const [name, c] of Object.entries(states)) {
  const li = document.createElement('li');
  li.innerHTML = `<i style="background:${hex(c)}"></i>${name}`;
  legendStates.appendChild(li);
}

$('btn-help').addEventListener('click', () => document.body.classList.toggle('help-hidden'));
$('btn-reset').addEventListener('click', () => ws.resetCamera());
$('btn-flow').addEventListener('click', (e) => {
  setFlowEnabled(!isFlowEnabled());
  e.currentTarget.classList.toggle('off', !isFlowEnabled());
});
let added = 0;
$('btn-add').addEventListener('click', () => {
  added += 1;
  const node = new Node3D({
    title: `Node ${added}`, subtitle: 'new · untitled', category: 'process',
    inputs: [{ name: 'in', type: 'data' }, { name: 'gate', type: 'boolean' }],
    outputs: [{ name: 'out', type: 'data' }],
  });
  world.addBlock(node, world.nextFreeSlot(ws.controls.target));
  interaction.select(node);
});
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) document.body.classList.toggle('help-hidden'); });

/* ---- Render loop ---- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  ws.controls.update();
  world.blocks.forEach((b) => b.update(t));
  world.connections.forEach((c) => c.update(dt));
  ws.renderer.render(ws.scene, ws.camera);
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging / automated screenshots
window.__proto = { ws, world, interaction, THREE };
