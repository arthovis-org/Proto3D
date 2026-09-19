// plugin.js — install(proto): everything the add-on attaches to the running app through real
// seams only: window.__proto (main.js:252), engine.onError (engine.js:20/153), the #toolbar
// .menu-anchor > .menu DOM pattern (index.html:32-53), a <details class="sec"> appended to
// <aside id="panel"> after #panel-body so panel.build()'s innerHTML reset never touches it
// (panel.js:129), world.overlays.toast (main.js:44), and a namespaced AutoSave (serialize.js:87).
import { AutoSave, loadWorld } from '../../src/serialize.js';
import { buildExample } from '../../src/examples/index.js';
import { ledger, fmt, fmtBal } from './ledger.js';
import { MODELS, TOOLS, PROVIDERS, RATE_CARD, TIERS, creditsToUsd } from './rates.js';
import { kick, GATEWAY_TYPES } from './nodes.js';
import example from './example.js';

export const WORLD_KEY = 'proto3d.gateway.world.v1';
const $ = (id) => document.getElementById(id);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const usd = (c) => `$${creditsToUsd(c).toFixed(2)}`;
const time = (iso) => new Date(iso).toTimeString().slice(0, 8);
const STATUS_LABEL = { settled: 'settled', held: 'held', refunded: 'refunded', decline: 'declined', bypassed: 'bypassed (own key)', topup: 'top-up', adjust: 'adjustment' };

export function install(proto) {
  if (!proto) throw new Error('gateway-credits: window.__proto missing — boot.js must import ../../src/main.js first');
  const { world, engine, ws, history, selection, overlays, leftBar } = proto;
  const extras = () => ({ camera: ws.camera, controls: ws.controls });
  const toast = (t, ms) => overlays?.toast?.(t, ms);

  /* ---- 1. namespaced autosave: this page never writes the core page's world ---- */
  proto.autosave.enabled = false;
  clearTimeout(proto.autosave._t);                       // a save of the core example was scheduled at main.js:201
  const autosave = new AutoSave(world, { key: WORLD_KEY, extras });
  autosave.enabled = false;
  function loadSample() {
    selection.clear(); history.clear();
    const named = buildExample(world, example, extras());
    engine.evaluate();
    ws.frameBlocks(example.focus(named).filter(Boolean), { instant: true, fill: 0.72, insetLeft: leftBar?.isOpen ? 300 : 0 });
    return named;
  }
  let restored = false;
  const saved = autosave.load();
  if (saved && saved.nodes && saved.nodes.length) {
    try { selection.clear(); history.clear(); loadWorld(world, saved, extras()); restored = true; } catch (e) { console.warn('gateway autosave ignored:', e.message); }
  }
  if (!restored) loadSample();
  autosave.enabled = true;
  autosave.save();                                       // the namespaced key exists from the first frame
  overlays?.setEmptyHint?.(world.nodes.length === 0);

  /* ---- 2. hold hygiene: engine errors and removed nodes release their holds ---- */
  const prevOnError = engine.onError;
  engine.onError = (node, e) => {
    prevOnError?.(node, e);
    if (GATEWAY_TYPES.includes(node.typeId)) { const n = ledger.releaseHolds(node.uid, `engine error: ${e?.message || e} · hold released`); if (n) toast(`${node.title}: ${n} hold${n > 1 ? 's' : ''} released after an error`, 2400); }
  };
  world.onChange((what) => {
    if (what !== 'remove-node' && what !== 'clear' && what !== 'load' && what !== 'example') return;
    const alive = new Set(world.nodes.map((n) => n.uid));
    for (const hd of ledger.openHolds()) if (!alive.has(hd.nodeUid)) ledger.refund(hd.holdId, 'node removed · hold released');
  });

  /* ---- 3. toasts for the metering lifecycle ---- */
  ledger.on((type, e) => {
    switch (type) {
      case 'hold': toast(`Held ${fmt(e.credits)} cr · ${e.nodeTitle} → ${e.provider}`); break;
      case 'settle': toast(`Settled ${fmt(e.credits)} cr · ${e.nodeTitle} · balance ${fmtBal(ledger.available())} cr`); break;
      case 'refund': toast(`Refunded · ${e.nodeTitle} · ${e.note}`, 2400); break;
      case 'decline': toast(`Declined · ${e.nodeTitle || 'request'} · ${e.note}`, 3600); break;
      case 'bypass': toast(`${e.nodeTitle}: own key, not metered (0 cr)`); break;
      case 'topup': toast(`Top-up +${fmtBal(e.credits)} cr · balance ${fmtBal(ledger.available())} cr`); break;
      case 'auto-topup': toast(`Auto top-up fired: +${fmtBal(e.credits)} cr`, 3000); break;
      case 'adjust': toast(`Balance adjusted to ${fmtBal(ledger.available())} cr`); break;
      default: break;
    }
  });

  /* ---- 4. "Run sample": pulse the Input feeding the first gateway node, else kick the node directly ---- */
  function runSample() {
    const gws = engine.order().filter((n) => n.typeId === 'gw-llm' || n.typeId === 'gw-tool');
    if (!gws.length) { toast('No gateway node in the graph — add one from the Gateway category'); return false; }
    const first = gws[0];
    const up = world.connections.find((c) => c.to && c.to.owner === first && c.to.key === 'trigger' && c.from.type === 'event');
    if (up) {
      const src = up.from.owner;
      if (src.typeId === 'input') { src.state.count = (src.state.count || 0) + 1; src.state.pressedAt = performance.now(); src.faceDirty = true; }
      if (src.emit(up.from.key, 'sample run')) return true;
    }
    return kick(first);
  }

  /* ---- 5. Credits ▾ menu in the top bar ---- */
  const toolbar = $('toolbar');
  const anchor = h('span', 'menu-anchor gw-anchor');
  const btn = h('button', null, 'Credits ▾'); btn.type = 'button'; btn.id = 'gw-btn-credits'; btn.title = 'Gateway Credits — balance, top-up, run the sample, reset';
  const menu = h('div', 'menu gw-menu'); menu.id = 'gw-menu'; menu.hidden = true;
  const bal = h('div', 'gw-menu-balance'); const balMain = h('b'); const balSub = h('small'); bal.append(balMain, balSub); menu.appendChild(bal);
  const item = (label, fn, action) => { const b = h('button', null, label); b.type = 'button'; b.dataset.action = action; b.addEventListener('click', () => { closeMenu(); fn(); }); menu.appendChild(b); return b; };
  item('Run sample', runSample, 'run');
  item('Top up +500', () => ledger.topUp(500, 'manual top-up +500'), 'topup');
  item('Show admin block', () => { proto.togglePanel(true); admin.open = true; admin.scrollIntoView({ block: 'nearest' }); }, 'admin');
  const sep = h('div', 'menu-sep', 'Demo'); menu.appendChild(sep);
  item('Set balance to 0.5 cr (test a decline)', () => ledger.adjustTo(0.5, 'balance set to 0.5 cr for testing; the next metered call declines unless auto top-up is on'), 'drain');
  item('Reload sample graph', () => { loadSample(); }, 'sample');
  item('Reset ledger', () => { ledger.reset(); }, 'reset');
  anchor.append(btn, menu);
  const helpAnchor = $('btn-help')?.parentElement;
  if (helpAnchor && helpAnchor.parentElement === toolbar) toolbar.insertBefore(anchor, helpAnchor); else toolbar.appendChild(anchor);
  const closeMenu = () => { menu.hidden = true; btn.classList.remove('on'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.classList.toggle('on', !menu.hidden); });
  window.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && e.target !== btn) closeMenu(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* ---- 6. Admin block in the right panel, after #panel-body (survives panel rebuilds) ---- */
  const panelEl = $('panel');
  const admin = h('details', 'sec gw-admin'); admin.id = 'gw-admin'; admin.open = true;
  admin.appendChild(h('summary', null, 'Gateway Credits'));
  const body = h('div', 'sec-body gw-body'); admin.appendChild(body);
  const live = [];   // live updaters for the controls below (refreshed by render())
  const helpEl = $('help');
  if (helpEl && helpEl.parentElement === panelEl) panelEl.insertBefore(admin, helpEl); else panelEl.appendChild(admin);

  // stat tiles
  const tiles = h('div', 'gw-tiles'); body.appendChild(tiles);
  const tile = (label, hero) => { const t = h('div', 'gw-tile' + (hero ? ' hero' : '')); const l = h('div', 'lbl', label); const v = h('div', 'val'); const s = h('div', 'sub'); t.append(l, v, s); tiles.appendChild(t); return { v, s }; };
  const tBal = tile('Balance', true), tSpend = tile('Spend this month'), tReq = tile('Requests'), tAvg = tile('Avg / call');

  const actions = h('div', 'gw-actions');
  const act = (label, fn, id) => { const b = h('button', null, label); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', fn); actions.appendChild(b); return b; };
  act('Run sample', runSample, 'gw-run');
  act('Top up +500', () => ledger.topUp(500, 'manual top-up +500'), 'gw-topup');
  act('Reset ledger', () => ledger.reset(), 'gw-reset');
  body.appendChild(actions);

  // auto top-up
  const at = fieldset('Auto top-up');
  const atEnabled = check(at, 'enabled', () => ledger.settings.autoTopUp.enabled, (v) => { ledger.settings.autoTopUp.enabled = v; ledger.saveSettings(); if (v) ledger.maybeAutoTopUp('enabled'); }, 'gw-at-enabled');
  num(at, 'threshold (cr)', () => ledger.settings.autoTopUp.threshold, (v) => { ledger.settings.autoTopUp.threshold = v; ledger.saveSettings(); }, 10, 'gw-at-threshold');
  num(at, 'target (cr)', () => ledger.settings.autoTopUp.target, (v) => { ledger.settings.autoTopUp.target = v; ledger.saveSettings(); }, 100, 'gw-at-target');
  num(at, 'monthly cap (cr)', () => ledger.settings.autoTopUp.monthlyCap, (v) => { ledger.settings.autoTopUp.monthlyCap = v; ledger.saveSettings(); }, 500, 'gw-at-cap');
  const atUsed = h('div', 'gw-hint'); at.appendChild(atUsed);

  // routing policy
  const pol = fieldset('Routing policy');
  check(pol, 'prefer cheapest capable', () => ledger.settings.policy.preferCheapest, (v) => { ledger.settings.policy.preferCheapest = v; ledger.saveSettings(); }, 'gw-pol-cheapest');
  pol.appendChild(h('div', 'gw-hint', 'Applies to nodes with a capability tier; a fixed model is never swapped.'));
  check(pol, 'fallback on provider error', () => ledger.settings.policy.fallback, (v) => { ledger.settings.policy.fallback = v; ledger.saveSettings(); }, 'gw-pol-fallback');
  pol.appendChild(h('div', 'gw-hint', 'Simulated 10% provider failure on model calls; the hold is refunded and a cheaper capable model on another provider is tried once.'));

  // spend bars
  const svcWrap = h('div', 'gw-block'); svcWrap.appendChild(h('h4', null, 'Spend by model / service')); const svcBars = h('div', 'gw-bars'); svcWrap.appendChild(svcBars); body.appendChild(svcWrap);
  const wfWrap = h('div', 'gw-block'); wfWrap.appendChild(h('h4', null, 'Spend by workflow')); const wfBars = h('div', 'gw-bars'); wfWrap.appendChild(wfBars); body.appendChild(wfWrap);

  // ledger table (last 12)
  const ledWrap = h('div', 'gw-block'); ledWrap.appendChild(h('h4', null, 'Ledger · last 12'));
  const table = h('table', 'gw-ledger'); table.id = 'gw-ledger';
  table.appendChild(h('thead')).innerHTML = '<tr><th>Time</th><th>Node · provider</th><th class="r">Credits</th><th>Status</th></tr>';
  const tbody = h('tbody'); table.appendChild(tbody); ledWrap.appendChild(table); body.appendChild(ledWrap);

  // rate card
  const rate = h('details', 'gw-rate'); rate.appendChild(h('summary', null, `Rate card · illustrative · synced ${RATE_CARD.syncedAt}`));
  const rt = h('table', 'gw-rate-table');
  const models = Object.values(MODELS).sort((a, b) => a.provider.localeCompare(b.provider) || TIERS[a.tier] - TIERS[b.tier]);
  rt.innerHTML = '<thead><tr><th>Model / service</th><th>Tier</th><th class="r">In</th><th class="r">Out</th></tr></thead>' +
    '<tbody>' + models.map((m) => `<tr><td><i class="gw-dot" style="background:${PROVIDERS[m.provider].color}"></i>${esc(PROVIDERS[m.provider].label)} · ${esc(m.label)}</td><td>${m.tier}</td><td class="r">${m.in}</td><td class="r">${m.out}</td></tr>`).join('') +
    Object.values(TOOLS).map((t) => `<tr><td><i class="gw-dot" style="background:${PROVIDERS[t.id].color}"></i>${esc(t.label)}</td><td>tool</td><td class="r" colspan="2">${t.price.toFixed(2)} / ${t.unit}</td></tr>`).join('') + '</tbody>';
  rate.appendChild(rt);
  rate.appendChild(h('div', 'gw-hint', `Credits per 1M tokens for models, per unit for tools. 1 credit = $0.01 (demo rate). ${RATE_CARD.source}.`));
  body.appendChild(rate);
  body.appendChild(h('div', 'gw-hint gw-foot', 'Simulated providers: no network call is made and no key leaves the page. Ledger lives in localStorage (proto3d.gateway.ledger.v1).'));

  /* ---- helpers for the admin block ---- */
  function fieldset(title) { const d = h('div', 'gw-fieldset'); d.appendChild(h('h4', null, title)); body.appendChild(d); return d; }
  function check(parent, label, get, set, id) {
    const r = h('label', 'row gw-row'); r.appendChild(h('span', 'lbl', label)); const i = h('input'); i.type = 'checkbox'; if (id) i.id = id;
    i.addEventListener('change', () => set(i.checked)); r.appendChild(i); parent.appendChild(r); live.push(() => { i.checked = !!get(); }); return i;
  }
  function num(parent, label, get, set, step, id) {
    const r = h('label', 'row gw-row'); r.appendChild(h('span', 'lbl', label)); const i = h('input'); i.type = 'number'; i.min = 0; i.step = step; if (id) i.id = id;
    i.addEventListener('input', () => { const v = parseFloat(i.value); if (Number.isFinite(v) && v >= 0) set(v); }); r.appendChild(i); parent.appendChild(r);
    live.push(() => { if (document.activeElement !== i) i.value = String(get()); }); return i;
  }
  function bars(container, rows, colorOf) {
    container.innerHTML = '';
    if (!rows.length) { container.appendChild(h('div', 'gw-hint', 'Nothing metered yet.')); return; }
    const max = Math.max(...rows.map((r) => r.credits));
    for (const r of rows) {
      const w = Math.max(2, (r.credits / max) * 100);
      const row = h('div', 'gw-bar'); const n = h('span', 'n', r.name); n.title = `${r.name} · ${r.n} call${r.n === 1 ? '' : 's'}`;
      const track = h('div', 'track'); const fill = h('div', 'fill'); fill.style.width = `${w}%`; fill.style.background = colorOf(r); track.appendChild(fill);
      const v = h('span', 'v', fmt(r.credits)); row.append(n, track, v); container.appendChild(row);
    }
  }
  function renderRows() {
    const rows = ledger.rows(12);
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="gw-hint">Empty. Every hold, settle, refund, decline, bypass and top-up lands here.</td></tr>'; return; }
    tbody.innerHTML = rows.map((r) => {
      const cr = r.status === 'topup' || r.status === 'adjust' ? `${r.credits >= 0 ? '+' : ''}${fmtBal(r.credits)}` : r.credits ? fmt(r.credits) : '0';
      const who = r.nodeTitle ? `<b>${esc(r.nodeTitle)}</b><small>${esc(r.provider || '—')}${r.units && r.units !== '—' ? ' · ' + esc(r.units) : ''}</small>` : `<b>${esc(r.provider || '—')}</b>`;
      const note = r.note ? `<small class="note">${esc(r.note)}</small>` : '';
      return `<tr data-status="${r.status}" title="${r.idem ? 'idempotency key ' + esc(r.idem) : ''}"><td class="t">${time(r.at)}</td><td class="who">${who}${note}</td><td class="r">${cr}</td><td><span class="gw-st ${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td></tr>`;
    }).join('');
  }
  function render() {
    const avail = ledger.available(), held = ledger.held(), spend = ledger.spend();
    tBal.v.textContent = `${fmtBal(avail)} cr`; tBal.s.textContent = `${usd(avail)}${held > 1e-6 ? ` · ${fmt(held)} cr on hold` : ' · no holds'}`;
    tBal.v.classList.toggle('low', avail < 100);
    tSpend.v.textContent = `${fmt(spend)} cr`; tSpend.s.textContent = usd(spend);
    tReq.v.textContent = String(ledger.requests()); tReq.s.textContent = `${ledger.bypassed()} bypassed on own keys`;
    const avg = ledger.avgPerCall(); tAvg.v.textContent = avg ? `${fmt(avg)} cr` : '—'; tAvg.s.textContent = `${ledger.settledEntries().length} settled this month`;
    balMain.textContent = `${fmtBal(avail)} cr`; balSub.textContent = `${usd(avail)} · ${held > 1e-6 ? `${fmt(held)} cr on hold` : 'no holds'} · spend ${fmt(spend)} cr`;
    btn.textContent = `Credits ${fmtBal(avail)} ▾`;
    atUsed.textContent = `${fmtBal(ledger.autoToppedThisMonth())} of ${fmtBal(ledger.settings.autoTopUp.monthlyCap)} cr auto-topped this month`;
    bars(svcBars, ledger.byService().slice(0, 8), (r) => (PROVIDERS[r.provider]?.color || 'var(--accent)'));
    const wfColors = ['var(--accent)', '#34c99a', '#f5b942', '#e25aa6', '#8b7cf6'];
    bars(wfBars, ledger.byWorkflow().slice(0, 6), (r, i) => wfColors[ledger.byWorkflow().findIndex((x) => x.name === r.name) % wfColors.length]);
    renderRows();
    live.forEach((fn) => fn());
  }
  let raf = 0;
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  ledger.on(schedule);
  setInterval(schedule, 1000);   // held ↔ settled transitions, period rollovers
  render();

  const api = { ledger, autosave, runSample, loadSample, kick, example, admin, menu, WORLD_KEY };
  window.__gateway = api;
  return api;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
