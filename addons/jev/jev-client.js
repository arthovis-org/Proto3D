// jev-client.js — one call: `decide({ state, questions })` → `{ answers, usage, model, latencyMs, cost, simulated }`.
// LIVE when a TypeSafe key is in the vault (POST https://api.typesafe.ai/v1/systemone through the
// core's `request()`, so a per-provider proxy URL works), SIMULATED otherwise (simulate.js). Retries
// 429 / 529 with exponential backoff, maps 401 → ProviderError('auth', fix: 'connections'), prices
// input tokens at $0.042 per million (output is free) and books the cost on the session `spend`.
// A small result cache keyed by the full spec (state + questions) keeps identical calls off the wire.
import { requestJSON, ProviderError, sleep } from '../../src/ai/http.js';
import { vault } from '../../src/ai/vault.js';
import { spend } from '../../src/ai/pricing.js';
import { providerStatus } from '../../src/ai/providers/base.js';
import { simulate, simulatedLatency } from './simulate.js';

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-latest';
export const PRICE_PER_M = 0.042;
export const PROVIDER_ID = 'jev';
const SETTINGS_KEY = 'proto3d.jev.settings.v1';
const BACKOFF = [400, 900, 2000];

/** FNV-1a, base36 — good enough for cache keys and change detection. */
export function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
export const costOf = (usage) => ((usage?.input_tokens || 0) / 1e6) * PRICE_PER_M;

function readSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (_) { return {}; } }
function writeSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) { /* private mode */ } }

class JevClient {
  constructor() {
    this.forceSimulated = !!readSettings().forceSimulated;
    this.cache = new Map();
    this.cacheMax = 200;
    this.stats = { count: 0, live: 0, simulated: 0, latencyTotal: 0, cost: 0, lastModel: null, lastError: null };
    this._listeners = new Set();
  }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit() { this._listeners.forEach((cb) => cb(this)); }
  /** True when a real call would go out: a key in the vault and the simulated switch off. */
  isLive() { return !this.forceSimulated && providerStatus(PROVIDER_ID) === 'connected'; }
  hasKey() { return providerStatus(PROVIDER_ID) === 'connected'; }
  setForceSimulated(v) { this.forceSimulated = !!v; writeSettings({ ...readSettings(), forceSimulated: this.forceSimulated }); this.cache.clear(); this._emit(); }
  get avgLatency() { return this.stats.count ? this.stats.latencyTotal / this.stats.count : 0; }

  /** Decide. `questions` is the raw API map { id: { type, instructions, criteria } }. */
  async decide({ state, questions }, { signal, noCache = false } = {}) {
    const live = this.isLive();
    const key = `${live ? 'L' : 'S'}:${JSON.stringify({ state, questions })}`;   // the whole spec, not a hash: a collision must never hand back another question's answer
    if (!noCache && this.cache.has(key)) return { ...this.cache.get(key), cached: true };
    const t0 = performance.now();
    const res = live ? await this._live({ state, questions }, signal) : await this._simulated({ state, questions }, signal);
    const out = { answers: res.answers || {}, usage: res.usage || { input_tokens: 0, output_tokens: 0 }, model: res.model || (live ? MODEL : 'simulated'), latencyMs: Math.round(performance.now() - t0), cost: live ? costOf(res.usage) : 0, simulated: !live, at: new Date().toISOString() };
    this._book(out);
    if (this.cache.size >= this.cacheMax) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, out);
    return out;
  }
  /** A decision failed outside the client (the runner reports it here so the status pill shows it). */
  noteError(message) { this.stats.lastError = message; this._emit(); }
  _book(out) {
    const s = this.stats; s.count++; s[out.simulated ? 'simulated' : 'live']++; s.latencyTotal += out.latencyMs; s.cost += out.cost; s.lastModel = out.model; s.lastError = null;
    if (!out.simulated && out.cost > 0) spend.add(PROVIDER_ID, out.cost, 'decision');
    this._emit();
  }
  async _simulated(body, signal) {
    const ms = window.__jevFast ? 0 : simulatedLatency(JSON.stringify(body));
    if (ms) await sleep(ms, signal);
    return simulate(body);
  }
  async _live(body, signal) {
    const key = vault.keyFor(PROVIDER_ID), proxy = vault.proxyFor(PROVIDER_ID);
    if (!key) throw new ProviderError('no-key', 'No TypeSafe key yet — add one in Connections', { fix: 'connections' });
    return callSystemOne({ ...body, model: MODEL }, { key, proxy, signal, onError: (e) => { this.stats.lastError = e.message; this._emit(); } });
  }
}

/** The raw HTTP call with backoff, shared with the provider's Test button. */
export async function callSystemOne(body, { key, proxy, signal, onError = () => {} } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await requestJSON(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal, proxy, timeout: 30000, label: 'TypeSafe Jev' });
    } catch (e) {
      const retryable = e instanceof ProviderError && (e.status === 429 || e.code === 'rate' || e.status === 529);   // only what TypeSafe documents as transient
      if (retryable && attempt < BACKOFF.length) { await sleep(BACKOFF[attempt] + Math.random() * 250, signal); attempt++; continue; }
      if (e instanceof ProviderError && e.status === 422) { const detail = /\(422\):\s*(.+)$/s.exec(e.message)?.[1]?.trim(); const err = new ProviderError('bad-request', `TypeSafe rejected the question shape (422)${detail ? `: ${detail}` : ''}`, { status: 422 }); onError(err); throw err; }
      onError(e); throw e;
    }
  }
}

export const client = new JevClient();
export default client;
