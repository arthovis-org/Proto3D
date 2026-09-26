// ui/help-dialogs.js — small pages behind the Help and Edit menus (Preferences is below), built on the modal shell the
// Connections page uses: the keyboard shortcut sheet (the workspace's fixed keys plus the active
// navigation preset's mouse / wheel / key bindings, regenerated each time it opens, plus a Touch
// section when a coarse pointer is present or a finger has touched the canvas) and About.
import * as THREE from 'three';
import { nav } from '../controls/navigation.js';
import { TOUCH_GESTURES } from '../controls/presets.js';
import { registry } from '../core/registry.js';
import { FORMAT_VERSION } from '../serialize.js';
import { icons } from '../icons.js';
import { REGIONS, UI_SCALES, SCALE_RANGE, fmtScale } from './ui-prefs.js';

export const REPO_URL = 'https://github.com/arthovis-org/proto3d';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keys = (s) => s.split(' / ').map((alt) => alt.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('+')).join(' <i>/</i> ');

/** The workspace's own keys (interaction.js, main.js); the navigation preset adds its bindings below. */
export const GLOBAL_SHORTCUTS = [
  { group: 'File', rows: [['Save file (downloads JSON)', 'Ctrl+S'], ['Save as…', 'Ctrl+Shift+S'], ['Open… (in a new tab)', 'Ctrl+O'], ['New file (a tab)', 'Alt+N'], ['Close tab', 'Alt+W'], ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'], ['Next / previous tab, where the browser keeps Ctrl+Tab', 'Alt+] / Alt+[']] },
  { group: 'Edit', rows: [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z / Ctrl+Y'], ['Cut', 'Ctrl+X'], ['Copy', 'Ctrl+C'], ['Paste', 'Ctrl+V'], ['Duplicate', 'Ctrl+D'], ['Delete', 'Delete / Backspace'], ['Select all', 'Ctrl+A'], ['Deselect, cancel', 'Esc'], ['Auto-layout (selection or all)', 'L'], ['Group', 'Ctrl+G'], ['Ungroup', 'Ctrl+Shift+G'], ['Collapse / expand group', 'C'], ['Bypass the selected blocks (inputs pass straight through)', 'Ctrl+B'], ['Preferences (UI scale, theme, toolbar sizes)', 'Ctrl+,']] },
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

/** A touchscreen is at hand: the primary pointer is coarse, or a touch pointer reached the canvas. */
export const touchPresent = (controls = null) => { try { if (window.matchMedia?.('(pointer: coarse)').matches) return true; } catch (_) { /* ignore */ } return !!controls?.touchSeen; };

export class ShortcutsSheet extends Dialog {
  /** @param {object} o { controls?: Navigator } (its `touchSeen` adds the Touch section) */
  constructor({ controls = null } = {}) { super('shortcuts'); this.controls = controls; }
  render() {
    const blocks = GLOBAL_SHORTCUTS.map((g) => `<section><h3>${esc(g.group)}</h3><dl>${g.rows.map(([l, k]) => `<dt>${esc(l)}</dt><dd>${keys(k)}</dd>`).join('')}</dl></section>`);
    const sheet = nav.sheet();
    for (const group of ['Mouse', 'Wheel', 'Keys']) {
      const rows = sheet.filter((r) => r.group === group);
      if (!rows.length) continue;
      blocks.push(`<section><h3>${group === 'Keys' ? `${esc(nav.preset.label)} keys` : `${esc(nav.preset.label)} ${group.toLowerCase()}`}</h3><dl>${rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${group === 'Keys' ? r.binding.split(' · ').map((b) => keys(b)).join(' <i>/</i> ') : esc(r.binding)}</dd>`).join('')}</dl></section>`);
    }
    if (touchPresent(this.controls)) blocks.push(`<section><h3>Touch</h3><dl>${TOUCH_GESTURES.map((g) => `<dt>${esc(g.action)}</dt><dd>${esc(g.gesture)}</dd>`).join('')}</dl></section>`);
    this._shell(icons.keyboard, 'Keyboard shortcuts', `Shortcuts are ignored while typing in a field. Mouse and key bindings follow the <b>${esc(nav.preset.label)}</b> navigation preset — change it under View → Navigation.`, `<div class="sheet-grid">${blocks.join('')}</div>`);
  }
}

/**
 * Preferences (Edit → Preferences…, Ctrl+,): the interface settings kept in this browser — UI scale
 * (presets and a slider, applied live), theme, and the sizes of the resizable regions (the same
 * values the edge handles write; ui/ui-prefs.js), each with a reset.
 */
export class PreferencesDialog extends Dialog {
  /** @param {object} o { prefs: uiPrefs, getTheme(), setTheme(v) } */
  constructor({ prefs, getTheme, setTheme }) {
    super('preferences');
    Object.assign(this, { prefs, getTheme, setTheme });
    prefs.onChange(() => { if (this.isOpen && !this._own) this._sync(); });
  }
  render() {
    const P = this.prefs, s = P.scale;
    const regions = Object.entries(REGIONS).map(([k, R]) => `<div class="pref-row"><label for="pref-${k}">${esc(R.label)} <small>${k === 'help' ? 'height' : 'width'}</small></label>
      <span class="pref-ctl"><input id="pref-${k}" type="number" data-region="${k}" min="${k === 'help' ? 0 : R.min}" max="${R.max}" step="10" placeholder="${k === 'help' ? 'auto' : ''}"><span class="pref-unit">px</span><button type="button" class="pref-reset" data-reset="${k}" title="Back to ${k === 'help' ? 'its natural height' : `${R.def} px`}">Reset</button></span></div>`).join('');
    this._shell(icons.settings || icons.workspace, 'Preferences', 'Interface settings for this browser. Region sizes can also be dragged by the edges of the toolbars and the panel (double-click an edge to reset it).',
      `<section class="pref-sec"><h3>Interface</h3>
        <div class="pref-row"><label for="pref-scale">UI scale</label><span class="pref-ctl grow"><input id="pref-scale" type="range" min="${SCALE_RANGE[0]}" max="${SCALE_RANGE[1]}" step="0.05" value="${s}"><output class="pref-val" for="pref-scale">${fmtScale(s)}</output></span></div>
        <div class="pref-presets" role="group" aria-label="UI scale presets">${UI_SCALES.map((v) => `<button type="button" data-scale="${v}" aria-pressed="${v === s}">${fmtScale(v)}</button>`).join('')}</div>
        <p class="pref-note">Scales the menus, toolbars, panel and dialogs; the 3D view keeps its own resolution.</p>
        <div class="pref-row"><label for="pref-theme">Theme</label><span class="pref-ctl"><select id="pref-theme"><option value="dark">Dark</option><option value="light">Light</option></select></span></div>
      </section>
      <section class="pref-sec"><h3>Layout</h3>${regions}</section>`,
      `<button type="button" data-act="reset-layout">Reset layout</button><button type="button" data-act="reset-all">Reset all</button><span class="grow"></span><span>Saved in this browser</span>`);
    const el = this.el;
    const own = (fn) => { this._own = true; try { fn(); } finally { this._own = false; } this._sync(); };
    el.querySelector('#pref-scale').addEventListener('input', (e) => own(() => P.setScale(+e.target.value)));
    el.querySelector('#pref-theme').addEventListener('change', (e) => this.setTheme(e.target.value));
    el.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => own(() => P.setScale(+b.dataset.scale))));
    el.querySelectorAll('[data-region]').forEach((i) => i.addEventListener('change', () => own(() => P.setSize(i.dataset.region, i.value === '' ? 0 : +i.value))));
    el.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => own(() => P.resetSize(b.dataset.reset))));
    el.querySelector('[data-act="reset-layout"]').addEventListener('click', () => own(() => P.resetLayout()));
    el.querySelector('[data-act="reset-all"]').addEventListener('click', () => own(() => { P.resetLayout(); P.setScale(1); }));
    this._sync();
  }
  /** Reflect the current values (a drag on an edge handle while the dialog is open updates it too). */
  _sync() {
    const P = this.prefs, el = this.el, s = P.scale;
    const r = el.querySelector('#pref-scale'); if (!r) return;
    if (document.activeElement !== r) r.value = String(s);
    el.querySelector('.pref-val').textContent = fmtScale(s);
    el.querySelectorAll('[data-scale]').forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.scale - s) < 1e-6)));
    el.querySelector('#pref-theme').value = this.getTheme();
    el.querySelectorAll('[data-region]').forEach((i) => { if (document.activeElement !== i) { const v = P.size(i.dataset.region); i.value = i.dataset.region === 'help' && !v ? '' : String(Math.round(v)); } });
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
