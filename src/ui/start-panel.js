// ui/start-panel.js — the Start panel: a centred card over the viewport (not a modal — the room
// behind it stays live) offering a blank project, the three starter templates with a thumbnail,
// the recent projects from this browser, Open file… and the Showcase. It shows on first run and
// on File → New, reopens from Help → Start panel, closes on any pick, Esc, × or when something
// lands in the scene; "Show on startup" is persisted in localStorage.
//
//   new StartPanel({ el, templates, showcase, recent, onBlank, onTemplate, onExample, onOpenFile, onOpenRecent, onAllProjects, onChange })
//   open() / hide(reason) / toggle() / isOpen · onChange(open, reason)
//   thumbnails: assets/templates/<id>-<theme>.png (rendered headless, committed), a component icon when missing
import { icons } from '../icons.js';
import { getTheme, onThemeChange } from '../theme.js';
import { isTyping } from '../interaction.js';
import { timeAgo } from './tab-strip.js';

export const START_KEY = 'proto3d.start.v1';   // '0' = do not show on startup
export function startOnLaunch() { try { return localStorage.getItem(START_KEY) !== '0'; } catch (_) { return true; } }
export function setStartOnLaunch(on) { try { if (on) localStorage.removeItem(START_KEY); else localStorage.setItem(START_KEY, '0'); } catch (_) { /* private mode */ } }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEMPLATE_ICON = { 'project-board': 'project', 'ai-pipeline': 'generate', 'device-flow': 'devices' };

export class StartPanel {
  constructor({ el, templates = [], showcase = null, recent = async () => [], onBlank = () => {}, onTemplate = () => {}, onExample = () => {}, onOpenFile = () => {}, onOpenRecent = () => {}, onAllProjects = null, onChange = () => {} }) {
    Object.assign(this, { el, templates, showcase, recent, onBlank, onTemplate, onExample, onOpenFile, onOpenRecent, onAllProjects, onChange });
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this._recent = [];
    window.addEventListener('keydown', (e) => { if (this.isOpen && e.key === 'Escape' && !isTyping(e)) { e.stopPropagation(); this.hide('esc'); } }, true);
    onThemeChange(() => { if (this.isOpen) this._render(); });
  }
  get isOpen() { return !this.el.hidden; }
  /** Show the card; the recent projects arrive asynchronously and patch only their list (the rest of the card never re-renders under the pointer). */
  open(reason = 'menu') {
    this._render();
    this.el.hidden = false; this.el.setAttribute('aria-hidden', 'false');
    const seq = this._seq = (this._seq || 0) + 1;
    Promise.resolve(this.recent()).then((list) => { this._recent = list || []; if (this.isOpen && seq === this._seq) this._renderRecent(); }).catch(() => {});
    this.onChange(true, reason);
    this.el.querySelector('.start-tile')?.focus({ preventScroll: true });
  }
  hide(reason = 'close') {
    if (!this.isOpen) return;
    this.el.hidden = true; this.el.setAttribute('aria-hidden', 'true');
    this.onChange(false, reason);
  }
  toggle() { this.isOpen ? this.hide('menu') : this.open('menu'); }

  _thumb(t) {
    const icon = icons[TEMPLATE_ICON[t.id] || 'node'] || icons.node;
    return `<span class="start-thumb"><img src="assets/templates/${esc(t.id)}-${esc(getTheme())}.png" alt="" loading="lazy" onerror="this.remove()">${icon}</span>`;
  }
  _recentHtml() {
    const recent = this._recent.filter((r) => !r.open).slice(0, 5);
    return recent.length ? `<ul class="start-recent">${recent.map((r) => `<li><button type="button" data-act="recent" data-id="${esc(r.id)}">${r.thumb ? `<img src="${r.thumb}" alt="">` : `<span class="start-recent-ic">${icons.file}</span>`}<span class="start-recent-text"><b>${esc(r.name || 'Untitled')}</b><small>${r.nodes} component${r.nodes === 1 ? '' : 's'} · ${esc(timeAgo(r.openedAt))}</small></span></button></li>`).join('')}</ul>` : '<p class="start-none">No other projects in this browser yet. Everything you build autosaves here.</p>';
  }
  _renderRecent() {
    const wrap = this.el.querySelector('.start-recent-wrap'); if (!wrap) return;
    wrap.innerHTML = this._recentHtml();
    this._bindActs(wrap);
  }
  _bindActs(root) {
    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('click', () => {
        const { act, id } = b.dataset;
        this.hide('pick');
        if (act === 'blank') this.onBlank();
        else if (act === 'template') this.onTemplate(id);
        else if (act === 'example') this.onExample(id);
        else if (act === 'file') this.onOpenFile();
        else if (act === 'recent') this.onOpenRecent(id);
        else if (act === 'all') this.onAllProjects?.();
      });
    }
  }
  _render() {
    this.el.innerHTML = `<div class="start-card" role="dialog" aria-labelledby="start-title">
      <div class="start-head">
        <span class="modal-icon">${icons.workspace}</span>
        <div><h2 id="start-title">Start</h2><p>Pick a starter, or open a project. The room behind this card is live; <kbd>Esc</kbd> closes it.</p></div>
        <button type="button" class="modal-close start-close" title="Close (Esc)" aria-label="Close">${icons.close}</button>
      </div>
      <div class="start-main">
        <div class="start-grid">
          <button type="button" class="start-tile" data-act="blank"><span class="start-thumb blank">${icons.plus}</span><span class="start-text"><b>Blank project</b><small>An empty room · add components from the left</small></span></button>
          ${this.templates.map((t) => `<button type="button" class="start-tile" data-act="template" data-id="${esc(t.id)}">${this._thumb(t)}<span class="start-text"><b>${esc(t.label)}</b><small>${esc(t.description)}</small></span></button>`).join('')}
        </div>
      </div>
      <aside class="start-side">
        <h3>Open recent</h3>
        <div class="start-recent-wrap">${this._recentHtml()}</div>
        ${this.onAllProjects ? `<button type="button" class="start-all" data-act="all">All projects <span aria-hidden="true">→</span></button>` : ''}
        <div class="start-side-btns">
          <button type="button" class="start-open" data-act="file">${icons.file}<span>Open file…</span></button>
          ${this.showcase ? `<button type="button" class="start-open" data-act="example" data-id="${esc(this.showcase.id)}">${icons.sparkle}<span>More examples · ${esc(this.showcase.label)}</span></button>` : ''}
        </div>
      </aside>
      <div class="start-foot">
        <label class="start-switch"><input type="checkbox" class="start-on"${startOnLaunch() ? ' checked' : ''}><span>Show this panel on startup</span></label>
        <span class="grow"></span>
        <span>Help → Start panel reopens it</span>
      </div>
    </div>`;
    this.el.querySelector('.start-close').addEventListener('click', () => this.hide('close'));
    this.el.querySelector('.start-on').addEventListener('change', (e) => setStartOnLaunch(e.target.checked));
    this._bindActs(this.el);
  }
}
