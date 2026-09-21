// faces.js — the gw- node FACES: each face is the node's working UI, not a read-out. Built on the
// core face design language (host.draw: beginFields, drawCaps, drawChip, drawBar, drawTile…) and
// the core's inline field editor: every editable region is registered with `beginFields` (kinds
// select / number / text / multiline / checkbox / action), so the core hit-tests, marks (edit
// mode), Tab-walks and edits it in place with an undoable setParam — exactly like a core face.
// On top of that `onPointer` gives the faces app-like single clicks OUTSIDE edit mode: a click on
// a Run button runs, on a tier chip or the credential toggle sets the param, on a checkbox
// toggles, on a select / number / text opens the core editor on the face plane. A press anywhere
// else on the face still drags the block. Faces respect `spec.editing` (no text under an open
// editor) and read the live palette at draw time so they follow the theme.
//
// Face logical sizes (120 px / unit, faces.js PAD 24): S 365×288 · M 485×288 · L 701×432.
import { fmt, fmtBal } from './ledger.js';
import { MODELS, PROVIDERS, TIER_OPTIONS, MODEL_PROVIDER_LABELS, TOOL_SERVICE_LABELS, TOOLS, toolByLabel, creditsToUsd } from './rates.js';
import { glyphFor, drawBadge, drawGlyph, withAlpha, GLYPHS } from './glyphs.js';

const STATUS_WORD = { idle: 'idle', held: 'held', running: 'running', settled: 'settled', bypassed: 'own key', failed: 'failed', declined: 'declined' };
const MODEL_FIELD_OPTIONS = [{ value: 'auto', label: 'auto · provider default' }, ...Object.values(MODELS).map((m) => ({ value: m.id, label: `${m.label} · ${PROVIDERS[m.provider].label}` }))];
const CREDENTIALS = ['Gateway credits', 'Own key'];

/**
 * @param {object} host    the SDK host (draw, theme, commands, fields)
 * @param {object} ledger  the page's ledger
 * @param {object} N       node helpers from nodes.js: { eligibility, estimateRun, kick, attachments, planSteps, estimateAgentRun, workflowOf }
 */
export function createFaces(host, ledger, N) {
  const D = host.draw; const palette = host.theme.palette;
  const { clear, drawText, roundRect, font, beginFields, drawCaps, drawDivider, drawTile, drawChip, drawBar, fitLine, tabular } = D;
  const PAD = D.PAD ?? 24;
  const statusColor = (s) => (s === 'settled' ? palette.faceGood : s === 'held' || s === 'running' || s === 'bypassing' ? palette.faceWarn : s === 'failed' || s === 'declined' ? palette.faceBad : s === 'bypassed' ? palette.faceAccent : palette.faceDim);
  const setParam = (block, key, value, label) => { try { host.commands.setParam(block, key, value, label); } catch (_) { block.params[key] = value; block.faceDirty = true; } };

  /* ---------------- shared widgets (each registers its field) ---------------- */
  /** Right-aligned status pill: dot + word (+ detail). Returns its width. */
  function statusPill(g, xRight, y, status, detail = '') {
    const c = statusColor(status); const text = `${STATUS_WORD[status] || status || 'idle'}${detail ? ` · ${detail}` : ''}`;
    g.font = font(12, 600); const w = g.measureText(text).width + 34;
    drawChip(g, text, xRight - w, y, { h: 24, bg: withAlpha(c, 0.14), color: c, size: 12, weight: 600, padX: 10, dot: c });
    return w;
  }
  /** A pill button registered as an action field. */
  function button(g, F, id, label, x, y, w, h, run, { primary = true, disabled = false, color = palette.faceAccent } = {}) {
    const bg = disabled ? palette.faceCard : primary ? color : palette.faceCard; const ink = disabled ? palette.faceDim : primary ? '#ffffff' : palette.faceText;
    g.fillStyle = bg; roundRect(g, x, y, w, h, h / 2); g.fill();
    g.font = font(Math.round(h * 0.4), 700); g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x + w / 2, y + h / 2 + 1);
    return F.add({ id, kind: 'action', label, mode: 'through', rect: { x, y, w, h }, run: (block) => { if (!disabled) run(block); } });
  }
  /** Segmented chips; the active one is filled. Each chip is an action field `<id>:<option>`. Returns the right edge. */
  function segmented(g, F, id, options, value, x, y, onPick, { h = 26, size = 11, color = palette.faceAccent, padX = 8 } = {}) {
    let cx = x;
    for (const opt of options) {
      const on = opt === value;
      const w = drawChip(g, opt, cx, y, { h, bg: on ? color : palette.faceCard, color: on ? '#fff' : palette.faceDim, size, weight: 600, padX });
      F.add({ id: `${id}:${opt}`, kind: 'action', label: `${id} ${opt}`, mode: 'through', rect: { x: cx, y, w, h }, run: (block) => onPick(block, opt) });
      cx += w + 6;
    }
    return cx - 6;
  }
  /** A select shown as its current label with a caret; opens the core list on click. */
  function select(g, F, spec, text, x, y, w, h, { size = 20, weight = 600, color = palette.faceText, caret = true } = {}) {
    const f = F.add({ ...spec, kind: 'select', rect: { x, y, w, h }, font: { size, weight, color, align: 'left' } });
    if (!f.editing) {
      g.font = font(size, weight); g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'middle';
      const label = fitLine(g, text, w - (caret ? 22 : 0)); g.fillText(label, x, y + h / 2 + 1);
      if (caret) { const cw = g.measureText(label).width; g.fillStyle = palette.faceDim; g.font = font(Math.max(10, size * 0.6), 600); g.fillText('▾', x + cw + 8, y + h / 2 + 1); }
    }
    return f;
  }
  /** A value chip (number / text) — label in caps, value editable. Returns width. */
  function valueChip(g, F, spec, caps, text, x, y, { h = 26, w = null, mono = true, size = 13 } = {}) {
    g.font = font(size, 600); const tw = w || Math.max(48, g.measureText(String(text)).width + 16);
    g.font = font(10, 600); const lw = drawCaps(g, caps, x, y + h / 2, { size: 10, color: palette.faceDim }) + 8;
    const rx = x + lw;
    drawTile(g, rx, y, tw, h, { r: 8 });
    const f = F.add({ ...spec, rect: { x: rx, y, w: tw, h }, font: { size, weight: 600, mono, align: 'left', color: palette.faceText } });
    if (!f.editing) { g.font = font(size, 600, mono); tabular(g); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, String(text), tw - 16), rx + 8, y + h / 2 + 1); }
    return lw + tw;
  }
  /** A checkbox row: box + label; the whole row is the field. */
  function checkbox(g, F, spec, label, checked, x, y, { size = 13, w = null } = {}) {
    const b = 18; g.font = font(size, 600); const tw = w || g.measureText(label).width + b + 10;
    g.fillStyle = checked ? palette.faceAccent : palette.faceCard; roundRect(g, x, y, b, b, 5); g.fill();
    if (checked) { g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(x + 4.5, y + 9.5); g.lineTo(x + 8, y + 13); g.lineTo(x + 14, y + 5.5); g.stroke(); }
    g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x + b + 8, y + b / 2 + 1);
    return F.add({ ...spec, kind: 'checkbox', label, mode: 'through', rect: { x, y, w: tw, h: b } });
  }
  /** Title line of a face: badge + caps line + a big line (which may be a field). */
  function header(g, glyphId, color, caps, x, y, r = 26) {
    drawBadge(g, glyphId || 'agent', x + r, y + r, r, { color, lit: !!glyphId });
    drawCaps(g, caps, x + 2 * r + 12, y + 12, { size: 11, color: palette.faceDim });
    return x + 2 * r + 12;
  }
  function previewLines(g, text, x, y, w, h, placeholder) {
    if (!text) { drawText(g, placeholder, x, y, w, h, { size: 14, color: palette.faceDim, align: 'left', valign: 'top', weight: 500 }); return; }
    drawText(g, String(text).replace(/\s+/g, ' ').trim(), x, y, w, h, { size: 15, min: 13, color: palette.faceText, align: 'left', valign: 'top', weight: 500, lineHeight: 1.35 });
  }
  const credToggle = (g, F, xRight, y, block, params) => {
    const own = params.credential === 'Own key'; const label = own ? 'Own key' : 'Gateway credits';
    g.font = font(11, 600); const w = g.measureText(label).width + 30;
    drawChip(g, label, xRight - w, y, { h: 26, bg: own ? withAlpha(palette.faceWarn, 0.16) : withAlpha(palette.faceGood, 0.14), color: own ? palette.faceWarn : palette.faceGood, size: 11, weight: 600, padX: 8, dot: own ? palette.faceWarn : palette.faceGood });
    F.add({ id: 'credential', kind: 'action', label: 'credential', mode: 'through', rect: { x: xRight - w, y, w, h: 26 }, run: (b) => setParam(b, 'credential', own ? CREDENTIALS[0] : CREDENTIALS[1], 'Switch credential') });
    return w;
  };

  /* ---------------- gw-llm ---------------- */
  function renderLlm(g, w, h, ctx) {
    const { params, state, instance, inputs = {} } = ctx; const gw = state.gw || {};
    clear(g, w, h); const F = beginFields(instance);
    const G = glyphFor('llm', params); const el = N.eligibility('llm', params); const est = N.estimateRun('llm', params);
    const modelLabel = el.route?.model ? el.route.model.label : params.model === 'auto' ? 'auto' : params.model;
    const tx = header(g, G.id, G.color, `model call · ${params.credential === 'Own key' ? 'own key · not metered' : 'gateway credits · metered'}`, PAD, PAD);
    // provider (select) small, model (select) big
    select(g, F, { id: 'provider', param: 'provider', label: 'provider', options: MODEL_PROVIDER_LABELS }, G.label, tx, PAD + 20, 150, 18, { size: 12, weight: 600, color: palette.faceDim, caret: true });
    statusPill(g, w - PAD, PAD + 2, gw.status || 'idle', gw.lastCost != null ? `${fmt(gw.lastCost)} cr` : '');
    select(g, F, { id: 'model', param: 'model', label: 'model', options: MODEL_FIELD_OPTIONS }, `${modelLabel}${el.route?.swapped ? ' ↷' : ''}`, tx, PAD + 40, w - tx - PAD - 8, 30, { size: 22, weight: 600 });
    // tier segmented + credential toggle
    const y2 = PAD + 84;
    segmented(g, F, 'tier', TIER_OPTIONS, params.tier, PAD, y2, (b, t) => setParam(b, 'tier', t, 'Set tier'));
    credToggle(g, F, w - PAD, y2, instance, params);
    // prompt: the connected one, or the fallback typed here (multiline field)
    const y3 = y2 + 40; const connected = inputs.prompt !== undefined && inputs.prompt !== null && inputs.prompt !== '';
    drawCaps(g, 'prompt', PAD, y3 + 8, { size: 10 });
    const pf = connected ? null : F.add({ id: 'prompt', kind: 'multiline', param: 'prompt', label: 'prompt', rect: { x: PAD + 58, y: y3 - 3, w: w - 2 * PAD - 58, h: 22 }, placeholder: 'Type a prompt or connect one', font: { size: 14, weight: 500, color: palette.faceDim, align: 'left' } });
    if (!pf?.editing) { g.font = font(14, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, connected ? `← ${String(inputs.prompt).replace(/\s+/g, ' ')}` : params.prompt || 'double-click to type a prompt', w - 2 * PAD - 58), PAD + 58, y3 + 8); }
    drawDivider(g, PAD, y3 + 24, w - 2 * PAD);
    // result preview
    const y4 = y3 + 34; const strip = h - PAD - 36;
    previewLines(g, gw.result, PAD, y4, w - 2 * PAD, strip - y4 - 8, gw.error ? `⚠ ${gw.error}` : 'No result yet — press Run, or pulse the trigger.');
    // status strip + Run
    const info = el.bypass ? `own key · 0 cr · ${gw.runs || 0}×` : `est ${fmt(est.credits)} cr${gw.lastCost != null ? ` · last ${fmt(gw.lastCost)} cr` : ''} · ${gw.runs || 0}×`;
    g.font = font(13, 500, true); tabular(g); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, info, w - 2 * PAD - 110), PAD, strip + 18);
    button(g, F, 'run', gw.status === 'held' ? 'Running…' : 'Run', w - PAD - 96, strip, 96, 36, (b) => N.kick(b), { disabled: gw.status === 'held', color: G.color });
  }

  /* ---------------- gw-tool ---------------- */
  function renderTool(g, w, h, ctx) {
    const { params, state, instance, inputs = {} } = ctx; const gw = state.gw || {};
    clear(g, w, h); const F = beginFields(instance);
    const G = glyphFor('tool', params); const tool = toolByLabel(params.service); const el = N.eligibility('tool', params); const est = N.estimateRun('tool', params);
    const tx = header(g, G.id, G.color, `tool · ${tool ? `${tool.price.toFixed(2)} cr / ${tool.unit}` : 'not on the rate card'}`, PAD, PAD);
    statusPill(g, w - PAD, PAD + 2, gw.status || 'idle', gw.lastCost != null ? `${fmt(gw.lastCost)} cr` : '');
    select(g, F, { id: 'service', param: 'service', label: 'service', options: TOOL_SERVICE_LABELS }, params.service, tx, PAD + 26, w - tx - PAD - 8, 32, { size: 22, weight: 600 });
    const y2 = PAD + 84;
    const uw = valueChip(g, F, { id: 'units', kind: 'number', param: 'units', label: 'units', min: 1, max: 100 }, `units · ${tool?.unit || 'unit'}${Number(params.units) === 1 ? '' : 's'}`, params.units, PAD, y2);
    void uw;
    credToggle(g, F, w - PAD, y2, instance, params);
    const y3 = y2 + 40; const connected = inputs.query !== undefined && inputs.query !== null && inputs.query !== '';
    drawCaps(g, 'query', PAD, y3 + 8, { size: 10 });
    const qf = connected ? null : F.add({ id: 'query', kind: 'text', param: 'query', label: 'query', rect: { x: PAD + 52, y: y3 - 3, w: w - 2 * PAD - 52, h: 22 }, placeholder: 'Type a query or connect one', font: { size: 14, weight: 500, color: palette.faceDim, align: 'left' } });
    if (!qf?.editing) { g.font = font(14, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, connected ? `← ${String(inputs.query).replace(/\s+/g, ' ')}` : params.query || 'double-click to type a query', w - 2 * PAD - 52), PAD + 52, y3 + 8); }
    drawDivider(g, PAD, y3 + 24, w - 2 * PAD);
    const y4 = y3 + 34; const strip = h - PAD - 36;
    previewLines(g, gw.result, PAD, y4, w - 2 * PAD, strip - y4 - 8, gw.error ? `⚠ ${gw.error}` : 'No result yet — press Run, or attach this tool to an agent.');
    const info = el.bypass ? `own key · 0 cr · ${gw.runs || 0}×` : `${tool ? `${tool.price.toFixed(2)} cr/${tool.unit}` : '—'} · est ${fmt(est.credits)} cr${gw.lastCost != null ? ` · last ${fmt(gw.lastCost)} cr` : ''} · ${gw.runs || 0}×`;
    g.font = font(13, 500, true); tabular(g); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, info, w - 2 * PAD - 110), PAD, strip + 18);
    button(g, F, 'run', gw.status === 'held' ? 'Running…' : 'Run', w - PAD - 96, strip, 96, 36, (b) => N.kick(b), { disabled: gw.status === 'held', color: G.color });
  }

  /* ---------------- gw-agent ---------------- */
  function renderAgent(g, w, h, ctx) {
    const { params, state, instance, inputs = {} } = ctx; const gw = state.gw || {};
    clear(g, w, h); const F = beginFields(instance);
    const G = glyphFor('agent'); const att = N.attachments(instance, inputs); const est = N.estimateAgentRun(instance, inputs, params);
    const tx = header(g, 'agent', G.color, `agent · ${N.workflowOf(instance)} · ${att.tools.length} tool${att.tools.length === 1 ? '' : 's'}`, PAD, PAD, 28);
    const status = gw.run ? 'running' : gw.status || 'idle';
    statusPill(g, w - PAD, PAD + 2, status, gw.run ? `step ${gw.run.idx + 1}/${gw.steps.length}` : gw.lastCost != null && gw.runs ? `${fmt(gw.lastCost)} cr` : '');
    // the request: connected or typed here
    const connected = inputs.prompt !== undefined && inputs.prompt !== null && inputs.prompt !== '';
    const pf = connected ? null : F.add({ id: 'prompt', kind: 'multiline', param: 'prompt', label: 'request', rect: { x: tx, y: PAD + 26, w: w - tx - PAD - 8, h: 30 }, placeholder: 'What should the agent research?', font: { size: 20, weight: 600, align: 'left' } });
    if (!pf?.editing) { g.font = font(20, 600); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, connected ? String(inputs.prompt) : params.prompt || 'double-click to type a request', w - tx - PAD - 8), tx, PAD + 41); }
    /* slots: Chat model · Memory · Tools — lit when connected */
    const sy = PAD + 74, sh = 56, gap = 10, sw = (w - 2 * PAD - 2 * gap) / 3;
    const slot = (i, caps, items, required) => {
      const x = PAD + i * (sw + gap); const lit = items.length > 0;
      if (lit) drawTile(g, x, sy, sw, sh, { bg: withAlpha(items[0].color, 0.12), r: 12 });
      else { g.strokeStyle = withAlpha(palette.faceDim, 0.6); g.lineWidth = 1.5; g.setLineDash?.([6, 5]); roundRect(g, x + 0.75, sy + 0.75, sw - 1.5, sh - 1.5, 12); g.stroke(); g.setLineDash?.([]); }
      drawCaps(g, `${caps}${required ? ' *' : ''}`, x + 12, sy + 13, { size: 10, color: lit ? items[0].color : palette.faceDim });
      if (!lit) { g.font = font(13, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, `— attach a ${caps.toLowerCase()} below`, sw - 24), x + 12, sy + 37); return; }
      let bx = x + 12;
      const shown = items.slice(0, 4);
      for (const it of shown) { drawBadge(g, it.id, bx + 12, sy + 37, 12, { color: it.color, ring: false }); bx += 30; }
      g.font = font(13, 600); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'middle';
      const label = shown.length === 1 ? items[0].label : `${items.length} tools`; g.fillText(fitLine(g, label + (items.length > 4 ? ` +${items.length - 4}` : ''), x + sw - bx - 8), bx + 2, sy + 37);
    };
    const modelItem = att.model ? [{ ...glyphFor('llm', att.model.params), label: `${glyphFor('llm', att.model.params).label}${att.model.params.credential === 'Own key' ? ' · own key' : ''}` }] : [];
    const memItem = att.memory ? [{ ...glyphFor('memory'), label: `${(att.memory.node?.state?.exchanges || []).length} of ${att.memory.node?.params?.window ?? '?'} remembered` }] : [];
    slot(0, 'Chat model', modelItem, true); slot(1, 'Memory', memItem, false); slot(2, 'Tools', att.tools.map((t) => glyphFor('tool', t.params)), false);
    /* step timeline: dots per step, lit as they settle, credits under each */
    const steps = gw.steps?.length ? gw.steps : att.model ? N.planSteps(att, params.maxTools) : [];
    const ty = sy + sh + 26, lineY = ty + 30;
    drawCaps(g, gw.run ? 'run in progress' : gw.steps?.length ? 'last run' : 'planned run', PAD, ty, { size: 10 });
    const total = gw.run ? gw.run.total : gw.lastCost;
    g.font = font(14, 600, true); tabular(g); g.fillStyle = palette.faceText; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(steps.length ? (total != null && (gw.run || gw.runs) ? `${fmt(total)} cr` : `est ${fmt(est.credits)} cr`) : '—', w - PAD, ty);
    if (steps.length) {
      const x0 = PAD + 36, x1 = w - PAD - 36, n = steps.length; const px = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1));
      g.strokeStyle = palette.faceLine; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, lineY); g.lineTo(x1, lineY); g.stroke();
      steps.forEach((st, i) => {
        const cx = px(i), c = statusColor(st.status), done = st.status === 'settled' || st.status === 'bypassed';
        if (i > 0 && done) { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(px(i - 1), lineY); g.lineTo(cx, lineY); g.stroke(); }
        g.beginPath(); g.arc(cx, lineY, 11, 0, Math.PI * 2);
        if (st.status === 'planned' || st.status === 'skipped') { g.fillStyle = palette.faceBg; g.fill(); g.strokeStyle = withAlpha(palette.faceDim, 0.7); g.lineWidth = 2; g.stroke(); }
        else { g.fillStyle = c; g.fill(); }
        const gid = st.kind === 'llm' ? (att.model ? glyphFor('llm', att.model.params).id : 'agent') : glyphFor('tool', { service: st.service }).id;
        drawGlyph(g, gid || 'agent', cx - 7, lineY - 7, 14, st.status === 'planned' || st.status === 'skipped' ? palette.faceDim : '#fff', { strokeWidth: 2.2 });
        g.font = font(11, 600); g.fillStyle = palette.faceDim; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(fitLine(g, st.role === 'tool' ? st.service : st.role, (x1 - x0) / Math.max(1, n - 1) - 6 || 80), cx, lineY + 24);
        g.font = font(11, 600, true); g.fillStyle = done ? palette.faceText : palette.faceDim;
        g.fillText(st.credits != null ? (st.status === 'bypassed' ? '0 · own key' : `${fmt(st.credits)} cr`) : st.status === 'held' ? 'held…' : st.status === 'failed' ? 'failed' : st.status === 'skipped' ? 'skipped' : '·', cx, lineY + 40);
      });
    } else { g.font = font(13, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Attach a Model call to the Chat model slot to plan a run.', PAD, lineY); }
    /* answer */
    const ay = lineY + 62; const strip = h - PAD - 40;
    drawDivider(g, PAD, ay - 8, w - 2 * PAD);
    previewLines(g, gw.answer, PAD, ay, w - 2 * PAD, strip - ay - 8, gw.error ? `⚠ ${gw.error}` : gw.run ? `Working… ${gw.run.findings.length} finding${gw.run.findings.length === 1 ? '' : 's'} so far.` : 'No answer yet — press Run to plan, call the tools and answer, every step metered.');
    /* strip */
    const info = `${steps.length} steps · ${att.model ? `est ${fmt(est.credits)} cr` : 'no model'}${gw.runs ? ` · ${gw.runs}× · ${gw.ms ? (gw.ms / 1000).toFixed(1) + ' s' : ''}` : ''}`;
    g.font = font(13, 500, true); tabular(g); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, info, w - 2 * PAD - 130), PAD, strip + 20);
    button(g, F, 'run', gw.run ? 'Running…' : 'Run', w - PAD - 112, strip, 112, 40, (b) => N.kick(b), { disabled: !!gw.run || !att.model, color: G.color });
  }

  /* ---------------- gw-memory ---------------- */
  function renderMemory(g, w, h, ctx) {
    const { params, state, instance } = ctx; const ex = state.exchanges || [];
    clear(g, w, h); const F = beginFields(instance);
    const G = glyphFor('memory');
    header(g, 'memory', G.color, 'memory · agent slot', PAD, PAD, 24);
    g.font = font(44, 700, true); tabular(g); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(String(ex.length), PAD, PAD + 118);
    g.font = font(14, 500); g.fillStyle = palette.faceDim; g.fillText(`exchange${ex.length === 1 ? '' : 's'} kept${state.total ? ` · ${state.total} total` : ''}`, PAD + 12 + g.measureText(String(ex.length)).width * 2.4, PAD + 118);
    valueChip(g, F, { id: 'window', kind: 'number', param: 'window', label: 'window', min: 1, max: 50 }, 'window', params.window, PAD, PAD + 134, { w: 64 });
    drawDivider(g, PAD, PAD + 172, w - 2 * PAD);
    const last = ex[ex.length - 1];
    previewLines(g, last ? `${last.prompt} → ${last.answer}` : '', PAD, PAD + 182, w - 2 * PAD, h - PAD - (PAD + 182), 'Nothing remembered yet. Attach to an agent\'s Memory slot; each answer lands here.');
  }

  /* ---------------- gw-budget ---------------- */
  function renderBudget(g, w, h, ctx) {
    const { params, instance } = ctx;
    clear(g, w, h); const F = beginFields(instance);
    const G = glyphFor('budget'); const wf = String(params.workflow || '').trim();
    const spent = ledger.spentFor(wf, params.period), held = ledger.heldFor(wf), limit = Math.max(0, +params.limit || 0);
    const k = limit ? Math.min(1, spent / limit) : 1, kh = limit ? Math.min(1, (spent + held) / limit) : 1; const over = spent + held > limit;
    const tx = header(g, 'budget', G.color, `budget · ${params.period}`, PAD, PAD);
    const nf = F.add({ id: 'workflow', kind: 'text', param: 'workflow', label: 'workflow', rect: { x: tx, y: PAD + 22, w: w - tx - PAD, h: 32 }, placeholder: 'workflow name', font: { size: 24, weight: 600, align: 'left' } });
    if (!nf.editing) { g.font = font(24, 600); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, wf || 'no workflow', w - tx - PAD), tx, PAD + 38); }
    const y2 = PAD + 84;
    const lw = valueChip(g, F, { id: 'limit', kind: 'number', param: 'limit', label: 'limit', min: 0 }, 'limit · cr', fmtBal(limit), PAD, y2, { w: 96, size: 14 });
    drawCaps(g, 'period', PAD + lw + 18, y2 + 13, { size: 10 });
    select(g, F, { id: 'period', param: 'period', label: 'period', options: ['monthly', 'daily'] }, params.period, PAD + lw + 70, y2, 110, 26, { size: 14, weight: 600 });
    /* ring: spent (accent) + held (warn) */
    const cx = w - PAD - 44, cy = y2 + 62, R = 40; const TAU = Math.PI * 2, a0 = -Math.PI / 2;
    g.lineCap = 'butt'; g.lineWidth = 12; g.strokeStyle = palette.faceCard; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    if (kh > 0) { g.strokeStyle = withAlpha(palette.faceWarn, 0.6); g.beginPath(); g.arc(cx, cy, R, a0, a0 + TAU * kh); g.stroke(); }
    if (k > 0) { g.strokeStyle = over ? palette.faceBad : G.color; g.beginPath(); g.arc(cx, cy, R, a0, a0 + TAU * k); g.stroke(); }
    g.font = font(16, 700, true); tabular(g); g.fillStyle = palette.faceText; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${Math.round(k * 100)}%`, cx, cy + 1);
    /* bar + numbers */
    const by = y2 + 48;
    drawBar(g, PAD, by, w - 2 * PAD - 110, 14, kh, { fill: withAlpha(palette.faceWarn, 0.6) });
    if (k > 0) drawBar(g, PAD, by, w - 2 * PAD - 110, 14, k, { track: 'rgba(0,0,0,0)', fill: over ? palette.faceBad : G.color });
    g.font = font(22, 600, true); tabular(g); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(`${fmt(spent)} of ${fmtBal(limit)} cr`, PAD, by + 46);
    g.font = font(13, 500); g.fillStyle = over ? palette.faceBad : palette.faceDim; g.fillText(over ? 'over budget: new holds decline' : `${fmt(Math.max(0, limit - spent - held))} cr left${held ? ` · ${fmt(held)} held` : ''} · enforced at hold time`, PAD, by + 68);
  }

  /* ---------------- gw-meter ---------------- */
  function renderMeter(g, w, h, ctx) {
    const { instance } = ctx;
    clear(g, w, h); const F = beginFields(instance);
    const G = glyphFor('meter'); const bal = ledger.available(), held = ledger.held(), spend = ledger.spend();
    header(g, 'meter', G.color, `gateway credits · $${creditsToUsd(bal).toFixed(2)}${held ? ` · ${fmt(held)} cr on hold` : ''}`, PAD, PAD, 22);
    g.font = font(40, 700, true); tabular(g); g.fillStyle = bal < 100 ? palette.faceBad : palette.faceText; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(`${fmtBal(bal)} cr`, PAD + 56, PAD + 52);
    /* sparkline: the last 12 settled costs */
    const pts = ledger.entries.filter((e) => e.kind === 'settle').slice(-12).map((e) => e.credits);
    const sx = w - PAD - 150, sy = PAD + 4, sw = 150, sh = 44;
    drawCaps(g, `spend · ${fmt(spend)} cr`, sx + sw, sy - 2, { size: 10, align: 'right' });
    if (pts.length >= 2) {
      const max = Math.max(...pts, 1e-9); const X = (i) => sx + (i * sw) / (pts.length - 1), Y = (v) => sy + 10 + sh - (v / max) * sh;
      g.strokeStyle = G.color; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
      pts.forEach((v, i) => { g.fillStyle = i === pts.length - 1 ? G.color : withAlpha(G.color, 0.5); g.beginPath(); g.arc(X(i), Y(v), i === pts.length - 1 ? 4 : 2.5, 0, Math.PI * 2); g.fill(); });
    } else { g.strokeStyle = palette.faceLine; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, sy + 10 + sh / 2); g.lineTo(sx + sw, sy + 10 + sh / 2); g.stroke(); g.font = font(11, 500); g.fillStyle = palette.faceDim; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText('settle two calls for a sparkline', sx + sw, sy + 10 + sh / 2 - 14); }
    /* controls: auto top-up checkbox (ledger settings) + Top up action */
    const y2 = PAD + 72;
    const A = () => ledger.settings.autoTopUp;
    checkbox(g, F, { id: 'autoTopUp', get: () => !!A().enabled, set: (v) => { A().enabled = !!v; ledger.saveSettings(); if (v) ledger.maybeAutoTopUp('enabled from the meter'); } }, `auto top-up${A().enabled ? ` · below ${fmtBal(A().threshold)} → ${fmtBal(A().target)} cr` : ' off'}`, !!A().enabled, PAD, y2 + 4);
    button(g, F, 'topup', 'Top up +500', w - PAD - 118, y2 - 2, 118, 30, () => ledger.topUp(500, 'top-up from the meter face'), { color: G.color });
    drawDivider(g, PAD, y2 + 40, w - 2 * PAD);
    /* last 3 rows */
    const rows = ledger.rows(3); let ry = y2 + 50;
    drawCaps(g, 'ledger · last 3', PAD, ry + 6, { size: 10 }); ry += 20;
    if (!rows.length) { g.font = font(13, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Nothing metered yet.', PAD, ry + 12); }
    for (const r of rows) {
      const c = statusColor(r.status === 'decline' ? 'declined' : r.status === 'topup' || r.status === 'adjust' ? 'settled' : r.status);
      const gl = glyphFor('x', { providerId: r.providerId }).id;
      if (gl) drawGlyph(g, gl, PAD, ry + 4, 16, GLYPHS[gl].color); else { g.fillStyle = c; g.beginPath(); g.arc(PAD + 8, ry + 12, 4, 0, Math.PI * 2); g.fill(); }
      g.font = font(13, 600); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fitLine(g, r.nodeTitle || r.provider || '—', w * 0.42), PAD + 24, ry + 12);
      g.font = font(12, 500); g.fillStyle = palette.faceDim; g.fillText(fitLine(g, r.provider && r.nodeTitle ? r.provider : r.note || '', w * 0.25), PAD + 24 + w * 0.42 + 8, ry + 12);
      g.font = font(13, 600, true); tabular(g); g.fillStyle = c; g.textAlign = 'right'; g.fillText(r.status === 'topup' || r.status === 'adjust' ? `${r.credits >= 0 ? '+' : ''}${fmtBal(r.credits)}` : r.credits ? fmt(r.credits) : r.status, w - PAD, ry + 12);
      ry += 26;
    }
  }

  /* ---------------- pointer: single clicks outside edit mode ---------------- */
  const fieldAtPx = (inst, px, py) => { let best = null, area = Infinity; for (const f of inst._fields || []) { const r = f.rect; if (!r) continue; if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h && r.w * r.h < area) { best = f; area = r.w * r.h; } } return best; };
  function activate(block, f) {
    if (!f) return false;
    if (f.kind === 'action') { f.run?.(block, {}); block.faceDirty = true; return true; }
    if (f.kind === 'checkbox') { const v = f.get ? f.get(block) : block.params[f.param]; if (f.set) f.set(!v, {}); else setParam(block, f.param, !v, `Toggle ${f.label || f.param}`); block.faceDirty = true; return true; }
    try { host.fields.open(block, f); } catch (_) { /* headless: no editor */ }
    return true;
  }
  function onPointer(ctx, ev) {
    const inst = ctx.instance; const face = inst.face; if (!face || !inst._fields) return false;
    const f = fieldAtPx(inst, ev.u * face.cw, ev.v * face.ch);
    if (ev.type === 'down') { inst._gwPress = f || null; return !!f; }
    if (ev.type === 'up') return !!inst._gwPress;
    if (ev.type === 'click') { const target = f || inst._gwPress; inst._gwPress = null; return activate(inst, target); }
    return false;
  }

  const face = (render, fps = 4) => ({ live: true, fps, render, onPointer });
  return { llm: face(renderLlm), tool: face(renderTool), agent: face(renderAgent, 6), memory: face(renderMemory, 2), budget: face(renderBudget, 2), meter: face(renderMeter, 2), onPointer, activate, fieldAtPx };
}
