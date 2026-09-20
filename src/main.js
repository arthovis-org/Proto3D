// main.js — boots the platform: theme, workspace, registry (all core components), world model,
// engine, history, selection, gizmo, interaction, guidance overlays, properties panel, Add
// toolbar, the menu bar (File · Edit · View · Add · Help) with its quick toggles at the right end,
// the mini toolbar above the selection, the command palette (Ctrl+K), the wiring switch,
// navigation presets, first-run tour, LOD, the AI layer (providers, key vault, jobs) with its
// Connections page, model browser and job tray, the performance stats, autosave, recent projects,
// the Showcase scene and the render loop. Exposes window.__proto for debugging / tests.
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
import { Overlays } from './ui/overlays.js';
import { Tour, tourSeen } from './ui/tour.js';
import { createInstance } from './instance.js';
import { updateLOD } from './lod.js';
import { serializeWorld, serializeSelection, importCommand, loadWorld, downloadJSON, pickJSONFile, safeFileName, AutoSave, RecentProjects } from './serialize.js';
import { MenuBar, shortcutText } from './ui/menubar.js';
import { ShortcutsSheet, AboutDialog, REPO_URL } from './ui/help-dialogs.js';
import { StatsOverlay } from './ui/stats.js';
import { MiniToolbar } from './ui/mini-toolbar.js';
import { CommandPalette, menuCommands } from './ui/command-palette.js';
import { CableChips } from './cable-chips.js';
import { examples, exampleById, buildExample, DEFAULT_EXAMPLE } from './examples/index.js';
import { setFlowEnabled, isFlowEnabled, setFlowSpeed, getFlowSpeed } from './connection3d.js';
import { portTypes, subtypes, states, sizes, hex, getTheme, setTheme, toggleTheme, onThemeChange, refreshLabel } from './theme.js';
import { formatValue, typeInfo, subtypeInfo, kindOf, portTypeName, mismatchReason } from './core/types.js';
import { describeLink } from './pm/relations.js';
import { onBitmapReady } from './faces.js';
import { isWiringOn, setWiring, toggleWiring, onWiringChange } from './wiring.js';
import { nav } from './controls/navigation.js';
import { PRESET_IDS } from './controls/presets.js';
import { icons } from './icons.js';
import './ai/providers/index.js';
import { store } from './ai/store.js';
import { vault } from './ai/vault.js';
import { jobs } from './ai/jobs.js';
import { spend } from './ai/pricing.js';
import { providerRegistry, providerStatus } from './ai/providers/index.js';
import { setUIHooks } from './ai/ui-hooks.js';
import { Connections } from './ui/connections.js';
import { ModelBrowser } from './ui/model-browser.js';
import { JobsTray } from './ui/jobs-tray.js';

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
const chips = new CableChips(ws.scene);   // value chips at cable midpoints (hovered / selected cables, cables of a selected block)
world.overlays = overlays;    // components may toast ("Assigned to Maya")
const interaction = new Interaction({
  camera: ws.camera, renderer: ws.renderer, controls: ws.controls, world, selection, history, gizmo, createInstance, overlays,
  onHoverConnection: (c) => { hoveredConnection = c; connLabel.hidden = !c; },
  onFocus: (blocks) => ws.frameBlocks(blocks, { insetLeft: leftBar?.isOpen ? 300 : 0 }),
  onFrameAll: () => frameAll(),
  onGizmoMode: (mode) => { if (!gizmo.enabled) setGizmo(true); gizmo.setMode(mode); syncToolbar(); },
  onTogglePanel: () => togglePanel(),
  onOpenPanel: () => togglePanel(true),
});
// the Navigator may swap the camera (orthographic view): everyone who holds a camera follows
ws.onCameraSwap((cam) => { interaction.camera = cam; overlays.camera = cam; gizmo.control.camera = cam; });
function frameAll(opts = {}) { return ws.frameBlocks([...world.nodes.filter((n) => n.visible), ...world.groups.filter((g) => g.collapsed)], { insetLeft: leftBar?.isOpen ? 300 : 0, ...opts }); }

/* ---- Properties panel ---- */
const panel = new Panel({
  el: $('panel'), world, engine, ws, gizmo, history, selection, interaction,
  flow: { isEnabled: isFlowEnabled, setEnabled: (v) => { setFlowEnabled(v); syncToolbar(); }, getSpeed: getFlowSpeed, setSpeed: setFlowSpeed },
  wiring: { isOn: isWiringOn, set: (v) => setWiring(v) },
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

/* ---- Project: name, autosave, recent projects, save / open / import / export ---- */
const autosave = new AutoSave(world, { extras: () => ({ camera: ws.camera, controls: ws.controls, name: project.name || 'untitled' }) });
const recent = new RecentProjects();
const project = { name: null };
const insetLeft = () => (leftBar?.isOpen ? 300 : 0);
const dateStamp = () => new Date().toISOString().slice(0, 10);
function setProjectName(name) { project.name = name ? String(name).trim() || null : null; document.title = `${project.name || 'Untitled'} — Proto3D`; }
function currentDoc(name = project.name || 'untitled') { return serializeWorld(world, { camera: ws.camera, controls: ws.controls, name }); }
/** Keep the scene on the recent list before it is replaced (New, Open, an example); untitled scenes get a timestamp for a name. */
function rememberCurrent() {
  if (!world.nodes.length) return;
  const name = project.name || `Untitled · ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  recent.remember(name, currentDoc(name));
}
function loadExample(id) {
  const ex = exampleById(id); if (!ex) return null;
  rememberCurrent();
  selection.clear(); history.clear();
  const named = buildExample(world, ex, { camera: ws.camera, controls: ws.controls });
  engine.evaluate();
  setProjectName(null);
  const focus = ex.focus ? ex.focus(named).filter(Boolean) : [];
  if (focus.length) ws.frameBlocks(focus, { instant: true, fill: 0.7, insetLeft: insetLeft() }); else frameAll({ instant: true });
  return named;
}
function newProject() { rememberCurrent(); selection.clear(); history.clear(); world.clear(); world.named = {}; setProjectName(null); }
/** Save = download the project as JSON under its name (a dated name the first time); Save as… asks for the name. */
function saveProject() {
  const name = project.name || `proto3d-${dateStamp()}`;
  const doc = currentDoc(name);
  downloadJSON(doc, safeFileName(name));
  recent.remember(name, doc);
  setProjectName(name);
  overlays.toast(`Saved ${safeFileName(name)}`, 1600);
}
function saveProjectAs() {
  const name = window.prompt('Save project as', project.name || `proto3d-${dateStamp()}`);
  if (name === null || !name.trim()) return;
  setProjectName(name.trim().replace(/\.json$/i, ''));
  saveProject();
}
/** Replace the scene with a document (Open…, Open recent). */
function openDoc(doc, name) {
  rememberCurrent();
  selection.clear(); history.clear();
  const r = loadWorld(world, doc, { camera: ws.camera, controls: ws.controls });
  setProjectName(name || doc.name);
  recent.remember(project.name || 'Untitled', doc);
  if (!doc.camera) frameAll({ instant: true });
  if (r.skipped.length) overlays.toast(`Opened · ${r.skipped.length} unknown component${r.skipped.length > 1 ? 's' : ''} skipped`, 2400);
  else overlays.toast(`Opened ${project.name || 'project'} · ${r.nodes} components`, 1600);
}
function openProject() {
  pickJSONFile({ withName: true }).then(({ doc, name }) => openDoc(doc, name)).catch((e) => { if (e.message !== 'cancelled') alert(`Could not open: ${e.message}`); });
}
function openRecent(id) { const e = recent.get(id); if (e) openDoc(e.doc, e.name); }
/** Merge a document into the scene, undoable; the new blocks land to the right of everything and get selected and framed. */
function importDoc(doc, label) {
  const c = importCommand(world, doc, { label });
  if (!c) { overlays.toast('Nothing to import: the document holds no known component', 2200); return null; }
  history.execute(c);
  selection.set(c.nodes);
  ws.frameBlocks(c.nodes, { fill: 0.6, insetLeft: insetLeft() });
  overlays.toast(`${label || 'Imported'} · ${c.nodes.length} component${c.nodes.length > 1 ? 's' : ''}${c.skipped.length ? ` · ${c.skipped.length} unknown skipped` : ''}`, 1800);
  return c;
}
function importFile() { pickJSONFile().then((doc) => importDoc(doc)).catch((e) => { if (e.message !== 'cancelled') alert(`Could not import: ${e.message}`); }); }
function exportSelection() {
  const nodes = selectedNodes(); if (!nodes.length) return;
  downloadJSON(serializeSelection(world, nodes, { name: `${project.name || 'proto3d'} selection` }), safeFileName(`${project.name || 'proto3d'}-selection`));
}
/** The viewport as a PNG: render once more and read the drawing buffer before the compositor clears it. */
function exportScreenshot() {
  ws.renderer.render(ws.scene, ws.camera);
  const url = ws.renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a'); a.href = url; a.download = safeFileName(`${project.name || 'proto3d'}-${dateStamp()}`, '.png'); document.body.appendChild(a); a.click(); a.remove();
  overlays.toast('Screenshot saved', 1400);
}
/* ---- Clipboard: the selection as a Proto3D document, in memory and (best effort) on the system clipboard ---- */
const clipboard = { doc: null };
const selectedNodes = () => selection.items.flatMap((i) => (i.kind === 'group' ? i.members : i.kind === 'connection' ? [] : [i]));
function copySelection() {
  const nodes = selectedNodes(); if (!nodes.length) return false;
  clipboard.doc = serializeSelection(world, nodes, { name: 'clipboard' });
  navigator.clipboard?.writeText?.(JSON.stringify(clipboard.doc)).catch(() => {});
  overlays.toast(`Copied ${nodes.length} component${nodes.length > 1 ? 's' : ''}`, 1200);
  return true;
}
function cutSelection() { if (copySelection()) interaction.deleteSelection(); }
function pasteClipboard(doc = clipboard.doc) { if (doc) importDoc(doc, 'Paste'); }
document.addEventListener('paste', (e) => {
  if (isTyping(e) || anyModalOpen()) return;
  let doc = null;
  try { const p = JSON.parse(e.clipboardData?.getData('text/plain') || ''); if (p && p.app === 'proto3d' && Array.isArray(p.nodes)) doc = p; } catch (_) { /* not ours */ }
  if (doc || clipboard.doc) { e.preventDefault(); pasteClipboard(doc || clipboard.doc); }
});

/* ---- AI generation: Connections page, model browser, job tray; the components reach them through ui-hooks ---- */
const connections = new Connections({ onChange: () => { syncToolbar(); panel.refresh(); } });
const modelBrowser = new ModelBrowser();
const jobsTray = new JobsTray({ el: $('jobs-tray'), onFocus: (uid) => { const n = world.nodeByUid(uid); if (n) { selection.set([n]); ws.frameBlocks([n], { fill: 0.6, insetLeft: leftBar?.isOpen ? 300 : 0 }); togglePanel(true); } } });
setUIHooks({
  openConnections: (id) => { connections.open(id || null); return true; },
  openModelBrowser: (o) => { modelBrowser.open(o); return true; },
  focusBlock: (uid) => { const n = world.nodeByUid(uid); if (!n) return false; selection.set([n]); ws.frameBlocks([n], { fill: 0.6 }); return true; },
  toast: (text, ms) => { overlays.toast(text, ms); return true; },
});
const shortcutsSheet = new ShortcutsSheet();
const aboutDialog = new AboutDialog();
const stats = new StatsOverlay({ el: $('stats'), ws, world });
let palette = null;   // the command palette, built after the menu bar (it reads the menu model)
const anyModalOpen = () => connections.isOpen || modelBrowser.isOpen || shortcutsSheet.isOpen || aboutDialog.isOpen || !!palette?.isOpen;
// with an OpenRouter key present, fetch its model list once so estimates and the panel price are live
vault.ready.then(() => { if (providerStatus('openrouter') === 'connected') providerRegistry.get('openrouter').listModels({ key: vault.keyFor('openrouter'), proxy: vault.proxyFor('openrouter') }).then(() => panel.refresh()).catch(() => {}); });

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
  buildControlsSheet();
}
/** The active navigation preset's cheat sheet (generated from the preset object). */
function buildControlsSheet() {
  const dl = $('legend-controls'); if (!dl) return;
  dl.innerHTML = '';
  const p = nav.preset;
  $('legend-controls-title').textContent = `Controls · ${p.label}`;
  for (const row of nav.sheet()) {
    const dt = document.createElement('dt'); dt.textContent = row.label; dt.dataset.action = row.action;
    const dd = document.createElement('dd'); dd.textContent = row.binding;
    dl.appendChild(dt); dl.appendChild(dd);
  }
  const sel = $('help-preset'); if (sel) { sel.innerHTML = ''; for (const id of PRESET_IDS) { const o = document.createElement('option'); o.value = id; o.textContent = nav.presets[id].label; sel.appendChild(o); } sel.value = nav.presetId; }
}
buildLegend();
onThemeChange(() => { buildLegend(); panel.refresh(); syncToolbar(); });
onBitmapReady(() => world.nodes.forEach((n) => { n.faceDirty = true; }));
nav.onChange(() => { buildControlsSheet(); panel.refresh(); tour.refreshText?.(); });
$('help-preset')?.addEventListener('change', (e) => nav.setPreset(e.target.value));

/* ---- Fonts: Inter arrives from Google Fonts when online; redraw every canvas label and face once it is ready ---- */
function refreshAllText() {
  world.nodes.forEach((n) => { n.labels.forEach((l) => refreshLabel(l)); n.faceDirty = true; });
  world.groups.forEach((g) => g.refreshTheme());
}
if (document.fonts?.ready) document.fonts.ready.then(() => { if (document.fonts.check('600 16px Inter')) refreshAllText(); }).catch(() => {});

/* ---- Quick toggles: icon buttons at the right end of the menu bar (the MenuBar appends `tools`). Each runs the same code as its key or menu item ---- */
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ''; });
const tools = document.createElement('span'); tools.className = 'mnu-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Quick toggles');
const tb = {};   // the toggles by id (they join the DOM when the MenuBar is built below)
const tool = (id, icon, title, label) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'tb'; b.title = title; b.setAttribute('aria-label', label); b.innerHTML = `<i>${icons[icon]}</i>`; tools.appendChild(b); tb[id] = b; return b; };
const toolSep = () => { const sep = document.createElement('span'); sep.className = 'tb-sep'; tools.appendChild(sep); };
tool('btn-undo', 'undo', 'Undo (Ctrl+Z)', 'Undo');
tool('btn-redo', 'redo', 'Redo (Ctrl+Shift+Z or Ctrl+Y)', 'Redo');
toolSep();
tool('btn-wiring', 'flow', 'Wiring — show or hide ports and cables (P). Cables are optional: drop a component onto another to link them', 'Wiring').setAttribute('aria-pressed', 'false');
tool('btn-flow', 'connection', 'Flow animation on cables', 'Flow animation');
tool('btn-gizmo', 'gizmo', 'Move / rotate / scale gizmo (G) · W move, E rotate, R scale', 'Gizmo');
toolSep();
tool('btn-theme', 'sun', 'Switch light / dark theme (T)', 'Theme');
tool('btn-frame', 'frame', 'Frame everything (Home) · F frames the selection', 'Frame all');
toolSep();
tool('btn-help', 'help', 'Help & legend (H) · the Help menu has the tour and the shortcuts', 'Help & legend');
tool('btn-panel', 'sidebar', 'Show / hide the properties panel (N or Tab)', 'Properties panel');
toolSep();
tool('btn-palette', 'search', 'Command palette (Ctrl+K) · every command, component and block by name', 'Command palette');
const connectionsHint = () => { const live = providerRegistry.all().filter((p) => p.needsKey && providerStatus(p.id) === 'connected').length; return live ? `${live} provider${live > 1 ? 's' : ''} connected` : 'AI providers and API keys'; };
function syncToolbar() {
  tb['btn-flow'].classList.toggle('off', !isFlowEnabled());
  tb['btn-wiring'].classList.toggle('on', isWiringOn());
  tb['btn-wiring'].setAttribute('aria-pressed', String(isWiringOn()));
  tb['btn-gizmo'].classList.toggle('on', gizmo.enabled);
  tb['btn-gizmo'].setAttribute('aria-pressed', String(gizmo.enabled));
  tb['btn-theme'].title = getTheme() === 'dark' ? 'Switch to the light theme (T)' : 'Switch to the dark theme (T)';
  tb['btn-theme'].querySelector('i').innerHTML = getTheme() === 'dark' ? icons.sun : icons.moon;
  const panelShown = !document.body.classList.contains('panel-hidden');
  tb['btn-panel'].classList.toggle('on', panelShown);
  tb['btn-panel'].setAttribute('aria-pressed', String(panelShown));
  const helpShown = !!$('help').open && panelShown;
  tb['btn-help'].classList.toggle('on', helpShown);
  tb['btn-help'].setAttribute('aria-pressed', String(helpShown));
  tb['btn-undo'].disabled = !history.canUndo; tb['btn-redo'].disabled = !history.canRedo;
}
history.onChange(syncToolbar);
onWiringChange(() => { syncToolbar(); panel.refresh(); });
tb['btn-flow'].addEventListener('click', () => { setFlowEnabled(!isFlowEnabled()); syncToolbar(); panel.refresh(); });
tb['btn-wiring'].addEventListener('click', () => { toggleWiring(); overlays.toast(isWiringOn() ? 'Wiring on · ports and cables shown' : 'Wiring off · drop a component onto another to link them', 1800); });
tb['btn-theme'].addEventListener('click', () => toggleTheme());
tb['btn-gizmo'].addEventListener('click', () => setGizmo(!gizmo.enabled));
tb['btn-panel'].addEventListener('click', () => togglePanel());
tb['btn-frame'].addEventListener('click', () => frameAll());
tb['btn-help'].addEventListener('click', () => toggleHelp());
tb['btn-undo'].addEventListener('click', () => { history.undo(); selection.prune(world); });
tb['btn-redo'].addEventListener('click', () => { history.redo(); selection.prune(world); });
tb['btn-palette'].addEventListener('click', () => palette.toggle());

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
  syncToolbar();
}
window.addEventListener('keydown', (e) => {
  if (isTyping(e) || anyModalOpen() || e.altKey) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod) {
    // Ctrl+V arrives as the paste event above, so the system clipboard can be read
    if (k === 's') { e.preventDefault(); if (e.shiftKey) saveProjectAs(); else saveProject(); }
    else if (k === 'o' && !e.shiftKey) { e.preventDefault(); openProject(); }
    else if (k === 'c' && !e.shiftKey && selectedNodes().length && !window.getSelection()?.toString()) { e.preventDefault(); copySelection(); }
    else if (k === 'x' && !e.shiftKey && selectedNodes().length) { e.preventDefault(); cutSelection(); }
    return;
  }
  if (e.shiftKey && e.key === '?') { e.preventDefault(); shortcutsSheet.toggle(); return; }
  if (!e.shiftKey && k === 'i' && !nav.keyAction(e)) { e.preventDefault(); stats.toggle(); }
});
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
  if (anyModalOpen()) return;   // modals own the keyboard
  if (nav.keyAction(e)) return;   // the navigation preset owns this key (interaction.js handles it)
  if (e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); leftBar.open('search'); return; }
  if (e.shiftKey) return;
  switch (e.key.toLowerCase()) {
    case 'h': toggleHelp(); break;
    case 't': toggleTheme(); break;
    case 'p': toggleWiring(); overlays.toast(isWiringOn() ? 'Wiring on' : 'Wiring off', 1000); break;
    case 'g': setGizmo(!gizmo.enabled); break;
    case 'n': togglePanel(); break;
    case 'w': if (gizmo.enabled) gizmo.setMode('translate'); break;
    case 'e': if (gizmo.enabled) gizmo.setMode('rotate'); break;
    case 'r': if (gizmo.enabled) gizmo.setMode('scale'); break;
    default: break;
  }
});
syncToolbar();

/* ---- Menu bar: File · Edit · View · Add · Help. Every item runs the same code as its button, key or panel control ---- */
const sc = shortcutText;
const toggleRail = () => { document.body.classList.toggle('rail-hidden'); ws.resize(); };
const setPortsOnSelection = (v) => { if (selection.nodes.length) history.execute(cmd.setShowPorts(world, selection.nodes, v)); panel.refresh(); };
const timeAgo = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const undoLabel = (stack, verb) => { const c = stack[stack.length - 1]; return c?.label ? `${verb} ${c.label}` : verb; };
const menubar = new MenuBar({
  el: $('menubar'), tools,
  menus: [
    { id: 'file', label: 'File', items: () => [
      { label: 'New project', hint: 'empty scene', run: newProject },
      { label: 'Open…', shortcut: sc('Ctrl+O'), run: openProject },
      { label: 'Open recent', items: () => {
        const list = recent.list();
        if (!list.length) return [{ label: 'No recent projects', disabled: true }];
        return [...list.map((e) => ({ label: e.name, hint: `${e.nodes} components · ${timeAgo(e.savedAt)}`, run: () => openRecent(e.id) })), { sep: true }, { label: 'Clear recent', run: () => recent.clear() }];
      } },
      { sep: true },
      { label: 'Save', shortcut: sc('Ctrl+S'), hint: project.name ? `${safeFileName(project.name)}` : 'downloads JSON', run: saveProject },
      { label: 'Save as…', shortcut: sc('Ctrl+Shift+S'), run: saveProjectAs },
      { sep: true },
      { label: 'Import…', hint: 'merge a JSON file into this scene', run: importFile },
      { label: 'Export', items: () => [
        { label: 'Selection as JSON…', hint: 'the selected components and their links', disabled: !selectedNodes().length, run: exportSelection },
        { label: 'Screenshot (PNG)', hint: 'the viewport as an image', run: exportScreenshot },
      ] },
      { sep: true },
      { label: 'Examples', items: () => examples.map((ex) => ({ label: ex.label, run: () => loadExample(ex.id) })) },
      { sep: true },
      { label: 'Connections…', hint: connectionsHint(), run: () => connections.open() },
    ] },
    { id: 'edit', label: 'Edit', items: () => [
      { label: undoLabel(history.undoStack, 'Undo'), shortcut: sc('Ctrl+Z'), disabled: !history.canUndo, run: () => { history.undo(); selection.prune(world); } },
      { label: undoLabel(history.redoStack, 'Redo'), shortcut: sc('Ctrl+Shift+Z'), disabled: !history.canRedo, run: () => { history.redo(); selection.prune(world); } },
      { sep: true },
      { label: 'Cut', shortcut: sc('Ctrl+X'), disabled: !selectedNodes().length, run: cutSelection },
      { label: 'Copy', shortcut: sc('Ctrl+C'), disabled: !selectedNodes().length, run: copySelection },
      { label: 'Paste', shortcut: sc('Ctrl+V'), disabled: !clipboard.doc, run: () => pasteClipboard() },
      { label: 'Duplicate', shortcut: sc('Ctrl+D'), disabled: !selection.nodes.length, run: () => interaction.duplicateSelection() },
      { label: 'Delete', shortcut: 'Del', disabled: !selection.size, run: () => interaction.deleteSelection() },
      { sep: true },
      { label: 'Select all', shortcut: sc('Ctrl+A'), disabled: !world.nodes.length, run: () => selection.set(world.nodes.filter((n) => n.visible)) },
      { label: 'Deselect', shortcut: 'Esc', disabled: !selection.size, run: () => selection.clear() },
      { sep: true },
      { label: 'Group', shortcut: sc('Ctrl+G'), disabled: !selection.nodes.some((n) => !n.group), run: () => interaction.groupSelection() },
      { label: 'Ungroup', shortcut: sc('Ctrl+Shift+G'), disabled: !(selection.groups.length || selection.nodes.some((n) => n.group)), run: () => interaction.ungroupSelection() },
      { label: 'Collapse / expand group', shortcut: 'C', disabled: !(selection.groups.length || selection.nodes.some((n) => n.group)), run: () => interaction.toggleCollapseSelection() },
    ] },
    { id: 'view', label: 'View', items: () => [
      { label: 'Light theme', shortcut: 'T', checked: getTheme() === 'light', run: () => toggleTheme() },
      { label: 'Grid', checked: ws.isGridVisible(), run: () => { ws.setGridVisible(!ws.isGridVisible()); panel.refresh(); } },
      { label: 'Wiring', hint: 'ports and cables', shortcut: 'P', checked: isWiringOn(), run: () => { toggleWiring(); overlays.toast(isWiringOn() ? 'Wiring on · ports and cables shown' : 'Wiring off · drop a component onto another to link them', 1800); } },
      { label: 'Ports on selection', disabled: !selection.nodes.length, items: () => {
        const v = selection.nodes.length ? selection.nodes[selection.nodes.length - 1].showPorts : null;
        return [
          { label: 'Follow the Wiring switch', radio: true, checked: v === null, run: () => setPortsOnSelection(null) },
          { label: 'Always show', radio: true, checked: v === true, run: () => setPortsOnSelection(true) },
          { label: 'Always hide', radio: true, checked: v === false, run: () => setPortsOnSelection(false) },
        ];
      } },
      { label: 'Flow animation', hint: 'on cables', checked: isFlowEnabled(), run: () => { setFlowEnabled(!isFlowEnabled()); syncToolbar(); panel.refresh(); } },
      { sep: true },
      { label: 'Gizmo', shortcut: 'G', checked: gizmo.enabled, run: () => setGizmo(!gizmo.enabled) },
      { label: 'Gizmo mode', items: () => [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']].map(([m, l, k]) => ({ label: l, shortcut: k, radio: true, checked: gizmo.mode === m, run: () => { if (!gizmo.enabled) setGizmo(true); gizmo.setMode(m); syncToolbar(); } })) },
      { sep: true },
      { label: 'Properties panel', shortcut: 'N', checked: !document.body.classList.contains('panel-hidden'), run: () => togglePanel() },
      { label: 'Add toolbar', checked: !document.body.classList.contains('rail-hidden'), run: toggleRail },
      { label: 'Performance stats', shortcut: 'I', checked: stats.on, run: () => stats.toggle() },
      { sep: true },
      { label: 'Frame selection', shortcut: 'F', disabled: !selection.size, run: () => interaction.focusSelection() },
      { label: 'Frame all', shortcut: 'Home', run: () => frameAll() },
      { label: 'Reset view', hint: 'home camera', run: () => ws.flyTo(ws.HOME.position, ws.HOME.target) },
      { label: 'Orthographic view', shortcut: 'Numpad 5', checked: ws.controls.isOrtho, run: () => { ws.controls.setOrtho(!ws.controls.isOrtho); overlays.toast(ws.controls.isOrtho ? 'Orthographic view' : 'Perspective view', 1200); } },
      { sep: true },
      { label: 'Navigation', hint: nav.preset.label, items: () => PRESET_IDS.map((id) => ({ label: nav.presets[id].label, hint: nav.presets[id].description, radio: true, checked: nav.presetId === id, run: () => { nav.setPreset(id); overlays.toast(`${nav.preset.label} controls · ${nav.binding('orbit')} orbits`, 2000); } })) },
      { label: 'Level of detail', hint: `far at ${sizes.lod.far} units`, items: () => [['Close', 60], ['Default', 110], ['Far', 200]].map(([l, d]) => ({ label: l, hint: `${d} units`, radio: true, checked: sizes.lod.far === d, run: () => { sizes.lod.far = d; panel.refresh(); } })) },
    ] },
    { id: 'add', label: 'Add', items: () => [
      { label: 'Search components…', shortcut: sc('Shift+A'), run: () => leftBar.open('search') },
      { sep: true },
      ...registry.categories().map((c) => ({ label: c.label, icon: icons[c.id] || icons.node, items: () => c.components.map((def) => ({ label: def.label, hint: def.description, icon: def.icon || icons.node, run: () => addComponent(def, null) })) })),
    ] },
    { id: 'help', label: 'Help', items: () => [
      { label: 'Command palette…', hint: 'every command, component and block by name', shortcut: sc('Ctrl+K'), run: () => palette.open() },
      { label: 'Take the tour', run: () => tour.start() },
      { label: 'Keyboard shortcuts…', shortcut: sc('Shift+?'), run: () => shortcutsSheet.open() },
      { label: 'Help & legend', shortcut: 'H', checked: $('help').open && !document.body.classList.contains('panel-hidden'), run: () => toggleHelp() },
      { sep: true },
      { label: 'Documentation', hint: 'README on GitHub', run: () => window.open(`${REPO_URL}#readme`, '_blank', 'noopener') },
      { label: 'Architecture', hint: 'how the platform fits together', run: () => window.open(`${REPO_URL}/blob/main/docs/ARCHITECTURE.md`, '_blank', 'noopener') },
      { sep: true },
      { label: 'About Proto3D', run: () => aboutDialog.open() },
    ] },
  ],
});

/* ---- Command palette (Ctrl+K): the menu model, "Add <component>" and "Go to <block>", ranked by fuzzy match ---- */
const goTo = (n) => { selection.set([n]); ws.frameBlocks([n], { fill: 0.6, insetLeft: insetLeft() }); };
palette = new CommandPalette({
  canvas: ws.renderer.domElement,
  sources: () => [
    ...menuCommands(menubar.menus, { skip: (menuId, label, it) => (menuId === 'add' && !!it.items) || label === 'No recent projects' || label === 'Command palette…' }),
    ...registry.all().map((def) => ({ id: `add:${def.id}`, kind: 'add', group: 'Add', label: `Add ${def.label}`, hint: `${registry.category(def.category).label} · ${def.description}`, icon: def.icon || icons.node, run: () => addComponent(def, null) })),
    ...world.nodes.map((n) => ({ id: `goto:${n.uid}`, kind: 'goto', group: 'Go to', label: `Go to ${n.title}`, hint: `${n.def.label}${n.group ? ` · in ${n.group.title}` : ''}`, icon: n.def.icon || icons.node, run: () => goTo(n) })),
  ],
  onOpenChange: (open) => { tb['btn-palette'].classList.toggle('on', open); tb['btn-palette'].setAttribute('aria-pressed', String(open)); },
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    if (anyModalOpen() && !palette.isOpen) return;   // another modal owns the keyboard
    e.preventDefault(); e.stopPropagation(); palette.toggle();
  }
}, true);

/* ---- Mini toolbar: floats above the selection, every action is the same code path as its key or menu item ---- */
const miniBar = new MiniToolbar({
  el: $('mini-toolbar'), ws, world, engine, selection, interaction, history, gizmo,
  avoid: () => [$('bottom-right'), $('selection')],
  onMore: () => { togglePanel(true); const body = $('panel'); body.scrollTop = 0; const f = body.querySelector('#prop-name, #panel-body input, #panel-body select, #panel-body textarea'); f?.focus({ preventScroll: true }); },
});

/* ---- First scene: the autosave if there is one, otherwise the Showcase ---- */
const saved = autosave.load();
let restored = false;
if (saved && saved.nodes && saved.nodes.length) {
  try { loadWorld(world, saved, { camera: ws.camera, controls: ws.controls }); restored = true; } catch (e) { console.warn('autosave ignored:', e.message); }
}
if (!restored) loadExample(DEFAULT_EXAMPLE);
else setProjectName(saved.name && saved.name !== 'untitled' ? saved.name : null);
autosave.enabled = true;
overlays.setEmptyHint(world.nodes.length === 0);

/* ---- First-run tour: once per browser, re-openable from "?" → Show tour ---- */
const tour = new Tour({ ws, world, el: $('tour'), onDone: () => frameAll() });
if (!tourSeen()) setTimeout(() => { if (!tour.active) tour.start(); }, 600);

/* ---- Render loop ---- */
const clock = new THREE.Clock();
let panelAcc = 0;
const _mid = new THREE.Vector3();
/**
 * Meaning line under the hovered (or selected) cable: "event · Maya's tasks appear on Website
 * relaunch". The value and the endpoint names are on the 3D chip above the cable (cable-chips.js),
 * so this line shows only when there is a sentence to add, or why an invalid link does not fit.
 */
function updateConnectionLabel() {
  const c = hoveredConnection || (selection.size === 1 ? selection.connections[0] : null);
  if (!c || !c.visible || !c.complete || interaction.connect) { connLabel.hidden = true; return; }
  const meaning = c.valid ? describeLink(c) : mismatchReason(c.from, c.to);   // "Maya's tasks appear on Website relaunch"
  if (!meaning) { connLabel.hidden = true; return; }
  c.midpoint(_mid).project(ws.camera);
  const r = ws.renderer.domElement.getBoundingClientRect();
  const x = r.left + (_mid.x + 1) / 2 * r.width, y = r.top + (1 - _mid.y) / 2 * r.height;
  connLabel.hidden = _mid.z > 1;
  connLabel.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, 60%)`;
  const typeText = !c.valid ? 'invalid' : c.type === 'any' && c.value !== undefined ? `any · ${kindOf(c.value)}` : portTypeName(c.from);
  connLabel.classList.toggle('selected', c !== hoveredConnection);
  connLabel.innerHTML = `<b style="color:${hex(c.color.getHex())}">${typeText}</b> ${meaning}`;
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
  updateLOD(world, ws.camera, dt, ws.renderer);
  world.connections.forEach((c) => c.update(dt));
  chips.update(world, ws.camera, { hovered: hoveredConnection, anySelected: selection.size > 0, time: engine.time, dt, renderer: ws.renderer });
  interaction.update(t, dt);
  overlays.update();
  miniBar.update();
  jobsTray.update();
  tour.update(dt);
  updateConnectionLabel();
  panelAcc += dt;
  if (panelAcc >= 0.1) { panel.refresh(); panelAcc = 0; }
  ws.renderer.render(ws.scene, ws.camera);
  stats.frame(dt);   // after the render so renderer.info holds this frame's counts
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging / automated tests
window.__proto = {
  ws, world, engine, history, selection, interaction, gizmo, panel, leftBar, menubar, miniBar, palette, stats, chips, shortcutsSheet, aboutDialog, recent, project, clipboard, registry, autosave, examples, THREE, overlays, tour, nav, icons, sizes, setTheme, getTheme,
  setGizmo, togglePanel, frameAll, loadExample, addComponent, createInstance, cmd,
  newProject, saveProject, saveProjectAs, openProject, openRecent, openDoc, importDoc, copySelection, cutSelection, pasteClipboard, exportSelection, exportScreenshot,
  wiring: { isOn: isWiringOn, set: setWiring, toggle: toggleWiring },
  ai: { vault, jobs, spend, store, providers: providerRegistry, providerStatus, connections, modelBrowser, jobsTray },
  serialize: () => serializeWorld(world, { camera: ws.camera, controls: ws.controls }),
  load: (doc) => loadWorld(world, doc, { camera: ws.camera, controls: ws.controls }),
};
