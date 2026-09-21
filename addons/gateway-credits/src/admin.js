// admin.js — the Credits menu (host.ui.menu → a real top-level menu in the core menu bar, also
// listed by the command palette) and the admin block in the properties panel (host.ui.panelSection
// → a <details class="sec"> outside #panel-body, so panel.build() never clears it): balance tiles,
// actions, auto top-up, routing policy, spend bars, the ledger table and the rate card.
import { fmt, fmtBal } from './ledger.js';
import { MODELS, TOOLS, PROVIDERS, RATE_CARD, TIERS, creditsToUsd } from './rates.js';

const usd = (c) => `$${creditsToUsd(c).toFixed(2)}`;
const time = (iso) => new Date(iso).toTimeString().slice(0, 8);
const STATUS_LABEL = { settled: 'settled', held: 'held', refunded: 'refunded', decline: 'declined', bypassed: 'bypassed (own key)', topup: 'top-up', adjust: 'adjustment' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Build the Credits menu and the admin section. Returns { menu, admin, render }. */
export function installAdmin(host, { ledger, runSample, loadSample, applyFlowLayout }) {
  /* ---- Credits menu: a declarative menu in the core menu bar; items are rebuilt each time it opens ---- */
  const menu = host.ui.menu({
    id: 'credits', label: 'Credits',
    items: () => {
      const avail = ledger.available(), held = ledger.held();
      return [
        { sep: true, label: `Balance ${fmtBal(avail)} cr · ${usd(avail)} · ${held > 1e-6 ? `${fmt(held)} cr on hold` : 'no holds'} · spend ${fmt(ledger.spend())} cr` },
        { label: 'Run sample', hint: 'pulse the trigger feeding the agent, then tidy the flow', action: () => runSample() },
        { label: 'Flow layout', hint: 'three levels: budget / meter above, the chain left → right at eye level, sub-nodes on the floor under their agent (undoable; flat while the 2D plan is on)', action: () => applyFlowLayout?.() },
        { label: 'Flow layout (flat)', hint: 'the plan-view variant on one level: sub-nodes behind their agent, budget / meter behind the chain, heights kept', action: () => applyFlowLayout?.({ flat: true }) },
        { label: 'Top up +500', hint: 'manual top-up row', action: () => ledger.topUp(500, 'manual top-up +500') },
        { label: 'Show admin block', hint: 'balance, policy, ledger in the panel', action: () => { host.ui.togglePanel(true); admin.open = true; admin.scrollIntoView({ block: 'nearest' }); } },
        { sep: true, label: 'Demo' },
        { label: 'Set balance to 0.5 cr', hint: 'the next metered call declines unless auto top-up is on', action: () => ledger.adjustTo(0.5, 'balance set to 0.5 cr for testing; the next metered call declines unless auto top-up is on') },
        { label: 'Reload sample graph', hint: 'replaces the current graph', action: loadSample },
        { label: 'Reset ledger', hint: 'back to the opening balance', action: () => ledger.reset() },
      ];
    },
  });

  /* ---- Admin block in the right panel ---- */
  let admin = null;
  const live = [];   // live updaters for the controls below (refreshed by render())
  let els = {};
  admin = host.ui.panelSection('Gateway Credits', (body, h) => {
    body.classList.add('gw-body');
    // stat tiles
    const tiles = h('div', 'gw-tiles'); body.appendChild(tiles);
    const tile = (label, hero) => { const t = h('div', 'gw-tile' + (hero ? ' hero' : '')); const l = h('div', 'lbl', label); const v = h('div', 'val'); const s = h('div', 'sub'); t.append(l, v, s); tiles.appendChild(t); return { v, s }; };
    els.tBal = tile('Balance', true); els.tSpend = tile('Spend this month'); els.tReq = tile('Requests'); els.tAvg = tile('Avg / call');

    const actions = h('div', 'gw-actions');
    const act = (label, fn, id) => { const b = h('button', null, label); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', fn); actions.appendChild(b); return b; };
    act('Run sample', () => runSample(), 'gw-run');
    act('Top up +500', () => ledger.topUp(500, 'manual top-up +500'), 'gw-topup');
    act('Reset ledger', () => ledger.reset(), 'gw-reset');
    body.appendChild(actions);

    const fieldset = (title) => { const d = h('div', 'gw-fieldset'); d.appendChild(h('h4', null, title)); body.appendChild(d); return d; };
    const check = (parent, label, get, set, id) => {
      const r = h('label', 'row gw-row'); r.appendChild(h('span', 'lbl', label)); const i = h('input'); i.type = 'checkbox'; if (id) i.id = id;
      i.addEventListener('change', () => set(i.checked)); r.appendChild(i); parent.appendChild(r); live.push(() => { i.checked = !!get(); }); return i;
    };
    const num = (parent, label, get, set, step, id) => {
      const r = h('label', 'row gw-row'); r.appendChild(h('span', 'lbl', label)); const i = h('input'); i.type = 'number'; i.min = 0; i.step = step; if (id) i.id = id;
      i.addEventListener('input', () => { const v = parseFloat(i.value); if (Number.isFinite(v) && v >= 0) set(v); }); r.appendChild(i); parent.appendChild(r);
      live.push(() => { if (document.activeElement !== i) i.value = String(get()); }); return i;
    };

    // auto top-up
    const at = fieldset('Auto top-up');
    check(at, 'enabled', () => ledger.settings.autoTopUp.enabled, (v) => { ledger.settings.autoTopUp.enabled = v; ledger.saveSettings(); if (v) ledger.maybeAutoTopUp('enabled'); }, 'gw-at-enabled');
    num(at, 'threshold (cr)', () => ledger.settings.autoTopUp.threshold, (v) => { ledger.settings.autoTopUp.threshold = v; ledger.saveSettings(); }, 10, 'gw-at-threshold');
    num(at, 'target (cr)', () => ledger.settings.autoTopUp.target, (v) => { ledger.settings.autoTopUp.target = v; ledger.saveSettings(); }, 100, 'gw-at-target');
    num(at, 'monthly cap (cr)', () => ledger.settings.autoTopUp.monthlyCap, (v) => { ledger.settings.autoTopUp.monthlyCap = v; ledger.saveSettings(); }, 500, 'gw-at-cap');
    els.atUsed = h('div', 'gw-hint'); at.appendChild(els.atUsed);

    // routing policy
    const pol = fieldset('Routing policy');
    check(pol, 'prefer cheapest capable', () => ledger.settings.policy.preferCheapest, (v) => { ledger.settings.policy.preferCheapest = v; ledger.saveSettings(); }, 'gw-pol-cheapest');
    pol.appendChild(h('div', 'gw-hint', 'Applies to nodes with a capability tier; a fixed model is never swapped.'));
    check(pol, 'fallback on provider error', () => ledger.settings.policy.fallback, (v) => { ledger.settings.policy.fallback = v; ledger.saveSettings(); }, 'gw-pol-fallback');
    pol.appendChild(h('div', 'gw-hint', 'Simulated 10% provider failure on model calls; the hold is refunded and a cheaper capable model on another provider is tried once.'));

    // spend bars
    const svcWrap = h('div', 'gw-block'); svcWrap.appendChild(h('h4', null, 'Spend by model / service')); els.svcBars = h('div', 'gw-bars'); svcWrap.appendChild(els.svcBars); body.appendChild(svcWrap);
    const wfWrap = h('div', 'gw-block'); wfWrap.appendChild(h('h4', null, 'Spend by workflow')); els.wfBars = h('div', 'gw-bars'); wfWrap.appendChild(els.wfBars); body.appendChild(wfWrap);

    // ledger table (last 12)
    const ledWrap = h('div', 'gw-block'); ledWrap.appendChild(h('h4', null, 'Ledger · last 12'));
    const table = h('table', 'gw-ledger'); table.id = 'gw-ledger';
    table.appendChild(h('thead')).innerHTML = '<tr><th>Time</th><th>Node · provider</th><th class="r">Credits</th><th>Status</th></tr>';
    els.tbody = h('tbody'); table.appendChild(els.tbody); ledWrap.appendChild(table); body.appendChild(ledWrap);

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
    body.appendChild(h('div', 'gw-hint gw-foot', `Simulated providers: no network call is made and no key leaves the page. Ledger lives in this page's isolated storage (${host.storage.namespace}ledger.v1).`));
  }, { id: 'gw-admin', open: true });
  admin.classList.add('gw-admin');

  function bars(container, rows, colorOf) {
    container.innerHTML = '';
    if (!rows.length) { container.appendChild(hEl('div', 'gw-hint', 'Nothing metered yet.')); return; }
    const max = Math.max(...rows.map((r) => r.credits));
    for (const r of rows) {
      const w = Math.max(2, (r.credits / max) * 100);
      const row = hEl('div', 'gw-bar'); const n = hEl('span', 'n', r.name); n.title = `${r.name} · ${r.n} call${r.n === 1 ? '' : 's'}`;
      const track = hEl('div', 'track'); const fill = hEl('div', 'fill'); fill.style.width = `${w}%`; fill.style.background = colorOf(r); track.appendChild(fill);
      const v = hEl('span', 'v', fmt(r.credits)); row.append(n, track, v); container.appendChild(row);
    }
  }
  function renderRows() {
    const rows = ledger.rows(12);
    if (!rows.length) { els.tbody.innerHTML = '<tr><td colspan="4" class="gw-hint">Empty. Every hold, settle, refund, decline, bypass and top-up lands here.</td></tr>'; return; }
    els.tbody.innerHTML = rows.map((r) => {
      const cr = r.status === 'topup' || r.status === 'adjust' ? `${r.credits >= 0 ? '+' : ''}${fmtBal(r.credits)}` : r.credits ? fmt(r.credits) : '0';
      const who = r.nodeTitle ? `<b>${esc(r.nodeTitle)}</b><small>${esc(r.provider || '—')}${r.units && r.units !== '—' ? ' · ' + esc(r.units) : ''}</small>` : `<b>${esc(r.provider || '—')}</b>`;
      const note = r.note ? `<small class="note">${esc(r.note)}</small>` : '';
      return `<tr data-status="${r.status}" title="${r.idem ? 'idempotency key ' + esc(r.idem) : ''}"><td class="t">${time(r.at)}</td><td class="who">${who}${note}</td><td class="r">${cr}</td><td><span class="gw-st ${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td></tr>`;
    }).join('');
  }
  function render() {
    const avail = ledger.available(), held = ledger.held(), spend = ledger.spend();
    els.tBal.v.textContent = `${fmtBal(avail)} cr`; els.tBal.s.textContent = `${usd(avail)}${held > 1e-6 ? ` · ${fmt(held)} cr on hold` : ' · no holds'}`;
    els.tBal.v.classList.toggle('low', avail < 100);
    els.tSpend.v.textContent = `${fmt(spend)} cr`; els.tSpend.s.textContent = usd(spend);
    els.tReq.v.textContent = String(ledger.requests()); els.tReq.s.textContent = `${ledger.bypassed()} bypassed on own keys`;
    const avg = ledger.avgPerCall(); els.tAvg.v.textContent = avg ? `${fmt(avg)} cr` : '—'; els.tAvg.s.textContent = `${ledger.settledEntries().length} settled this month`;
    els.atUsed.textContent = `${fmtBal(ledger.autoToppedThisMonth())} of ${fmtBal(ledger.settings.autoTopUp.monthlyCap)} cr auto-topped this month`;
    bars(els.svcBars, ledger.byService().slice(0, 8), (r) => (PROVIDERS[r.provider]?.color || 'var(--accent)'));
    const wfColors = ['var(--accent)', '#34c99a', '#f5b942', '#e25aa6', '#8b7cf6'];
    const byWf = ledger.byWorkflow();
    bars(els.wfBars, byWf.slice(0, 6), (r) => wfColors[byWf.findIndex((x) => x.name === r.name) % wfColors.length]);
    renderRows();
    live.forEach((fn) => fn());
  }
  let raf = 0;
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  ledger.on(schedule);
  setInterval(schedule, 1000);   // held ↔ settled transitions, period rollovers
  render();
  return { menu, admin, render };
}
const hEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
