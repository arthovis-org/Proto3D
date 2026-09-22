// main.js — boots the platform: theme, workspace, registry (all core components), world model,
// engine, history, selection, gizmo, interaction, guidance overlays, properties panel, Add
// toolbar, the menu bar (File · Edit · View · Add · Help) with its quick toggles at the right end,
// the mini toolbar above the selection, the command palette (Ctrl+K), the wiring switch,
// navigation presets, first-run tour, LOD, the AI layer (providers, key vault, jobs) with its
// Connections page, model browser and job tray, the performance stats, the project tabs (each with
// its own scene, history and view), autosave into IndexedDB with its indicator, version history, recent projects,
// the Start panel (blank project, three starter templates with a hint bar, recent projects, open a file),
// the Home page (every project in this browser with its metadata and task index, the people
// directory, the Create / Edit Project dialog),
// the 2D editing mode (plan view, key 2) with grid snapping and Auto-layout (L), inline editing of
// face fields (double-click text on a face), cable management (styles, waypoints, bundles: View →
// Cables), the Showcase scene and the render loop. Exposes window.__proto for debugging / tests.
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
import { serializeWorld, serializeSelection, importCommand, loadWorld, downloadJSON, pickJSONFile, safeFileName } from './serialize.js';
import { Tabs } from './tabs.js';
import { projectStore } from './project-store.js';
import { TabStrip, timeAgo } from './ui/tab-strip.js';
import { VersionHistory } from './ui/version-history.js';
import { confirmDialog, promptDialog, isDialogOpen } from './ui/confirm.js';
import { MenuBar, shortcutText } from './ui/menubar.js';
import { ShortcutsSheet, AboutDialog, REPO_URL } from './ui/help-dialogs.js';
import { StatsOverlay } from './ui/stats.js';
import { MiniToolbar } from './ui/mini-toolbar.js';
import { ViewportHeader } from './ui/viewport-header.js';
import { CommandPalette, menuCommands } from './ui/command-palette.js';
import { CableChips } from './cable-chips.js';
import { Guides } from './ui/guides.js';
import { FieldEditor, glideSetting } from './ui/field-editor.js';
import { isPlanOn, setPlan, snap, GRID_SIZES, SNAP_KINDS, ROTATION_STEPS, SCALE_STEPS, fmtDeg, fmtScale } from './plan.js';
import { cables, CABLE_STYLES, THICKNESSES, CORNER_RADII, BUNDLE_DISTANCES } from './cables.js';
import { BundleManager } from './bundles.js';
import { layoutPlan, layoutCommand, updateTweens, tweening } from './layout.js';
import { examples, templates, exampleById, buildExample, DEFAULT_EXAMPLE } from './examples/index.js';
import { StartPanel, startOnLaunch } from './ui/start-panel.js';
import { Home } from './ui/home.js';
import { ProjectDialog } from './ui/project-dialog.js';
import { people } from './pm/people.js';
import { HintBar } from './ui/hint-bar.js';
import { NavHint } from './ui/nav-hint.js';
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
const gizmo = new Gizmo({ camera: ws.camera, renderer: ws.renderer, scene: ws.scene, controls: ws.controls, world, history, onModeChange: () => { panel.refresh(); vpHeader?.sync(); } });
const connLabel = $('conn-label');
let hoveredConnection = null;
const overlays = new Overlays({ camera: ws.camera, renderer: ws.renderer, world, els: { tip: $('tip'), dragLabel: $('drag-label'), toast: $('toast'), endLabels: $('cable-labels'), emptyHint: $('empty-hint') } });
const chips = new CableChips(ws.scene);   // value chips at cable midpoints (hovered / selected cables, cables of a selected block)
const bundles = new BundleManager(world, ws.scene);   // cable management: parallel cables merge into neutral trunks (cables.js `bundle`)
const guides = new Guides({ el: $('guides'), ws });   // snap / alignment guides while a block is dragged
world.overlays = overlays;    // components may toast ("Assigned to Maya")
const interaction = new Interaction({
  camera: ws.camera, renderer: ws.renderer, controls: ws.controls, world, selection, history, gizmo, createInstance, overlays, guides,
  onHoverConnection: (c) => { hoveredConnection = c; connLabel.hidden = !c; },
  onFocus: (blocks) => ws.frameBlocks(blocks, { insetLeft: leftBar?.isOpen ? 300 : 0 }),
  onFrameAll: () => frameAll(),
  onGizmoMode: (mode) => { if (!gizmo.enabled) setGizmo(true); gizmo.setMode(mode); syncToolbar(); },
  onTogglePanel: () => togglePanel(),
  onOpenPanel: () => togglePanel(true),
});
// edit mode: double-click a block (Enter, the pencil) to edit the text on its face where it is drawn — an HTML editor laid onto the face plane
const fieldEditor = new FieldEditor({ ws, world, history, selection, interaction, overlays, els: { editor: $('field-editor'), hint: $('edit-hint') } });
interaction.fieldEditor = fieldEditor;
// the Navigator may swap the camera (orthographic view): everyone who holds a camera follows
ws.onCameraSwap((cam) => { interaction.camera = cam; overlays.camera = cam; gizmo.control.camera = cam; });
function frameAll(opts = {}) { return ws.frameBlocks([...world.nodes.filter((n) => n.visible), ...world.groups.filter((g) => g.collapsed)], { insetLeft: leftBar?.isOpen ? 300 : 0, ...opts }); }

/* ---- Properties panel ---- */
const panel = new Panel({
  el: $('panel'), world, engine, ws, gizmo, history, selection, interaction,
  flow: { isEnabled: isFlowEnabled, setEnabled: (v) => { setFlowEnabled(v); syncToolbar(); }, getSpeed: getFlowSpeed, setSpeed: setFlowSpeed },
  wiring: { isOn: isWiringOn, set: (v) => setWiring(v) },
  plan: { isOn: isPlanOn, set: (v) => setPlanView(v), snap, setSnapOption: (k, v) => setSnapOption(k, v), toggleSnap: () => toggleSnap(), GRID_SIZES, SNAP_KINDS, ROTATION_STEPS, SCALE_STEPS, fmtDeg, fmtScale },
  cables: { cables, setOption: (k, v) => setCableOption(k, v), CABLE_STYLES, THICKNESSES },
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

/* ---- Projects: tabs (tabs.js), autosave into IndexedDB, version history, save / open / import / export ---- */
// the 2D editing mode is a view setting: a document written while it is on carries the remembered 3D camera
const cameraPose = () => (isPlanOn() && ws.planSaved ? { position: ws.planSaved.position, target: ws.planSaved.target } : null);
const insetLeft = () => (leftBar?.isOpen ? 300 : 0);
const dateStamp = () => new Date().toISOString().slice(0, 10);
const v3 = (a) => new THREE.Vector3().fromArray(a);
const arr = (v) => v.toArray().map((x) => +x.toFixed(2));
/** The active tab's name (null while untitled); `document.title` follows it. */
const project = { get name() { return tabs.active?.name || null; } };
function currentDoc(name = project.name || 'untitled') { return serializeWorld(world, { camera: ws.camera, controls: ws.controls, pose: cameraPose(), name, project: tabs.active?.meta || null }); }
function syncTitle(tab = tabs.active) { document.title = `${tab?.name || 'Untitled'}${tab?.preview ? ' (preview)' : ''} — Proto3D`; }
function setProjectName(name) { if (tabs.active) tabs.rename(tabs.activeId, name); syncTitle(); }
let lastLoad = null;   // what the last loadWorld reported (unknown components skipped)
/* the viewport as a small JPEG for Open recent: drawn from the canvas right after a render (frame() below), so it costs one 256 px blit */
let thumbResolve = null, thumbCanvas = null;
function requestThumb() { return new Promise((resolve) => { thumbResolve = resolve; setTimeout(() => { if (thumbResolve === resolve) { thumbResolve = null; resolve(null); } }, 500); }); }
function captureThumb() {
  const r = thumbResolve; thumbResolve = null;
  try {
    const src = ws.renderer.domElement, w = 256, h = Math.max(1, Math.round(w * src.height / Math.max(1, src.width)));
    const c = thumbCanvas || (thumbCanvas = document.createElement('canvas')); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    r(c.toDataURL('image/jpeg', 0.7));
  } catch (_) { r(null); }
}
const tabs = new Tabs({
  world, history, selection, store: projectStore,
  hooks: {
    serialize: (name) => currentDoc(name || 'untitled'),
    load: (doc) => { lastLoad = loadWorld(world, doc, { camera: ws.camera, controls: ws.controls }); return lastLoad; },
    /** Camera (the 3D pose, the plan pose while the 2D mode is on), 2D mode and projection of the active tab. */
    captureView: () => {
      const plan = isPlanOn();
      const pose = plan && ws.planSaved ? ws.planSaved : { position: ws.camera.position, target: ws.controls.target };
      return { camera: { position: arr(pose.position), target: arr(pose.target) }, ortho: plan ? !!ws.planSaved?.ortho : ws.controls.isOrtho, plan, planCamera: plan ? { position: arr(ws.camera.position), target: arr(ws.controls.target) } : null };
    },
    /** Put a tab's view back, instantly: 2D mode first, then the camera (a document's camera when the tab has no view yet). */
    applyView: (view, doc) => {
      const pose = view?.camera || doc?.camera || null;
      const wantPlan = !!view?.plan;
      if (isPlanOn() !== wantPlan) setPlanView(wantPlan, { toast: false, instant: true });
      if (wantPlan) {
        if (pose) ws.planSaved = { position: v3(pose.position), target: v3(pose.target), ortho: !!view?.ortho };
        if (view?.planCamera) { ws.camera.position.fromArray(view.planCamera.position); ws.controls.target.fromArray(view.planCamera.target); ws.controls.update(); }
        else frameAll({ instant: true });
      } else if (pose) { ws.controls.setOrtho(!!view?.ortho); ws.flyTo(v3(pose.position), v3(pose.target), 0); }
      else frameAll({ instant: true });
    },
    beforeSwitch: () => { interaction.cancel(); fieldEditor.cancel(); menubar?.close(); hoveredConnection = null; connLabel.hidden = true; },
    afterSwitch: (tab) => { syncTitle(tab); gizmo.setTarget(selection.nodes[selection.nodes.length - 1] || null); engine.evaluate(); syncEmptyHint(); syncToolbar(); panel.build(); refreshRecent(); syncHint(tab); if (world.nodes.length && start?.isOpen) start.hide('switch'); },
    thumbnail: () => requestThumb(),
    confirmClose: (tab) => confirmDialog({
      icon: icons.file, title: `Save changes to ${tabs.displayName(tab)}?`,
      text: tab.baseDoc?.nodes?.length ? 'Save downloads a JSON file. Discard closes the tab and keeps the project in Open recent as it was last saved or opened.' : 'Save downloads a JSON file. Discard closes the tab and removes this never-saved project from browser storage.',
      buttons: [{ id: 'discard', label: 'Discard', kind: 'danger' }, { id: 'cancel', label: 'Cancel' }, { id: 'save', label: 'Save', kind: 'primary', default: true }],
    }),
    download: (doc, name) => downloadJSON(doc, safeFileName(name)),
    defaultName: () => `proto3d-${dateStamp()}`,
    toast: (t, ms) => overlays.toast(t, ms),
  },
});
/* File → Open recent reads a cached list (menus build synchronously); it refreshes after every save and tab change */
let recentCache = [], recentTimer = 0;
function refreshRecent() { clearTimeout(recentTimer); recentTimer = setTimeout(() => tabs.recent().then((l) => { recentCache = l; }), 150); }
tabs.onStatus((st) => { if (st.state === 'saved') refreshRecent(); });
tabs.onChange(() => refreshRecent());
/**
 * An example scene or a starter template: into the active tab when it is an untouched empty
 * project, else a new tab; framed on its focus blocks. A template names the tab after itself and
 * shows its one-line hint bar (dismissible, remembered on the tab).
 */
function loadExample(id) {
  const ex = exampleById(id); if (!ex) return null;
  let named = null;
  const tab = tabs.replaceActive(() => { named = buildExample(world, ex, { camera: ws.camera, controls: ws.controls }); engine.evaluate(); }, { name: ex.template ? ex.label : null });
  if (!tab) return null;
  start.hide('load');
  const focus = ex.focus ? ex.focus(named).filter(Boolean) : [];
  if (isPlanOn()) frameAll({ instant: true });
  else if (focus.length) ws.frameBlocks(focus, { instant: true, fill: ex.template ? 0.88 : 0.7, insetLeft: insetLeft() }); else frameAll({ instant: true });   // a template fills the view, the Showcase keeps its overview
  tab.hint = ex.hint ? { text: ex.hint, dismissed: false } : null;
  syncHint(tab);
  if (ex.template && !tourSeen() && !tour.active) setTimeout(() => { if (!tour.active && tabs.active === tab) tour.start(); }, 700);   // the first template a new visitor opens starts the tour
  return named;
}
/** The hint bar shows the active tab's template hint until it is dismissed (per tab). */
function syncHint(tab = tabs.active) { if (tab?.hint && !tab.hint.dismissed && !tab.preview) hintBar.show(tab.hint.text); else hintBar.hide(); }
/** File → New: an empty project in a new tab (an untouched empty tab is already one), with the Start panel over it. */
function newProject() {
  home.hide('new');
  let t = tabs.active;
  if (t && tabs.isUntouchedEmpty(t)) overlays.toast('This tab is already an empty project', 1400);
  else { t = tabs.newTab(); if (t) overlays.toast('New project · Save as… names it, Alt+W closes the tab', 1600); }
  if (t) start.open('new');
  return t;
}
function closeTab(id = tabs.activeId) { return tabs.close(id); }
async function renameProject() {
  const tab = tabs.active; if (!tab || tab.preview) return;
  const name = await promptDialog({ icon: icons.text, title: 'Rename project', text: 'The tab, the window title and the next Save use this name.', value: tab.name || '', placeholder: 'Untitled', ok: 'Rename' });
  if (name !== null) tabs.rename(tab.id, name.replace(/\.json$/i, ''));
}
/** Save = download the project as JSON under its name (a dated name the first time) and mark the tab saved; Save as… asks for the name. */
function saveProject() {
  const tab = tabs.active; if (!tab) return;
  if (tab.preview) { overlays.toast('This is a read-only preview · restore it or duplicate it as a tab first', 2200); return; }
  const name = tab.name || `proto3d-${dateStamp()}`;
  const doc = currentDoc(name);
  downloadJSON(doc, safeFileName(name));
  tabs.markSaved(name, doc);
  overlays.toast(`Saved ${safeFileName(name)}`, 1600);
}
async function saveProjectAs() {
  const tab = tabs.active; if (!tab || tab.preview) { saveProject(); return; }
  const name = await promptDialog({ icon: icons.save, title: 'Save project as', text: 'Downloads a JSON file under this name; the tab takes the name too.', value: tab.name || `proto3d-${dateStamp()}`, ok: 'Save' });
  if (name === null || !name) return;
  tabs.rename(tab.id, name.replace(/\.json$/i, ''));
  saveProject();
}
/** Open a document (Open…, a file): a new tab, or the active tab when it is an untouched empty project. */
function openDoc(doc, name) {
  const tab = tabs.openDoc(doc, { name: name || (doc?.name && doc.name !== 'untitled' ? doc.name : null) });
  if (!tab) return null;
  const r = lastLoad;
  if (!doc.camera) frameAll({ instant: true });
  if (r?.skipped?.length) overlays.toast(`Opened · ${r.skipped.length} unknown component${r.skipped.length > 1 ? 's' : ''} skipped`, 2400);
  else overlays.toast(`Opened ${tabs.displayName(tab)} · ${world.nodes.length} components`, 1600);
  return tab;
}
function openProject() {
  pickJSONFile({ withName: true }).then(({ doc, name }) => openDoc(doc, name)).catch((e) => { if (e.message !== 'cancelled') overlays.toast(`Could not open: ${e.message}`, 2600); });
}
/** File → Open recent: a stored project comes to the front when it is open, else opens in a tab. */
async function openRecent(id) {
  const rec = await projectStore.getProject(id);
  if (!rec) { overlays.toast('That project is no longer in this browser', 1800); refreshRecent(); return null; }
  const tab = tabs.openRecord(rec);
  if (tab) overlays.toast(`Opened ${tabs.displayName(tab)} · ${world.nodes.length} components`, 1400);
  return tab;
}
async function clearRecent() {
  const n = recentCache.filter((p) => !p.open).length;
  if (!n) { overlays.toast('No closed projects to remove', 1400); return; }
  const ok = await confirmDialog({ icon: icons.trash, title: `Remove ${n} closed project${n > 1 ? 's' : ''} from this browser?`, text: 'Open tabs stay. Their versions go with them; downloaded JSON files are not affected.', buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Remove', kind: 'danger', default: true }] });
  if (ok === 'ok') { await tabs.forgetClosed(); refreshRecent(); overlays.toast(`${n} project${n > 1 ? 's' : ''} removed`, 1400); }
}
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

/* ---- Home page (ui/home.js), the Create / Edit Project dialog (ui/project-dialog.js) and the people directory (pm/people.js) ---- */
/**
 * Create from the dialog: the template through the same path as the Start panel (`loadExample`,
 * into the untouched empty tab else a new one), Blank into an empty tab; then the name and the
 * metadata, Home steps aside and the scene is framed.
 */
function createProject({ name, meta, template }) {
  home.hide('create');
  let tab = null;
  if (template && template !== 'blank' && exampleById(template)) { loadExample(template); tab = tabs.active; }
  else { tab = tabs.active && tabs.isUntouchedEmpty(tabs.active) ? tabs.active : tabs.newTab(); if (tab) start.hide('create'); }
  if (!tab) return null;
  tabs.setMeta(tab.id, { name, ...meta });
  if (!world.nodes.length) frameAll({ instant: true });
  overlays.toast(`${name} created · ${meta.key} · Home lists it`, 1800);
  return tab;
}
/** A row in Home's Tasks view: open the project (its tab) and select the card on its board, like the Person panel does. */
async function openTask({ projectId, boardUid, taskId }) {
  const rec = await projectStore.getProject(projectId);
  if (!rec) { overlays.toast('That project is no longer in this browser', 1800); return; }
  const tab = tabs.openRecord(rec); if (!tab) return;
  home.hide('task');
  const node = world.nodeByUid(boardUid);
  if (node?.selectSub) { node.selectSub({ kind: node.typeId === 'timeline' ? 'task' : 'card', id: taskId }, selection); ws.frameBlocks([node], { fill: 0.7, insetLeft: insetLeft() }); togglePanel(true); }
}
const home = new Home({
  el: $('home'), tabs, people, store: projectStore,
  onNew: () => projectDialog.create(), onEdit: (rec) => projectDialog.edit(rec), onOpenTask: openTask,
  onChange: () => { tabStrip?.renderHome(); syncEmptyHint(); },
  toast: (t, ms) => overlays.toast(t, ms),
});
const projectDialog = new ProjectDialog({ tabs, people, templates, showcase: exampleById(DEFAULT_EXAMPLE), onCreate: createProject, toast: (t, ms) => overlays.toast(t, ms) });
/** File → Project settings…: the active project's card. */
function projectSettings() { const t = tabs.active; if (!t || t.preview) return; projectDialog.edit({ id: t.id, name: t.name, meta: t.meta }); }

/* ---- Start panel and the template hint bar ---- */
const hintBar = new HintBar({ el: $('hint-bar'), onDismiss: () => { if (tabs.active?.hint) tabs.active.hint.dismissed = true; } });
const navHint = new NavHint({ controls: ws.controls, toast: (t, ms) => overlays.toast(t, ms) });   // trackpad suggestion + first-run navigation hint (ui/nav-hint.js)
/** The empty-scene arrow shows only while the room is empty and neither the Start panel nor Home is over it. */
const syncEmptyHint = () => overlays.setEmptyHint(world.nodes.length === 0 && !start?.isOpen && !home?.isOpen);
const start = new StartPanel({
  el: $('start'), templates, showcase: exampleById(DEFAULT_EXAMPLE), recent: () => tabs.recent(),
  onBlank: () => { if (!(tabs.active && tabs.isUntouchedEmpty(tabs.active))) tabs.newTab(); overlays.toast('Blank project · add a component from the left', 1600); },
  onTemplate: (id) => loadExample(id), onExample: (id) => loadExample(id), onOpenFile: () => openProject(), onOpenRecent: (id) => openRecent(id),
  onAllProjects: () => home.open('projects', 'start'),
  onChange: () => { syncEmptyHint(); syncToolbar(); },
});
world.onChange(() => { if (start.isOpen && world.nodes.length) start.hide('added'); else syncEmptyHint(); });   // anything landing in the room dismisses the card

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
const shortcutsSheet = new ShortcutsSheet({ controls: ws.controls });
const aboutDialog = new AboutDialog();
const versions = new VersionHistory({ tabs, toast: (t, ms) => overlays.toast(t, ms) });
const stats = new StatsOverlay({ el: $('stats'), ws, world });
let palette = null;   // the command palette, built after the menu bar (it reads the menu model)
const anyModalOpen = () => connections.isOpen || modelBrowser.isOpen || shortcutsSheet.isOpen || aboutDialog.isOpen || !!palette?.isOpen || isDialogOpen() || projectDialog.isOpen;
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

/* ---- Quick toggles: icon buttons at the right end of the menu bar (the MenuBar appends `tools`). Each runs the same code as its key or menu item.
   Wiring, flow animation, snap, the gizmo and the cable settings live in the viewport header (ui/viewport-header.js, built below), not here ---- */
let vpHeader = null;   // the viewport header, once built; syncToolbar refreshes it
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ''; });
const tools = document.createElement('span'); tools.className = 'mnu-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Quick toggles');
const tb = {};   // the toggles by id (they join the DOM when the MenuBar is built below)
const tool = (id, icon, title, label) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'tb'; b.title = title; b.setAttribute('aria-label', label); b.innerHTML = `<i>${icons[icon]}</i>`; tools.appendChild(b); tb[id] = b; return b; };
const toolSep = () => { const sep = document.createElement('span'); sep.className = 'tb-sep'; tools.appendChild(sep); };
tool('btn-undo', 'undo', 'Undo (Ctrl+Z)', 'Undo');
tool('btn-redo', 'redo', 'Redo (Ctrl+Shift+Z or Ctrl+Y)', 'Redo');
toolSep();
tool('btn-plan', 'plan', '2D editing mode (2) · a top-down plan: drag to box-select, middle-drag or Space+drag pans, the wheel zooms, blocks snap to the grid · press again for 3D', '2D editing mode').setAttribute('aria-pressed', 'false');
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
  tb['btn-plan'].classList.toggle('on', isPlanOn());
  tb['btn-plan'].setAttribute('aria-pressed', String(isPlanOn()));
  tb['btn-theme'].title = getTheme() === 'dark' ? 'Switch to the light theme (T)' : 'Switch to the dark theme (T)';
  tb['btn-theme'].querySelector('i').innerHTML = getTheme() === 'dark' ? icons.sun : icons.moon;
  const panelShown = !document.body.classList.contains('panel-hidden');
  tb['btn-panel'].classList.toggle('on', panelShown);
  tb['btn-panel'].setAttribute('aria-pressed', String(panelShown));
  const helpShown = !!$('help').open && panelShown;
  tb['btn-help'].classList.toggle('on', helpShown);
  tb['btn-help'].setAttribute('aria-pressed', String(helpShown));
  tb['btn-undo'].disabled = !history.canUndo; tb['btn-redo'].disabled = !history.canRedo;
  vpHeader?.sync();
}
history.onChange(syncToolbar);
onWiringChange(() => { syncToolbar(); panel.refresh(); });
tb['btn-theme'].addEventListener('click', () => toggleTheme());
tb['btn-plan'].addEventListener('click', () => setPlanView(!isPlanOn()));
snap.onChange(() => { syncToolbar(); panel.refresh(); });
cables.onChange(() => panel.refresh());
tb['btn-panel'].addEventListener('click', () => togglePanel());
tb['btn-frame'].addEventListener('click', () => frameAll());
tb['btn-help'].addEventListener('click', () => toggleHelp());
tb['btn-undo'].addEventListener('click', () => { history.undo(); selection.prune(world); });
tb['btn-redo'].addEventListener('click', () => { history.redo(); selection.prune(world); });
tb['btn-palette'].addEventListener('click', () => palette.toggle());

/**
 * 2D editing mode (plan.js): blocks lie flat, cables go planar, the camera flies top-down and
 * goes orthographic (workspace.enterPlan), the gizmo hides; off, everything stands up again and
 * the camera flies back to the remembered 3D pose. A view setting — nothing about it is saved.
 */
function setPlanView(on, { toast = true, instant = false } = {}) {
  on = !!on;
  if (on === isPlanOn()) return;
  interaction.cancel();
  if (on) {
    const focus = selection.nodes.length || selection.groups.length ? selectedNodes() : world.nodes.filter((n) => n.visible);
    setPlan(true);                                        // blocks, groups and cables follow
    ws.enterPlan(focus, { insetLeft: insetLeft(), instant });
    gizmo.setSuspended(true);
  } else {
    setPlan(false);
    ws.exitPlan({ instant });
    gizmo.setSuspended(false);
  }
  syncToolbar(); panel.refresh();
  if (toast) overlays.toast(on ? '2D editing mode · drag on empty space to box-select · middle-drag or Space+drag pans · wheel zooms · 2 returns to 3D' : '3D view', on ? 3200 : 1000);
}
/** The master snap switch (M, the magnet toggle, View → Snap → Snap): the kinds keep their own settings. */
function toggleSnap() {
  snap.toggle();
  overlays.toast(snap.on ? `${snap.summary()} · Shift while dragging skips it` : 'Snap off · free movement', 1800);
}
/** View → Snap → Rotation step / Scale step → Custom…: one line, any number in range (plan.js clamps it). */
async function askSnapStep(key) {
  const rot = key === 'rotationStep';
  const v = await promptDialog({ icon: icons.snap, title: rot ? 'Rotation step' : 'Scale step', text: rot ? 'Degrees per gizmo step while rotation snapping is on (0.5 to 180).' : 'Scale factor per gizmo step while scale snapping is on (0.01 to 4).', value: String(rot ? snap.rotationStep : snap.scaleStep), placeholder: rot ? '15' : '0.25', ok: 'Set' });
  if (v === null) return;
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) { overlays.toast('Enter a number above zero', 1600); return; }
  setSnapOption(key, n);
}
/** One snap kind on / off (View → Snap ▸, the panel); `gridSize` takes a pitch, `rotationStep` degrees, `scaleStep` a factor. */
function setSnapOption(key, v) {
  snap.setOption(key, v);
  overlays.toast(snap.summary(), 1400);
}
/** View → Cables ▸ / the panel: one cable setting (cables.js clamps and persists it); every cable re-routes on the next frame. */
function setCableOption(key, v) {
  const before = cables.state;
  cables.setOption(key, v);
  const S = cables.state;
  if (key === 'style' && before.style !== S.style) overlays.toast(`${cables.styleLabel} cables${S.style === 'orthogonal' ? ` · corners ${S.cornerRadius}` : ''} · View → Cables`, 1600);
  else if (key === 'bundle' && before.bundle !== S.bundle) overlays.toast(S.bundle ? `Parallel cables bundle within ${S.bundleDistance} units · drop a waypoint on a trunk to join it` : 'Cables run on their own', 1800);
  else if (before[key] !== S[key]) overlays.toast(cables.summary(), 1400);
}
/** Edit → Auto-layout: arrange the selected blocks (two or more) or every block, one undoable animated command. */
function autoLayoutSelection(nodes = null) {
  const picked = nodes || selectedNodes();
  const plan = layoutPlan(world, picked.length > 1 ? picked : null);
  if (!plan.nodes.length) return null;
  history.execute(layoutCommand(world, plan.nodes, plan.positions));
  overlays.toast(`Arranged ${plan.nodes.length} block${plan.nodes.length > 1 ? 's' : ''} left to right${plan.backEdges.length ? ` · ${plan.backEdges.length} cable${plan.backEdges.length > 1 ? 's' : ''} loop back` : ''} · Ctrl+Z undoes`, 2200);
  return plan;
}
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
/* Project tabs: Ctrl+Tab / Ctrl+Shift+Tab cycle (Alt+] / Alt+[ where the browser keeps Ctrl+Tab), Alt+W closes (Ctrl+W too when the browser lets it through), Alt+N opens a new one */
window.addEventListener('keydown', (e) => {
  if (isTyping(e) || anyModalOpen()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); tabs.cycle(e.shiftKey ? -1 : 1); return; }
  if (e.altKey && !mod && !e.shiftKey) {
    if (e.code === 'BracketRight' || e.code === 'BracketLeft') { e.preventDefault(); e.stopPropagation(); tabs.cycle(e.code === 'BracketRight' ? 1 : -1); }
    else if (e.code === 'KeyW') { e.preventDefault(); e.stopPropagation(); closeTab(); }
    else if (e.code === 'KeyN') { e.preventDefault(); e.stopPropagation(); newProject(); }
    else if (e.code === 'KeyH') { e.preventDefault(); e.stopPropagation(); home.toggle(); }
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); e.stopPropagation(); closeTab(); }
}, true);
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
  if (e.code === 'Digit2') { e.preventDefault(); setPlanView(!isPlanOn()); return; }   // 2D ↔ 3D
  switch (e.key.toLowerCase()) {
    case 'h': toggleHelp(); break;
    case 'l': autoLayoutSelection(); break;
    case 'm': toggleSnap(); break;
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
const undoLabel = (stack, verb) => { const c = stack[stack.length - 1]; return c?.label ? `${verb} ${c.label}` : verb; };
const menubar = new MenuBar({
  el: $('menubar'), tools,
  menus: [
    { id: 'file', label: 'File', items: () => [
      { label: 'New project', shortcut: 'Alt+N', hint: 'in a new tab', run: newProject },
      { label: 'New project…', hint: 'name, key, people, dates, a template', run: () => projectDialog.create() },
      { label: 'Projects', shortcut: 'Alt+H', hint: 'all projects, tasks, calendar', checked: home.isOpen, run: () => home.toggle() },
      { label: 'Open…', shortcut: sc('Ctrl+O'), hint: 'a JSON file, in a new tab', run: openProject },
      { label: 'Open recent', items: () => {
        const list = recentCache;
        if (!list.length) return [{ label: 'No recent projects', disabled: true }];
        return [
          ...list.slice(0, 12).map((e) => ({ label: e.name || 'Untitled', icon: e.thumb ? `<img class="mnu-thumb" src="${e.thumb}" alt="">` : icons.file, hint: `${e.nodes} component${e.nodes === 1 ? '' : 's'} · ${e.open ? (e.active ? 'this tab' : 'open in a tab') : `opened ${timeAgo(e.openedAt)}`}`, checked: e.open ? true : undefined, run: () => openRecent(e.id) })),
          { sep: true },
          { label: 'Remove closed projects…', hint: 'from this browser', disabled: !list.some((e) => !e.open), run: clearRecent },
        ];
      } },
      { sep: true },
      { label: 'Save', shortcut: sc('Ctrl+S'), hint: project.name ? `${safeFileName(project.name)}` : 'downloads JSON', disabled: !!tabs.active?.preview, run: saveProject },
      { label: 'Save as…', shortcut: sc('Ctrl+Shift+S'), disabled: !!tabs.active?.preview, run: saveProjectAs },
      { label: 'Rename project…', disabled: !!tabs.active?.preview, run: renameProject },
      { label: 'Project settings…', hint: tabs.active?.meta ? `${tabs.active.meta.key} · ${tabs.active.meta.status}` : undefined, disabled: !!tabs.active?.preview, run: projectSettings },
      { sep: true },
      { label: 'Version history…', hint: `${tabs.active?.preview ? 'previewing an earlier version' : 'snapshots of this project, in this browser'}`, checked: versions.isOpen, run: () => versions.toggle() },
      { label: 'Close tab', shortcut: 'Alt+W', hint: tabs.active?.dirty ? 'asks about unsaved changes' : tabs.tabs.length === 1 ? 'leaves an empty project' : undefined, run: () => closeTab() },
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
      { label: 'Auto-layout', shortcut: 'L', hint: selectedNodes().length > 1 ? `arrange the ${selectedNodes().length} selected blocks along their cables` : 'arrange every block left to right along its cables', disabled: !world.nodes.length, run: () => autoLayoutSelection() },
      { sep: true },
      { label: 'Group', shortcut: sc('Ctrl+G'), disabled: !selection.nodes.some((n) => !n.group), run: () => interaction.groupSelection() },
      { label: 'Ungroup', shortcut: sc('Ctrl+Shift+G'), disabled: !(selection.groups.length || selection.nodes.some((n) => n.group)), run: () => interaction.ungroupSelection() },
      { label: 'Collapse / expand group', shortcut: 'C', disabled: !(selection.groups.length || selection.nodes.some((n) => n.group)), run: () => interaction.toggleCollapseSelection() },
      { sep: true },
      { label: fieldEditor.editBlock ? 'Done editing' : 'Edit content', shortcut: fieldEditor.editBlock ? 'Esc' : 'Enter', hint: fieldEditor.editBlock ? `leave edit mode on ${fieldEditor.editBlock.title}` : 'edit the text on the selected block where it is drawn · double-click does too', disabled: !fieldEditor.editBlock && !(selection.nodes.length === 1 && fieldEditor.editable(selection.nodes[0])), run: () => fieldEditor.toggleEdit(fieldEditor.editBlock || selection.nodes[0]) },
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
      { label: 'Cables', hint: cables.summary().replace(/^Cables · /, ''), items: () => [
        { label: 'Style', hint: cables.styleLabel, items: () => CABLE_STYLES.map(([id, l, d]) => ({ label: l, hint: d, radio: true, checked: cables.style === id, run: () => setCableOption('style', id) })) },
        { label: 'Corner rounding', hint: cables.style === 'orthogonal' ? `${cables.cornerRadius} units` : 'orthogonal style only', items: () => [
          ...CORNER_RADII.map((r) => ({ label: r === 0 ? 'Sharp (0)' : `${r} units`, radio: true, checked: cables.cornerRadius === r, run: () => setCableOption('cornerRadius', r) })),
          ...(CORNER_RADII.includes(cables.cornerRadius) ? [] : [{ label: `${cables.cornerRadius} units`, radio: true, checked: true, hint: 'set in the panel', run: () => {} }]),
        ] },
        { label: 'Thickness', hint: THICKNESSES.find(([id]) => id === cables.thickness)?.[1], items: () => THICKNESSES.map(([id, l]) => ({ label: l, radio: true, checked: cables.thickness === id, run: () => setCableOption('thickness', id) })) },
        { sep: true },
        { label: 'Bundle parallel cables', hint: `cables running within ${cables.bundleDistance} units merge into one trunk`, checked: cables.bundle, run: () => setCableOption('bundle', !cables.bundle) },
        { label: 'Bundle distance', hint: `${cables.bundleDistance} units`, disabled: !cables.bundle, items: () => [
          ...BUNDLE_DISTANCES.map((d) => ({ label: `${d} units`, radio: true, checked: cables.bundleDistance === d, run: () => setCableOption('bundleDistance', d) })),
          ...(BUNDLE_DISTANCES.includes(cables.bundleDistance) ? [] : [{ label: `${cables.bundleDistance} units`, radio: true, checked: true, hint: 'set in the panel', run: () => {} }]),
        ] },
        { sep: true },
        { label: 'Show waypoints', hint: 'always show the route handles · else on hover and selection', checked: cables.showWaypoints, run: () => setCableOption('showWaypoints', !cables.showWaypoints) },
      ] },
      { sep: true },
      { label: '2D editing mode', hint: 'top-down plan: box-select, snap, wire and arrange', shortcut: '2', checked: isPlanOn(), run: () => setPlanView(!isPlanOn()) },
      { label: 'Snap', hint: snap.summary().replace(/^Snap( ·)? ?/, '') || undefined, items: () => [
        { label: 'Snap on / off', shortcut: 'M', hint: 'the master switch · Shift while dragging skips it', checked: snap.on, run: toggleSnap },
        { sep: true },
        { label: 'Grid', hint: `blocks land on ${snap.gridSize}-unit steps · Ctrl halves it`, checked: snap.grid, run: () => setSnapOption('grid', !snap.grid) },
        { label: 'Grid size', hint: `${snap.gridSize} units`, items: () => GRID_SIZES.map((g) => ({ label: `${g} unit${g === 1 ? '' : 's'}`, radio: true, checked: snap.gridSize === g, run: () => setSnapOption('gridSize', g) })) },
        { label: 'Objects', hint: 'edges and centres line up with neighbours', checked: snap.objects, run: () => setSnapOption('objects', !snap.objects) },
        { label: 'Ports', hint: 'a pin lands level with the pin it is wired to · cables run straight', checked: snap.ports, run: () => setSnapOption('ports', !snap.ports) },
        { label: 'Rotation', hint: `${fmtDeg(snap.rotationStep)} steps on the gizmo`, checked: snap.rotation, run: () => setSnapOption('rotation', !snap.rotation) },
        { label: 'Rotation step', hint: fmtDeg(snap.rotationStep), items: () => [
          ...ROTATION_STEPS.map((d) => ({ label: fmtDeg(d), radio: true, checked: snap.rotationStep === d, run: () => setSnapOption('rotationStep', d) })),
          { label: 'Custom…', hint: ROTATION_STEPS.includes(snap.rotationStep) ? 'any angle, 0.5° to 180°' : `now ${fmtDeg(snap.rotationStep)}`, radio: true, checked: !ROTATION_STEPS.includes(snap.rotationStep), run: () => askSnapStep('rotationStep') },
        ] },
        { label: 'Scale', hint: `${fmtScale(snap.scaleStep)} steps on the gizmo`, checked: snap.scale, run: () => setSnapOption('scale', !snap.scale) },
        { label: 'Scale step', hint: fmtScale(snap.scaleStep), items: () => [
          ...SCALE_STEPS.map((s) => ({ label: fmtScale(s), radio: true, checked: snap.scaleStep === s, run: () => setSnapOption('scaleStep', s) })),
          { label: 'Custom…', hint: SCALE_STEPS.includes(snap.scaleStep) ? 'any step, 0.01 to 4' : `now ${fmtScale(snap.scaleStep)}`, radio: true, checked: !SCALE_STEPS.includes(snap.scaleStep), run: () => askSnapStep('scaleStep') },
        ] },
      ] },
      { label: 'Glide to text when editing', hint: 'the camera faces a field that is too small or too oblique to read, and comes back after', checked: glideSetting.on, run: () => { glideSetting.toggle(); overlays.toast(glideSetting.on ? 'Glide on · the camera faces a hard-to-read field while you edit it' : 'Glide off · the camera stays put while you edit', 1800); } },
      { sep: true },
      { label: 'Gizmo', shortcut: 'G', checked: gizmo.enabled, disabled: isPlanOn(), hint: isPlanOn() ? 'hidden in 2D: drag to move' : undefined, run: () => setGizmo(!gizmo.enabled) },
      { label: 'Gizmo mode', items: () => [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']].map(([m, l, k]) => ({ label: l, shortcut: k, radio: true, checked: gizmo.mode === m, run: () => { if (!gizmo.enabled) setGizmo(true); gizmo.setMode(m); syncToolbar(); } })) },
      { sep: true },
      { label: 'Properties panel', shortcut: 'N', checked: !document.body.classList.contains('panel-hidden'), run: () => togglePanel() },
      { label: 'Add toolbar', checked: !document.body.classList.contains('rail-hidden'), run: toggleRail },
      { label: 'Performance stats', shortcut: 'I', checked: stats.on, run: () => stats.toggle() },
      { sep: true },
      { label: 'Frame selection', shortcut: 'F', disabled: !selection.size, run: () => interaction.focusSelection() },
      { label: 'Frame all', shortcut: 'Home', run: () => frameAll() },
      { label: 'Reset view', hint: 'home camera', run: () => ws.flyTo(ws.HOME.position, ws.HOME.target) },
      { label: 'Orthographic view', shortcut: 'Numpad 5', checked: ws.controls.isOrtho, disabled: isPlanOn(), hint: isPlanOn() ? 'always on in 2D' : undefined, run: () => { ws.controls.setOrtho(!ws.controls.isOrtho); overlays.toast(ws.controls.isOrtho ? 'Orthographic view' : 'Perspective view', 1200); } },
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
      { label: 'Start panel', hint: 'blank project, starter templates, recent projects', checked: start.isOpen, run: () => start.toggle() },
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
    ...menuCommands(menubar.menus, { skip: (menuId, label, it) => (menuId === 'add' && !!it.items) || label === 'No recent projects' || label === 'Command palette…' || label.startsWith('Open recent ›') }),
    ...tabs.tabs.filter((t) => t.id !== tabs.activeId).map((t) => ({ id: `tab:${t.id}`, kind: 'command', group: 'Tabs', label: `Switch to ${tabs.displayName(t)}`, hint: t.preview ? 'read-only preview' : t.dirty ? 'unsaved changes' : 'open project', icon: icons.file, run: () => tabs.activate(t.id) })),
    ...recentCache.filter((e) => !e.open).slice(0, 8).map((e) => ({ id: `recent:${e.id}`, kind: 'command', group: 'File', label: `Open recent › ${e.name || 'Untitled'}`, hint: `${e.nodes} components · opened ${timeAgo(e.openedAt)}`, icon: icons.file, run: () => openRecent(e.id) })),
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
  avoid: () => [$('bottom-right'), $('selection'), $('vp-header')],
  onLayout: (blocks) => autoLayoutSelection(blocks),
  onMore: () => { togglePanel(true); const body = $('panel'); body.scrollTop = 0; const f = body.querySelector('#prop-name, #panel-body input, #panel-body select, #panel-body textarea'); f?.focus({ preventScroll: true }); },
});

/* ---- Viewport header: Wiring · Snap · Gizmo · Cables at the top of the viewport; every control is the same code path as the View menu and the keys ---- */
vpHeader = new ViewportHeader({
  el: $('vp-header'), viewport: $('viewport'), snap, cables, gizmo, isPlanOn,
  toggleSnap: () => toggleSnap(), setSnapOption: (k, v) => setSnapOption(k, v), setGizmo: (on) => setGizmo(on),
  setGizmoMode: (m) => { if (!gizmo.enabled) setGizmo(true); gizmo.setMode(m); syncToolbar(); }, setCableOption: (k, v) => setCableOption(k, v),
  isWiringOn, toggleWiring: () => { toggleWiring(); overlays.toast(isWiringOn() ? 'Wiring on · ports and cables shown' : 'Wiring off · drop a component onto another to link them', 1800); },
  portsOnSelection: () => ({ n: selection.nodes.length, v: selection.nodes.length ? selection.nodes[selection.nodes.length - 1].showPorts : null }), setPortsOnSelection,
  isFlowEnabled, setFlowEnabled: (v) => { setFlowEnabled(v); syncToolbar(); panel.refresh(); },
  GRID_SIZES, ROTATION_STEPS, SCALE_STEPS, CABLE_STYLES, THICKNESSES, fmtDeg, fmtScale,
});
selection.onChange(() => vpHeader.sync());   // "ports on selection" follows the selection
world.onChange((what) => { if (what === 'wiring') vpHeader.sync(); });
syncToolbar();

/* ---- First scene: the saved tabs (IndexedDB; the round-5 localStorage autosave migrates once), otherwise an empty tab with the Start panel over it ---- */
const tabStrip = new TabStrip({ el: $('tabstrip'), tabs, onNew: newProject, onDownload: saveProject, onVersions: () => versions.open(), onHome: () => home.open('projects', 'tab'), isHome: () => home.isOpen, onActivate: () => home.hide('tab') });
const tour = new Tour({ ws, world, el: $('tour'), onDone: () => frameAll() });
let restored = false;
try { restored = await tabs.init(); } catch (e) { console.warn('project store unavailable:', e.message); }
if (!restored && !tabs.tabs.length) tabs.newTab();
refreshRecent();
syncEmptyHint();
// the Start panel: first run, or a reload onto an untouched empty project, unless switched off on the panel
if (startOnLaunch() && tabs.active && tabs.isUntouchedEmpty(tabs.active)) start.open('startup');

/* ---- First-run tour: once per browser, re-openable from Help → Take the tour; a new visitor's first template starts it (loadExample) ---- */
if (!tourSeen() && !start.isOpen && world.nodes.length) setTimeout(() => { if (!tour.active) tour.start(); }, 600);

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
  if (home.isOpen && !thumbResolve) { requestAnimationFrame(frame); return; }   // Home covers the viewport: no render, no per-frame work (a pending thumbnail still gets its frame)
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  ws.updateFlight(dt);
  ws.controls.update();
  ws.updateFog();
  engine.tick(dt);
  updateTweens(dt);          // Auto-layout glides blocks to their places
  world.detectMoves();
  world.nodes.forEach((b) => b.update(t, dt));
  world.groups.forEach((g) => g.update(dt));
  updateLOD(world, ws.camera, dt, ws.renderer);
  bundles.update(dt);        // regroup parallel cables when due; trunks follow the layout
  world.connections.forEach((c) => c.update(dt));
  chips.update(world, ws.camera, { hovered: hoveredConnection, anySelected: selection.size > 0, time: engine.time, dt, renderer: ws.renderer });
  interaction.update(t, dt);
  overlays.update();
  guides.update();
  fieldEditor.update();      // the editor rides the face plane, the edit-mode hint follows the block
  miniBar.update();
  jobsTray.update();
  tour.update(dt);
  updateConnectionLabel();
  panelAcc += dt;
  if (panelAcc >= 0.1) { panel.refresh(); panelAcc = 0; }
  ws.renderer.render(ws.scene, ws.camera);
  if (thumbResolve) captureThumb();   // Open recent thumbnail: one small blit right after the render
  stats.frame(dt);   // after the render so renderer.info holds this frame's counts
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging / automated tests
window.__proto = {
  ws, world, engine, history, selection, interaction, gizmo, panel, leftBar, menubar, miniBar, vpHeader, fieldEditor, glideSetting, palette, stats, chips, shortcutsSheet, aboutDialog, project, clipboard, registry, tabs, tabStrip, versions, projectStore, examples, templates, start, hintBar, navHint, THREE, overlays, tour, nav, icons, sizes, setTheme, getTheme,
  home, projectDialog, people, createProject, projectSettings,
  setGizmo, togglePanel, frameAll, loadExample, addComponent, createInstance, cmd, guides,
  plan: { isOn: isPlanOn, set: setPlanView, toggle: () => setPlanView(!isPlanOn()), snap, toggleSnap, setSnapOption, GRID_SIZES, SNAP_KINDS, ROTATION_STEPS, SCALE_STEPS, fmtDeg, fmtScale },
  cables, setCableOption, bundles,
  layout: { arrange: autoLayoutSelection, plan: (nodes) => layoutPlan(world, nodes), tweening },
  newProject, closeTab, renameProject, saveProject, saveProjectAs, openProject, openRecent, openDoc, importDoc, copySelection, cutSelection, pasteClipboard, exportSelection, exportScreenshot,
  wiring: { isOn: isWiringOn, set: setWiring, toggle: toggleWiring },
  ai: { vault, jobs, spend, store, providers: providerRegistry, providerStatus, connections, modelBrowser, jobsTray },
  serialize: () => serializeWorld(world, { camera: ws.camera, controls: ws.controls, pose: cameraPose(), project: tabs.active?.meta || null }),
  load: (doc) => loadWorld(world, doc, { camera: ws.camera, controls: ws.controls }),
};
