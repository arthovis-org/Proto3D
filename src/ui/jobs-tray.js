// ui/jobs-tray.js — a small tray at the bottom right: running and queued jobs with progress,
// stage, elapsed and a cancel button, recently finished ones (fading), and the session spend.
// Clicking a job frames and selects its component. Collapses to a pill when nothing is running.
import { jobs, fmtElapsed } from '../ai/jobs.js';
import { spend, fmtUSD } from '../ai/pricing.js';
import { icons } from '../icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RECENT_MS = 8000;

export class JobsTray {
  /** @param {object} o { el, onFocus(uid) } */
  constructor({ el, onFocus = () => {} }) {
    this.el = el; this.onFocus = onFocus; this.expanded = true; this._dirty = true;
    jobs.onChange(() => { this._dirty = true; });
    spend.onChange(() => { this._dirty = true; });
    this.el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cancel]'); if (c) { e.stopPropagation(); jobs.byId(c.dataset.cancel)?.cancel(); return; }
      const r = e.target.closest('[data-retry]'); if (r) { e.stopPropagation(); jobs.byId(r.dataset.retry)?.retry(); return; }
      const row = e.target.closest('[data-job]'); if (row) { const j = jobs.byId(row.dataset.job); if (j?.owner) this.onFocus(j.owner); return; }
      if (e.target.closest('.tray-head')) { this.expanded = !this.expanded; this._dirty = true; }
    });
    this.render();
  }
  visibleJobs() {
    const now = Date.now();
    return jobs.jobs.filter((j) => j.active || (j.finishedAt && now - j.finishedAt < RECENT_MS && !j._dismissed)).slice(-6).reverse();
  }
  /** Per frame (cheap: rebuilds only when something changed or a job is running). */
  update() {
    const active = jobs.active.length > 0;
    if (!this._dirty && !active && !this.visibleJobs().length) return;
    if (!this._dirty && !active) { this._dirty = true; }   // a recent job is fading: keep repainting until it is gone
    const now = performance.now();
    if (active && now - (this._last || 0) < 120) return;
    this._last = now; this._dirty = false;
    this.render();
  }
  render() {
    const list = this.visibleJobs();
    const active = jobs.active.length;
    const hasContent = list.length > 0 || spend.count > 0;
    this.el.hidden = !hasContent;
    if (!hasContent) return;
    this.el.classList.toggle('collapsed', !this.expanded);
    const head = `<div class="tray-head" role="button" tabindex="0" aria-expanded="${this.expanded}">
      <span class="tray-dot ${active ? 'live' : ''}"></span>
      <b>${active ? `${active} job${active > 1 ? 's' : ''} running` : 'Generation'}</b>
      <span class="tray-spend" title="Spent this session (estimates for curated prices)">${fmtUSD(spend.total)}${spend.count ? ` · ${spend.count} run${spend.count > 1 ? 's' : ''}` : ''}</span>
      <span class="tray-chev">${icons.chevron}</span></div>`;
    const metaOf = (j) => { const st = j.status; return st === 'queued' ? `queued${j.queuePosition ? ` · #${j.queuePosition}` : ''}` : st === 'running' ? `${j.stage} · ${fmtElapsed(j.elapsed)}${j.tokens ? ` · ${j.tokens.out} tok` : ''}` : st === 'succeeded' ? `done · ${fmtElapsed(j.elapsed)}${typeof j.cost === 'number' ? ` · ${j.cost === 0 ? 'free' : fmtUSD(j.cost)}` : ''}` : st === 'failed' ? `failed · ${j.error?.message || ''}` : 'cancelled'; };
    const pctOf = (j) => Math.round((j.status === 'succeeded' ? 1 : j.progress) * 100);
    // same rows in the same states: patch the live parts in place so buttons stay attached under the pointer
    const sig = `${this.expanded}|${active}|${list.map((j) => `${j.id}:${j.status}`).join(',')}`;
    if (sig === this._sig && this.el.firstChild) {
      const spendEl = this.el.querySelector('.tray-spend'); if (spendEl) spendEl.textContent = `${fmtUSD(spend.total)}${spend.count ? ` · ${spend.count} run${spend.count > 1 ? 's' : ''}` : ''}`;
      for (const j of list) { const row = this.el.querySelector(`[data-job="${j.id}"]`); if (!row) continue; row.querySelector('.tray-bar i').style.width = `${pctOf(j)}%`; row.querySelector('.tray-meta').textContent = metaOf(j); }
      return;
    }
    this._sig = sig;
    const rows = list.map((j) => {
      const st = j.status;
      return `<div class="tray-job ${st}" data-job="${j.id}" title="Click to show the component">
        <div class="tray-line"><span class="tray-kind">${esc(j.kind)}</span><b>${esc(j.title || j.kind)}</b><small>${esc(j.model.split('/').pop())}</small>
          ${j.active ? `<button type="button" class="ghost" data-cancel="${j.id}" title="Cancel" aria-label="Cancel">${icons.close}</button>` : st !== 'succeeded' ? `<button type="button" class="ghost" data-retry="${j.id}" title="Retry" aria-label="Retry">${icons.redo}</button>` : ''}</div>
        <div class="tray-bar"><i style="width:${pctOf(j)}%"></i></div>
        <div class="tray-meta">${esc(metaOf(j))}</div></div>`;
    }).join('');
    this.el.innerHTML = head + (this.expanded ? `<div class="tray-list">${rows || '<div class="tray-empty">No jobs right now.</div>'}</div>` : '');
  }
}
