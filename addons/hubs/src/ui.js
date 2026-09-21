// ui.js — the add-on's controls: the Hubs menu (demos, arrange, live pages, open selected page),
// the "Client Hubs" panel section (live budget, counts, flow buttons) and the floating flow bar at
// the bottom-centre of the viewport (the five flows, the client filter, the live toggle). All of it
// drives the same `api` object index.js builds, so tests can call the api directly.
import { FLOWS } from './flows.js';
import { isHubNode } from './nodes.js';
import { clientKeyOf } from './arrange.js';
import { clientBySlug } from './clients.js';

const BUDGETS = [0, 4, 8, 12, 16];

export function installUI(host, api) {
  const flowbar = document.createElement('div'); flowbar.id = 'hub-flowbar'; flowbar.setAttribute('role', 'toolbar'); flowbar.setAttribute('aria-label', 'Hub flows');
  const flowBtns = new Map();
  for (const f of FLOWS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hub-flow'; b.dataset.flow = f.id; b.textContent = f.label; b.title = f.hint;
    b.addEventListener('click', () => api.arrange(f.id));
    flowbar.appendChild(b); flowBtns.set(f.id, b);
  }
  const sep1 = document.createElement('span'); sep1.className = 'hub-sep'; flowbar.appendChild(sep1);
  const clientSel = document.createElement('select'); clientSel.className = 'hub-client'; clientSel.title = 'Arrange only this client';
  clientSel.addEventListener('change', () => { api.settings.client = clientSel.value || null; api.saveSettings(); });
  flowbar.appendChild(clientSel);
  const sep2 = document.createElement('span'); sep2.className = 'hub-sep'; flowbar.appendChild(sep2);
  const liveBtn = document.createElement('button'); liveBtn.type = 'button'; liveBtn.className = 'hub-live-toggle'; liveBtn.title = 'Live pages on / off';
  liveBtn.addEventListener('click', () => api.setLive(!api.settings.live));
  flowbar.appendChild(liveBtn);
  const count = document.createElement('span'); count.className = 'hub-count'; flowbar.appendChild(count);
  document.body.appendChild(flowbar);

  /* ---- panel section ---- */
  let range, rangeOut, liveCheck, countsEl; const panelBtns = new Map();
  const section = host.ui.panelSection('Client Hubs', (body, h) => {
    const r1 = h('div', 'hub-row'); const l1 = h('label', null, 'Live frames'); liveCheck = document.createElement('input'); liveCheck.type = 'checkbox'; liveCheck.id = 'hub-live-check';
    liveCheck.addEventListener('change', () => api.setLive(liveCheck.checked)); l1.htmlFor = liveCheck.id; r1.append(l1, liveCheck); body.appendChild(r1);
    const r2 = h('div', 'hub-row'); const l2 = h('label', null, 'Budget'); range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '16'; range.step = '1'; range.id = 'hub-budget';
    rangeOut = h('output'); range.addEventListener('input', () => { rangeOut.textContent = range.value; api.setBudget(+range.value); }); l2.htmlFor = range.id; r2.append(l2, range, rangeOut); body.appendChild(r2);
    countsEl = h('div', 'hub-counts'); body.appendChild(countsEl);
    const flows = h('div', 'hub-flows');
    for (const f of FLOWS) { const b = h('button', null, f.label); b.type = 'button'; b.title = f.hint; b.dataset.flow = f.id; b.addEventListener('click', () => api.arrange(f.id)); flows.appendChild(b); panelBtns.set(f.id, b); }
    body.appendChild(flows);
    body.appendChild(h('div', 'hub-hint', 'Click a page face to make its live frame interactive (Done or Esc leaves). Only the nearest live pages within the budget load an iframe; the others show their card.'));
  }, { id: 'hubs-section' });

  /* ---- menu ---- */
  const menu = host.ui.menu({ id: 'hubs', label: 'Hubs', items: () => {
    const sel = api.selectedPage();
    return [
      { label: 'Demos', items: api.examples.map((ex) => ({ label: ex.label, hint: ex.description, run: () => api.loadDemo(ex.id) })) },
      { label: 'Arrange', items: FLOWS.map((f) => ({ label: f.label, hint: f.hint, checked: api.settings.flow === f.id, radio: true, run: () => api.arrange(f.id) })) },
      { label: 'Live pages', items: [
        { label: 'Show live frames', checked: !!api.settings.live, run: () => api.setLive(!api.settings.live) },
        { sep: true, label: 'Budget (nearest pages with a live frame)' },
        ...BUDGETS.map((n) => ({ label: n === 0 ? 'None' : `${n} pages`, checked: api.settings.budget === n, radio: true, run: () => api.setBudget(n) })),
      ] },
      { sep: true },
      { label: sel ? `Open ${sel.title}` : 'Open selected page', hint: 'fly to the selected page and make its live frame interactive', disabled: !sel, shortcut: 'Enter on a page', run: () => api.interact(sel) },
      { label: 'Leave interactive page', disabled: !api.live?.interactive, run: () => api.leaveInteract() },
      { sep: true },
      { label: 'Generate pages for selected blueprint', disabled: !api.selectedBlueprint(), run: () => api.generate(api.selectedBlueprint()) },
    ];
  } });

  /* ---- refresh: counts, active flow, client list ---- */
  function refresh() {
    const c = api.counts();
    const nodes = host.world.nodes().filter(isHubNode);
    const clients = [...new Set(nodes.map(clientKeyOf).filter(Boolean))];
    const cur = api.settings.client && clients.includes(api.settings.client) ? api.settings.client : '';
    const want = ['', ...clients].join('|');
    if (clientSel.dataset.list !== want) {
      clientSel.dataset.list = want; clientSel.innerHTML = '';
      const all = document.createElement('option'); all.value = ''; all.textContent = clients.length > 1 ? 'All clients' : 'Client'; clientSel.appendChild(all);
      for (const k of clients) { const o = document.createElement('option'); o.value = k; o.textContent = clientBySlug(k)?.name || k; clientSel.appendChild(o); }
    }
    clientSel.value = cur; clientSel.hidden = clients.length < 2; sep2.hidden = clients.length < 2;
    for (const [id, b] of flowBtns) b.classList.toggle('is-active', api.settings.flow === id);
    for (const [id, b] of panelBtns) b.classList.toggle('is-active', api.settings.flow === id);
    liveBtn.classList.toggle('is-on', !!c.enabled);
    liveBtn.innerHTML = `<i></i>Live <b>${c.enabled ? `${c.live}/${c.eligible}` : 'off'}</b>`;
    count.textContent = `${c.pages} page${c.pages === 1 ? '' : 's'} · ${clients.length} client${clients.length === 1 ? '' : 's'}`;
    if (range) { range.value = String(c.budget); rangeOut.textContent = String(c.budget); }
    if (liveCheck) liveCheck.checked = !!c.enabled;
    if (countsEl) countsEl.innerHTML = `<b>${c.pages}</b> pages · <b>${c.live}</b> live frame${c.live === 1 ? '' : 's'} of <b>${c.eligible}</b> eligible · <b>${clients.length}</b> client${clients.length === 1 ? '' : 's'}${c.interactive ? ' · <b>interactive</b>' : ''}`;
    flowbar.hidden = false;
  }
  refresh();
  return { menu, section, flowbar, refresh, destroy() { menu.remove(); section.remove(); flowbar.remove(); } };
}
