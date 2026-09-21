// ui/help-dialogs.js — two small pages behind the Help menu, built on the modal shell the
// Connections page uses: the keyboard shortcut sheet (the workspace's fixed keys plus the active
// navigation preset's mouse / wheel / key bindings, regenerated each time it opens) and About.
import * as THREE from 'three';
import { nav } from '../controls/navigation.js';
import { registry } from '../core/registry.js';
import { FORMAT_VERSION } from '../serialize.js';
import { icons } from '../icons.js';

export const REPO_URL = 'https://github.com/arthovis-org/proto3d';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keys = (s) => s.split(' / ').map((alt) => alt.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('+')).join(' <i>/</i> ');

/** The workspace's own keys (interaction.js, main.js); the navigation preset adds its bindings below. */
export const GLOBAL_SHORTCUTS = [
  { group: 'File', rows: [['Save project (downloads JSON)', 'Ctrl+S'], ['Save as…', 'Ctrl+Shift+S'], ['Open… (in a new tab)', 'Ctrl+O'], ['New project tab', 'Alt+N'], ['Close tab', 'Alt+W'], ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'], ['Next / previous tab, where the browser keeps Ctrl+Tab', 'Alt+] / Alt+[']] },
  { group: 'Edit', rows: [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z / Ctrl+Y'], ['Cut', 'Ctrl+X'], ['Copy', 'Ctrl+C'], ['Paste', 'Ctrl+V'], ['Duplicate', 'Ctrl+D'], ['Delete', 'Delete / Backspace'], ['Select all', 'Ctrl+A'], ['Deselect, cancel', 'Esc'], ['Auto-layout (selection or all)', 'L'], ['Group', 'Ctrl+G'], ['Ungroup', 'Ctrl+Shift+G'], ['Collapse / expand group', 'C']] },
  { group: 'View', rows: [['2D editing mode ↔ 3D', '2'], ['Frame selection', 'F'], ['Frame all', 'Home'], ['Wiring (ports and cables)', 'P'], ['Light / dark theme', 'T'], ['Properties panel', 'N / Tab'], ['Gizmo', 'G'], ['Gizmo move · rotate · scale', 'W / E / R'], ['Performance stats', 'I'], ['Help & legend', 'H'], ['Keyboard shortcuts', 'Shift+?']] },
  { group: 'Cables', rows: [['Add a waypoint and move it', 'Drag the middle of a cable'], ['Move a waypoint (snaps to the grid and to other waypoints)', 'Drag its handle'], ['Share a waypoint with another cable · join a bundle', 'Drop the handle on another handle · on a trunk'], ['Remove a waypoint · unpin this cable from a shared one', 'Alt+Click the handle'], ['Back to automatic routing', 'Double-click a handle'], ['Style, corner rounding, thickness, bundling, show waypoints', 'View → Cables']] },
  { group: '2D editing mode and snapping', rows: [['Box select', 'Left-drag on empty space'], ['Pan', 'Middle-drag / Space+Left-drag'], ['Zoom about the cursor', 'Wheel'], ['Snap on / off (grid, objects, ports, rotation and scale — kinds and step sizes under View → Snap)', 'M'], ['Skip snapping for this drag', 'Shift+drag'], ['Snap to half the grid pitch', 'Ctrl+drag']] },
  { group: 'Edit mode (text on a face)', rows: [['Enter edit mode on a block (on the text under the pointer)', 'Double-click'], ['Enter edit mode on the selected block and open its first field', 'Enter'], ['Open a field · save · new line in a multiline field', 'Click · Enter · Shift+Enter'], ['Next / previous field on the block', 'Tab / Shift+Tab'], ['Nudge a number', '↑ / ↓ (Shift: ×10)'], ['Close the editor, then leave edit mode', 'Esc · Esc']] },
  { group: 'Add', rows: [['Search components', 'Shift+A']] },
  { group: 'Command palette', rows: [['Open / close', 'Ctrl+K'], ['Move · run · close', '↑ / ↓ · Enter · Esc'], ['Filter: All · Commands · Add · Go to', 'Tab / Shift+Tab']] },
  { group: 'Mini toolbar (above the selection)', rows: [['Edit / Done (edit mode)', 'Enter / Esc'], ['Duplicate', 'Ctrl+D'], ['Delete', 'Delete'], ['Collapse / expand group', 'C'], ['Frame', 'F'], ['Properties panel', 'N']] },
];

class Dialog {
  constructor(id) {
    this.el = document.createElement('div'); this.el.className = 'modal-backdrop'; this.el.id = id; this.el.hidden = true;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true');
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    window.addEventListener('keydown', (e) => { if (!this.el.hidden && e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }
  get isOpen() { return !this.el.hidden; }
  open() { this._prev = document.activeElement; this.render(); this.el.hidden = false; this.el.querySelector('.modal-close')?.focus(); }
  close() { this.el.hidden = true; this._prev?.focus?.(); }
  toggle() { this.isOpen ? this.close() : this.open(); }
  _shell(icon, title, lead, body, foot = '') {
    this.el.innerHTML = `<div class="modal sheet"><div class="modal-head"><span class="modal-icon">${icon}</span><div><h2>${title}</h2><p>${lead}</p></div><button type="button" class="modal-close" title="Close (Esc)" aria-label="Close">${icons.close}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
    this.el.querySelector('.modal-close').addEventListener('click', () => this.close());
  }
}

export class ShortcutsSheet extends Dialog {
  constructor() { super('shortcuts'); }
  render() {
    const blocks = GLOBAL_SHORTCUTS.map((g) => `<section><h3>${esc(g.group)}</h3><dl>${g.rows.map(([l, k]) => `<dt>${esc(l)}</dt><dd>${keys(k)}</dd>`).join('')}</dl></section>`);
    const sheet = nav.sheet();
    for (const group of ['Mouse', 'Wheel', 'Keys']) {
      const rows = sheet.filter((r) => r.group === group);
      if (!rows.length) continue;
      blocks.push(`<section><h3>${group === 'Keys' ? `${esc(nav.preset.label)} keys` : `${esc(nav.preset.label)} ${group.toLowerCase()}`}</h3><dl>${rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${group === 'Keys' ? r.binding.split(' · ').map((b) => keys(b)).join(' <i>/</i> ') : esc(r.binding)}</dd>`).join('')}</dl></section>`);
    }
    this._shell(icons.keyboard, 'Keyboard shortcuts', `Shortcuts are ignored while typing in a field. Mouse and key bindings follow the <b>${esc(nav.preset.label)}</b> navigation preset — change it under View → Navigation.`, `<div class="sheet-grid">${blocks.join('')}</div>`);
  }
}

export class AboutDialog extends Dialog {
  constructor() { super('about'); }
  render() {
    const cats = registry.categories();
    const rows = [
      ['Document format', `v${FORMAT_VERSION} (JSON)`],
      ['Components', `${registry.all().length} types in ${cats.length} categories`],
      ['Renderer', `Three.js r${THREE.REVISION} · WebGL`],
      ['Runs from', 'static files, no build step'],
    ];
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)} ${icons.external}</a>`;
    this._shell(icons.workspace, 'Proto3D', '3D project management · live dataflow. Compose running systems out of components in a 3D workspace; everything you build autosaves in this browser.',
      `<dl class="about-rows">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
      `${link(REPO_URL, 'Source')}${link(`${REPO_URL}#readme`, 'README')}${link(`${REPO_URL}/blob/main/docs/ARCHITECTURE.md`, 'Architecture')}${link(`${REPO_URL}/commits/main`, 'Changes')}<span class="grow"></span><span>Runs from static files · saves to this browser</span>`);
  }
}
