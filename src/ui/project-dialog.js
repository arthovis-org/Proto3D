// ui/project-dialog.js — Create / Edit Project on the modal shell (like Connections): name, key
// (auto-derived from the name, editable, unique among the projects in this browser), description,
// colour (eight swatches + custom), status, start / due dates, tags (a chip input: Enter or comma
// adds, × removes), People (a searchable list of the directory with a checkbox and a role per
// checked person, plus an inline "Add person" row that creates the directory entry and checks it)
// and, for Create only, "Start from" (Blank, the starter templates, the Showcase). The dialog
// validates and hands the result to main.js (`onCreate({ name, meta, template })`) or writes the
// edit through `tabs.patchProject`. Esc closes, Tab cycles, Enter in a text field submits.
//   new ProjectDialog({ tabs, people, templates, showcase, onCreate, toast })
//   create() · edit(rec) · close() · isOpen
import { icons } from '../icons.js';
import { PROJECT_STATUSES, MEMBER_ROLES, PROJECT_COLOURS, deriveKey, uniqueKey, normalizeMeta } from '../project-store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export class ProjectDialog {
  constructor({ tabs, people, templates = [], showcase = null, onCreate = () => {}, toast = () => {} }) {
    Object.assign(this, { tabs, people, templates, showcase, onCreate, toast });
    this.el = document.createElement('div');
    this.el.id = 'project-dialog'; this.el.className = 'modal-backdrop'; this.el.hidden = true;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-labelledby', 'pd-title');
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    window.addEventListener('keydown', (e) => { if (this.el.hidden) return; if (e.key === 'Escape') { e.stopPropagation(); this.close(); } else if (e.key === 'Enter' && e.target.matches?.('input:not([data-role="tag"]):not([data-role="np-name"]):not([data-role="np-email"])')) { e.preventDefault(); this._submit(); } }, true);
    this.people.onChange(() => { if (!this.el.hidden) this._renderPeople(); });
    this.state = null;
  }
  get isOpen() { return !this.el.hidden; }
  /** Create: a fresh form (the untouched key follows the name). */
  async create() { await this._open({ mode: 'create', id: null, name: '', meta: normalizeMeta({}, {}), template: this.templates[0]?.id || 'blank' }); }
  /** Edit: a stored or open project's record ({ id, name, meta }). */
  async edit(rec) { if (!rec) return; await this._open({ mode: 'edit', id: rec.id, name: rec.name || '', meta: normalizeMeta(rec.meta || {}, { id: rec.id, name: rec.name }) }); }
  async _open(state) {
    this._prev = document.activeElement;
    this.state = { ...state, keyTouched: state.mode === 'edit', tags: [...state.meta.tags], members: new Map(state.meta.members.map((m) => [m.personId, m.role])), q: '', error: '' };
    this.state.keys = await this.tabs.projectKeys(state.id);
    if (state.mode === 'create') this.state.meta.key = uniqueKey(deriveKey(state.name) || 'PR', this.state.keys);
    this.el.hidden = false;
    this.render();
    setTimeout(() => this.el.querySelector('[data-role="name"]')?.focus(), 30);
  }
  close() { this.el.hidden = true; this.state = null; this._prev?.focus?.(); }

  render() {
    const S = this.state, m = S.meta, create = S.mode === 'create';
    this.el.innerHTML = `<div class="modal project-dialog">
      <header class="modal-head">
        <span class="modal-icon">${icons.project}</span>
        <div><h2 id="pd-title">${create ? 'New project' : 'Project settings'}</h2><p>${create ? 'A project is one room of components plus this card: a key, people, dates and tags. It autosaves in this browser.' : 'Changes apply to the project in this browser and travel in the JSON you save.'}</p></div>
        <button type="button" class="modal-close" aria-label="Close">${icons.close}</button>
      </header>
      <div class="modal-body pd-body">
        <div class="pd-grid">
          <label class="field pd-name"><span>Name</span><input type="text" data-role="name" value="${esc(S.name)}" placeholder="Website relaunch" spellcheck="false" autocomplete="off" required></label>
          <label class="field pd-key"><span>Key</span><input type="text" data-role="key" value="${esc(m.key)}" maxlength="6" spellcheck="false" autocomplete="off" aria-describedby="pd-key-hint"><small class="field-hint" id="pd-key-hint">2–6 letters or digits, unique here</small></label>
          <label class="field pd-desc"><span>Description</span><textarea data-role="description" rows="2" placeholder="What this project is for">${esc(m.description)}</textarea></label>
          <div class="field pd-colour"><span>Colour</span><div class="pd-swatches" role="radiogroup" aria-label="Colour">${PROJECT_COLOURS.map((c) => `<button type="button" class="swatch${c.toLowerCase() === m.colour.toLowerCase() ? ' on' : ''}" data-colour="${c}" style="--sw:${c}" role="radio" aria-checked="${c.toLowerCase() === m.colour.toLowerCase()}" aria-label="${c}"></button>`).join('')}<label class="swatch custom${PROJECT_COLOURS.some((c) => c.toLowerCase() === m.colour.toLowerCase()) ? '' : ' on'}" title="Custom colour" style="--sw:${esc(m.colour)}"><input type="color" data-role="colour" value="${esc(m.colour)}" aria-label="Custom colour"></label></div></div>
          <label class="field pd-status"><span>Status</span><select data-role="status">${PROJECT_STATUSES.map((s) => `<option value="${s}"${s === m.status ? ' selected' : ''}>${cap(s)}</option>`).join('')}</select></label>
          <label class="field pd-start"><span>Start</span><input type="date" data-role="start" value="${esc(m.start)}"></label>
          <label class="field pd-due"><span>Due</span><input type="date" data-role="due" value="${esc(m.due)}"></label>
          <div class="field pd-tags"><span>Tags</span><div class="chip-input" data-role="tagbox"><span class="chip-list"></span><input type="text" data-role="tag" placeholder="add a tag, Enter or comma" aria-label="Add a tag" spellcheck="false" autocomplete="off"></div></div>
          ${create ? `<label class="field pd-from"><span>Start from</span><select data-role="template"><option value="blank">Blank project</option>${this.templates.map((t) => `<option value="${esc(t.id)}"${t.id === S.template ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}${this.showcase ? `<option value="${esc(this.showcase.id)}">${esc(this.showcase.label)} (the full example)</option>` : ''}</select></label>` : ''}
        </div>
        <section class="pd-people">
          <div class="pd-people-head"><span class="field-label">People</span><label class="home-search pd-search">${icons.search}<input type="search" data-role="pq" placeholder="Search the directory" aria-label="Search the directory"></label></div>
          <div class="pd-list" role="group" aria-label="Members"></div>
          <div class="pd-add"><input type="text" data-role="np-name" placeholder="Name" aria-label="New person's name" spellcheck="false"><input type="email" data-role="np-email" placeholder="email (optional)" aria-label="New person's email"><select data-role="np-role" aria-label="New person's role">${MEMBER_ROLES.map((r) => `<option value="${r}"${r === 'member' ? ' selected' : ''}>${cap(r)}</option>`).join('')}</select><button type="button" data-act="np-add">${icons.plus}<span>Add person</span></button></div>
          <p class="home-note">People live in this browser's directory. Share a project with File → Save; live sync is a later step.</p>
        </section>
      </div>
      <footer class="modal-foot pd-foot"><span class="pd-error" role="alert"></span><span class="grow"></span><button type="button" class="ghost" data-act="cancel">Cancel</button><button type="button" class="primary" data-act="submit">${create ? 'Create project' : 'Save'}</button></footer>
    </div>`;
    this._bind();
    this._renderTags(); this._renderPeople();
  }
  _bind() {
    const q = (sel) => this.el.querySelector(sel), S = this.state;
    q('.modal-close').addEventListener('click', () => this.close());
    q('[data-act="cancel"]').addEventListener('click', () => this.close());
    q('[data-act="submit"]').addEventListener('click', () => this._submit());
    const name = q('[data-role="name"]'), key = q('[data-role="key"]');
    name.addEventListener('input', () => { S.name = name.value; if (!S.keyTouched) { key.value = uniqueKey(deriveKey(name.value), S.keys); } this._error(''); });
    key.addEventListener('input', () => { S.keyTouched = true; key.value = key.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); this._error(''); });
    key.addEventListener('blur', () => { if (!key.value) { S.keyTouched = false; key.value = uniqueKey(deriveKey(name.value), S.keys); } });
    for (const b of this.el.querySelectorAll('.swatch[data-colour]')) b.addEventListener('click', () => this._setColour(b.dataset.colour));
    q('[data-role="colour"]').addEventListener('input', (e) => this._setColour(e.target.value, true));
    const tag = q('[data-role="tag"]');
    tag.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); this._addTag(tag.value); tag.value = ''; }
      else if (e.key === 'Backspace' && !tag.value && S.tags.length) { S.tags.pop(); this._renderTags(); }
    });
    tag.addEventListener('blur', () => { if (tag.value.trim()) { this._addTag(tag.value); tag.value = ''; } });
    q('[data-role="tagbox"]').addEventListener('click', (e) => { const x = e.target.closest('[data-tag]'); if (x) { S.tags = S.tags.filter((t) => t !== x.dataset.tag); this._renderTags(); } else tag.focus(); });
    q('[data-role="pq"]').addEventListener('input', (e) => { S.q = e.target.value; this._renderPeople(); });
    q('[data-act="np-add"]').addEventListener('click', () => this._addPerson());
    q('[data-role="np-name"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._addPerson(); } });
    q('[data-role="np-email"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._addPerson(); } });
    q('.pd-list').addEventListener('change', (e) => {
      const row = e.target.closest('[data-person]'); if (!row) return;
      const id = row.dataset.person;
      if (e.target.type === 'checkbox') { if (e.target.checked) S.members.set(id, row.querySelector('select').value); else S.members.delete(id); }
      else if (e.target.tagName === 'SELECT' && S.members.has(id)) S.members.set(id, e.target.value);
      row.classList.toggle('on', S.members.has(id)); row.querySelector('select').disabled = !S.members.has(id);
    });
  }
  _setColour(c, custom = false) {
    this.state.meta.colour = c;
    for (const b of this.el.querySelectorAll('.swatch[data-colour]')) { const on = !custom && b.dataset.colour.toLowerCase() === c.toLowerCase(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const cust = this.el.querySelector('.swatch.custom'); cust.classList.toggle('on', custom || !PROJECT_COLOURS.some((x) => x.toLowerCase() === c.toLowerCase())); cust.style.setProperty('--sw', c);
    if (!custom) this.el.querySelector('[data-role="colour"]').value = c;
  }
  _addTag(v) {
    for (const t of String(v).split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean)) if (!this.state.tags.includes(t)) this.state.tags.push(t);
    this._renderTags();
  }
  _renderTags() {
    this.el.querySelector('.chip-list').innerHTML = this.state.tags.map((t) => `<span class="tagchip rm">#${esc(t)}<button type="button" data-tag="${esc(t)}" aria-label="Remove ${esc(t)}">${icons.close}</button></span>`).join('');
  }
  _renderPeople() {
    const list = this.el.querySelector('.pd-list'); if (!list) return;
    const S = this.state, q = S.q.trim().toLowerCase();
    const all = this.people.list().filter((p) => !q || `${p.name} ${p.email} ${p.role}`.toLowerCase().includes(q));
    // checked people first, then alphabetically
    all.sort((a, b) => (S.members.has(b.id) - S.members.has(a.id)) || a.name.localeCompare(b.name));
    if (!all.length) { list.innerHTML = `<p class="home-none">${this.people.list().length ? 'Nobody matches.' : 'The directory is empty — add the first person below.'}</p>`; return; }
    list.innerHTML = all.map((p) => { const on = S.members.has(p.id); return `<label class="pd-person${on ? ' on' : ''}" data-person="${esc(p.id)}"><input type="checkbox"${on ? ' checked' : ''} aria-label="${esc(p.name)}"><span class="avatar" style="--av:${esc(p.colour)}">${esc(this.people.initials(p.name))}</span><span class="pd-person-text"><b>${esc(p.name)}</b><small>${esc([p.role, p.email].filter(Boolean).join(' · '))}</small></span><select aria-label="Role of ${esc(p.name)}"${on ? '' : ' disabled'}>${MEMBER_ROLES.map((r) => `<option value="${r}"${(S.members.get(p.id) || 'member') === r ? ' selected' : ''}>${cap(r)}</option>`).join('')}</select></label>`; }).join('');
  }
  _addPerson() {
    const name = this.el.querySelector('[data-role="np-name"]'), email = this.el.querySelector('[data-role="np-email"]'), role = this.el.querySelector('[data-role="np-role"]');
    const n = name.value.trim(); if (!n) { name.focus(); return; }
    const existing = this.people.byName(n);
    const p = existing || this.people.add({ name: n, email: email.value.trim(), role: '' });
    this.state.members.set(p.id, role.value);
    name.value = ''; email.value = ''; this.state.q = ''; this.el.querySelector('[data-role="pq"]').value = '';
    this._renderPeople();
    this.toast(existing ? `${p.name} was already in the directory · added to the project` : `${p.name} added to the directory`, 1600);
    name.focus();
  }
  _error(t) { const e = this.el.querySelector('.pd-error'); if (e) e.textContent = t; }
  _submit() {
    const S = this.state; if (!S) return;
    const v = (r) => this.el.querySelector(`[data-role="${r}"]`)?.value ?? '';
    const name = v('name').trim();
    if (!name) { this._error('Give the project a name.'); this.el.querySelector('[data-role="name"]').focus(); return; }
    let key = v('key').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || deriveKey(name);
    if (key.length < 2) key = deriveKey(name);
    key = uniqueKey(key, S.keys);
    const tagInput = this.el.querySelector('[data-role="tag"]'); if (tagInput.value.trim()) this._addTag(tagInput.value);
    const start = v('start'), due = v('due');
    if (start && due && due < start) { this._error('The due date is before the start.'); return; }
    const meta = normalizeMeta({ ...S.meta, key, description: v('description').trim(), status: v('status'), colour: S.meta.colour, start, due, tags: S.tags, members: [...S.members].map(([personId, role]) => ({ personId, role })), owner: S.meta.owner || this.people.me || '' }, { id: S.id, name });
    const mode = S.mode, id = S.id, template = create(S) ? v('template') : null;
    this.close();
    if (mode === 'create') this.onCreate({ name, meta, template });
    else this.tabs.patchProject(id, { name, ...meta }).then(() => this.toast(`${name} updated`, 1200));
  }
}
const create = (S) => S.mode === 'create';
