// ui/version-history.js — File → Version history…: a drawer on the right, in the properties-panel
// language, listing the snapshots of the current project (tabs.js takes them: automatically on
// autosave when the content changed and the last one is older than the interval, on every manual
// save, before a restore, and by hand with "Snapshot now"). Each row: when, kind, size, a one-line
// diff against the previous snapshot, an optional name; actions Preview (a read-only tab), Restore
// (one undoable step), Duplicate as tab, Name…, Delete. The footer shows what the project and all
// projects take in the browser and the site's share of the storage quota, with a warning near it;
// "Clear older than…" drops unnamed snapshots. Presentation only: everything runs through Tabs.
import { icons } from '../icons.js';
import { formatBytes } from '../project-store.js';
import { confirmDialog, promptDialog } from './confirm.js';
import { timeAgo } from './tab-strip.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { auto: 'Auto', manual: 'Saved', before: 'Before restore', restore: 'Restore' };
const exact = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const CLEAR = [['', 'Clear older than…'], [String(60 * 60 * 1000), '1 hour'], [String(24 * 60 * 60 * 1000), '1 day'], [String(7 * 24 * 60 * 60 * 1000), '7 days'], ['0', 'Every unnamed version']];

export class VersionHistory {
  /** @param {object} o { tabs, toast } */
  constructor({ tabs, toast = () => {} }) {
    Object.assign(this, { tabs, toast });
    this.el = document.createElement('aside'); this.el.id = 'versions'; this.el.hidden = true; this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'Version history');
    this.el.innerHTML = `<header class="vh-head"><span class="modal-icon">${icons.history}</span><div><h2>Version history</h2><p class="vh-sub">—</p></div><button type="button" class="modal-close" title="Close (Esc)" aria-label="Close">${icons.close}</button></header>
      <div class="vh-preview" hidden><span class="vh-preview-text"></span><div class="vh-preview-btns"><button type="button" data-act="restore-preview" class="primary">Restore this version</button><button type="button" data-act="close-preview" class="ghost">Close preview</button></div></div>
      <div class="vh-tools"><button type="button" data-act="snap" class="vh-snap">${icons.camera}<span>Snapshot now</span></button><span class="grow"></span><select class="vh-clear" aria-label="Clear older than">${CLEAR.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="vh-list" role="list"></div>
      <footer class="vh-foot"><div class="vh-store"><span class="vh-bytes">—</span><div class="vh-bar"><i></i></div><small class="vh-quota">—</small></div></footer>`;
    document.body.appendChild(this.el);
    this.list = this.el.querySelector('.vh-list');
    this.el.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.el.querySelector('[data-act="snap"]').addEventListener('click', async () => { const r = await tabs.snapshotNow(); this.toast(r ? 'Snapshot taken' : 'Nothing to snapshot', 1200); });
    this.el.querySelector('[data-act="restore-preview"]').addEventListener('click', async () => { const t = tabs.active; if (t?.preview) { await tabs.restore(t.snapshotId); this.toast('Version restored · Ctrl+Z undoes', 2000); } });
    this.el.querySelector('[data-act="close-preview"]').addEventListener('click', () => { const t = tabs.active; if (t?.preview) tabs.close(t.id); });
    const clear = this.el.querySelector('.vh-clear');
    clear.addEventListener('change', async () => {
      const v = clear.value; clear.value = ''; if (v === '') return;
      const ms = Number(v), label = CLEAR.find(([x]) => x === v)?.[1] || '';
      const all = await tabs.listVersions(); const cutoff = Date.now() - ms;
      const n = all.filter((s) => !s.label && s.at <= cutoff).length;
      if (!n) { this.toast('Nothing to clear', 1200); return; }
      const ok = await confirmDialog({ icon: icons.trash, title: `Remove ${n} version${n > 1 ? 's' : ''}?`, text: ms ? `Unnamed versions older than ${esc(label.toLowerCase())} go; named versions stay.` : 'Every unnamed version goes; named versions stay.', buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Remove', kind: 'danger', default: true }] });
      if (ok === 'ok') { await tabs.clearOlder(ms); this.toast(`${n} version${n > 1 ? 's' : ''} removed`, 1400); }
    });
    this.list.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) this._action(b.dataset.act, b.closest('.ver')); });
    window.addEventListener('keydown', (e) => { if (this.isOpen && e.key === 'Escape' && !document.querySelector('.confirm-backdrop')) { e.stopPropagation(); this.close(); } }, true);
    tabs.onVersions(() => { if (this.isOpen) this.refresh(); });
    tabs.onChange(() => { if (this.isOpen) this.refresh(); });
    this._refreshing = null;
  }
  get isOpen() { return !this.el.hidden; }
  open() { this._prev = document.activeElement; this.el.hidden = false; document.body.classList.add('versions-open'); this.refresh(); this.el.querySelector('.modal-close')?.focus(); }
  close() { this.el.hidden = true; document.body.classList.remove('versions-open'); this._prev?.focus?.(); }
  toggle() { this.isOpen ? this.close() : this.open(); }

  async refresh() {
    if (this._refreshing) { this._again = true; return; }
    this._refreshing = (async () => {
      const tab = this.tabs.historyTab, active = this.tabs.active;
      const list = tab ? await this.tabs.listVersions(tab) : [];
      const info = await this.tabs.storageInfo();
      this._render(tab, active, list, info);
    })().catch(() => {}).finally(() => { this._refreshing = null; if (this._again) { this._again = false; this.refresh(); } });
  }
  _render(tab, active, list, { bytes, estimate }) {
    const mine = tab ? bytes.per.get(tab.id) : null;
    const projBytes = mine ? mine.project + mine.snapshots : 0;
    this.el.querySelector('.vh-sub').textContent = tab ? `${this.tabs.displayName(tab)} · ${list.length} version${list.length === 1 ? '' : 's'} · ${formatBytes(projBytes)}` : 'No project';
    const pv = this.el.querySelector('.vh-preview');
    pv.hidden = !active?.preview;
    if (active?.preview) { const s = list.find((x) => x.id === active.snapshotId); pv.querySelector('.vh-preview-text').innerHTML = `Previewing the version from <b>${esc(s ? exact(s.at) : '…')}</b> — read-only.`; }
    this.el.querySelector('[data-act="snap"]').disabled = !tab || !!active?.preview || !this.tabs.store.available;
    this.el.querySelector('.vh-clear').disabled = !list.some((s) => !s.label);
    if (!list.length) this.list.innerHTML = `<div class="vh-empty">${this.tabs.store.available ? 'No versions yet. A version is kept automatically once the project changes, on every save, and whenever you press <b>Snapshot now</b>.' : 'Version history needs browser storage (IndexedDB), which is not available here.'}</div>`;
    else this.list.innerHTML = list.map((s) => this._row(s, active)).join('');
    // storage
    const el = this.el.querySelector('.vh-store');
    el.querySelector('.vh-bytes').innerHTML = `This project <b>${formatBytes(projBytes)}</b> · all projects <b>${formatBytes(bytes.total)}</b> in ${bytes.projects} project${bytes.projects === 1 ? '' : 's'}, ${bytes.snapshots} version${bytes.snapshots === 1 ? '' : 's'}`;
    const bar = el.querySelector('.vh-bar i'), q = el.querySelector('.vh-quota');
    if (estimate && estimate.quota) {
      const share = estimate.usage / estimate.quota;
      bar.style.width = `${Math.min(100, Math.max(0.5, share * 100)).toFixed(1)}%`;
      const near = share > 0.8;
      el.classList.toggle('warn', near);
      q.textContent = `${share < 0.01 ? '<1' : Math.round(share * 100)}% of ${formatBytes(estimate.quota)} used by this site${near ? ' · nearly full — clear older versions or download projects' : ''}`;
    } else { bar.style.width = '0%'; el.classList.remove('warn'); q.textContent = 'Browser storage quota unknown'; }
  }
  _row(s, active) {
    const kind = s.label ? 'Named' : KIND[s.kind] || 'Auto';
    const previewing = active?.preview && active.snapshotId === s.id;
    return `<div class="ver${s.label ? ' named' : ''}${previewing ? ' previewing' : ''}" role="listitem" data-id="${esc(s.id)}">
      <div class="ver-top"><b class="ver-time" title="${esc(exact(s.at))}">${esc(timeAgo(s.at))}</b><span class="ver-kind ${esc(s.kind)}">${kind}</span><span class="ver-size">${esc(formatBytes(s.bytes || 0))}</span></div>
      ${s.label ? `<div class="ver-label">${esc(s.label)}</div>` : ''}
      <div class="ver-sum">${esc(s.summary?.text || '')}${s.nodes !== undefined && !s.summary?.first ? ` <span class="ver-count">· ${s.nodes} component${s.nodes === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="ver-acts"><button type="button" data-act="preview" title="Open read-only in a temporary tab">${previewing ? 'Previewing' : 'Preview'}</button><button type="button" data-act="restore" title="Replace the project with this version (undoable)">Restore</button><button type="button" data-act="dup" title="Open as a new project">Duplicate as tab</button><button type="button" data-act="label" title="Give this version a name; named versions are never pruned">${s.label ? 'Rename' : 'Name…'}</button><button type="button" data-act="del" class="danger" title="Delete this version">${icons.trash}</button></div>
    </div>`;
  }
  async _action(act, row) {
    const id = row?.dataset.id; if (!id) return;
    if (act === 'preview') { await this.tabs.preview(id); this.toast('Read-only preview · Restore or close it from the version history', 2200); }
    else if (act === 'restore') { const ok = await this.tabs.restore(id); if (ok) this.toast('Version restored · Ctrl+Z undoes', 2000); }
    else if (act === 'dup') { const t = await this.tabs.duplicate(id); if (t) this.toast(`Opened ${t.name} in a new tab`, 1600); }
    else if (act === 'label') {
      const cur = row.querySelector('.ver-label')?.textContent || '';
      const v = await promptDialog({ icon: icons.star, title: cur ? 'Rename this version' : 'Name this version', text: 'Named versions are kept until you delete them.', value: cur, placeholder: 'e.g. Before the redesign', ok: 'Save' });
      if (v !== null) { await this.tabs.setLabel(id, v); this.refresh(); }
    } else if (act === 'del') { await this.tabs.deleteVersion(id); this.toast('Version deleted', 1200); }
  }
}
