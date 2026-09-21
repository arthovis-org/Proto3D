// components/common.js — what the five Jev components share: state → text, the per-instance async
// decision runner (the engine calls `evaluate` every frame; the API is never called from there —
// a job parked in a WeakMap is kicked when the state hash changes (auto, debounced) or on `run`,
// and its result lands in `instance.state.last`, which is plain JSON so save / load keeps it),
// the face language (header with the Simulated / Live badge, probability bars, footer, error tile,
// Run button) and the panel pieces (raw answer, mode / threshold rows).
import { palette } from '../../../src/theme.js';
import { drawCaps, drawDivider, drawTile, drawChip, drawBar, drawText, fitLine, font, roundRect, tabular, PAD } from '../../../src/faces.js';
import { asText } from '../../../src/components/util.js';
import { fmtUSD } from '../../../src/ai/pricing.js';
import { ui } from '../../../src/ai/ui-hooks.js';
import { ProviderError } from '../../../src/ai/http.js';
import { setLabelText } from '../../../src/theme.js';
import { client, hash } from '../jev-client.js';

export const CATEGORY = 'jev';
export const DEBOUNCE = 0.3;   // s, auto mode
export const MODES = ['auto', 'manual'];
export const modeParam = { key: 'mode', label: 'decide', type: 'select', options: MODES, default: 'auto' };
export const runInput = { key: 'run', label: 'run', type: 'event', optional: true };
export const stateInput = { key: 'state', label: 'state', type: 'any', multi: true, optional: true };

/* ------------------------------------------------------------------ */
/* state → text                                                         */
/* ------------------------------------------------------------------ */
/** One text for Jev's `state`: strings as they are, everything else as compact JSON, several inputs stacked. */
export function stateText(values) {
  const list = Array.isArray(values) ? values : values === undefined ? [] : [values];
  return list.filter((v) => v !== undefined && v !== null && v !== '').map((v) => (typeof v === 'string' ? v : typeof v === 'object' && !v.__pulse ? JSON.stringify(v) : asText(v))).join('\n\n').trim();
}
/** A list of items { id, text, ref } from anything that arrives on a multi `any` input (arrays, a board's tasks, plain values). */
export function flattenItems(values, cap = 40) {
  const out = [];
  const push = (v, i) => {
    if (v === undefined || v === null || v === '' || (v && v.__pulse)) return;
    if (typeof v !== 'object') { out.push({ id: String(out.length), text: asText(v), ref: v }); return; }
    const title = v.title ?? v.name ?? v.text ?? v.label;
    const extra = [v.description, v.body, v.summary, Array.isArray(v.tags) ? v.tags.join(', ') : null].filter(Boolean).join(' · ');
    out.push({ id: String(v.id ?? v.uid ?? i ?? out.length), text: title !== undefined ? `${title}${extra ? ' — ' + extra : ''}` : JSON.stringify(v), ref: v });
  };
  for (const v of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(v)) v.forEach((x, i) => push(x, i));
    else if (v && typeof v === 'object' && Array.isArray(v.items)) v.items.forEach((x, i) => push(x, i));
    else if (typeof v === 'string' && v.includes('\n')) v.split('\n').map((s) => s.trim()).filter(Boolean).forEach((s, i) => push(s, i));
    else push(v);
  }
  return out.slice(0, cap);
}
export { hash };

/* ------------------------------------------------------------------ */
/* the runner                                                           */
/* ------------------------------------------------------------------ */
const jobs = new WeakMap();
export function jobOf(inst) {
  let j = jobs.get(inst);
  if (!j) { j = { want: null, due: 0, active: false, inflight: null, pending: null, error: null, lastHash: null, ctrl: null, kick: false, force: false }; jobs.set(inst, j); }
  return j;
}
/** Ask for a decision on the next pass (face Run button, panel, tutorial). */
export function kick(inst) { const j = jobOf(inst); j.kick = true; j.error = null; inst.faceDirty = true; return true; }
export const errorRecord = (e) => (e instanceof ProviderError ? { code: e.code, message: e.message, fix: e.fix } : { code: 'error', message: e?.message || String(e), fix: null });

/**
 * Called from `evaluate`. Decides when to (re)decide, starts the async call at most once at a
 * time, and reports what landed since the last pass so the component can pulse its events.
 * @returns {{ last, landed, busy, error, stale }}
 */
export function runDecision(ctx, { key, state, questions, mode = 'auto' }) {
  const { inputs, time, instance: inst } = ctx;
  const j = jobOf(inst);
  const last = inst.state.last || null;
  const run = !!inputs.run || j.kick; j.kick = false;
  if (key) {
    if (run) { j.want = key; j.due = time; j.force = true; }
    else if (mode === 'auto' && key !== j.lastHash && !(last && last.stateHash === key)) {
      if (j.active && key === j.inflight) j.want = null;                                          // the running decision is already about this state
      else if (key !== j.want) { j.want = key; j.due = time + (window.__jevFast ? 0 : DEBOUNCE); }   // every change restarts the debounce
    }
    // a wanted decision that is already running or already answered is not started twice (a pressed Run always is)
    if (j.want && !j.force && ((j.active && j.inflight === j.want) || (last && last.stateHash === j.want))) j.want = null;
    if (j.want && time >= j.due) {
      if (j.active) { j.ctrl?.abort(); j.ctrl = null; j.active = false; }   // a newer state supersedes the decision in flight: its answer is dropped, never pulsed
      start(inst, j, { key: j.want, state, questions });
    }
  }
  // only an answer about the state as it is now pulses events; one that landed after the state moved on is kept as `last` (marked stale) and re-decided
  const landed = j.pending && key && j.pending.stateHash === key ? j.pending : null; j.pending = null;
  return { last, landed, busy: j.active, error: j.error, stale: !!(last && key && last.stateHash !== key) };
}
function start(inst, j, { key, state, questions }) {
  j.want = null; j.active = true; j.inflight = key; j.error = null; j.startedAt = performance.now();
  const ctrl = new AbortController(); j.ctrl = ctrl;
  const force = j.force; j.force = false;
  client.decide({ state, questions }, { signal: ctrl.signal, noCache: force }).then((res) => {
    if (j.ctrl !== ctrl) return;
    j.active = false; j.inflight = null; j.lastHash = key;
    const { cached, ...rec } = res;
    inst.state.last = { ...rec, stateHash: key };
    j.pending = inst.state.last;
    inst.faceDirty = true;
    inst.world?.changed?.('decision');
  }).catch((e) => {
    if (j.ctrl !== ctrl) return;
    j.active = false; j.inflight = null; j.lastHash = key; j.error = errorRecord(e); inst.faceDirty = true;
    client.noteError(j.error.message);
  });
}
/** Drop a pending or running decision (the instance is going away). */
export function cancelDecision(inst) { const j = jobs.get(inst); if (j) { j.ctrl?.abort(); j.ctrl = null; j.active = false; j.inflight = null; j.want = null; } }

/** Rename the lane ports of a routing node after its lanes param (a private core seam: `_placePortLabel` re-seats the name). */
export function syncPortLabels(inst, labels) {
  labels.forEach((label, i) => {
    const p = inst.getPort?.(`lane${i + 1}`, 'out'); if (!p || p.label === label) return;
    p.label = label;
    if (p.labelMesh) { setLabelText(p.labelMesh, label); inst._placePortLabel?.(p); }
  });
}

/* ------------------------------------------------------------------ */
/* the face                                                             */
/* ------------------------------------------------------------------ */
export const BTN = { w: 96, h: 34 };
/** Faces are designed at the L width (6.4 units × 120 px); a bigger face (XL) draws the same design scaled up, so its type grows with it. */
export const L_W = 768;
export const faceScale = (w) => Math.max(1, w / L_W);
/** Run `draw(W, H)` in design space scaled onto the face; hit regions are collected in design space (facePointer divides by the scale). */
export function scaled(g, w, h, instance, draw) { const k = faceScale(w); instance._jevHitScale = k; g.save(); g.scale(k, k); try { draw(w / k, h / k); } finally { g.restore(); } }
/** Port anchors declared in design space (a number, or `(H) => y` for one measured from the design height) mapped onto the real face. */
export function anchorsOf(w, h, map) { const k = faceScale(w), H = h / k; return Object.fromEntries(Object.entries(map).map(([key, v]) => [key, (typeof v === 'function' ? v(H) : v) * k])); }
const alpha = (hex, a) => { const c = String(hex).replace('#', ''); const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
export const pct = (p) => `${Math.round((p || 0) * 100)}%`;

/** What the badge says: the decision's origin, or what is happening right now. */
export function statusOf(r) {
  if (r.error) return { text: 'error', color: palette.faceBad };
  if (r.busy) return { text: client.isLive() ? 'asking Jev…' : 'deciding…', color: palette.faceAccent, busy: true };
  if (r.last) return r.last.simulated ? { text: 'Simulated', color: palette.faceWarn } : { text: `Live · ${r.last.model}`, color: palette.faceGood };
  return client.isLive() ? { text: 'Live · ready', color: palette.faceGood } : { text: 'Simulated', color: palette.faceWarn };
}
/**
 * Face top: a small-caps kind label, the Simulated / Live badge on the right, the question below,
 * a divider. Returns the y where the body starts.
 */
export function drawJevHeader(g, w, { kind, question, status, time = 0 }) {
  drawCaps(g, kind, PAD, PAD - 4, { size: 12 });
  // status badge, right-aligned
  g.font = font(12, 600); const tw = g.measureText(status.text).width; const bw = tw + 26 + (status.busy ? 10 : 0), bh = 22;
  const bx = w - PAD - bw, by = PAD - 15;
  g.fillStyle = alpha(status.color, 0.16); roundRect(g, bx, by, bw, bh, bh / 2); g.fill();
  g.fillStyle = status.color; g.beginPath();
  const r = status.busy ? 3.5 + 1.5 * Math.abs(Math.sin(time * 4)) : 3.5;
  g.arc(bx + 12, by + bh / 2, r, 0, Math.PI * 2); g.fill();
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(status.text, bx + 22, by + bh / 2 + 0.5);
  // the question, up to two lines
  const q = String(question || '').trim();
  let y = PAD + 14;
  if (q) { const rr = drawText(g, q, PAD, y, w - 2 * PAD, 46, { size: 18, min: 14, weight: 500, color: palette.faceText, align: 'left', valign: 'top', lineHeight: 1.3 }); y += Math.min(2, rr.lines) * rr.px * 1.3 + 8; }
  else { g.font = font(16, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('No instructions yet — write the question in the panel', PAD, y); y += 30; }
  drawDivider(g, PAD, y, w - 2 * PAD);
  return y + 12;
}
/** Horizontal probability bars: label · track · percentage. `win` marks the accent row; others are dim. */
export function drawBars(g, x, y, w, rows, { rowH = 32, labelW = Math.min(180, w * 0.32), win = null, marker = null } = {}) {
  const trackX = x + labelW + 10, trackW = w - labelW - 10 - 62;
  rows.forEach((r, i) => {
    const cy = y + i * rowH + rowH / 2;
    const isWin = r.key === win || r.win;
    g.font = font(15, isWin ? 600 : 500); g.fillStyle = isWin ? palette.faceText : palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(fitLine(g, r.label, labelW), x, cy + 0.5);
    drawBar(g, trackX, cy - 4, trackW, 8, r.p, { fill: isWin ? palette.faceAccent : alpha(palette.faceDim, 0.55) });
    if (marker !== null && marker !== undefined) { g.fillStyle = palette.faceWarn; g.fillRect(trackX + trackW * marker - 1, cy - 9, 2, 18); }
    tabular(g); g.font = font(14, isWin ? 600 : 500); g.fillStyle = isWin ? palette.faceText : palette.faceDim; g.textAlign = 'right'; g.fillText(pct(r.p), x + w, cy + 0.5);
  });
  return y + rows.length * rowH;
}
/** Confidence chip: "confidence 83%" in the tone of its band (act / confirm / route to a human). */
export function drawConfidence(g, x, y, conf, threshold = null) {
  const c = conf ?? 0; const low = threshold !== null && c < threshold;
  const color = low ? palette.faceWarn : c >= 0.75 ? palette.faceGood : palette.faceText;
  return drawChip(g, `confidence ${pct(c)}${low ? ' · unsure' : ''}`, x, y, { bg: alpha(color, low ? 0.16 : 0.1), color, size: 13, weight: 600, h: 24 });
}
/** Bottom bar: Run button (a hit region) + the footer line (model · latency · cost) and a stale note. */
export function drawJevFooter(g, w, h, r, hits, { stale = false } = {}) {
  const yb = h - PAD - BTN.h; const acc = palette.faceAccent;
  g.fillStyle = r.busy ? palette.faceCard : acc; roundRect(g, PAD, yb, BTN.w, BTN.h, BTN.h / 2); g.fill();
  g.fillStyle = r.busy ? palette.faceDim : '#fff';
  if (!r.busy) { g.beginPath(); g.moveTo(PAD + 18, yb + 10); g.lineTo(PAD + 29, yb + 17); g.lineTo(PAD + 18, yb + 24); g.closePath(); g.fill(); }
  g.font = font(14, 600); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(r.busy ? 'Deciding' : 'Run', PAD + (r.busy ? 18 : 36), yb + BTN.h / 2 + 1);
  hits.push({ x: PAD, y: yb, w: BTN.w, h: BTN.h, action: 'run' });
  g.font = font(13, 500); g.fillStyle = palette.faceDim; tabular(g); g.textAlign = 'right';
  g.fillText(fitLine(g, footerText(r, stale), w - 2 * PAD - BTN.w - 16), w - PAD, yb + BTN.h / 2 + 1);
}
export function footerText(r, stale = false) {
  const L = r.last;
  if (r.error) return r.error.message.length > 60 ? r.error.message.slice(0, 59) + '…' : r.error.message;
  if (r.busy) return client.isLive() ? 'jev-latest · waiting for the answer' : 'simulated decider';
  if (!L) return client.isLive() ? 'ready · jev-latest' : 'no key · simulated';
  const base = L.simulated ? `Simulated · ${L.latencyMs} ms` : `${L.model} · ${L.latencyMs} ms · ${fmtUSD(L.cost)}`;
  return stale ? `${base} · state changed — Run` : base;
}
/** Error tile with the fix button (Open Connections / Retry / Dismiss). */
export function drawJevError(g, x, y, w, h, err, hits) {
  drawTile(g, x, y, w, h, { r: 12 });
  g.fillStyle = palette.faceBad; roundRect(g, x, y, 4, h, 2); g.fill();
  drawCaps(g, 'could not decide', x + 18, y + 18, { color: palette.faceBad, size: 11 });
  drawText(g, err.message || 'Something went wrong', x + 18, y + 32, w - 36, Math.max(24, h - 32 - 48), { size: 15, weight: 500, align: 'left', valign: 'top', lineHeight: 1.35 });
  const label = err.fix === 'connections' ? 'Open Connections' : err.fix === 'retry' ? 'Retry' : 'Dismiss';
  g.font = font(13, 600); const bw = g.measureText(label).width + 30, bh = 30, bx = x + 18, byy = y + h - bh - 12;
  g.fillStyle = err.fix ? palette.faceAccent : palette.faceLine; roundRect(g, bx, byy, bw, bh, bh / 2); g.fill();
  g.fillStyle = err.fix ? '#fff' : palette.faceText; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, bx + bw / 2, byy + bh / 2 + 1);
  hits.push({ x: bx, y: byy, w: bw, h: bh, action: err.fix === 'connections' ? 'connections' : err.fix === 'retry' ? 'run' : 'dismiss' });
}
/** Body area between the header and the footer. */
export const bodyRect = (w, h, top) => ({ x: PAD, y: top, w: w - 2 * PAD, h: h - top - BTN.h - PAD - 12 });
/** The state Jev read, quoted and dimmed under the answer (at most two lines); nothing when there is no room. */
export function drawStateExcerpt(g, box, y, text) {
  const room = box.y + box.h - y;
  if (!text || room < 34) return;
  const t = String(text).replace(/\s+/g, ' ').trim();
  drawDivider(g, box.x, y, box.w);
  drawText(g, `“${t.length > 220 ? t.slice(0, 219) + '…' : t}”`, box.x, y + 8, box.w, Math.min(room - 8, 46), { size: 15, min: 12, weight: 400, color: palette.faceDim, align: 'left', valign: 'top', lineHeight: 1.35 });
}
/** A face body when there is nothing to decide on yet. */
export function drawWaiting(g, box, text) { drawText(g, text, box.x, box.y, box.w, box.h, { size: 18, color: palette.faceDim, weight: 500 }); }

/** Click handling for every Jev face: the Run button, the error tile's fix. */
export function facePointer(ctx, ev) {
  if (ev.type !== 'click') return false;
  const inst = ctx.instance; const cw = inst.face.cw, ch = inst.face.ch, k = inst._jevHitScale || 1;
  const px = ev.u * cw / k, py = ev.v * ch / k;   // hit regions live in design space
  const hit = (inst._jevHits || []).find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  if (!hit) return false;
  if (hit.action === 'run') kick(inst);
  else if (hit.action === 'connections') ui.openConnections('jev');
  else if (hit.action === 'dismiss') jobOf(inst).error = null;
  return true;
}
/** The current runner view of an instance for faces drawn between evaluations. */
export function viewOf(inst) { const j = jobOf(inst); return { last: inst.state.last || null, busy: j.active, error: j.error }; }
export const footer = ({ instance }) => footerText(viewOf(instance));

/* ------------------------------------------------------------------ */
/* the panel                                                            */
/* ------------------------------------------------------------------ */
/** Instructions area + mode select + Run button + the raw answer, shared by every Jev panel. `extra(s)` adds the component's own rows first. */
export function buildJevPanel(api, b, { title = 'Jev', instructionsRows = 3, extra = () => {}, before = () => {} } = {}) {
  const s = api.section(title);
  before(s);
  api.area(s, 'instructions', () => b.params.instructions, (v) => api.setParam('instructions', v, 'instructions'), 'instructions', instructionsRows);
  extra(s);
  const note = api.h('div', 'panel-note jev-note');
  api.live(() => { const live = client.isLive(); note.textContent = live ? 'Live: decisions go to api.typesafe.ai with the key from Connections.' : client.hasKey() ? 'Simulated by choice (Jev menu → Use live Jev to switch).' : 'Simulated: no TypeSafe key yet. Connections… adds one; the same node then calls the real API.'; });
  s.appendChild(note);
  api.action(s, 'Decide now', () => kick(b), `jev-run-${b.uid}`);
  const d = api.h('details', 'jev-raw'); const sum = api.h('summary', null, 'Last answer (raw)'); const pre = api.h('pre', 'jev-pre'); d.append(sum, pre); s.appendChild(d);
  api.live(() => { if (!d.open) return; const L = b.state.last; const t = L ? JSON.stringify({ model: L.model, simulated: L.simulated, latencyMs: L.latencyMs, cost: L.cost, usage: L.usage, answers: L.answers }, null, 2) : 'no decision yet'; if (pre.textContent !== t) pre.textContent = t; });
  return s;
}
/** Editable list rows (label + description) for lanes / levels; `get()` → array, `set(array)`. */
export function buildListEditor(api, s, { label, get, set, min = 2, max = 6, fields = ['label', 'description'], placeholder = ['name', 'what belongs here'], hint = null }) {
  const wrap = api.h('div', 'jev-list'); s.appendChild(wrap);
  const head = api.h('div', 'jev-list-head'); head.appendChild(api.h('span', null, label));
  const add = api.h('button', 'jev-list-add', '+ add'); add.type = 'button'; head.appendChild(add); wrap.appendChild(head);
  const rows = api.h('div', 'jev-list-rows'); wrap.appendChild(rows);
  if (hint) { const p = api.h('div', 'panel-note', hint); wrap.appendChild(p); }
  let sig = '';
  const render = () => {
    const list = get();
    const now = JSON.stringify(list); if (now === sig && rows.children.length) return; sig = now;
    rows.innerHTML = '';
    list.forEach((item, i) => {
      const row = api.h('div', 'jev-list-row');
      fields.forEach((f, k) => {
        const inp = api.h('input'); inp.type = 'text'; inp.placeholder = placeholder[k] || f; inp.value = typeof item === 'string' ? item : item[f] ?? ''; inp.dataset.field = f; inp.className = `jev-f-${f}`;
        inp.addEventListener('input', () => { const next = get().map((x) => (typeof x === 'string' ? x : { ...x })); if (typeof next[i] === 'string') next[i] = inp.value; else next[i][f] = inp.value; sig = JSON.stringify(next); set(next); });
        row.appendChild(inp);
      });
      const rm = api.h('button', 'jev-list-rm', '×'); rm.type = 'button'; rm.title = 'Remove'; rm.disabled = list.length <= min;
      rm.addEventListener('click', () => { const next = get().filter((_, k) => k !== i); sig = ''; set(next); render(); });
      row.appendChild(rm); rows.appendChild(row);
    });
    add.disabled = list.length >= max;
  };
  add.addEventListener('click', () => { const list = get(); if (list.length >= max) return; const blank = typeof list[0] === 'string' ? '' : Object.fromEntries(fields.map((f) => [f, ''])); sig = ''; set([...list, blank]); render(); });
  render(); api.live(render);
  return wrap;
}
