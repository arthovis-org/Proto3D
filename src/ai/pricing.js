// ai/pricing.js — money. OpenRouter prices arrive live from /models (USD per token; shown per
// 1M tokens); fal.ai and kie.ai prices are approximate, curated per model (per image, per second
// of video, per run); the Demo provider is free. `spend` counts what this session has spent,
// per provider and kind, survives a reload through sessionStorage, and notifies the job tray.
const SPEND_KEY = 'proto3d.ai.spend.v1';

export const fmtUSD = (v, { compact = false } = {}) => {
  if (v === null || v === undefined || !Number.isFinite(+v)) return '—';
  v = +v;
  if (v === 0) return compact ? '$0' : '$0.00';
  if (v < 0.001) return `$${v.toFixed(5)}`;
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
};
/** "$0.15 / $0.60 per 1M" from per-token prices (strings from OpenRouter). */
export function fmtPerMillion(prompt, completion) {
  const p = +prompt, c = +completion;
  if (!Number.isFinite(p) && !Number.isFinite(c)) return '—';
  if (p === 0 && c === 0) return 'free';
  const f = (x) => (x * 1e6 >= 10 ? (x * 1e6).toFixed(0) : (x * 1e6).toFixed(2));
  return `$${f(p)} / $${f(c)} per 1M`;
}
/** Cost of a text call from token counts and per-token prices. */
export function textCost(usage, pricing) {
  if (!usage || !pricing) return null;
  const p = +pricing.prompt || 0, c = +pricing.completion || 0;
  return (usage.prompt_tokens || 0) * p + (usage.completion_tokens || 0) * c;
}
/** Rough token count for an estimate before the call: ~4 characters per token. */
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);
/** Band label for filters: free · cheap (< $1 / 1M in+out) · mid (< $10) · premium. */
export function priceBand(pricing) {
  const t = ((+pricing?.prompt || 0) + (+pricing?.completion || 0)) * 1e6;
  if (t === 0) return 'free'; if (t < 1) return 'cheap'; if (t < 10) return 'mid'; return 'premium';
}
/**
 * A hosted model that costs nothing: an OpenRouter id ending in ":free", or prompt and completion
 * both priced 0 (a per-run price of 0 for media). The offline Demo provider is "offline", not a
 * free tier, so its models are not counted here.
 */
export function isFreeModel(m) {
  if (!m || m.provider === 'demo') return false;
  if (/:free$/i.test(String(m.id || ''))) return true;
  const p = m.pricing; if (!p) return false;
  if (p.run !== undefined) return +p.run === 0;
  if ('prompt' in p || 'completion' in p) return (+p.prompt || 0) === 0 && (+p.completion || 0) === 0;
  return false;
}

class Spend {
  constructor() {
    this.total = 0; this.byProvider = {}; this.byKind = {}; this.count = 0;
    this._listeners = new Set();
    try { const s = sessionStorage.getItem(SPEND_KEY); if (s) Object.assign(this, JSON.parse(s)); } catch (_) { /* ignore */ }
  }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  add(provider, cost, kind = 'text') {
    if (!Number.isFinite(+cost)) return;
    this.total += +cost; this.count += 1;
    this.byProvider[provider] = (this.byProvider[provider] || 0) + +cost;
    this.byKind[kind] = (this.byKind[kind] || 0) + +cost;
    try { sessionStorage.setItem(SPEND_KEY, JSON.stringify({ total: this.total, byProvider: this.byProvider, byKind: this.byKind, count: this.count })); } catch (_) { /* ignore */ }
    this._listeners.forEach((cb) => cb(this));
  }
  reset() { this.total = 0; this.byProvider = {}; this.byKind = {}; this.count = 0; try { sessionStorage.removeItem(SPEND_KEY); } catch (_) { /* ignore */ } this._listeners.forEach((cb) => cb(this)); }
}
export const spend = new Spend();
