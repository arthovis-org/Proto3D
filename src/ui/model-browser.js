// ui/model-browser.js — pick a model: search, filters (provider, price band, context length,
// vision), sort, favourites (persisted), pricing per 1M tokens or per run, "recommended" badges
// on a few good defaults. Text models come live from OpenRouter (/models, cached ten minutes)
// once a key exists; media models are the providers' curated lists; Demo models are always there.
import { providerRegistry, providerStatus } from '../ai/providers/index.js';
import { vault } from '../ai/vault.js';
import { fmtPerMillion, priceBand } from '../ai/pricing.js';
import { icons } from '../icons.js';

const FAV_KEY = 'proto3d.ai.favourites.v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtCtx = (n) => (!n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M ctx` : n >= 1000 ? `${Math.round(n / 1000)}k ctx` : `${n} ctx`);

export class ModelBrowser {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'model-browser'; this.el.className = 'modal-backdrop'; this.el.hidden = true;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true');
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    window.addEventListener('keydown', (e) => { if (!this.el.hidden && e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.fav = new Set(); try { this.fav = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch (_) { /* ignore */ }
    this.filters = { q: '', provider: 'all', band: 'all', ctx: 0, vision: false, favs: false, sort: 'recommended' };
    this.models = []; this.loading = false; this.loadError = '';
  }
  get isOpen() { return !this.el.hidden; }
  /** @param {object} o { kind, providerId, current, onPick(modelId, providerId) } */
  open(o) {
    this.opts = o; this.filters.provider = 'all'; this.filters.q = '';
    this.el.hidden = false;
    this._load().then(() => this.render());
    this.render();
    setTimeout(() => this.el.querySelector('input[type="search"]')?.focus(), 30);
  }
  close() { this.el.hidden = true; }
  _saveFav() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...this.fav])); } catch (_) { /* ignore */ } }
  async _load(force = false) {
    const kind = this.opts.kind;
    this.loading = true; this.loadError = '';
    const out = [];
    for (const p of providerRegistry.forKind(kind)) {
      try {
        const st = providerStatus(p.id);
        if (p.id === 'openrouter' && st !== 'connected' && !p.cachedModels()) { out.push(...fallbackOpenRouter()); continue; }
        const list = await p.listModels({ kind, key: vault.keyFor(p.id), proxy: vault.proxyFor(p.id), force });
        out.push(...list.filter((m) => m.kind === kind).map((m) => ({ ...m, provider: p.id })));
      } catch (e) { this.loadError = `${p.label}: ${e.message}`; if (p.id === 'openrouter') out.push(...fallbackOpenRouter()); }
    }
    this.models = out; this.loading = false;
  }
  _filtered() {
    const f = this.filters, q = f.q.trim().toLowerCase();
    let list = this.models.filter((m) => (f.provider === 'all' || m.provider === f.provider) && (!q || `${m.id} ${m.label} ${m.description || ''} ${m.note || ''}`.toLowerCase().includes(q)) && (f.band === 'all' || bandOf(m) === f.band) && (!f.ctx || (m.context || 0) >= f.ctx) && (!f.vision || m.vision) && (!f.favs || this.fav.has(m.id)));
    const price = (m) => (m.pricing?.run !== undefined ? m.pricing.run : (+m.pricing?.prompt || 0) + (+m.pricing?.completion || 0));
    const sorters = {
      recommended: (a, b) => (b.recommended - a.recommended) || (this.fav.has(b.id) - this.fav.has(a.id)) || (a.provider === 'demo') - (b.provider === 'demo') || a.label.localeCompare(b.label),
      name: (a, b) => a.label.localeCompare(b.label), priceAsc: (a, b) => price(a) - price(b), priceDesc: (a, b) => price(b) - price(a), context: (a, b) => (b.context || 0) - (a.context || 0), newest: (a, b) => (b.created || 0) - (a.created || 0),
    };
    list.sort(sorters[f.sort] || sorters.recommended);
    return list;
  }
  render() {
    if (this.el.hidden) return;
    const { kind, current } = this.opts;
    const f = this.filters;
    const list = this._filtered();
    const providers = providerRegistry.forKind(kind);
    const isText = kind === 'text';
    this.el.innerHTML = `
      <div class="modal model-browser">
        <header class="modal-head">
          <span class="modal-icon">${icons.generate}</span>
          <div><h2>Choose a ${kind} model</h2><p>${isText ? 'Prices are USD per 1M tokens (input / output), live from OpenRouter when a key is connected.' : 'Prices are approximate USD per run from the curated lists; the provider bills the exact amount.'}</p></div>
          <button type="button" class="modal-close" aria-label="Close">${icons.close}</button>
        </header>
        <div class="mb-tools">
          <label class="mb-search">${icons.search}<input type="search" placeholder="Search models…" value="${esc(f.q)}" aria-label="Search models" /></label>
          <select data-f="provider" aria-label="Provider"><option value="all">All providers</option>${providers.map((p) => `<option value="${p.id}" ${f.provider === p.id ? 'selected' : ''}>${esc(p.label)}${providerStatus(p.id) === 'missing' ? ' (no key)' : ''}</option>`).join('')}</select>
          <select data-f="band" aria-label="Price band"><option value="all">Any price</option><option value="free" ${f.band === 'free' ? 'selected' : ''}>Free</option><option value="cheap" ${f.band === 'cheap' ? 'selected' : ''}>Cheap</option><option value="mid" ${f.band === 'mid' ? 'selected' : ''}>Mid</option><option value="premium" ${f.band === 'premium' ? 'selected' : ''}>Premium</option></select>
          ${isText ? `<select data-f="ctx" aria-label="Context length"><option value="0">Any context</option><option value="32000" ${f.ctx === 32000 ? 'selected' : ''}>≥ 32k</option><option value="128000" ${f.ctx === 128000 ? 'selected' : ''}>≥ 128k</option><option value="1000000" ${f.ctx === 1000000 ? 'selected' : ''}>≥ 1M</option></select>
          <label class="mb-check"><input type="checkbox" data-f="vision" ${f.vision ? 'checked' : ''}/> vision</label>` : ''}
          <label class="mb-check"><input type="checkbox" data-f="favs" ${f.favs ? 'checked' : ''}/> ${icons.star} favourites</label>
          <select data-f="sort" aria-label="Sort"><option value="recommended" ${f.sort === 'recommended' ? 'selected' : ''}>Recommended first</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Name</option><option value="priceAsc" ${f.sort === 'priceAsc' ? 'selected' : ''}>Price ↑</option><option value="priceDesc" ${f.sort === 'priceDesc' ? 'selected' : ''}>Price ↓</option>${isText ? `<option value="context" ${f.sort === 'context' ? 'selected' : ''}>Context</option><option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>Newest</option>` : ''}</select>
          <button type="button" class="ghost" data-role="refresh" title="Fetch the model list again">${icons.redo}</button>
        </div>
        <div class="mb-list" role="listbox">
          ${this.loading && !this.models.length ? '<div class="mb-empty">Loading models…</div>' : ''}
          ${this.loadError ? `<div class="mb-empty bad">${esc(this.loadError)}</div>` : ''}
          ${!this.loading && !list.length ? '<div class="mb-empty">No model matches.</div>' : ''}
          ${list.map((m) => this._row(m, current)).join('')}
        </div>
        <footer class="modal-foot"><span>${list.length} of ${this.models.length} models</span>${isText && !providerStatus('openrouter').startsWith('connected') ? `<span class="grow"></span><span>Connect OpenRouter to see its full live catalogue.</span>` : ''}</footer>
      </div>`;
    this.el.querySelector('.modal-close').addEventListener('click', () => this.close());
    const q = this.el.querySelector('input[type="search"]');
    q.addEventListener('input', () => { f.q = q.value; this._renderList(); });
    this.el.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('change', () => { const k = c.dataset.f; f[k] = c.type === 'checkbox' ? c.checked : k === 'ctx' ? +c.value : c.value; this.render(); }));
    this.el.querySelector('[data-role="refresh"]').addEventListener('click', () => this._load(true).then(() => this.render()));
    this._bindList();
  }
  _row(m, current) {
    const price = m.pricing?.text || (m.pricing && 'prompt' in m.pricing ? fmtPerMillion(m.pricing.prompt, m.pricing.completion) : '');
    const p = providerRegistry.get(m.provider);
    return `<div class="mb-row ${m.id === current ? 'on' : ''}" role="option" tabindex="0" data-id="${esc(m.id)}" data-provider="${esc(m.provider)}" aria-selected="${m.id === current}">
      <button type="button" class="mb-fav ${this.fav.has(m.id) ? 'on' : ''}" data-fav="${esc(m.id)}" title="Favourite" aria-label="Favourite">${icons.star}</button>
      <div class="mb-main"><b>${esc(m.label)}</b>${m.recommended ? '<span class="badge">recommended</span>' : ''}${m.unverified ? '<span class="badge dim" title="from the curated list, not verified against the live docs">unverified</span>' : ''}<small>${esc(m.id)}${m.note ? ` · ${esc(m.note)}` : ''}</small></div>
      <div class="mb-meta"><span class="mb-provider">${esc(p?.label || m.provider)}</span>${m.context ? `<span>${fmtCtx(m.context)}</span>` : ''}${m.vision ? '<span>vision</span>' : ''}<span class="mb-price">${esc(price)}</span></div>
    </div>`;
  }
  _renderList() { const box = this.el.querySelector('.mb-list'); const list = this._filtered(); box.innerHTML = list.map((m) => this._row(m, this.opts.current)).join('') || '<div class="mb-empty">No model matches.</div>'; this.el.querySelector('.modal-foot span').textContent = `${list.length} of ${this.models.length} models`; this._bindList(); }
  _bindList() {
    this.el.querySelectorAll('.mb-row').forEach((r) => {
      const pick = () => { const id = r.dataset.id, provider = r.dataset.provider; this.opts.onPick?.(id, provider); this.close(); };
      r.addEventListener('click', (e) => { if (e.target.closest('.mb-fav')) return; pick(); });
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    this.el.querySelectorAll('.mb-fav').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const id = b.dataset.fav; if (this.fav.has(id)) this.fav.delete(id); else this.fav.add(id); this._saveFav(); b.classList.toggle('on', this.fav.has(id)); }));
  }
}
const bandOf = (m) => (m.pricing?.run !== undefined ? (m.pricing.run === 0 ? 'free' : m.pricing.run < 0.05 ? 'cheap' : m.pricing.run < 0.5 ? 'mid' : 'premium') : priceBand(m.pricing));
/** Shown for OpenRouter before a key exists: a handful of well-known ids with typical prices (per token), so a model can be chosen up front. */
function fallbackOpenRouter() {
  const rows = [
    ['openai/gpt-4o-mini', 'GPT-4o mini', 0.15, 0.6, 128000, true, true], ['openai/gpt-4.1-mini', 'GPT-4.1 mini', 0.4, 1.6, 1047576, true, true], ['anthropic/claude-sonnet-4', 'Claude Sonnet 4', 3, 15, 200000, true, true],
    ['anthropic/claude-3.5-haiku', 'Claude 3.5 Haiku', 0.8, 4, 200000, true, true], ['google/gemini-2.5-flash', 'Gemini 2.5 Flash', 0.3, 2.5, 1048576, true, true], ['meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B', 0.1, 0.3, 131072, false, true],
    ['deepseek/deepseek-chat-v3-0324', 'DeepSeek V3', 0.3, 0.9, 163840, false, true], ['mistralai/mistral-small-3.2-24b-instruct', 'Mistral Small 3.2', 0.1, 0.3, 131072, true, true],
  ];
  return rows.map(([id, label, p, c, ctx, vision, rec]) => ({ id, label, kind: 'text', provider: 'openrouter', pricing: { prompt: p / 1e6, completion: c / 1e6 }, context: ctx, vision, json: true, recommended: rec, note: 'typical price · connect OpenRouter for live prices' }));
}
