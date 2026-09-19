// ledger.js — the shared prepaid balance. Append-only entries in localStorage; balance, holds,
// spend and budgets are all DERIVED from the entries (never stored as separate numbers), so the
// ledger cannot drift. Storage key is the add-on's own; the core app never reads it.
//
// Entry kinds:  open | topup | auto-topup | adjust | hold | settle | refund | decline | bypass
// A request lifecycle is hold → settle (actual cost) or hold → refund (provider error / node
// removed / engine error). Declines and own-key bypasses are rows too, so every decision is
// visible. `idem` (idempotency key) makes hold() a no-op for a pulse already processed.
export const LEDGER_KEY = 'proto3d.gateway.ledger.v1';
export const SETTINGS_KEY = 'proto3d.gateway.settings.v1';
export const OPENING_BALANCE = 2300;

const DEFAULT_SETTINGS = { autoTopUp: { enabled: false, threshold: 100, target: 1000, monthlyCap: 5000 }, policy: { preferCheapest: false, fallback: true } };

const load = (key, fallback) => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch (_) { return fallback; } };
const store = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (_) { return false; } };
let seq = 0;
const newId = (p = 'e') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const monthKey = (iso) => iso.slice(0, 7);
const dayKey = (iso) => iso.slice(0, 10);
const nowIso = () => new Date().toISOString();

class Ledger {
  constructor() {
    this.entries = load(LEDGER_KEY, null);
    if (!Array.isArray(this.entries) || !this.entries.length) this.entries = [{ id: newId(), at: nowIso(), kind: 'open', credits: OPENING_BALANCE, note: 'opening balance (demo)' }], this._persist();
    const s = load(SETTINGS_KEY, {});
    this.settings = { autoTopUp: { ...DEFAULT_SETTINGS.autoTopUp, ...(s.autoTopUp || {}) }, policy: { ...DEFAULT_SETTINGS.policy, ...(s.policy || {}) } };
    this._listeners = new Set();
    this._recompute();
  }

  /* ---------- events ---------- */
  on(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit(type, payload) { this._listeners.forEach((cb) => { try { cb(type, payload, this); } catch (e) { console.warn('ledger listener', e); } }); }

  /* ---------- storage ---------- */
  _persist() { store(LEDGER_KEY, this.entries); }
  _append(entry) {
    const e = { id: newId(), at: nowIso(), ...entry };
    this.entries.push(e);
    this._recompute();
    this._persist();
    this._emit(e.kind, e);
    return e;
  }
  saveSettings() { store(SETTINGS_KEY, this.settings); this._emit('settings', this.settings); }
  reset() {
    this.entries = [{ id: newId(), at: nowIso(), kind: 'open', credits: OPENING_BALANCE, note: 'ledger reset (demo)' }];
    this._recompute(); this._persist(); this._emit('reset', null);
  }

  /* ---------- derived state ---------- */
  _recompute() {
    let balance = 0; const holds = new Map();
    for (const e of this.entries) {
      switch (e.kind) {
        case 'open': case 'topup': case 'auto-topup': case 'adjust': balance += e.credits; break;
        case 'hold': holds.set(e.holdId, { ...e }); break;
        case 'settle': { const h = holds.get(e.holdId); if (h) { balance -= e.credits; holds.delete(e.holdId); } break; }
        case 'refund': holds.delete(e.holdId); break;
        default: break;
      }
    }
    this._balance = balance;                       // funds not yet spent (settled)
    this._holds = holds;                           // open holds by holdId
    this._held = [...holds.values()].reduce((a, h) => a + h.credits, 0);
  }
  /** Credits free to hold right now: balance minus open holds. */
  available() { return this._balance - this._held; }
  balance() { return this._balance; }
  held() { return this._held; }
  openHolds() { return [...this._holds.values()]; }
  holdsFor(nodeUid) { return this.openHolds().filter((h) => h.nodeUid === nodeUid); }
  isOpen(holdId) { return this._holds.has(holdId); }
  hasIdem(idem) { return this.entries.some((e) => e.idem === idem && (e.kind === 'hold' || e.kind === 'bypass' || e.kind === 'decline')); }

  _inPeriod(e, period = 'monthly', ref = nowIso()) { return period === 'daily' ? dayKey(e.at) === dayKey(ref) : monthKey(e.at) === monthKey(ref); }
  settledEntries(period = 'monthly') { return this.entries.filter((e) => e.kind === 'settle' && this._inPeriod(e, period)); }
  spend(period = 'monthly') { return this.settledEntries(period).reduce((a, e) => a + e.credits, 0); }
  requests(period = 'monthly') { return this.entries.filter((e) => (e.kind === 'settle' || e.kind === 'bypass') && this._inPeriod(e, period)).length; }
  bypassed(period = 'monthly') { return this.entries.filter((e) => e.kind === 'bypass' && this._inPeriod(e, period)).length; }
  avgPerCall(period = 'monthly') { const s = this.settledEntries(period); return s.length ? this.spend(period) / s.length : 0; }
  autoToppedThisMonth() { return this.entries.filter((e) => e.kind === 'auto-topup' && this._inPeriod(e)).reduce((a, e) => a + e.credits, 0); }
  spentFor(workflow, period = 'monthly') { return this.settledEntries(period).filter((e) => e.workflow === workflow).reduce((a, e) => a + e.credits, 0); }
  heldFor(workflow) { return this.openHolds().filter((h) => h.workflow === workflow).reduce((a, h) => a + h.credits, 0); }
  lastCost() { for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].kind === 'settle') return this.entries[i].credits; return null; }
  lastCostFor(nodeUid) { for (let i = this.entries.length - 1; i >= 0; i--) { const e = this.entries[i]; if (e.kind === 'settle' && e.nodeUid === nodeUid) return e.credits; } return null; }
  /** Spend grouped by model / service label (this month), largest first. */
  byService(period = 'monthly') {
    const m = new Map();
    for (const e of this.settledEntries(period)) { const k = e.service || e.provider || '—'; const r = m.get(k) || { name: k, provider: e.providerId, credits: 0, n: 0 }; r.credits += e.credits; r.n += 1; m.set(k, r); }
    return [...m.values()].sort((a, b) => b.credits - a.credits);
  }
  byWorkflow(period = 'monthly') {
    const m = new Map();
    for (const e of this.settledEntries(period)) { const k = e.workflow || '—'; const r = m.get(k) || { name: k, credits: 0, n: 0 }; r.credits += e.credits; r.n += 1; m.set(k, r); }
    return [...m.values()].sort((a, b) => b.credits - a.credits);
  }

  /**
   * Display rows: one per request, newest first. A hold and its later settle / refund collapse into
   * one row whose status is held → settled | refunded; declines, bypasses and top-ups stand alone.
   */
  rows(limit = 12) {
    const byHold = new Map(); const out = [];
    for (const e of this.entries) {
      if (e.kind === 'open') continue;
      if (e.kind === 'hold') { const r = { ...e, status: 'held', estimate: e.credits }; byHold.set(e.holdId, r); out.push(r); continue; }
      if (e.kind === 'settle' || e.kind === 'refund') {
        const r = byHold.get(e.holdId);
        if (r) { r.status = e.kind === 'settle' ? 'settled' : 'refunded'; r.credits = e.kind === 'settle' ? e.credits : 0; r.units = e.units || r.units; r.note = e.note || r.note; r.settledAt = e.at; }
        else out.push({ ...e, status: e.kind });
        continue;
      }
      out.push({ ...e, status: e.kind === 'bypass' ? 'bypassed' : e.kind === 'auto-topup' ? 'topup' : e.kind });
    }
    return out.reverse().slice(0, limit);
  }

  /* ---------- money in ---------- */
  topUp(credits, note = 'manual top-up') { return this._append({ kind: 'topup', credits: +credits, note, provider: 'Manual top-up' }); }
  /** Demo helper: move the available balance to `target` with a signed adjustment entry (append-only, so it is a row too). */
  adjustTo(target, note = 'balance adjusted for testing') { return this._append({ kind: 'adjust', credits: +(target - this.available()).toFixed(4), note, provider: 'Adjustment' }); }
  /** Fire auto top-up when the balance is below the threshold and the monthly cap allows. */
  maybeAutoTopUp(reason = '') {
    const a = this.settings.autoTopUp;
    if (!a.enabled) return null;
    if (this.available() >= a.threshold) return null;
    const room = Math.max(0, a.monthlyCap - this.autoToppedThisMonth());
    let amt = Math.max(0, a.target - this.available());
    if (amt <= 0) return null;
    if (room <= 0) { this._emit('auto-topup-capped', { cap: a.monthlyCap }); return null; }
    amt = Math.min(amt, room);
    return this._append({ kind: 'auto-topup', credits: amt, provider: 'Auto top-up', note: `auto top-up fired: balance fell below ${a.threshold} cr; refilled towards ${a.target} cr${reason ? ' · ' + reason : ''}` });
  }

  /* ---------- request lifecycle ---------- */
  /**
   * Place a hold for an estimated cost. `req` = { idem, nodeUid, nodeTitle, workflow, providerId,
   * provider, service, units, credits, note, budget?: { limit, period } }.
   * Returns { ok: true, holdId } | { ok: true, duplicate: true } | { ok: false, reason, entry }.
   */
  hold(req) {
    if (req.idem && this.hasIdem(req.idem)) return { ok: true, duplicate: true };
    const est = Math.max(0, +req.credits || 0);
    const base = { idem: req.idem, nodeUid: req.nodeUid, nodeTitle: req.nodeTitle, workflow: req.workflow, providerId: req.providerId, provider: req.provider, service: req.service, units: req.units };
    if (req.budget && Number.isFinite(req.budget.limit)) {
      const spent = this.spentFor(req.workflow, req.budget.period) + this.heldFor(req.workflow);
      if (spent + est > req.budget.limit) {
        const reason = `workflow budget ${fmt(req.budget.limit)} cr (${req.budget.period || 'monthly'}) reached: spent ${fmt(spent)}, est ${fmt(est)}`;
        return { ok: false, reason, entry: this._append({ ...base, kind: 'decline', credits: 0, note: reason }) };
      }
    }
    if (this.available() < est) {
      this.maybeAutoTopUp(`needed ${fmt(est)} cr for ${req.nodeTitle || 'a request'}`);
      if (this.available() < est) {
        const reason = `insufficient balance: est ${fmt(est)} cr, available ${fmt(this.available())} cr${this.settings.autoTopUp.enabled ? ' (auto top-up could not cover it)' : ' (auto top-up is off)'}`;
        return { ok: false, reason, entry: this._append({ ...base, kind: 'decline', credits: 0, note: reason }) };
      }
    }
    const holdId = newId('h');
    this._append({ ...base, kind: 'hold', holdId, credits: est, note: req.note || '' });
    return { ok: true, holdId, estimate: est };
  }
  /** Settle an open hold to the actual cost. Idempotent: a settled or refunded hold is left alone. */
  settle(holdId, actual, { units, note } = {}) {
    const h = this._holds.get(holdId); if (!h) return null;
    const e = this._append({ kind: 'settle', holdId, idem: h.idem, nodeUid: h.nodeUid, nodeTitle: h.nodeTitle, workflow: h.workflow, providerId: h.providerId, provider: h.provider, service: h.service, units: units || h.units, credits: Math.max(0, +actual || 0), note: note ?? h.note });
    this.maybeAutoTopUp('after settlement');
    return e;
  }
  refund(holdId, note = 'hold released') {
    const h = this._holds.get(holdId); if (!h) return null;
    return this._append({ kind: 'refund', holdId, idem: h.idem, nodeUid: h.nodeUid, nodeTitle: h.nodeTitle, workflow: h.workflow, providerId: h.providerId, provider: h.provider, service: h.service, units: h.units, credits: 0, note });
  }
  /** Release every open hold of a node (engine error, node removed). Returns how many. */
  releaseHolds(nodeUid, note = 'hold released') { const hs = this.holdsFor(nodeUid); hs.forEach((h) => this.refund(h.holdId, note)); return hs.length; }
  decline(req, reason) { return this._append({ kind: 'decline', idem: req.idem, nodeUid: req.nodeUid, nodeTitle: req.nodeTitle, workflow: req.workflow, providerId: req.providerId, provider: req.provider, service: req.service, units: '—', credits: 0, note: reason }); }
  /** Own-key call: not metered, logged for visibility with 0 credits. */
  bypass(req) { if (req.idem && this.hasIdem(req.idem)) return null; return this._append({ kind: 'bypass', idem: req.idem, nodeUid: req.nodeUid, nodeTitle: req.nodeTitle, workflow: req.workflow, providerId: req.providerId, provider: req.provider, service: req.service, units: req.units, credits: 0, note: req.note || 'own API key; not metered' }); }
}

export const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(3) : (+v || 0).toFixed(4));
export const fmtBal = (v) => (+v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One ledger per page (module singleton), shared by the nodes and the admin UI. */
export const ledger = new Ledger();
export default ledger;
