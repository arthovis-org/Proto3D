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
import { iconTable, glyphFor } from './glyphs.js';

export const GATEWAY_TYPES = ['gw-llm', 'gw-tool', 'gw-budget', 'gw-meter', 'gw-memory', 'gw-agent'];
/** Types that take a trigger and meter themselves (Run sample looks for these; the agent first). */
export const RUNNABLE_TYPES = ['gw-agent', 'gw-llm', 'gw-tool'];
const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
export const ICONS = {
  gateway: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.2 9.6c0-1 1.2-1.6 2.8-1.6s2.8.6 2.8 1.6c0 2.6-5.6 1.4-5.6 4 0 1 1.2 1.6 2.8 1.6s2.8-.6 2.8-1.6"/>'),
  'gw-llm': svg('<path d="M4 17V9a5 5 0 015-5h6a5 5 0 015 5v2a5 5 0 01-5 5H9l-5 4z"/><path d="M9 9.5h6M9 12.5h4"/>'),
  'gw-tool': svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M20 20l-4.8-4.8"/>'),
  'gw-budget': svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>'),
  'gw-meter': svg('<path d="M4 16a8 8 0 0116 0"/><path d="M12 16l4-5"/><path d="M3 20h18"/>'),
  'gw-memory': svg('<path d="M4 6.5C4 4.5 8 3.5 12 3.5s8 1 8 3-4 3-8 3-8-1-8-3z"/><path d="M4 6.5v11c0 2 4 3 8 3s8-1 8-3v-11"/><path d="M4 12c0 2 4 3 8 3s8-1 8-3"/>'),
  'gw-agent': svg('<rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 8V4.5"/><circle cx="12" cy="3.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.8" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.2" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><path d="M9 17h6"/>'),
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
  return 'failed';
}

/**
 * One attempt: estimate → hold → async call → queue. Called from evaluate (initial), from drain
 * (fallback) and, for the agent, once per step. `req` = { pulseId, prompt, attempt, route?, note?,
 * el?, params?, title?, step? }: `params` / `title` / `step` let one node (the agent) meter a call
 * on behalf of an attached sub-node — the idempotency key then carries `:s<step>` and the ledger
 * row `title` ("Research agent · step 2"). Returns 'started' | 'bypassed' | 'duplicate' | 'failed'.
 */
function startAttempt(ctx, kind, req) {
  const { instance, state } = ctx; const gw = gwState(state);
  const params = req.params || ctx.params;
  const idem = `${instance.uid}:${req.pulseId}${req.step != null ? `:s${req.step}` : ''}${req.attempt > 1 ? `:a${req.attempt}` : ''}`;
  const workflow = workflowOf(instance);
  const el = req.el || eligibility(kind, params);
  const base = { idem, nodeUid: instance.uid, nodeTitle: req.title || instance.title, workflow };
  if (el.bypass) {
    if (!el.adapter || (kind === 'llm' && !el.route.model)) return fail(ctx, gw, `own key: ${el.route?.reason || 'no adapter for ' + (params.provider || params.service)}`);
    const est = el.adapter.estimate(params, req.prompt, el.route);
    const row = ledger.bypass({ ...base, providerId: routeProviderId(kind, el.route), provider: routeLabel(kind, el.route), service: routeService(kind, el.route), units: est.units, note: `own API key${params.apiKey ? '' : ' (empty)'}; not metered` });
    if (!row) return 'duplicate';   // same pulse already processed
    if (req.step == null) { gw.status = 'bypassed'; gw.route = routeLabel(kind, el.route); }
    const P = pend(instance); P.inflight += 1;
    el.adapter.call(params, req.prompt, el.route, { mode: 'own-key' })
      .then((res) => P.queue.push({ ok: true, holdId: null, res, req, kind, route: el.route }), (err) => P.queue.push({ ok: false, holdId: null, err, req, kind, route: el.route }))
      .finally(() => { P.inflight -= 1; });
    return 'bypassed';
  }
  if (!el.ok) { ledger.decline({ ...base, provider: params.provider || params.service, service: '—' }, `not gateway-eligible: ${el.why}`); return fail(ctx, gw, `declined: ${el.why}`); }
  const route = req.route || el.route;
  const adapter = adapterFor(routeProviderId(kind, route)) || el.adapter;
  const est = adapter.estimate(params, req.prompt, route);
  const budget = budgetFor(instance, workflow);
  const hold = ledger.hold({ ...base, providerId: routeProviderId(kind, route), provider: routeLabel(kind, route), service: routeService(kind, route), units: est.units, credits: est.credits, note: req.note || (kind === 'llm' ? route.reason : ''), budget: budget ? { limit: budget.limit, period: budget.period } : null });
  if (hold.duplicate) return 'duplicate';   // idempotency: this pulse was already billed
  if (!hold.ok) return fail(ctx, gw, `declined: ${hold.reason}`);
  if (req.step == null) { gw.status = 'held'; gw.route = routeLabel(kind, route); }
  gw.holdId = hold.holdId;
  const P = pend(instance); P.inflight += 1;
  adapter.call(params, req.prompt, route, { simulateFailure: policy().fallback })
    .then((res) => P.queue.push({ ok: true, holdId: hold.holdId, res, req, kind, route }), (err) => P.queue.push({ ok: false, holdId: hold.holdId, err, req, kind, route }))
    .finally(() => { P.inflight -= 1; });
  return 'started';
}

/** After a provider error: refund the hold and, for a model call with the fallback policy on, retry once elsewhere. Returns true when a fallback attempt started. */
function tryFallback(ctx, item, kind, reason) {
  const { instance } = ctx;
  if (item.holdId) ledger.refund(item.holdId, `${reason} · hold released`);
  if (kind === 'llm' && policy().fallback && item.req.attempt < 2 && item.route?.model) {
    const fb = fallbackFor(item.route.model);
    if (fb) {
      toast(`${item.req.title || instance.title}: ${item.route.model.label} failed, falling back to ${fb.label}`, 2200);
      const r = startAttempt(ctx, kind, { ...item.req, attempt: item.req.attempt + 1, route: { model: fb, reason: `fallback from ${item.route.model.label}` }, note: `fallback from ${item.route.model.label} after ${reason}` });
      return r === 'started' || r === 'bypassed';
    }
  }
  return false;
}

/** Drain resolved calls: settle / refund on this frame, then emit. Fallback re-enters startAttempt. */
function drain(ctx, kind) {
  const { instance, state, emit, touch } = ctx; const gw = gwState(state); const P = pend(instance);
  while (P.queue.length) {
    const item = P.queue.shift();
    if (item.ok) {
      if (item.holdId) { if (!ledger.isOpen(item.holdId)) continue; ledger.settle(item.holdId, item.res.credits, { units: item.res.units, note: item.req.note || (kind === 'llm' ? item.route?.reason : '') }); }
      gw.status = item.holdId ? 'settled' : 'bypassed'; gw.lastCost = item.holdId ? item.res.credits : 0; gw.result = item.res.result; gw.runs = (gw.runs || 0) + 1; gw.holdId = null; gw.error = null; gw.lastAt = ctx.time;
      touch('result'); touch('cost'); emit('done', gw.result);
      continue;
    }
    const reason = item.err?.message || String(item.err);
    gw.holdId = null;
    if (tryFallback(ctx, item, kind, reason)) continue;
    fail(ctx, gw, `${reason}${policy().fallback ? ' · no fallback left' : ' · fallback policy off'}`);
  }
}

/** The `handle` a gw-llm / gw-tool publishes so an agent slot can run it: who it is and how it is configured (never the key itself). */
export function handleOf(kind, instance) {
  const p = instance.params;
  const params = kind === 'llm' ? { credential: p.credential, provider: p.provider, model: p.model, tier: p.tier, hasKey: !!p.apiKey } : { credential: p.credential, service: p.service, units: Number(p.units) || 1, hasKey: !!p.apiKey };
  return { kind, uid: instance.uid, title: instance.title, params, glyph: glyphFor(kind, p).id };
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
    return { result: gw.result, cost: gw.lastCost ?? 0, handle: handleOf(kind, instance) };
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


/* ======================================================================================
 * gw-agent: an n8n-style agent whose Chat model, Memory and Tools are SUB-NODES attached to
 * slot inputs (`model`, `memory`, `tools` — the last one is `multi`, one slot per cable). A run is a
 * metered loop entirely through the ledger: PLAN (a model call on the attached gw-llm's provider /
 * model / tier / credential) → up to `maxTools` TOOL steps (one per attached gw-tool, through its
 * service) → ANSWER (a model call). Each step is its own hold → settle (or bypass for an own-key
 * model) with the idempotency key `<agent>:<pulse>:s<n>` and the row title "<agent> · step n"; a
 * decline or provider error mid-way refunds the open hold, marks the rest skipped and emits
 * `failed`. Steps live in `state.gw.steps` [{ n, kind, role, service, status, credits, ms }] so the
 * face can draw the timeline; the answer is remembered in the attached gw-memory (last N).
 * ====================================================================================== */
const AGENT_ROLES = { plan: 'plan', tool: 'tool', answer: 'answer' };
/** The attached sub-node behind a handle (its live params win over the handle's snapshot). */
function resolveHandle(instance, h) {
  if (!h || typeof h !== 'object' || !h.kind) return null;
  const node = instance.world?.nodeByUid?.(h.uid) || null;
  return { kind: h.kind, uid: h.uid, title: node?.title || h.title || h.kind, params: node?.params || { ...h.params }, node };
}
/** The agent's attachments from its slot inputs: { model, memory, tools[] }. */
export function attachments(instance, inputs = {}) {
  const model = resolveHandle(instance, inputs.model); const memory = resolveHandle(instance, inputs.memory);
  const raw = Array.isArray(inputs.tools) ? inputs.tools : inputs.tools ? [inputs.tools] : [];
  const tools = raw.map((h) => resolveHandle(instance, h)).filter((t) => t && t.kind === 'tool');
  return { model: model && model.kind === 'llm' ? model : null, memory: memory && memory.kind === 'memory' ? memory : null, tools };
}
/** The step plan for a run (pure): plan → one step per tool (capped) → answer. */
export function planSteps(att, maxTools = 3) {
  const steps = [];
  const modelService = att.model ? (eligibility('llm', att.model.params).route?.model?.label || att.model.params.provider) : '—';
  steps.push({ n: 1, kind: 'llm', role: AGENT_ROLES.plan, uid: att.model?.uid || null, service: modelService, status: 'planned', credits: null, ms: null });
  att.tools.slice(0, Math.max(0, Math.round(Number(maxTools) || 0))).forEach((t) => steps.push({ n: steps.length + 1, kind: 'tool', role: AGENT_ROLES.tool, uid: t.uid, service: t.params.service, status: 'planned', credits: null, ms: null }));
  steps.push({ n: steps.length + 1, kind: 'llm', role: AGENT_ROLES.answer, uid: att.model?.uid || null, service: modelService, status: 'planned', credits: null, ms: null });
  return steps;
}
/** Estimated credits for a whole run with the current attachments (0 for own-key steps). */
export function estimateAgentRun(instance, inputs, params) {
  const att = attachments(instance, inputs);
  if (!att.model) return { credits: 0, steps: 0, att };
  const steps = planSteps(att, params.maxTools);
  let credits = 0;
  for (const st of steps) { const sub = st.kind === 'llm' ? att.model : att.tools.find((t) => t.uid === st.uid); if (sub) credits += estimateRun(st.kind, sub.params).credits; }
  return { credits, steps: steps.length, att };
}
const agentState = (state) => { const gw = gwState(state); gw.steps = gw.steps || []; gw.total = gw.total || 0; return gw; };
const stepPrompt = (run, step, k) => step.role === 'plan' ? `Plan the research for: ${run.prompt}${run.memoryNote || ''}`
  : step.role === 'tool' ? `${run.prompt} — step ${k + 1}: ${step.service}`
  : `Write the final answer for "${run.prompt}" from ${run.findings.length} finding${run.findings.length === 1 ? '' : 's'}: ${run.findings.map((f) => f.slice(0, 40)).join(' | ')}`;

function startStep(ctx, gw) {
  const run = gw.run; const step = gw.steps[run.idx]; if (!step) return finishRun(ctx, gw, 'done');
  const att = run.att;
  const sub = step.kind === 'llm' ? att.model : att.tools.find((t) => t.uid === step.uid);
  if (!sub) { step.status = 'failed'; return finishRun(ctx, gw, 'failed', `step ${step.n}: attached ${step.kind === 'llm' ? 'model' : 'tool'} is gone`); }
  step.startedAt = Date.now(); step.status = 'held';
  const r = startAttempt(ctx, step.kind, { pulseId: run.pulseId, prompt: stepPrompt(run, step, run.idx), attempt: 1, params: sub.params, title: `${ctx.instance.title} · step ${step.n}`, step: step.n });
  if (r === 'bypassed') step.status = 'bypassing';
  if (r === 'failed') { step.status = 'failed'; finishRun(ctx, gw, 'failed', gw.error, { emitted: true }); }
  if (r === 'duplicate') { step.status = 'skipped'; run.idx += 1; return startStep(ctx, gw); }
  ctx.instance.faceDirty = true;
  return r;
}
function finishRun(ctx, gw, status, reason = null, { emitted = false } = {}) {
  const run = gw.run; if (!run) return;
  for (const st of gw.steps) if (st.status === 'planned' || st.status === 'held' || st.status === 'bypassing') st.status = st.status === 'planned' ? 'skipped' : 'failed';
  gw.run = null; gw.runs = (gw.runs || 0) + 1; gw.lastAt = ctx.time; gw.ms = Date.now() - run.startedAt;
  if (status === 'done') {
    gw.status = run.total > 0 || !run.att.model ? 'settled' : 'bypassed'; gw.answer = run.answer; gw.lastCost = run.total; gw.error = null;
    remember(run.att.memory, { prompt: run.prompt, answer: run.answer, credits: run.total, steps: gw.steps.length, at: new Date().toISOString() });
    ctx.touch('answer'); ctx.touch('steps'); ctx.touch('cost'); ctx.emit('done', run.answer);
  } else {
    gw.lastCost = run.total;
    if (!emitted) fail(ctx, gw, reason || 'agent run failed'); else gw.status = 'failed';
    ctx.touch('steps'); ctx.touch('cost');
  }
  ctx.instance.faceDirty = true;
}
/** Write an exchange into the attached gw-memory node (last `window` kept). */
function remember(mem, exchange) {
  const node = mem?.node; if (!node || node.typeId !== 'gw-memory') return false;
  const win = Math.max(1, Math.round(Number(node.params.window) || 6));
  node.state.exchanges = [...(node.state.exchanges || []), exchange].slice(-win);
  node.state.total = (node.state.total || 0) + 1;
  node.faceDirty = true;
  return true;
}
function drainAgent(ctx) {
  const { instance, state } = ctx; const gw = agentState(state); const P = pend(instance);
  while (P.queue.length) {
    const item = P.queue.shift();
    const step = gw.steps.find((st) => st.n === item.req.step);
    if (!step || !gw.run) { if (item.holdId && ledger.isOpen(item.holdId)) ledger.refund(item.holdId, 'agent run ended · hold released'); continue; }
    const run = gw.run;
    if (item.ok) {
      if (item.holdId) { if (!ledger.isOpen(item.holdId)) { step.status = 'skipped'; run.idx += 1; startStep(ctx, gw); continue; } ledger.settle(item.holdId, item.res.credits, { units: item.res.units, note: item.req.note || (item.kind === 'llm' ? item.route?.reason : '') }); }
      step.status = item.holdId ? 'settled' : 'bypassed'; step.credits = item.holdId ? item.res.credits : 0; step.ms = Date.now() - (step.startedAt || Date.now()); step.result = String(item.res.result || '').slice(0, 160);
      run.total += step.credits; gw.total = run.total;
      if (step.role === 'tool') run.findings.push(String(item.res.result || ''));
      if (step.role === 'plan') run.plan = String(item.res.result || '');
      if (step.role === 'answer') { run.answer = item.res.result; finishRun(ctx, gw, 'done'); continue; }
      run.idx += 1; startStep(ctx, gw);
      continue;
    }
    const reason = item.err?.message || String(item.err);
    gw.holdId = null;
    if (tryFallback(ctx, item, item.kind, reason)) { step.status = 'held'; step.fallback = true; continue; }
    step.status = 'failed'; step.error = reason;
    finishRun(ctx, gw, 'failed', `step ${step.n} (${step.service}): ${reason}${policy().fallback ? ' · no fallback left' : ' · fallback policy off'}`);
  }
}
function agentEvaluate(ctx) {
  const { inputs, params, state, time, instance } = ctx; const gw = agentState(state);
  let pulse = inputs.trigger || null;
  if (kicks.delete(instance)) pulse = { n: `m${++manualSeq}`, payload: 'manual run' };
  if (pulse) {
    if (gw.run) toast(`${instance.title}: already running (step ${gw.run.idx + 1} of ${gw.steps.length})`, 1800);
    else {
      const att = attachments(instance, inputs);
      const raw = inputs.prompt; const fromPulse = typeof pulse.payload === 'string' && pulse.payload !== 'manual run' && pulse.payload !== 'sample run' ? pulse.payload : undefined;
      const prompt = raw !== undefined && raw !== null && raw !== '' ? String(raw) : params.prompt || fromPulse || 'research request';
      gw.error = null;
      if (!att.model) { gw.steps = []; fail(ctx, gw, 'no model attached: cable a Model call into the Chat model slot'); }
      else {
        const mem = att.memory?.node?.state?.exchanges || [];
        gw.steps = planSteps(att, params.maxTools); gw.total = 0; gw.answer = undefined;
        gw.run = { pulseId: pulseId(pulse), prompt, att, idx: 0, total: 0, findings: [], startedAt: Date.now(), memoryNote: mem.length ? ` (with ${mem.length} remembered exchange${mem.length === 1 ? '' : 's'})` : '' };
        gw.status = 'running';
        startStep(ctx, gw);
      }
    }
  }
  drainAgent(ctx);
  if (gw.error && time < (gw.errorUntil || 0)) instance.rt.error = gw.error;
  return { answer: gw.answer, steps: gw.steps, cost: gw.lastCost ?? gw.total ?? 0 };
}
const agentFooter = ({ state, inputs, params, instance }) => {
  const gw = state.gw || {}; const steps = gw.steps || [];
  const done = steps.filter((s) => s.status === 'settled' || s.status === 'bypassed').length;
  if (gw.run) return `running · step ${gw.run.idx + 1} of ${steps.length} · ${fmt(gw.run.total)} cr`;
  if (gw.status === 'failed' && steps.length) return `failed · ${done}/${steps.length} steps · ${fmt(gw.lastCost || 0)} cr`;
  if (steps.length && done) return `${done} steps · ${fmt(gw.lastCost || 0)} cr · ${gw.runs || 0}×`;
  const est = estimateAgentRun(instance, inputs, params);
  return est.att.model ? `${est.steps} steps · est ${fmt(est.credits)} cr` : 'attach a model to the Chat model slot';
};
function agentPanel(api, block) {
  const s = api.section('Agent run');
  const att = () => attachments(block, block.rt?.inputs || {});
  api.readonly(s, 'chat model', () => { const a = att(); return a.model ? `${a.model.title} · ${a.model.params.provider}${a.model.params.credential === 'Own key' ? ' · own key' : ''}` : 'none attached'; });
  api.readonly(s, 'memory', () => { const a = att(); return a.memory ? `${a.memory.title} · ${(a.memory.node?.state?.exchanges || []).length} exchanges` : 'none'; });
  api.readonly(s, 'tools', () => { const a = att(); return a.tools.length ? a.tools.map((t) => t.params.service).join(', ') : 'none'; });
  api.readonly(s, 'est. cost / run', () => { const e = estimateAgentRun(block, block.rt?.inputs || {}, block.params); return e.att.model ? `${fmt(e.credits)} cr · ${e.steps} steps` : '—'; });
  const list = api.h('div', 'gw-steps'); s.appendChild(list);
  api.live(() => {
    const steps = block.state.gw?.steps || [];
    list.textContent = steps.length ? steps.map((st) => `${st.n}. ${st.role} · ${st.service} · ${st.status}${st.credits != null ? ` · ${fmt(st.credits)} cr` : ''}`).join('\n') : 'no run yet';
  });
  api.readonly(s, 'last run', () => { const gw = block.state.gw || {}; return gw.runs ? `${fmt(gw.lastCost || 0)} cr · ${gw.ms ? `${(gw.ms / 1000).toFixed(1)} s` : ''}` : '—'; });
  api.readonly(s, 'balance', () => `${fmtBal(ledger.available())} cr available`);
  api.action(s, 'Run now (no upstream pulse needed)', () => kick(block), `gw-run-${block.uid}`);
}

/** Register the gw- components. Called once per page from index.js `register(host)`. */
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
    outputs: [{ key: 'result', label: 'result', type: 'text' }, { key: 'cost', label: 'cost', type: 'number' }, { key: 'done', label: 'done', type: 'event' }, { key: 'failed', label: 'failed', type: 'event' }, { key: 'handle', label: 'as model', type: 'data' }],
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
    outputs: [{ key: 'result', label: 'result', type: 'text' }, { key: 'cost', label: 'cost', type: 'number' }, { key: 'done', label: 'done', type: 'event' }, { key: 'failed', label: 'failed', type: 'event' }, { key: 'handle', label: 'as tool', type: 'data' }],
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
  /* ---------- gw-memory ---------- */
  host.nodes.register({
    id: 'gw-memory', category: 'gateway', label: 'Memory', icon: ICONS['gw-memory'], size: 'S',
    description: 'Attach to an agent\'s Memory slot: keeps the last N exchanges (prompt, answer, cost) and tells the agent about them',
    inputs: [{ key: 'clear', label: 'clear', type: 'event', optional: true }],
    outputs: [{ key: 'handle', label: 'as memory', type: 'data' }, { key: 'count', label: 'count', type: 'number' }, { key: 'recent', label: 'recent', type: 'data' }],
    params: [{ key: 'window', label: 'window (exchanges kept)', type: 'number', default: 6, min: 1, max: 50, step: 1 }],
    evaluate({ inputs, params, state, instance }) {
      const win = Math.max(1, Math.round(Number(params.window) || 6));
      if (inputs.clear) { state.exchanges = []; instance.faceDirty = true; }
      state.exchanges = (state.exchanges || []).slice(-win);
      const last = state.exchanges[state.exchanges.length - 1];
      return { handle: { kind: 'memory', uid: instance.uid, title: instance.title, window: win, count: state.exchanges.length, glyph: 'memory' }, count: state.exchanges.length, recent: last ? { prompt: last.prompt, answer: last.answer, at: last.at } : undefined };
    },
    footer: ({ state, params }) => `${(state.exchanges || []).length} of ${params.window} exchanges${state.total ? ` · ${state.total} total` : ''}`,
  });

  /* ---------- gw-agent ---------- */
  host.nodes.register({
    id: 'gw-agent', category: 'gateway', label: 'Research agent', icon: ICONS['gw-agent'], size: 'L',
    description: 'An agent whose Chat model, Memory and Tools are sub-nodes on its slots; every step (plan, tools, answer) is metered through the ledger',
    inputs: [
      { key: 'trigger', label: 'trigger', type: 'event' }, { key: 'prompt', label: 'prompt', type: 'text', optional: true },
      { key: 'model', label: 'Chat model *', type: 'data', optional: true }, { key: 'memory', label: 'Memory', type: 'data', optional: true }, { key: 'tools', label: 'Tools', type: 'data', multi: true, optional: true },
    ],
    outputs: [{ key: 'answer', label: 'answer', type: 'text' }, { key: 'steps', label: 'steps', type: 'data' }, { key: 'cost', label: 'cost', type: 'number' }, { key: 'done', label: 'done', type: 'event' }, { key: 'failed', label: 'failed', type: 'event' }],
    params: [
      { key: 'prompt', label: 'request (if unconnected)', type: 'text', default: 'Research the latest pricing changes across model providers' },
      { key: 'maxTools', label: 'tool steps per run (max)', type: 'number', default: 3, min: 0, max: 6, step: 1 },
      { key: 'workflow', label: 'workflow (empty = group)', type: 'text', default: '' },
    ],
    evaluate: agentEvaluate,
    footer: agentFooter,
    panel: agentPanel,
    onDestroy(instance) { const n = ledger.releaseHolds(instance.uid, 'agent removed · hold released'); if (n) toast(`${instance.title}: ${n} hold${n > 1 ? 's' : ''} released`); },
  });
  return GATEWAY_TYPES;
}
