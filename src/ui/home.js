// ui/home.js — the Home page: a full view over the viewport area (the rail and the panel stay)
// behind the permanent first tab of the strip, Alt+H and File → Projects. Three views: Projects
// (a searchable, filterable grid of every project in this browser — thumbnail, key, status,
// tags, member avatars, a progress ring from the task index, next due, last opened, a ⋯ menu:
// Open · Edit… · Duplicate · Archive · Delete), Tasks (a sortable table over the task index of
// every project or of the active one; a row opens the project and selects the card) and Calendar
// (a placeholder until the next round). At the right of the header the "You are …" picker sets
// who the viewer is in the people directory (pm/people.js). Presentation only: projects come
// from the store's listing (metadata + index, no documents), edits go through Tabs
// (`patchProject`, `duplicateProject`, `deleteProject`) and the project dialog.
//
//   new Home({ el, tabs, people, store, onNew, onEdit, onOpenTask, toast })
//   open(view?) / hide(reason) / toggle() / isOpen · onChange(open, reason) · refresh()
import { icons } from '../icons.js';
import { isTyping } from '../interaction.js';
import { PROJECT_STATUSES, projectStats, indexDoc, isoToday } from '../project-store.js';
import { fmtDate, PRIORITY_COLOURS } from '../pm/model.js';
import { confirmDialog } from './confirm.js';
import { timeAgo } from './tab-strip.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIEWS = [['projects', 'Projects'], ['tasks', 'Tasks'], ['calendar', 'Calendar']];
const STATUS_CHIPS = [['all', 'All'], ...PROJECT_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])];
const SORTS = [['opened', 'Last opened'], ['name', 'Name'], ['due', 'Due'], ['progress', 'Progress']];
const COLUMNS = [['title', 'Task'], ['project', 'Project'], ['column', 'Column'], ['assignee', 'Assignee'], ['due', 'Due'], ['priority', 'Priority']];
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
/** An avatar disc: initials in a colour. */
export const avatar = (name, colour, title = name) => `<span class="avatar" style="--av:${esc(colour || '#8e9bb1')}" title="${esc(title)}">${esc(initialsOf(name))}</span>`;
const initialsOf = (name) => String(name || '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
const ring = (ratio, size = 30) => { const r = (size - 4) / 2, c = 2 * Math.PI * r; return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, ratio)))).toFixed(1)}"/></svg>`; };

export class Home {
  constructor({ el, tabs, people, store, onNew = () => {}, onEdit = () => {}, onOpenTask = () => {}, onChange = () => {}, toast = () => {} }) {
    Object.assign(this, { el, tabs, people, store, onNew, onEdit, onOpenTask, onChange, toast });
    this.view = 'projects';
    this.filters = { q: '', status: 'all', tag: '', member: '', sort: 'opened' };
    this.tasks = { scope: 'all', q: '', sort: 'due', dir: 1, projectId: null };
    this.projects = [];            // the store's listing, merged with the open tabs
    this._activeAtOpen = null;
    this.el.hidden = true; this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `<div class="home-wrap"><header class="home-head"></header><div class="home-body"></div></div>`;
    this.head = this.el.querySelector('.home-head'); this.body = this.el.querySelector('.home-body');
    this.el.addEventListener('click', (e) => this._click(e));
    this.el.addEventListener('keydown', (e) => this._key(e));
    window.addEventListener('keydown', (e) => { if (this.isOpen && e.key === 'Escape' && !isTyping(e) && !document.querySelector('.confirm-backdrop, .modal-backdrop:not([hidden])')) { if (this._closeMenus()) { e.stopPropagation(); return; } e.stopPropagation(); this.hide('esc'); } }, true);
    window.addEventListener('pointerdown', (e) => { if (!e.target.closest('.home-menu, .pcard-more, .home-me')) this._closeMenus(); }, true);
    // a tab switch closes Home — unless Home itself caused it (deleting the active project closes its tab)
    tabs.onChange(() => { if (!this.isOpen) return; if (tabs.activeId !== this._activeAtOpen) { if (this._own) { this._activeAtOpen = tabs.activeId; this.refreshSoon(); } else this.hide('switch'); } else this.refreshSoon(); });
    tabs.onStatus((s) => { if (this.isOpen && s.state === 'saved') this.refreshSoon(); });
    people.onChange(() => { if (this.isOpen) { this._renderMe(); this.refreshSoon(); } });
    this._t = 0;
  }
  get isOpen() { return !this.el.hidden; }
  /** Show Home (optionally on a view). The Tasks view scopes to the active project when it holds anything. */
  open(view = null, reason = 'menu') {
    const wasOpen = this.isOpen;
    if (view) this.view = view;
    if (!wasOpen) {
      const t = this.tabs.active;
      this._activeAtOpen = this.tabs.activeId;
      this.tasks.projectId = t && !t.preview ? t.id : null;
      this.tasks.scope = t && !t.preview && !this.tabs.isUntouchedEmpty(t) ? 'project' : 'all';
    }
    this.el.hidden = false; this.el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('home-open');
    this._renderHead(); this._renderBody();
    this.refresh();
    if (!wasOpen) this.onChange(true, reason);
    return true;
  }
  hide(reason = 'close') {
    if (!this.isOpen) return;
    this._closeMenus();
    this.el.hidden = true; this.el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('home-open');
    this.onChange(false, reason);
  }
  toggle() { this.isOpen ? this.hide('menu') : this.open(); }
  setView(view) { if (!VIEWS.some(([v]) => v === view) || view === this.view) return; this.view = view; this._renderHead(); this._renderBody(); this._renderContent(); }

  /* ---------- data ---------- */
  refreshSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.refresh(), 120); }
  /** Re-read the listing (metadata + index only) and redraw the current view's content. */
  async refresh() {
    const seq = this._seq = (this._seq || 0) + 1;
    const list = await this.store.listProjects();
    if (seq !== this._seq) return;
    this.projects = list.map((p) => { const tab = this.tabs.byId(p.id); return { ...p, name: tab ? tab.name : p.name, meta: tab ? tab.meta : p.meta, dirty: tab ? tab.dirty : !!p.dirty, open: !!tab, active: p.id === this.tabs.activeId, stats: projectStats(tab?.doc ? { doc: tab.doc } : p) }; });
    if (this.isOpen) this._renderContent();
  }
  /** The listing without untouched empty tabs (a new, unnamed, never edited tab is not a project yet). */
  get real() { return this.projects.filter((p) => p.name || p.nodes || p.dirty); }
  get tags() { return [...new Set(this.projects.flatMap((p) => p.meta?.tags || []))].sort((a, b) => a.localeCompare(b)); }
  get members() {
    const ids = new Set(this.projects.flatMap((p) => (p.meta?.members || []).map((m) => m.personId)));
    return this.people.list().filter((p) => ids.has(p.id));
  }
  filtered() {
    const f = this.filters, q = f.q.trim().toLowerCase(), today = isoToday();
    let list = this.real.filter((p) => {
      const m = p.meta || {};
      if (f.status === 'all' ? m.status === 'archived' : m.status !== f.status) return false;
      if (f.tag && !(m.tags || []).includes(f.tag)) return false;
      if (f.member && !(m.members || []).some((x) => x.personId === f.member)) return false;
      if (q && !`${p.name || 'untitled'} ${m.key || ''} ${m.description || ''} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const due = (p) => p.meta?.due || p.stats.nextDue || '9999';
    if (f.sort === 'name') list.sort((a, b) => (a.name || 'Untitled').localeCompare(b.name || 'Untitled'));
    else if (f.sort === 'due') list.sort((a, b) => due(a).localeCompare(due(b)) || (b.openedAt || 0) - (a.openedAt || 0));
    else if (f.sort === 'progress') list.sort((a, b) => b.stats.doneRatio - a.stats.doneRatio || (b.openedAt || 0) - (a.openedAt || 0));
    else list.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    list.today = today;
    return list;
  }
  /** The task rows of the Tasks view: every non-archived project, or the scoped one. */
  taskRows() {
    const t = this.tasks, q = t.q.trim().toLowerCase();
    const src = t.scope === 'project' && t.projectId ? this.projects.filter((p) => p.id === t.projectId) : this.projects.filter((p) => p.meta?.status !== 'archived');
    const rows = [];
    for (const p of src) {
      const tab = this.tabs.byId(p.id);
      const tasks = tab?.doc ? indexDoc(tab.doc).tasks : p.index?.tasks || [];   // an open tab's document is fresher than its stored index
      for (const k of tasks) rows.push({ ...k, projectId: p.id, project: p.name || 'Untitled', key: p.meta?.key || '', colour: p.meta?.colour });
    }
    const out = q ? rows.filter((r) => `${r.title} ${r.project} ${r.assignee} ${r.column}`.toLowerCase().includes(q)) : rows;
    const dir = t.dir, k = t.sort;
    const val = (r) => (k === 'due' ? r.due || '9999' : k === 'priority' ? PRIORITY_RANK[r.priority] ?? 9 : k === 'column' ? `${r.columnIndex}` : String(r[k] || '').toLowerCase());
    out.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.title.localeCompare(b.title); });
    return out;
  }

  /* ---------- rendering ---------- */
  _renderHead() {
    this.head.innerHTML = `<div class="home-title"><span class="modal-icon">${icons.home}</span><div><h1>Home</h1><p>Every project in this browser, its tasks and people.</p></div></div>
      <nav class="home-switch" role="tablist" aria-label="Home views">${VIEWS.map(([v, l]) => `<button type="button" role="tab" data-view="${v}" aria-selected="${v === this.view}">${l}</button>`).join('')}</nav>
      <div class="home-me"></div>`;
    this._renderMe();
  }
  _renderMe() {
    const wrap = this.head.querySelector('.home-me'); if (!wrap) return;
    const me = this.people.mePerson;
    wrap.innerHTML = `<button type="button" class="home-me-btn" aria-haspopup="listbox" aria-expanded="false" title="Who you are in this browser's directory">${me ? avatar(me.name, me.colour) : `<span class="avatar empty">?</span>`}<span class="home-me-text">${me ? `You are <b>${esc(me.name)}</b>` : 'Who are you?'}</span>${icons.chevron}</button>
      <div class="home-me-pop" role="listbox" aria-label="You are" hidden>
        ${this.people.list().map((p) => `<button type="button" role="option" data-me="${esc(p.id)}" aria-selected="${p.id === this.people.me}">${avatar(p.name, p.colour)}<span class="home-me-name"><b>${esc(p.name)}</b><small>${esc(p.role || p.email || '')}</small></span>${p.id === this.people.me ? icons.check : ''}</button>`).join('') || '<p class="home-none">Nobody in the directory yet.</p>'}
        <div class="home-me-add" hidden><input type="text" data-role="me-name" placeholder="Your name" aria-label="Your name" spellcheck="false"><input type="email" data-role="me-email" placeholder="email (optional)" aria-label="Your email"><button type="button" data-act="me-add" class="primary">Add</button></div>
        <button type="button" class="home-me-new" data-act="me-new">${icons.plus}<span>Add me…</span></button>
        <p class="home-note">People live in this browser's directory. Share a project with File → Save; live sync is a later step.</p>
      </div>`;
  }
  _renderBody() {
    if (this.view === 'projects') {
      this.body.innerHTML = `<div class="home-tools">
          <label class="home-search">${icons.search}<input type="search" data-role="q" placeholder="Search projects" aria-label="Search projects" value="${esc(this.filters.q)}"></label>
          <div class="home-chips" role="group" aria-label="Status">${STATUS_CHIPS.map(([v, l]) => `<button type="button" class="hchip" data-status="${v}" aria-pressed="${v === this.filters.status}">${l}</button>`).join('')}</div>
          <select data-role="tag" aria-label="Tag"></select>
          <select data-role="member" aria-label="Member"></select>
          <select data-role="sort" aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}"${v === this.filters.sort ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <span class="grow"></span>
          <button type="button" class="primary home-new" data-act="new">${icons.plus}<span>New project</span></button>
        </div>
        <div class="home-grid" role="list"></div>`;
      const q = this.body.querySelector('[data-role="q"]');
      q.addEventListener('input', () => { this.filters.q = q.value; this._renderContent(); });
      for (const role of ['tag', 'member', 'sort']) this.body.querySelector(`[data-role="${role}"]`).addEventListener('change', (e) => { this.filters[role] = e.target.value; this._renderContent(); });
    } else if (this.view === 'tasks') {
      this.body.innerHTML = `<div class="home-tools">
          <div class="home-seg" role="group" aria-label="Scope"><button type="button" data-scope="project" aria-pressed="${this.tasks.scope === 'project'}" ${this.tasks.projectId ? '' : 'disabled'}>This project</button><button type="button" data-scope="all" aria-pressed="${this.tasks.scope === 'all'}">All projects</button></div>
          <label class="home-search">${icons.search}<input type="search" data-role="tq" placeholder="Search tasks" aria-label="Search tasks" value="${esc(this.tasks.q)}"></label>
          <span class="grow"></span><span class="home-count" data-role="count"></span>
        </div>
        <div class="home-table-wrap"><table class="home-table"><thead><tr>${COLUMNS.map(([k, l]) => `<th scope="col"><button type="button" data-sort="${k}">${l}<i class="sort-ic"></i></button></th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
      const q = this.body.querySelector('[data-role="tq"]');
      q.addEventListener('input', () => { this.tasks.q = q.value; this._renderContent(); });
    } else {
      this.body.innerHTML = `<div class="home-placeholder"><span class="modal-icon">${icons.timeline}</span><div><h2>Calendar comes in the next round</h2><p>Milestones, due dates and people's load by week will show here. Until then the Tasks view sorts by due date.</p></div></div>`;
    }
  }
  _renderContent() {
    if (!this.isOpen) return;
    if (this.view === 'projects') this._renderProjects();
    else if (this.view === 'tasks') this._renderTasks();
  }
  _renderProjects() {
    const grid = this.body.querySelector('.home-grid'); if (!grid) return;
    // the tag and member selects follow the data
    const tagSel = this.body.querySelector('[data-role="tag"]'), memSel = this.body.querySelector('[data-role="member"]');
    tagSel.innerHTML = `<option value="">Any tag</option>${this.tags.map((t) => `<option value="${esc(t)}"${t === this.filters.tag ? ' selected' : ''}>#${esc(t)}</option>`).join('')}`;
    memSel.innerHTML = `<option value="">Anyone</option>${this.members.map((p) => `<option value="${esc(p.id)}"${p.id === this.filters.member ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
    if (this.filters.tag && !this.tags.includes(this.filters.tag)) { this.filters.tag = ''; tagSel.value = ''; }
    for (const b of this.body.querySelectorAll('.hchip')) b.setAttribute('aria-pressed', String(b.dataset.status === this.filters.status));
    const list = this.filtered();
    if (!list.length) {
      const any = this.real.length;
      grid.innerHTML = `<div class="home-empty"><span class="modal-icon">${icons.file}</span><h2>${any ? 'No project matches' : 'No projects yet'}</h2><p>${any ? 'Try another status, tag or search.' : 'A project is a room of components with a name, a key, people and dates. Everything autosaves in this browser.'}</p>${any ? '' : `<button type="button" class="primary" data-act="new">${icons.plus}<span>New project</span></button>`}</div>`;
      return;
    }
    grid.innerHTML = list.map((p) => this._card(p, list.today)).join('');
  }
  _card(p, today) {
    const m = p.meta || {}, st = p.stats;
    const members = (m.members || []).map((x) => this.people.byId(x.personId)).filter(Boolean);
    const extra = st.people.filter((n) => !members.some((mm) => mm.name.toLowerCase() === n.toLowerCase())).map((n) => ({ name: n, colour: null }));
    const all = [...members, ...extra];
    const shown = all.slice(0, 4), more = all.length - shown.length;
    const due = m.due || st.nextDue;
    const pct = Math.round(st.doneRatio * 100);
    return `<article class="pcard${p.open ? ' open' : ''}${p.active ? ' active' : ''}" role="listitem" data-id="${esc(p.id)}" tabindex="0" style="--pc:${esc(m.colour || '#5aa9ff')}" aria-label="${esc(p.name || 'Untitled')}">
      <div class="pcard-thumb">${p.thumb ? `<img src="${p.thumb}" alt="">` : ''}<span class="pcard-key">${esc(m.key || '')}</span>${p.open ? `<span class="pcard-open" title="${p.active ? 'the active tab' : 'open in a tab'}"></span>` : ''}</div>
      <div class="pcard-body">
        <div class="pcard-row"><b class="pcard-name">${esc(p.name || 'Untitled')}</b><button type="button" class="pcard-more" data-act="more" aria-label="Project menu" aria-haspopup="menu">${icons.more}</button></div>
        ${m.description ? `<p class="pcard-desc">${esc(m.description)}</p>` : ''}
        <div class="pcard-tags"><span class="chip st-${esc(m.status || 'active').replace(' ', '-')}">${esc(m.status || 'active')}</span>${(m.tags || []).slice(0, 5).map((t) => `<span class="tagchip">#${esc(t)}</span>`).join('')}</div>
        <div class="pcard-foot">
          <div class="avatars">${shown.map((x) => avatar(x.name, x.colour || '#8e9bb1', x.name)).join('')}${more > 0 ? `<span class="avatar more">+${more}</span>` : ''}</div>
          <div class="pcard-prog" title="${st.done} of ${st.total} done${st.overdue ? ` · ${st.overdue} overdue` : ''}">${ring(st.doneRatio)}<span class="pcard-pct">${st.total ? `${pct} %` : '—'}</span></div>
          <div class="pcard-meta"><span class="${due && due < today && st.total && st.doneRatio < 1 ? 'overdue' : ''}">${due ? `next due ${esc(fmtDate(due))}` : 'no dates'}</span><span>opened ${esc(timeAgo(p.openedAt))}</span></div>
        </div>
      </div>
    </article>`;
  }
  _renderTasks() {
    const tbody = this.body.querySelector('tbody'); if (!tbody) return;
    for (const b of this.body.querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === this.tasks.scope));
    for (const b of this.body.querySelectorAll('[data-sort]')) { const on = b.dataset.sort === this.tasks.sort; b.classList.toggle('on', on); b.querySelector('.sort-ic').textContent = on ? (this.tasks.dir > 0 ? '↑' : '↓') : ''; b.closest('th').setAttribute('aria-sort', on ? (this.tasks.dir > 0 ? 'ascending' : 'descending') : 'none'); }
    const rows = this.taskRows(), today = isoToday();
    this.body.querySelector('[data-role="count"]').textContent = `${rows.length} task${rows.length === 1 ? '' : 's'} · ${rows.filter((r) => r.done).length} done · ${rows.filter((r) => !r.done && r.due && r.due < today).length} overdue`;
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="home-none">${this.tasks.scope === 'project' ? 'This project has no cards or tasks yet. Add a Kanban board or a Timeline.' : 'No tasks in any project yet.'}</td></tr>`; return; }
    tbody.innerHTML = rows.map((r) => `<tr class="${r.done ? 'done' : ''}" data-project="${esc(r.projectId)}" data-board="${esc(r.boardUid)}" data-task="${esc(r.id)}" tabindex="0" title="Open ${esc(r.project)} and select this card">
      <td class="t-title">${esc(r.title)}</td>
      <td class="t-project"><span class="pkey" style="--pc:${esc(r.colour || '#5aa9ff')}">${esc(r.key)}</span>${esc(r.project)}</td>
      <td>${esc(r.column)}</td>
      <td>${r.assignee ? `${avatar(r.assignee, this.people.byName(r.assignee)?.colour || '#8e9bb1')} ${esc(r.assignee)}` : '<span class="dim">—</span>'}</td>
      <td class="t-due${!r.done && r.due && r.due < today ? ' overdue' : ''}">${r.due ? esc(fmtDate(r.due)) : '<span class="dim">—</span>'}</td>
      <td><i class="pm-prio" style="background:${PRIORITY_COLOURS[r.priority] || PRIORITY_COLOURS.medium}"></i> ${esc(r.priority || 'medium')}</td>
    </tr>`).join('');
  }

  /* ---------- events ---------- */
  _click(e) {
    const t = e.target;
    const view = t.closest('[data-view]'); if (view) { this.setView(view.dataset.view); return; }
    const chip = t.closest('.hchip'); if (chip) { this.filters.status = chip.dataset.status; this._renderContent(); return; }
    const scope = t.closest('[data-scope]'); if (scope) { this.tasks.scope = scope.dataset.scope; this._renderContent(); return; }
    const sort = t.closest('[data-sort]'); if (sort) { const k = sort.dataset.sort; if (this.tasks.sort === k) this.tasks.dir *= -1; else { this.tasks.sort = k; this.tasks.dir = 1; } this._renderContent(); return; }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'new') { this.onNew(); return; }
      if (a === 'more') { e.stopPropagation(); this._menu(act, act.closest('.pcard').dataset.id); return; }
      if (a === 'me-new') { const row = this.head.querySelector('.home-me-add'); row.hidden = false; act.hidden = true; row.querySelector('input').focus(); return; }
      if (a === 'me-add') { const name = this.head.querySelector('[data-role="me-name"]').value.trim(); if (!name) { this.head.querySelector('[data-role="me-name"]').focus(); return; } const p = this.people.add({ name, email: this.head.querySelector('[data-role="me-email"]').value.trim(), role: '' }); this.people.setMe(p.id); this.toast(`You are ${p.name}`, 1400); return; }
      if (a.startsWith('menu:')) { const id = this._menuEl?.dataset.id; this._closeMenus(); this._menuAction(a.slice(5), id); return; }
    }
    const meBtn = t.closest('.home-me-btn');
    if (meBtn) { const pop = this.head.querySelector('.home-me-pop'); pop.hidden = !pop.hidden; meBtn.setAttribute('aria-expanded', String(!pop.hidden)); return; }
    const me = t.closest('[data-me]'); if (me) { this.people.setMe(me.dataset.me); this._closeMenus(); const p = this.people.byId(me.dataset.me); if (p) this.toast(`You are ${p.name}`, 1200); return; }
    if (t.closest('.home-me-pop')) return;
    const row = t.closest('tr[data-task]'); if (row) { this.onOpenTask({ projectId: row.dataset.project, boardUid: row.dataset.board, taskId: row.dataset.task }); return; }
    const card = t.closest('.pcard'); if (card && !t.closest('.pcard-more')) this._openProject(card.dataset.id);
  }
  _key(e) {
    const card = e.target.closest?.('.pcard'), row = e.target.closest?.('tr[data-task]');
    if ((e.key === 'Enter' || e.key === ' ') && (card || row) && e.target === (card || row)) { e.preventDefault(); if (card) this._openProject(card.dataset.id); else this.onOpenTask({ projectId: row.dataset.project, boardUid: row.dataset.board, taskId: row.dataset.task }); }
    else if (e.key === 'Enter' && e.target.dataset?.role === 'me-name') { e.preventDefault(); this.head.querySelector('[data-act="me-add"]').click(); }
    else if (e.key === 'ContextMenu' && card) { e.preventDefault(); this._menu(card.querySelector('.pcard-more'), card.dataset.id); }
  }
  async _openProject(id) {
    const rec = await this.store.getProject(id);
    if (!rec) { this.toast('That project is no longer in this browser', 1800); this.refresh(); return null; }
    const tab = this.tabs.openRecord(rec);
    if (tab) this.hide('open');
    return tab;
  }
  /** The ⋯ menu of a card. */
  _menu(anchor, id) {
    this._closeMenus();
    const p = this.projects.find((x) => x.id === id); if (!p) return;
    const archived = p.meta?.status === 'archived';
    const m = document.createElement('div'); m.className = 'home-menu'; m.setAttribute('role', 'menu'); m.dataset.id = id;
    m.innerHTML = [['open', icons.file, p.open ? 'Switch to tab' : 'Open'], ['edit', icons.edit, 'Edit…'], ['duplicate', icons.copy, 'Duplicate'], ['archive', icons.history, archived ? 'Unarchive' : 'Archive'], ['delete', icons.trash, 'Delete…', 'danger']]
      .map(([a, ic, l, cls]) => `<button type="button" role="menuitem" class="${cls || ''}" data-act="menu:${a}">${ic}<span>${l}</span></button>`).join('');
    this.el.appendChild(m);
    const r = anchor.getBoundingClientRect(), host = this.el.getBoundingClientRect();
    m.style.top = `${r.bottom - host.top + 4}px`; m.style.left = `${Math.min(r.right - host.left - m.offsetWidth, host.width - m.offsetWidth - 8)}px`;
    anchor.setAttribute('aria-expanded', 'true');
    this._menuEl = m; this._menuAnchor = anchor;
    m.querySelector('button')?.focus();
    m.addEventListener('keydown', (e) => { const items = [...m.querySelectorAll('button')], i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); } });
  }
  _closeMenus() {
    let closed = false;
    if (this._menuEl) { this._menuEl.remove(); this._menuAnchor?.setAttribute('aria-expanded', 'false'); this._menuAnchor?.focus?.(); this._menuEl = null; closed = true; }
    const pop = this.head.querySelector('.home-me-pop');
    if (pop && !pop.hidden) { pop.hidden = true; this.head.querySelector('.home-me-btn')?.setAttribute('aria-expanded', 'false'); closed = true; }
    return closed;
  }
  async _menuAction(act, id) {
    const p = this.projects.find((x) => x.id === id); if (!p) return;
    const name = p.name || 'Untitled';
    this._own = true; setTimeout(() => { this._own = false; }, 1500);
    if (act === 'open') this._openProject(id);
    else if (act === 'edit') this.onEdit(p);
    else if (act === 'duplicate') { const copy = await this.tabs.duplicateProject(id); this.toast(copy ? `Duplicated as ${copy.name}` : 'Could not duplicate', 1600); this.refresh(); }
    else if (act === 'archive') { const on = p.meta?.status !== 'archived'; await this.tabs.patchProject(id, { status: on ? 'archived' : 'active' }); this.toast(on ? `${name} archived · the Archived chip shows it` : `${name} is active again`, 1800); this.refresh(); }
    else if (act === 'delete') {
      const ok = await confirmDialog({ icon: icons.trash, title: `Delete ${name}?`, text: `${p.open ? 'Its tab closes and the' : 'The'} project and its ${p.nodes || 0} component${p.nodes === 1 ? '' : 's'} leave this browser with every version. Downloaded JSON files are not affected.`, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Delete', kind: 'danger', default: true }] });
      if (ok === 'ok') { await this.tabs.deleteProject(id); this.toast(`${name} deleted`, 1400); this.refresh(); }
    }
  }
}
