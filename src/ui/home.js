// ui/home.js — the Home page: a full view over the viewport area (the rail and the panel stay)
// behind the permanent first tab of the strip, Alt+H and File → Projects. Three views: Projects
// (a searchable, filterable grid of every project in this browser — thumbnail, key, status,
// tags, member avatars, a progress ring from the task index, next due, last opened, a ⋯ menu:
// Open · Edit… · Duplicate · Archive · Delete), Tasks (a sortable table over the task index of
// every project, of the active one or of mine; column, assignee, dates and priority edit inline,
// a chevron opens the card's activity — comments and time logs; New task adds a card to any
// project's board) and Calendar (a placeholder until the next round). At the right of the header
// the "You are …" picker sets who the viewer is in the people directory (pm/people.js).
// Presentation only: projects come from the store's listing (metadata + index, no documents),
// metadata edits go through Tabs (`patchProject`, `duplicateProject`, `deleteProject`) and the
// project dialog, task edits through `onWrite` (main.js `editTask`: the active tab's undoable
// commands, a background tab in place, a closed project's stored document).
//
//   new Home({ el, tabs, people, store, onNew, onEdit, onOpenTask, onWrite, onBoards, onCard, activeDoc, toast })
//   open(view?) / hide(reason) / toggle() / isOpen · onChange(open, reason) · refresh()
import { icons } from '../icons.js';
import { isTyping } from '../interaction.js';
import { PROJECT_STATUSES, projectStats, indexDoc, isoToday } from '../project-store.js';
import { fmtDate, PRIORITY_COLOURS, PRIORITIES, activity, loggedMinutes, estimateMinutes, fmtHours, newId, isoDate } from '../pm/model.js';
import { confirmDialog } from './confirm.js';
import { CalendarView } from './calendar.js';
import { timeAgo } from './tab-strip.js';
import { uiScale } from './ui-prefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIEWS = [['projects', 'Projects'], ['tasks', 'Tasks'], ['calendar', 'Calendar']];
const STATUS_CHIPS = [['all', 'All'], ...PROJECT_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])];
const SORTS = [['opened', 'Last opened'], ['name', 'Name'], ['due', 'Due'], ['progress', 'Progress']];
const COLUMNS = [['title', 'Task'], ['project', 'Project'], ['column', 'Column'], ['assignee', 'Assignee'], ['start', 'Start'], ['due', 'Due'], ['priority', 'Priority'], ['logged', 'Logged / est'], ['comments', '']];
const BUBBLE = '<svg viewBox="0 0 24 24" aria-label="comments"><path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>';
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
/** An avatar disc: initials in a colour. */
export const avatar = (name, colour, title = name) => `<span class="avatar" style="--av:${esc(colour || '#8e9bb1')}" title="${esc(title)}">${esc(initialsOf(name))}</span>`;
const initialsOf = (name) => String(name || '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
const ring = (ratio, size = 30) => { const r = (size - 4) / 2, c = 2 * Math.PI * r; return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, ratio)))).toFixed(1)}"/></svg>`; };

export class Home {
  constructor({ el, tabs, people, store, onNew = () => {}, onEdit = () => {}, onOpenTask = () => {}, onOpenNode = () => {}, onWrite = async () => null, onBoards = async () => [], onCard = async () => null, activeDoc = null, onChange = () => {}, toast = () => {} }) {
    Object.assign(this, { el, tabs, people, store, onNew, onEdit, onOpenTask, onOpenNode, onWrite, onBoards, onCard, activeDoc, onChange, toast });
    this.calendar = new CalendarView({ home: this });
    this.view = 'projects';
    this.filters = { q: '', status: 'all', tag: '', member: '', sort: 'opened' };
    this.tasks = { scope: 'all', q: '', sort: 'due', dir: 1, projectId: null, expanded: null, newOpen: false, newDue: '' };
    this.projects = [];            // the store's listing, merged with the open tabs
    this._activeAtOpen = null;
    this.el.hidden = true; this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `<div class="home-wrap"><header class="home-head"></header><div class="home-body"></div></div>`;
    this.head = this.el.querySelector('.home-head'); this.body = this.el.querySelector('.home-body');
    this.el.addEventListener('click', (e) => this._click(e));
    this.el.addEventListener('change', (e) => this._change(e));
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
    this.projects = list.map((p) => { const tab = this.tabs.byId(p.id); const index = this._indexOf(p.id, tab, p); return { ...p, index, name: tab ? tab.name : p.name, meta: tab ? tab.meta : p.meta, dirty: tab ? tab.dirty : !!p.dirty, open: !!tab, active: p.id === this.tabs.activeId, stats: projectStats({ index }) }; });
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
  /** A project's task index: the live scene for the active tab (`activeDoc`), a background tab's document, else the stored index. */
  _indexOf(id, tab = this.tabs.byId(id), rec = null) {
    if (tab && tab.id === this.tabs.activeId && this.activeDoc) { try { return indexDoc(this.activeDoc()); } catch (_) { /* fall through */ } }
    if (tab?.doc) return indexDoc(tab.doc);
    return rec?.index || this.projects.find((p) => p.id === id)?.index || { tasks: [], boards: [], milestones: [] };
  }
  get meName() { return this.people.mePerson?.name || ''; }
  /** The task rows of the Tasks view: every non-archived project, the scoped one, or mine (assignee = me). */
  taskRows() {
    const t = this.tasks, q = t.q.trim().toLowerCase(), me = this.meName;
    const src = t.scope === 'project' && t.projectId ? this.projects.filter((p) => p.id === t.projectId) : this.projects.filter((p) => p.meta?.status !== 'archived');
    const rows = [];
    for (const p of src) {
      const idx = p.index || { tasks: [], boards: [] };
      for (const k of idx.tasks || []) {
        if (t.scope === 'mine' && !sameName(k.assignee, me)) continue;
        rows.push({ ...k, projectId: p.id, project: p.name || 'Untitled', key: p.meta?.key || '', colour: p.meta?.colour, columns: (idx.boards || []).find((b) => b.uid === k.boardUid)?.columns || [] });
      }
    }
    const out = q ? rows.filter((r) => `${r.title} ${r.project} ${r.assignee} ${r.column}`.toLowerCase().includes(q)) : rows;
    const dir = t.dir, k = t.sort;
    const val = (r) => (k === 'due' || k === 'start' ? r[k] || '9999' : k === 'priority' ? PRIORITY_RANK[r.priority] ?? 9 : k === 'column' ? `${r.columnIndex}` : k === 'logged' || k === 'comments' ? -(r[k] || 0) : String(r[k] || '').toLowerCase());
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
      const me = this.meName;
      this.body.innerHTML = `<div class="home-tools">
          <div class="home-seg" role="group" aria-label="Scope"><button type="button" data-scope="project" aria-pressed="${this.tasks.scope === 'project'}" ${this.tasks.projectId ? '' : 'disabled'}>This project</button><button type="button" data-scope="all" aria-pressed="${this.tasks.scope === 'all'}">All</button><button type="button" data-scope="mine" aria-pressed="${this.tasks.scope === 'mine'}" ${me ? '' : 'disabled'} title="${me ? `Tasks assigned to ${esc(me)}` : 'Pick who you are (top right) first'}">Mine</button></div>
          <label class="home-search">${icons.search}<input type="search" data-role="tq" placeholder="Search tasks" aria-label="Search tasks" value="${esc(this.tasks.q)}"></label>
          <span class="grow"></span><span class="home-count" data-role="count"></span>
          <button type="button" class="primary home-newtask-btn" data-act="newtask" aria-expanded="${this.tasks.newOpen}">${icons.plus}<span>New task</span></button>
        </div>
        <form class="home-newtask" data-role="newtask" ${this.tasks.newOpen ? '' : 'hidden'}><select data-role="nt-project" aria-label="Project"></select><select data-role="nt-board" aria-label="Board"></select><select data-role="nt-column" aria-label="Column"></select><input type="text" data-role="nt-title" placeholder="Task title" aria-label="Task title" spellcheck="false"><input type="date" data-role="nt-due" aria-label="Due" value="${esc(this.tasks.newDue)}"><button type="submit" class="primary">Add</button></form>
        <div class="home-table-wrap"><table class="home-table"><thead><tr>${COLUMNS.map(([k, l]) => `<th scope="col"><button type="button" data-sort="${k}">${l || BUBBLE}<i class="sort-ic"></i></button></th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
      const q = this.body.querySelector('[data-role="tq"]');
      q.addEventListener('input', () => { this.tasks.q = q.value; this._renderContent(); });
      this.body.querySelector('[data-role="newtask"]').addEventListener('submit', (e) => { e.preventDefault(); this._addTask(); });
      if (this.tasks.newOpen) this._fillNewTask();
    } else this.calendar.mount(this.body);
  }
  _renderContent() {
    if (!this.isOpen) return;
    if (this.view === 'projects') this._renderProjects();
    else if (this.view === 'tasks') this._renderTasks();
    else this.calendar.render();
  }
  /** A day cell's "+" on the calendar: the Tasks view's New task bar with the due date prefilled. */
  newTaskOn(date) { this.tasks.newOpen = true; this.tasks.newDue = date || ''; this.setView('tasks'); }
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
    this._renderTasksRows();
  }
  _renderTasksRows() {
    const tbody = this.body.querySelector('tbody'); if (!tbody) return;
    const rows = this.taskRows(), today = isoToday();
    const mineBtn = this.body.querySelector('[data-scope="mine"]'); if (mineBtn) mineBtn.disabled = !this.meName;
    this.body.querySelector('[data-role="count"]').textContent = `${rows.length} task${rows.length === 1 ? '' : 's'} · ${rows.filter((r) => r.done).length} done · ${rows.filter((r) => !r.done && r.due && r.due < today).length} overdue · ${fmtHours(rows.reduce((a, r) => a + (r.logged || 0), 0))} logged`;
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="home-none">${this.tasks.scope === 'project' ? 'This project has no cards or tasks yet. Add a Kanban board or a Timeline.' : this.tasks.scope === 'mine' ? `Nothing is assigned to ${esc(this.meName)}.` : 'No tasks in any project yet.'}</td></tr>`; return; }
    const names = this.people.list().map((p) => p.name);
    const ex = this.tasks.expanded;
    tbody.innerHTML = rows.map((r) => {
      const open = ex && ex.projectId === r.projectId && ex.boardUid === r.boardUid && ex.taskId === r.id;
      const aOpts = [...new Set([...names, ...(r.assignee && !names.some((n) => sameName(n, r.assignee)) ? [r.assignee] : [])])];
      const est = Math.round((r.estimate || 0) * 8 * 60);
      return `<tr class="${r.done ? 'done' : ''}${open ? ' expanded' : ''}" data-project="${esc(r.projectId)}" data-board="${esc(r.boardUid)}" data-task="${esc(r.id)}" data-kind="${esc(r.kind || 'card')}" data-pname="${esc(r.project)}" tabindex="0">
      <td class="t-title"><button type="button" class="t-exp" data-act="expand" aria-expanded="${open}" aria-label="Activity">${icons.chevron}</button><span class="t-open" title="Open ${esc(r.project)} and select this card">${esc(r.title)}</span></td>
      <td class="t-project t-open" title="Open ${esc(r.project)}"><span class="pkey" style="--pc:${esc(r.colour || '#5aa9ff')}">${esc(r.key)}</span>${esc(r.project)}</td>
      <td><select data-edit="column" aria-label="Column">${r.columns.map((c) => `<option value="${esc(c.id)}"${c.title === r.column ? ' selected' : ''}>${esc(c.title)}</option>`).join('') || `<option>${esc(r.column)}</option>`}</select></td>
      <td class="t-assignee">${r.assignee ? avatar(r.assignee, this.people.byName(r.assignee)?.colour || '#8e9bb1') : ''}<select data-edit="assignee" aria-label="Assignee"><option value="">—</option>${aOpts.map((n) => `<option value="${esc(n)}"${sameName(n, r.assignee) ? ' selected' : ''}>${esc(n)}</option>`).join('')}<option value="__other">Other…</option></select></td>
      <td><input type="date" data-edit="start" value="${esc(r.start || '')}" aria-label="Start"></td>
      <td class="t-due${!r.done && r.due && r.due < today ? ' overdue' : ''}"><input type="date" data-edit="due" value="${esc(r.due || '')}" aria-label="Due"></td>
      <td><i class="pm-prio" style="background:${PRIORITY_COLOURS[r.priority] || PRIORITY_COLOURS.medium}"></i><select data-edit="priority" aria-label="Priority">${PRIORITIES.map((p) => `<option value="${p}"${p === (r.priority || 'medium') ? ' selected' : ''}>${p}</option>`).join('')}</select></td>
      <td class="t-time${est && r.logged > est ? ' overdue' : ''}">${r.logged ? `${CLOCK}${esc(fmtHours(r.logged))}` : '<span class="dim">—</span>'}<span class="dim"> / ${esc(fmtHours(est))}</span></td>
      <td class="t-com">${r.comments ? `${BUBBLE}${r.comments}` : ''}</td>
    </tr>${open ? `<tr class="t-detail" data-project="${esc(r.projectId)}" data-board="${esc(r.boardUid)}" data-task="${esc(r.id)}"><td colspan="${COLUMNS.length}"><div class="t-panel" data-role="panel">Loading…</div></td></tr>` : ''}`;
    }).join('');
    if (ex) this._renderDetail();
  }
  /* ---------- the expanded row: activity, comment, time ---------- */
  async _renderDetail() {
    const ex = this.tasks.expanded; if (!ex) return;
    const el = this.body.querySelector('.t-detail [data-role="panel"]'); if (!el) return;
    const card = await this.onCard(ex);
    if (!card || this.tasks.expanded !== ex) return;
    const me = this.meName;
    const who = (w) => { const p = this.people.byName(w); return avatar(w || '?', p?.colour || '#8e9bb1'); };
    const est = estimateMinutes(card), lg = loggedMinutes(card);
    el.innerHTML = `<div class="t-panel-cols">
      <section><h3>Activity</h3>
        ${me ? '' : this._identityHtml()}
        <ul class="t-feed">${activity(card).map((a) => `<li class="${a.kind}">${a.who ? who(a.who) : '<span class="avatar empty">·</span>'}<div><small>${esc(a.who || 'card')} · ${esc(timeAgo(new Date(a.at).getTime()))}</small><span>${esc(a.text)}</span></div>${a.kind === 'comment' && me && a.who === me ? `<button type="button" class="t-x" data-act="del-comment" data-id="${esc(a.id)}" aria-label="Delete comment">${icons.close}</button>` : ''}</li>`).join('')}</ul>
        <div class="t-comment"><textarea data-role="comment" rows="2" placeholder="${me ? `Comment as ${esc(me)} · Ctrl+Enter sends` : 'Pick who you are first'}" ${me ? '' : 'disabled'}></textarea><button type="button" data-act="comment" ${me ? '' : 'disabled'}>Comment</button></div>
      </section>
      <section><h3>Time</h3>
        <p class="t-logged">${esc(fmtHours(lg))} logged · estimate ${card.estimate ?? 0}d (${esc(fmtHours(est))})</p>
        <div class="pm-bar${est && lg > est ? ' over' : ''}"><i style="width:${Math.min(100, est ? lg / est * 100 : lg ? 100 : 0).toFixed(1)}%"></i></div>
        <div class="t-log"><input type="number" data-role="hours" step="0.25" min="0" value="1" aria-label="Hours"><input type="date" data-role="date" value="${isoDate()}" aria-label="Date"><input type="text" data-role="note" placeholder="note" aria-label="Note"><button type="button" data-act="log" ${me ? '' : 'disabled'}>Log time</button></div>
        <ul class="t-logs">${[...(card.timeLogs || [])].reverse().map((t) => `<li>${who(t.who)}<span>${esc(t.who || '—')} · ${esc(fmtDate(t.date))} · <b>${esc(fmtHours(t.minutes))}</b>${t.note ? ` · ${esc(t.note)}` : ''}</span><button type="button" class="t-x" data-act="del-log" data-id="${esc(t.id)}" aria-label="Remove entry">${icons.close}</button></li>`).join('') || '<li class="dim">No time logged yet.</li>'}</ul>
      </section></div>`;
    el.querySelector('[data-role="comment"]')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this._detailAction('comment', el); } });
    el.dataset.card = JSON.stringify({ comments: card.comments || [], timeLogs: card.timeLogs || [] });
  }
  _identityHtml() { return `<div class="t-who"><select data-role="who" aria-label="You are"><option value="">You are…</option>${this.people.list().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="+">Add me…</option></select><input type="text" data-role="who-name" placeholder="Your name" hidden><button type="button" data-act="who-add" hidden>Add</button></div>`; }
  async _detailAction(act, el, id = null) {
    const ex = this.tasks.expanded; if (!ex) return;
    const cur = JSON.parse(el.dataset.card || '{"comments":[],"timeLogs":[]}');
    const me = this.meName, row = this.body.querySelector(`tr[data-task="${ex.taskId}"][data-board="${ex.boardUid}"]`);
    const write = (patch, label) => this.onWrite({ ...ex, project: row?.dataset.pname, op: 'update', patch, label });
    if (act === 'comment') { const ta = el.querySelector('[data-role="comment"]'); const t = ta.value.trim(); if (!t || !me) return; await write({ comments: [...cur.comments, { id: newId('m'), who: me, at: new Date().toISOString(), text: t }] }, 'Comment'); }
    else if (act === 'del-comment') await write({ comments: cur.comments.filter((c) => c.id !== id) }, 'Delete comment');
    else if (act === 'log') { const h = parseFloat(el.querySelector('[data-role="hours"]').value); if (!(h > 0) || !me) return; await write({ timeLogs: [...cur.timeLogs, { id: newId('l'), who: me, at: new Date().toISOString(), date: el.querySelector('[data-role="date"]').value || isoDate(), minutes: Math.round(h * 60), note: el.querySelector('[data-role="note"]').value.trim() }] }, `Log ${fmtHours(Math.round(h * 60))}`); }
    else if (act === 'del-log') await write({ timeLogs: cur.timeLogs.filter((t) => t.id !== id) }, 'Remove time entry');
    else return;
    this.refresh();
  }
  /* ---------- New task ---------- */
  async _fillNewTask(projectId = null) {
    const form = this.body.querySelector('[data-role="newtask"]'); if (!form) return;
    const ps = form.querySelector('[data-role="nt-project"]'), bs = form.querySelector('[data-role="nt-board"]'), cs = form.querySelector('[data-role="nt-column"]');
    const list = this.real.filter((p) => p.meta?.status !== 'archived');
    const want = projectId || ps.value || (this.tasks.scope === 'project' && this.tasks.projectId) || this.tabs.activeId;
    const pid = list.some((p) => p.id === want) ? want : list[0]?.id;
    ps.innerHTML = list.map((p) => `<option value="${esc(p.id)}"${p.id === pid ? ' selected' : ''}>${esc(p.name || 'Untitled')}${p.open ? ' · open' : ''}</option>`).join('') || '<option value="">No project</option>';
    const boards = pid ? await this.onBoards(pid) : [];
    if (ps.value !== pid && pid) return;
    const bid = boards.some((b) => b.uid === bs.value) ? bs.value : boards[0]?.uid;
    bs.innerHTML = boards.map((b) => `<option value="${esc(b.uid)}"${b.uid === bid ? ' selected' : ''}>${esc(b.title)}</option>`).join('') || '<option value="">No board in this project</option>';
    const cols = boards.find((b) => b.uid === bid)?.columns || [];
    cs.innerHTML = cols.map((c, i) => `<option value="${esc(c.id)}"${i === 0 ? ' selected' : ''}>${esc(c.title)}</option>`).join('');
    form.querySelector('button[type="submit"]').disabled = !bid;
  }
  async _addTask() {
    const form = this.body.querySelector('[data-role="newtask"]'); if (!form) return;
    const projectId = form.querySelector('[data-role="nt-project"]').value, boardUid = form.querySelector('[data-role="nt-board"]').value, column = form.querySelector('[data-role="nt-column"]').value;
    const titleEl = form.querySelector('[data-role="nt-title"]'), title = titleEl.value.trim();
    if (!projectId || !boardUid) return;
    if (!title) { titleEl.focus(); return; }
    const p = this.projects.find((x) => x.id === projectId);
    const due = form.querySelector('[data-role="nt-due"]')?.value || '';
    const r = await this.onWrite({ projectId, boardUid, op: 'add', column, title, patch: due ? { due } : null, project: p?.name || 'Untitled' });
    if (!r) { this.toast('Could not add the task', 1600); return; }
    titleEl.value = ''; this.tasks.newDue = '';
    this.toast(`Added "${title}" to ${p?.name || 'the project'}${r.mode === 'active' ? ' · Ctrl+Z undoes' : ''}`, 1600);
    this.refresh();
  }
  /** An inline edit in a row: column (move), assignee (with "Other…" → free text), start / due, priority. */
  async _change(e) {
    const t = e.target, edit = t.dataset.edit;
    if (t.dataset.role === 'nt-project') { this._fillNewTask(t.value); return; }
    if (t.dataset.role === 'nt-board') { this._fillNewTask(); return; }
    if (t.dataset.role === 'who') { if (t.value === '+') { const n = t.parentElement.querySelector('[data-role="who-name"]'); n.hidden = false; t.parentElement.querySelector('[data-act="who-add"]').hidden = false; n.focus(); } else if (t.value) { this.people.setMe(t.value); this._renderTasks(); } return; }
    if (!edit) return;
    const row = t.closest('tr[data-task]'); if (!row) return;
    const ctx = { projectId: row.dataset.project, boardUid: row.dataset.board, taskId: row.dataset.task, project: row.dataset.pname };
    if (edit === 'assignee' && t.value === '__other') {
      const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Name'; inp.setAttribute('aria-label', 'Assignee'); inp.dataset.free = 'assignee';
      t.replaceWith(inp); inp.focus();
      const done = async () => { const v = inp.value.trim(); if (v) await this.onWrite({ ...ctx, op: 'update', patch: { assignee: v }, label: 'Assign card' }); this.refresh(); };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(); } else if (ev.key === 'Escape') { ev.stopPropagation(); this._renderTasks(); } });
      inp.addEventListener('blur', done);
      return;
    }
    let r = null;
    if (edit === 'column') r = await this.onWrite({ ...ctx, op: 'move', column: t.value });
    else r = await this.onWrite({ ...ctx, op: 'update', patch: { [edit]: t.value }, label: edit === 'assignee' ? 'Assign card' : edit === 'priority' ? 'Set priority' : `Set ${edit} date` });
    if (!r) this.toast('Could not save that change', 1600);
    this.refresh();
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
      if (a === 'newtask') { this.tasks.newOpen = !this.tasks.newOpen; const f = this.body.querySelector('[data-role="newtask"]'); f.hidden = !this.tasks.newOpen; act.setAttribute('aria-expanded', String(this.tasks.newOpen)); if (this.tasks.newOpen) { this._fillNewTask().then(() => f.querySelector('[data-role="nt-title"]')?.focus()); } return; }
      if (a === 'expand') { const row = act.closest('tr'); const ex = { projectId: row.dataset.project, boardUid: row.dataset.board, taskId: row.dataset.task }; const same = this.tasks.expanded && this.tasks.expanded.taskId === ex.taskId && this.tasks.expanded.boardUid === ex.boardUid; this.tasks.expanded = same ? null : ex; this._renderTasks(); return; }
      if (a === 'comment' || a === 'log' || a === 'del-comment' || a === 'del-log') { this._detailAction(a, act.closest('[data-role="panel"]'), act.dataset.id); return; }
      if (a === 'who-add') { const n = act.parentElement.querySelector('[data-role="who-name"]').value.trim(); if (!n) return; const p = this.people.byName(n) || this.people.add({ name: n }); this.people.setMe(p.id); this._renderTasks(); return; }
      if (a === 'more') { e.stopPropagation(); this._menu(act, act.closest('.pcard').dataset.id); return; }
      if (a === 'me-new') { const row = this.head.querySelector('.home-me-add'); row.hidden = false; act.hidden = true; row.querySelector('input').focus(); return; }
      if (a === 'me-add') { const name = this.head.querySelector('[data-role="me-name"]').value.trim(); if (!name) { this.head.querySelector('[data-role="me-name"]').focus(); return; } const p = this.people.add({ name, email: this.head.querySelector('[data-role="me-email"]').value.trim(), role: '' }); this.people.setMe(p.id); this.toast(`You are ${p.name}`, 1400); return; }
      if (a.startsWith('menu:')) { const id = this._menuEl?.dataset.id; this._closeMenus(); this._menuAction(a.slice(5), id); return; }
    }
    const meBtn = t.closest('.home-me-btn');
    if (meBtn) { const pop = this.head.querySelector('.home-me-pop'); pop.hidden = !pop.hidden; meBtn.setAttribute('aria-expanded', String(!pop.hidden)); return; }
    const me = t.closest('[data-me]'); if (me) { this.people.setMe(me.dataset.me); this._closeMenus(); const p = this.people.byId(me.dataset.me); if (p) this.toast(`You are ${p.name}`, 1200); return; }
    if (t.closest('.home-me-pop')) return;
    if (t.closest('select, input, textarea, .t-detail')) return;   // inline editors and the expanded panel keep the click
    const row = t.closest('tr[data-task]'); if (row && t.closest('.t-open')) { this.onOpenTask({ projectId: row.dataset.project, boardUid: row.dataset.board, taskId: row.dataset.task }); return; }
    const card = t.closest('.pcard'); if (card && !t.closest('.pcard-more')) this._openProject(card.dataset.id);
  }
  _key(e) {
    const card = e.target.closest?.('.pcard'), row = e.target.closest?.('tr[data-task]:not(.t-detail)');
    if (e.key === 'Enter' && e.target.dataset?.role === 'who-name') { e.preventDefault(); e.target.parentElement.querySelector('[data-act="who-add"]').click(); return; }
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
    const s = uiScale(), r = anchor.getBoundingClientRect(), host = this.el.getBoundingClientRect();   // Home is drawn at the UI scale: screen px / scale
    m.style.top = `${(r.bottom - host.top) / s + 4}px`; m.style.left = `${Math.min((r.right - host.left) / s - m.offsetWidth, host.width / s - m.offsetWidth - 8)}px`;
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
