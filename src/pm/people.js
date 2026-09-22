// pm/people.js — the people directory of this browser: who can be a project member or an
// assignee, kept in the `people` store of project-store.js (DB v2) and mirrored in memory so the
// Home page, the project dialog and the Person component's panel read it synchronously. A
// directory person is `createPerson` from pm/model.js plus an email; `me` (the viewer, picked on
// the Home page) is an id in localStorage. No server: the directory is per browser, like the
// projects — sharing a project is File → Save; live sync is a later step.
//
//   people.ready · list() · byId(id) · byName(name) · add({ name, email, role, colour, capacity })
//   update(id, patch) · remove(id) · me / setMe(id) · onChange(cb) · initials(name)
import { projectStore } from '../project-store.js';
import { createPerson, initials } from './model.js';

export const ME_KEY = 'proto3d.me.v1';
const COLOURS = ['#5aa9ff', '#2dd4bf', '#34c99a', '#f5b942', '#ff7a45', '#ff4d5e', '#e25aa6', '#8b7cf6'];

export class People {
  constructor(store = projectStore) {
    this.store = store;
    this._list = [];
    this._listeners = new Set();
    this.ready = store.ready.then(() => (store.available ? store.listPeople() : [])).then((list) => { this._list = list.map(normalize); this._notify(); return this._list; }).catch(() => this._list);
  }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _notify() { this._listeners.forEach((cb) => cb(this)); }
  /** Everyone, alphabetically. */
  list() { return this._list.slice(); }
  byId(id) { return this._list.find((p) => p.id === id) || null; }
  byName(name) { const q = String(name || '').trim().toLowerCase(); return q ? this._list.find((p) => p.name.toLowerCase() === q) || null : null; }
  initials(name) { return initials(name); }
  /** Add a person (a colour is picked when none is given). Returns the record. */
  add(o = {}) {
    const p = normalize({ ...createPerson({ ...o, colour: o.colour || COLOURS[this._list.length % COLOURS.length] }), email: o.email || '' });
    this._list = [...this._list, p].sort(byName);
    this._write(p); this._notify();
    return p;
  }
  update(id, patch = {}) {
    const cur = this.byId(id); if (!cur) return null;
    const p = normalize({ ...cur, ...patch, id });
    this._list = this._list.map((x) => (x.id === id ? p : x)).sort(byName);
    this._write(p); this._notify();
    return p;
  }
  remove(id) {
    if (!this.byId(id)) return false;
    this._list = this._list.filter((x) => x.id !== id);
    if (this.me === id) this.setMe(null);
    if (this.store.available) this.store.removePerson(id).catch(() => {});
    this._notify();
    return true;
  }
  _write(p) { if (this.store.available) this.store.putPerson(p).catch(() => {}); }
  /** The viewer's directory id (the "You are …" picker on the Home page), or null. */
  get me() { try { return localStorage.getItem(ME_KEY) || null; } catch (_) { return null; } }
  setMe(id) { try { if (id) localStorage.setItem(ME_KEY, id); else localStorage.removeItem(ME_KEY); } catch (_) { /* private mode */ } this._notify(); }
  get mePerson() { return this.byId(this.me); }
}
const byName = (a, b) => a.name.localeCompare(b.name);
const normalize = (p) => ({ ...createPerson(p), email: String(p.email || '').trim() });

export const people = new People();
