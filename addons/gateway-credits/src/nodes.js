// nodes.js — the Gateway Credits components, registered through `host.nodes.register` in the
// 'gateway' category (ids prefixed gw-, enforced by the SDK from addon.json's `prefix`).
// Metering happens inside the nodes' own evaluate(): trigger → eligibility → estimate →
// ledger.hold → provider adapter (async) → parked in a per-instance queue → drained on a later
// frame → ledger.settle / refund → touch('result') + emit('done' | 'failed').
// Everything the nodes need from the core arrives through the host: drawing helpers
// (host.draw), the live palette (host.theme.palette) and icons (host.icons).
import { fmt, fmtBal } from './ledger.js';
import { MODEL_PROVIDER_LABELS, TOOL_SERVICE_LABELS, TIER_OPTIONS, MODEL_OPTIONS, PROVIDERS, providerByLabel, toolByLabel, creditsToUsd } from './rates.js';
import { resolveModel, fallbackFor } from './routing.js';
import { adapterFor } from './providers.js';
import { iconTable } from './glyphs.js';

export const GATEWAY_TYPES = ['gw-llm', 'gw-tool', 'gw-budget', 'gw-meter'];
const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
export const ICONS = {
  gateway: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.2 9.6c0-1 1.2-1.6 2.8-1.6s2.8.6 2.8 1.6c0 2.6-5.6 1.4-5.6 4 0 1 1.2 1.6 2.8 1.6s2.8-.6 2.8-1.6"/>'),
  'gw-llm': svg('<path d="M4 17V9a5 5 0 015-5h6a5 5 0 015 5v2a5 5 0 01-5 5H9l-5 4z"/><path d="M9 9.5h6M9 12.5h4"/>'),
  'gw-tool': svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M20 20l-4.8-4.8"/>'),
  'gw-budget': svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>'),
  'gw-meter': svg('<path d="M4 16a8 8 0 0116 0"/><path d="M12 16l4-5"/><path d="M3 20h18"/>'),
};

/* ---------- module state: one ledger + host per page (set by registerNodes) ---------- */
let ledger = null;
let host = null;

/* ---------- per-instance runtime that must NOT serialize: resolved promises waiting to be drained ---------- */
const pending = new WeakMap();
const pend = (inst) => { let p = pending.get(inst); if (!p) { p = { queue: [], inflight: 0 }; pending.set(inst, p); } return p; };
/** Manual kicks ("Run now" in the panel, "Run sample" in the Credits menu) consumed by the next evaluate. */
const kicks = new Set();
let manualSeq = 0;
export function kick(instance) { if (!instance) return false; kicks.add(instance); return true; }
/** Pulse ids are session-scoped (engine pulse numbers restart on reload) so an idempotency key can never collide across reloads. */
const SESSION = Date.now().toString(36).slice(-5);
const pulseId = (pulse) => `${SESSION}.${pulse.n}`;
const ERROR_VISIBLE_S = 6;

/* ---------- helpers ---------- */
export const workflowOf = (inst) => (inst.params.workflow && String(inst.params.workflow).trim()) || inst.group?.title || 'default';
export function budgetFor(inst, workflow) {
  const b = inst.world?.nodes.find((n) => n.typeId === 'gw-budget' && String(n.params.workflow || '').trim() === workflow);
  return b ? { limit: +b.params.limit, period: b.params.period || 'monthly', node: b } : null;
}
const policy = () => ledger.settings.policy;
const toast = (text, ms) => { try { host?.ui.toast(text, ms); } catch (_) { /* before boot / headless */ } };

/** Eligibility: credential mode, adapter present, rate on card. Returns { ok, why, route, adapter }. */
export function eligibility(kind, params) {
  if (params.credential === 'Own key') {
    const p = kind === 'llm' ? providerByLabel(params.provider) : providerByLabel(params.service);
    return { ok: false, bypass: true, why: `own API key${params.apiKey ? '' : ' (none entered)'}: routed straight to ${p ? p.label : 'the provider'}, not metered`, route: kind === 'llm' ? resolveModel({ ...params, tier: 'fixed' }, {}) : { tool: toolByLabel(params.service) }, adapter: p ? adapterFor(p.id) : null };
  }
  if (kind === 'llm') {
    const p = providerByLabel(params.provider);
    if (!p) return { ok: false, why: `unknown provider "${params.provider}"` };
    const route = resolveModel(params, policy());
    if (!route.model) return { ok: false, why: route.reason };
    const adapter = adapterFor(route.model.provider);
    if (!adapter) return { ok: false, why: `${PROVIDERS[route.model.provider].label} has no gateway adapter` };
    return { ok: true, why: `Gateway credits · ${PROVIDERS[route.model.provider].label} adapter present · ${route.model.label} on the rate card · ${route.reason}`, route, adapter };
  }
  const tool = toolByLabel(params.service);
  if (!tool) return { ok: false, why: `${params.service} is not on the rate card` };
  const adapter = adapterFor(tool.id);
  if (!adapter) return { ok: false, why: `${tool.label} has no gateway adapter` };
  return { ok: true, why: `Gateway credits · ${tool.label} adapter present · ${tool.price} cr / ${tool.unit} on the rate card`, route: { tool }, adapter };
}
/** Estimated credits for one run with the current params (0 for own-key). */
export function estimateRun(kind, params) {
  const el = eligibility(kind, params);
  if (!el.ok || !el.adapter) return { credits: 0, units: '—', el };
  const prompt = kind === 'llm' ? params.prompt : params.query;
  return { ...el.adapter.estimate(params, prompt, el.route), el };
}

const gwState = (state) => (state.gw = state.gw || { status: 'idle', runs: 0, lastCost: null, result: undefined });
const routeLabel = (kind, route) => (kind === 'llm' ? `${PROVIDERS[route.model.provider].label} · ${route.model.label}` : route.tool.label);
const routeService = (kind, route) => (kind === 'llm' ? route.model.label : route.tool.label);
const routeProviderId = (kind, route) => (kind === 'llm' ? route.model.provider : route.tool.id);

function fail(ctx, gw, reason) {
  gw.status = 'failed'; gw.error = reason; gw.errorUntil = ctx.time + ERROR_VISIBLE_S;
  ctx.instance.rt.error = reason;
  ctx.emit('failed', reason);
}

/** One attempt: estimate → hold → async call → queue. Called from evaluate (initial) and from drain (fallback). */
function startAttempt(ctx, kind, req) {
  const { instance, params, state } = ctx; const gw = gwState(state);
  const idem = `${instance.uid}:${req.pulseId}${req.attempt > 1 ? `:a${req.attempt}` : ''}`;
  const workflow = workflowOf(instance);
  const el = req.el || eligibility(kind, params);
  const base = { idem, nodeUid: instance.uid, nodeTitle: instance.title, workflow };
  if (el.bypass) {
    if (!el.adapter || (kind === 'llm' && !el.route.model)) return fail(ctx, gw, `own key: ${el.route?.reason || 'no adapter for ' + (params.provider || params.service)}`);
    const est = el.adapter.estimate(params, req.prompt, el.route);
    const row = ledger.bypass({ ...base, providerId: routeProviderId(kind, el.route), provider: routeLabel(kind, el.route), service: routeService(kind, el.route), units: est.units, note: `own API key${params.apiKey ? '' : ' (empty)'}; not metered` });
    if (!row) return;   // same pulse already processed
    gw.status = 'bypassed'; gw.route = routeLabel(kind, el.route);
    const P = pend(instance); P.inflight += 1;
    el.adapter.call(params, req.prompt, el.route, { mode: 'own-key' })
      .then((res) => P.queue.push({ ok: true, holdId: null, res, req }), (err) => P.queue.push({ ok: false, holdId: null, err, req, route: el.route }))
      .finally(() => { P.inflight -= 1; });
    return;
  }
  if (!el.ok) { ledger.decline({ ...base, provider: params.provider || params.service, service: '—' }, `not gateway-eligible: ${el.why}`); return fail(ctx, gw, `declined: ${el.why}`); }
  const route = req.route || el.route;
  const adapter = adapterFor(routeProviderId(kind, route)) || el.adapter;
  const est = adapter.estimate(params, req.prompt, route);
  const budget = budgetFor(instance, workflow);
  const hold = ledger.hold({ ...base, providerId: routeProviderId(kind, route), provider: routeLabel(kind, route), service: routeService(kind, route), units: est.units, credits: est.credits, note: req.note || (kind === 'llm' ? route.reason : ''), budget: budget ? { limit: budget.limit, period: budget.period } : null });
  if (hold.duplicate) return;   // idempotency: this pulse was already billed
  if (!hold.ok) return fail(ctx, gw, `declined: ${hold.reason}`);
  gw.status = 'held'; gw.route = routeLabel(kind, route); gw.holdId = hold.holdId;
  const P = pend(instance); P.inflight += 1;
  adapter.call(params, req.prompt, route, { simulateFailure: policy().fallback })
    .then((res) => P.queue.push({ ok: true, holdId: hold.holdId, res, req, route }), (err) => P.queue.push({ ok: false, holdId: hold.holdId, err, req, route }))
    .finally(() => { P.inflight -= 1; });
}

/** Drain resolved calls: settle / refund on this frame, then emit. Fallback re-enters startAttempt. */
function drain(ctx, kind) {
  const { instance, state, emit, touch } = ctx; const gw = gwState(state); const P = pend(instance);
  while (P.queue.length) {
    const item = P.queue.shift();
    if (item.ok) {
      if (item.holdId) { if (!ledger.isOpen(item.holdId)) continue; ledger.settle(item.holdId, item.res.credits, { units: item.res.units, note: item.req.note || (kind === 'llm' ? item.route?.reason : '') }); }
      gw.status = item.holdId ? 'settled' : 'bypassed'; gw.lastCost = item.holdId ? item.res.credits : 0; gw.result = item.res.result; gw.runs = (gw.runs || 0) + 1; gw.holdId = null; gw.error = null;
      touch('result'); touch('cost'); emit('done', gw.result);
      continue;
    }
    const reason = item.err?.message || String(item.err);
    if (item.holdId) ledger.refund(item.holdId, `${reason} · hold released`);
    gw.holdId = null;
    if (kind === 'llm' && policy().fallback && item.req.attempt < 2 && item.route?.model) {
      const fb = fallbackFor(item.route.model);
      if (fb) {
        toast(`${instance.title}: ${item.route.model.label} failed, falling back to ${fb.label}`, 2200);
        startAttempt(ctx, kind, { ...item.req, attempt: item.req.attempt + 1, route: { model: fb, reason: `fallback from ${item.route.model.label}` }, note: `fallback from ${item.route.model.label} after ${reason}` });
        continue;
      }
    }
    fail(ctx, gw, `${reason}${policy().fallback ? ' · no fallback left' : ' · fallback policy off'}`);
  }
}

function gatewayEvaluate(kind) {
  return function evaluate(ctx) {
    const { inputs, params, state, time, instance } = ctx; const gw = gwState(state);
    let pulse = inputs.trigger || null;
    if (kicks.delete(instance)) pulse = { n: `m${++manualSeq}`, payload: 'manual run' };
    if (pulse) {
      const raw = kind === 'llm' ? inputs.prompt : inputs.query;
      const fromPulse = typeof pulse.payload === 'string' ? pulse.payload : undefined;
      const text = raw !== undefined && raw !== null && raw !== '' ? String(raw) : (kind === 'llm' ? params.prompt : params.query) || fromPulse || '';
      gw.error = null;
      startAttempt(ctx, kind, { pulseId: pulseId(pulse), prompt: text, attempt: 1 });
    }
    drain(ctx, kind);
    if (gw.error && time < (gw.errorUntil || 0)) instance.rt.error = gw.error;
    return { result: gw.result, cost: gw.lastCost ?? 0 };
  };
}
const statusWord = { idle: 'idle', held: 'held…', settled: 'settled', bypassed: 'own key', failed: 'failed', declined: 'declined' };
function gatewayFooter(kind) {
  return ({ params, state }) => {
    const gw = state.gw || {}; const el = eligibility(kind, params);
    const what = el.route ? (kind === 'llm' ? el.route.model?.label : el.route.tool?.label) : '—';
    if (el.bypass) return `${what || '—'} · own key · not metered${gw.runs ? ` · ${gw.runs}×` : ''}`;
    const cost = gw.lastCost != null ? `${fmt(gw.lastCost)} cr` : `est ${fmt(estimateRun(kind, params).credits)} cr`;
    return `${what || '—'} · ${statusWord[gw.status] || gw.status || 'idle'} · ${cost}`;
  };
}
/** Panel section on the node (def.panel(api, block)): eligibility, est. cost / run, held, last cost, Run now. */
function gatewayPanel(kind) {
  return (api, block) => {
    const s = api.section('Gateway credits');
    const el = () => eligibility(kind, block.params);
    api.readonly(s, 'eligible', () => (el().ok ? 'yes' : el().bypass ? 'bypass' : 'no'));
    const why = api.h('div', 'gw-why'); s.appendChild(why); api.live(() => { const e = el(); why.textContent = e.why; why.classList.toggle('bad', !e.ok && !e.bypass); });
    api.readonly(s, 'workflow', () => workflowOf(block));
    api.readonly(s, 'est. cost / run', () => { const e = estimateRun(kind, block.params); return e.credits ? `${fmt(e.credits)} cr · $${creditsToUsd(e.credits).toFixed(4)} · ${e.units}` : '0 cr (not metered)'; });
    api.readonly(s, 'held', () => { const h = ledger.holdsFor(block.uid).reduce((a, x) => a + x.credits, 0); return h ? `${fmt(h)} cr` : 'none'; });
    api.readonly(s, 'last cost', () => { const c = ledger.lastCostFor(block.uid); return c == null ? '—' : `${fmt(c)} cr`; });
    api.readonly(s, 'runs', () => String(block.state.gw?.runs || 0));
    api.readonly(s, 'balance', () => `${fmtBal(ledger.available())} cr available`);
    api.action(s, 'Run now (no upstream pulse needed)', () => kick(block), `gw-run-${block.uid}`);
  };
}

/** Register the four gw- components. Called once per page from index.js `register(host)`. */
export function registerNodes(h, l) {
  host = h; ledger = l;
  const { clear, drawText, roundRect } = host.draw;
  const palette = host.theme.palette;
  for (const [name, icon] of Object.entries(ICONS)) host.icons.set(name, icon);
  for (const [name, svg] of Object.entries(iconTable())) host.icons.set(name, svg);   // service glyphs: gw-svc-<provider|service|role>

  /* ---------- gw-llm ---------- */
  host.nodes.register({
    id: 'gw-llm', category: 'gateway', label: 'Model call', icon: ICONS['gw-llm'], size: 'S',
    description: 'Calls a model through Gateway credits (metered) or your own key (bypassed); simulated providers',
    inputs: [{ key: 'trigger', label: 'trigger', type: 'event' }, { key: 'prompt', label: 'prompt', type: 'text', optional: true }],
    outputs: [{ key: 'result', label: 'result', type: 'text' }, { key: 'cost', label: 'cost', type: 'number' }, { key: 'done', label: 'done', type: 'event' }, { key: 'failed', label: 'failed', type: 'event' }],
    params: [
      { key: 'credential', label: 'credential', type: 'select', options: ['Gateway credits', 'Own key'], default: 'Gateway credits' },
      { key: 'provider', label: 'provider', type: 'select', options: MODEL_PROVIDER_LABELS, default: 'Anthropic' },
      { key: 'model', label: 'model (auto = provider default)', type: 'select', options: MODEL_OPTIONS, default: 'auto' },
      { key: 'tier', label: 'tier (fixed = never swapped)', type: 'select', options: TIER_OPTIONS, default: 'standard' },
      { key: 'apiKey', label: 'own API key (never sent)', type: 'text', default: '' },
      { key: 'prompt', label: 'prompt (if unconnected)', type: 'text', default: 'Summarize the incoming support ticket' },
      { key: 'workflow', label: 'workflow (empty = group)', type: 'text', default: '' },
    ],
    evaluate: gatewayEvaluate('llm'),
    footer: gatewayFooter('llm'),
    panel: gatewayPanel('llm'),
    onDestroy(instance) { const n = ledger.releaseHolds(instance.uid, 'node removed · hold released'); if (n) toast(`${instance.title}: ${n} hold${n > 1 ? 's' : ''} released`); },
  });

  /* ---------- gw-tool ---------- */
  host.nodes.register({
    id: 'gw-tool', category: 'gateway', label: 'Tool call', icon: ICONS['gw-tool'], size: 'S',
    description: 'Search, crawl, browse or parse through a tool service, priced per request / page / minute',
    inputs: [{ key: 'trigger', label: 'trigger', type: 'event' }, { key: 'query', label: 'query', type: 'text', optional: true }],
    outputs: [{ key: 'result', label: 'result', type: 'text' }, { key: 'cost', label: 'cost', type: 'number' }, { key: 'done', label: 'done', type: 'event' }, { key: 'failed', label: 'failed', type: 'event' }],
    params: [
      { key: 'credential', label: 'credential', type: 'select', options: ['Gateway credits', 'Own key'], default: 'Gateway credits' },
      { key: 'service', label: 'service', type: 'select', options: TOOL_SERVICE_LABELS, default: 'Brave Search' },
      { key: 'units', label: 'units per run (requests / pages / min)', type: 'number', default: 1, min: 1, max: 100, step: 1 },
      { key: 'apiKey', label: 'own API key (never sent)', type: 'text', default: '' },
      { key: 'query', label: 'query (if unconnected)', type: 'text', default: '' },
      { key: 'workflow', label: 'workflow (empty = group)', type: 'text', default: '' },
    ],
    evaluate: gatewayEvaluate('tool'),
    footer: gatewayFooter('tool'),
    panel: gatewayPanel('tool'),
    onDestroy(instance) { ledger.releaseHolds(instance.uid, 'node removed · hold released'); },
  });

  /* ---------- gw-budget ---------- */
  host.nodes.register({
    id: 'gw-budget', category: 'gateway', label: 'Budget', icon: ICONS['gw-budget'], size: 'M',
    description: 'A per-workflow spend cap the ledger enforces at hold time; travels with the graph',
    outputs: [{ key: 'spent', label: 'spent', type: 'number' }, { key: 'remaining', label: 'remaining', type: 'number' }],
    params: [
      { key: 'workflow', label: 'workflow', type: 'text', default: 'Support inbox triage' },
      { key: 'limit', label: 'limit (credits)', type: 'number', default: 50, min: 0, step: 1 },
      { key: 'period', label: 'period', type: 'select', options: ['monthly', 'daily'], default: 'monthly' },
    ],
    evaluate({ params }) {
      const wf = String(params.workflow || '').trim();
      const spent = ledger.spentFor(wf, params.period);
      return { spent: +spent.toFixed(4), remaining: +Math.max(0, params.limit - spent).toFixed(4) };
    },
    footer: ({ params, outputs }) => `${fmt(outputs.spent || 0)} / ${fmtBal(params.limit)} cr · ${params.period}`,
    face: {
      live: true, fps: 2,
      render(g, w, h, { params }) {
        clear(g, w, h);
        const wf = String(params.workflow || '').trim();
        const spent = ledger.spentFor(wf, params.period), held = ledger.heldFor(wf), limit = Math.max(0, +params.limit || 0);
        const k = limit ? Math.min(1, spent / limit) : 1, kh = limit ? Math.min(1, (spent + held) / limit) : 1;
        drawText(g, wf || 'no workflow', 16, 10, w - 32, 40, { size: 26, weight: 600, align: 'left' });
        drawText(g, `${fmt(spent)} of ${fmtBal(limit)} cr · ${params.period}`, 16, 50, w - 32, 34, { size: 22, color: palette.faceDim, align: 'left' });
        const bx = 16, by = h - 84, bw = w - 32, bh = 30;
        g.fillStyle = palette.faceCard; roundRect(g, bx, by, bw, bh, 10); g.fill();
        if (kh > 0) { g.fillStyle = 'rgba(245,185,66,0.55)'; roundRect(g, bx, by, Math.max(8, bw * kh), bh, 10); g.fill(); }
        if (k > 0) { g.fillStyle = k >= 1 ? '#ff4d5e' : palette.faceAccent; roundRect(g, bx, by, Math.max(8, bw * k), bh, 10); g.fill(); }
        drawText(g, spent + held > limit ? 'over budget: new holds decline' : `${fmt(Math.max(0, limit - spent - held))} cr left${held ? ` · ${fmt(held)} held` : ''}`, 16, h - 46, w - 32, 34, { size: 20, color: spent + held > limit ? '#ff4d5e' : palette.faceDim, align: 'left' });
      },
    },
  });

  /* ---------- gw-meter ---------- */
  host.nodes.register({
    id: 'gw-meter', category: 'gateway', label: 'Credits meter', icon: ICONS['gw-meter'], size: 'M',
    description: 'Read-only: balance, spend this month and the last settled cost',
    outputs: [{ key: 'balance', label: 'balance', type: 'number' }, { key: 'spend', label: 'spend', type: 'number' }],
    params: [],
    evaluate() { return { balance: +ledger.available().toFixed(2), spend: +ledger.spend().toFixed(4) }; },
    footer: () => `${fmtBal(ledger.available())} cr · $${creditsToUsd(ledger.available()).toFixed(2)}`,
    face: {
      live: true, fps: 2,
      render(g, w, h) {
        clear(g, w, h);
        const bal = ledger.available(), held = ledger.held(), spend = ledger.spend(), last = ledger.lastCost();
        drawText(g, 'GATEWAY CREDITS', 16, 8, w - 32, 28, { size: 18, weight: 600, color: palette.faceDim, align: 'left' });
        drawText(g, `${fmtBal(bal)} cr`, 16, 34, w - 32, 70, { size: 54, weight: 700, mono: true, color: bal < 100 ? '#ff4d5e' : palette.faceText, align: 'left' });
        drawText(g, `$${creditsToUsd(bal).toFixed(2)}${held ? ` · ${fmt(held)} cr on hold` : ''}`, 16, 104, w - 32, 30, { size: 20, color: palette.faceDim, align: 'left' });
        const y = h - 96; const cw = (w - 32) / 2;
        g.fillStyle = palette.faceCard; roundRect(g, 16, y, cw - 6, 84, 12); g.fill(); roundRect(g, 16 + cw + 6, y, cw - 6, 84, 12); g.fill();
        drawText(g, 'spend this month', 28, y + 8, cw - 30, 26, { size: 17, color: palette.faceDim, align: 'left' });
        drawText(g, `${fmt(spend)} cr`, 28, y + 36, cw - 30, 40, { size: 28, weight: 600, mono: true, align: 'left' });
        drawText(g, 'last cost', 28 + cw + 6, y + 8, cw - 30, 26, { size: 17, color: palette.faceDim, align: 'left' });
        drawText(g, last == null ? '—' : `${fmt(last)} cr`, 28 + cw + 6, y + 36, cw - 30, 40, { size: 28, weight: 600, mono: true, color: palette.faceAccent, align: 'left' });
      },
    },
  });
  return GATEWAY_TYPES;
}
