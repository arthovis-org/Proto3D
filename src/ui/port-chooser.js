// ui/port-chooser.js — "add a node from a link": the popover that opens when a new cable is dropped
// on empty space (interaction.js _endConnect). It lists every component · port pair that fits the
// dragged end, grouped by category and ranked (exact type / subtype first, then number → text
// coercion, then `any`; within a rank a port named like the dragged one, then sinks / sources with
// fewer ports on the far side), with a search field (the command palette's fuzzy scorer), ↑ ↓ Enter Esc
// and click-outside cancel. Presentation only: `candidates()` builds the list from the registry,
// `openPortChooser()` shows it and resolves through `onPick(item)` / `onCancel()`.
import { registry } from '../core/registry.js';
import { compatiblePorts, portTypeText } from '../core/types.js';
import { describePorts } from '../pm/relations.js';
import { scoreItem } from './command-palette.js';
import { icons } from '../icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Every { def, portDef, label, hint, group, rank } that could take the other end of a cable from
 * `fixed` (a real Port3D). `need` is the side wanted: 'in' when dragging from an output, 'out' when
 * dragging backwards from an input.
 */
export function candidates(fixed, need) {
  const cats = registry.categories();
  const order = new Map(cats.map((c, i) => [c.id, i]));
  const out = [];
  for (const def of registry.all()) {
    const ports = need === 'in' ? def.inputs : def.outputs;
    for (const pd of ports || []) {
      if (pd.hidden) continue;
      const pair = need === 'in' ? [fixed, pd] : [pd, fixed];
      const k = compatiblePorts(...pair);
      if (k === 'invalid') continue;
      const rank = k === 'coerce' ? 1 : pd.type === 'any' ? 2 : 0;
      const same = pd.label === fixed.label || pd.key === fixed.key ? 0 : 1;   // "prompt → Prompt · prompt" first
      const other = Math.min(4, ((need === 'in' ? def.outputs : def.inputs) || []).length);   // sinks first when looking for a consumer, sources first when looking for a producer
      const fake = { ...pd, dir: need, owner: { title: def.label, typeId: def.id, def, kind: def.device ? 'device' : 'node' } };
      let hint = null;
      try { hint = need === 'in' ? describePorts(fixed, fake) : describePorts(fake, fixed); } catch (_) { hint = null; }
      out.push({ def, portDef: pd, label: `${def.label} · ${pd.label}`, hint: hint || portTypeText(pd), group: (cats.find((c) => c.id === def.category) || {}).label || def.category, cat: order.get(def.category) ?? 99, rank, same, other, icon: def.icon || icons.node });
    }
  }
  out.sort((a, b) => a.rank - b.rank || a.same - b.same || a.other - b.other || a.def.label.localeCompare(b.def.label) || a.label.localeCompare(b.label));
  return out;
}

/**
 * Show the chooser at screen (x, y), clamped inside `bounds` (a DOMRect; the viewport). Returns
 * { el, close() }. Exactly one of onPick(item) / onCancel() fires.
 */
export function openPortChooser(items, { x, y, title = 'Connect to…', bounds = null }, onPick, onCancel = () => {}) {
  const el = document.createElement('div');
  el.id = 'port-chooser'; el.className = 'chooser port-chooser'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="chooser-title">${esc(title)}</div><input class="chooser-search" type="search" placeholder="Search components…" aria-label="Search components" autocomplete="off" spellcheck="false"><div class="chooser-list" role="listbox"></div>`;
  const input = el.querySelector('input'), list = el.querySelector('.chooser-list');
  let shown = [], active = 0, done = false;
  const finish = (item) => { if (done) return; done = true; window.removeEventListener('pointerdown', outside, true); el.remove(); if (item) onPick(item); else onCancel(); };
  const outside = (e) => { if (!el.contains(e.target)) finish(null); };
  const render = () => {
    const q = input.value.trim();
    shown = q ? items.map((it) => ({ it, s: scoreItem(q, it).s })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s || a.it.rank - b.it.rank).map((r) => r.it) : items.slice();
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = '';
    if (!shown.length) { const d = document.createElement('div'); d.className = 'chooser-empty'; d.textContent = 'Nothing fits this port'; list.appendChild(d); return; }
    let group = null;
    shown.forEach((it, i) => {
      if (!q && it.group !== group) { group = it.group; const g = document.createElement('div'); g.className = 'chooser-group'; g.textContent = group; list.appendChild(g); }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chooser-row' + (i === active ? ' active' : ''); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === active)); b.dataset.index = String(i);
      b.title = it.hint || ''; b.innerHTML = `<span class="ic">${it.icon}</span><b>${esc(it.label)}</b><small>${esc(it.hint || '')}</small>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); finish(it); });
      b.addEventListener('pointerenter', () => { active = i; list.querySelectorAll('.chooser-row').forEach((r, k) => { r.classList.toggle('active', k === i); r.setAttribute('aria-selected', String(k === i)); }); });
      list.appendChild(b);
    });
    list.querySelector('.chooser-row.active')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { active = 0; render(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!shown.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; render(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shown[active]) finish(shown[active]); }
    else e.stopPropagation();   // typing never reaches the workspace shortcuts
  });
  document.body.appendChild(el);
  render();
  const B = bounds || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const w = el.offsetWidth || 300, h = el.offsetHeight || 200;
  el.style.left = `${Math.round(Math.min(Math.max(B.left + 8, x + 8), B.right - w - 8))}px`;
  el.style.top = `${Math.round(Math.min(Math.max(B.top + 8, y + 8), B.bottom - h - 8))}px`;
  setTimeout(() => { if (!done) window.addEventListener('pointerdown', outside, true); }, 0);
  input.focus({ preventScroll: true });
  return { el, close: () => finish(null) };
}
