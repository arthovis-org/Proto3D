// selection.js — the selection set (nodes, devices, connections, groups). Items receive
// setSelected(bool); listeners get the ordered list with the primary (last-added) item first.
export class Selection {
  constructor() { this.items = []; this._listeners = new Set(); }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _notify() { this._listeners.forEach((cb) => cb(this)); }
  get primary() { return this.items[this.items.length - 1] || null; }
  get size() { return this.items.length; }
  get nodes() { return this.items.filter((i) => i.kind === 'node' || i.kind === 'device'); }
  get groups() { return this.items.filter((i) => i.kind === 'group'); }
  get connections() { return this.items.filter((i) => i.kind === 'connection'); }
  has(item) { return this.items.includes(item); }
  set(items) {
    const next = Array.isArray(items) ? items.filter(Boolean) : items ? [items] : [];
    this.items.forEach((i) => { if (!next.includes(i)) i.setSelected(false); });
    next.forEach((i) => i.setSelected(true));
    this.items = [...new Set(next)];
    this._notify();
  }
  add(item) { if (!item || this.has(item)) return; item.setSelected(true); this.items.push(item); this._notify(); }
  remove(item) { if (!this.has(item)) return; item.setSelected(false); this.items = this.items.filter((i) => i !== item); this._notify(); }
  toggle(item) { this.has(item) ? this.remove(item) : this.add(item); }
  clear() { this.set([]); }
  /** Re-notify listeners (a sub-selection inside a block changed: the panel rebuilds). */
  refresh() { this._notify(); }
  /** Drop items that left the world. */
  prune(world) {
    const alive = this.items.filter((i) => (i.kind === 'connection' ? world.connections.includes(i) : i.kind === 'group' ? world.groups.includes(i) : world.nodes.includes(i)));
    if (alive.length !== this.items.length) this.set(alive);
  }
}
