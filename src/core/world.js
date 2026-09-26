// core/world.js — the world model: nodes (component instances), connections and groups.
// Single source of truth; the engine annotates it with values, the UI reads and writes it,
// serialization walks it. Low-level mutations live here; undoable operations are built from
// them in commands.js. `layoutVersion` bumps whenever something moved so connections re-route.
import { Connection3D } from '../connection3d.js';
import { sizes } from '../theme.js';
import { compatiblePorts } from './types.js';

export class World {
  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
    this.connections = [];
    this.groups = [];
    this.engine = null;
    this.version = 0;          // bumps on every structural / param change (autosave)
    this.layoutVersion = 0;    // bumps when anything moved (connection routing)
    this._listeners = new Set();
    this._posHash = 0;
  }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  changed(what = 'change') { this.version += 1; this._listeners.forEach((cb) => cb(what, this)); }
  bumpLayout() { this.layoutVersion += 1; }

  /* ---------- nodes ---------- */
  addNode(node, position) {
    if (position) node.position.set(position[0] ?? position.x, position[1] ?? position.y, position[2] ?? position.z);
    if (node.kind === 'device') node.position.y = Math.max(0, node.position.y);
    node.world = this;
    node.visible = true;
    this.scene.add(node);
    if (!this.nodes.includes(node)) this.nodes.push(node);
    this.bumpLayout();
    this.changed('add-node');
    return node;
  }
  /** Detach a node (and its connections). Returns what was removed so a command can undo it. */
  removeNode(node) {
    const conns = this.connectionsOfNode(node);
    conns.forEach((c) => this.removeConnection(c));
    if (node.group) node.group.removeMember(node);
    this.scene.remove(node);
    this.nodes = this.nodes.filter((n) => n !== node);
    this.bumpLayout();
    this.changed('remove-node');
    return { node, connections: conns };
  }
  nodeByUid(uid) { return this.nodes.find((n) => n.uid === uid) || null; }

  /* ---------- connections ---------- */
  /** Connect an output port to an input port. Duplicates return the existing link. */
  addConnection(from, to, opts = {}) {
    if (!from || !to || from.dir !== 'out' || to.dir !== 'in' || from.owner === to.owner) return null;
    const existing = this.connections.find((c) => c.from === from && c.to === to);
    if (existing) return existing;
    const c = opts.instance || new Connection3D(from, to, { uid: opts.uid, world: this });
    c.world = this;
    c.visible = true;
    this.scene.add(c);
    this.connections.push(c);
    from.setConnected?.(true); to.setConnected?.(true);
    this._syncCount(to);
    this.groups.forEach((g) => g.collapsed && g.refreshProxies(this));
    this.changed('connect');
    return c;
  }
  removeConnection(c) {
    this.scene.remove(c);
    this.connections = this.connections.filter((x) => x !== c);
    this._syncConnected(c.from); if (c.to) { this._syncConnected(c.to); this._syncCount(c.to); }
    this.groups.forEach((g) => g.collapsed && g.refreshProxies(this));
    this.changed('disconnect');
    return c;
  }
  /** A port renders filled while at least one link is attached, hollow otherwise. */
  _syncConnected(port) { port.setConnected?.(this.connections.some((c) => c.from === port || c.to === port)); }
  /** Multi inputs grow one slot per cable: tell the port how many links it carries. */
  _syncCount(port) { port.setLinkCount?.(this.connections.filter((c) => c.to === port).length); }
  /** How many cables end on an input (their slot order is the world's connection order). */
  linkIndex(conn) { return conn.to ? this.connections.filter((c) => c.to === conn.to).indexOf(conn) : -1; }
  /** Ports of `node` that can take a cable coming from `port` (direction and type), never on the same block. */
  compatiblePorts(port, nodes = this.nodes) {
    const out = [];
    for (const n of nodes) {
      if (n === port.owner || !n.visible) continue;
      const list = port.dir === 'out' ? n.inputs : n.outputs;
      for (const p of list) if (!p.proxy && (port.dir === 'out' ? this.canConnect(port, p) : this.canConnect(p, port))) out.push(p);
    }
    return out;
  }
  connectionsOf(port) { return this.connections.filter((c) => c.from === port || c.to === port); }
  connectionsOfNode(node) { return this.connections.filter((c) => c.from.owner === node || (c.to && c.to.owner === node)); }
  connectionByUid(uid) { return this.connections.find((c) => c.uid === uid) || null; }
  canConnect(from, to) { return !!(from && to && from.dir === 'out' && to.dir === 'in' && from.owner !== to.owner && compatiblePorts(from, to) !== 'invalid'); }

  /* ---------- groups ---------- */
  addGroup(g) {
    g.world = this;
    this.scene.add(g);
    if (!this.groups.includes(g)) this.groups.push(g);
    g.members.forEach((m) => { m.group = g; });
    g.updateBounds(true);
    this.changed('group');
    return g;
  }
  removeGroup(g) {
    if (g.collapsed) g.setCollapsed(false, this);
    g.members.forEach((m) => { if (m.group === g) m.group = null; });
    this.scene.remove(g);
    this.groups = this.groups.filter((x) => x !== g);
    this.changed('ungroup');
    return g;
  }
  groupByUid(uid) { return this.groups.find((g) => g.uid === uid) || null; }

  /* ---------- helpers ---------- */
  /** Free slot near a point on the layout pitch (kind decides height: devices stand on the floor). */
  nextFreeSlot(near, node) {
    const px = sizes.spacing.pitchX, pz = sizes.spacing.pitchZ;
    const y = node.kind === 'device' ? 0 : node.height / 2 + 0.4;
    for (let i = 0; i < 60; i++) {
      const ring = Math.floor(i / 8) + 1, k = i % 8;
      const dx = [0, 1, 1, 0, -1, -1, -1, 1][k] * ring, dz = [1, 1, 0, -1, -1, 0, 1, -1][k] * ring;
      const x = Math.round(near.x / px) * px + dx * px * (0.65), z = Math.round(near.z / pz) * pz + dz * pz;
      const free = !this.nodes.some((b) => b !== node && Math.abs(b.position.x - x) < (b.width + node.width) / 2 + 0.6 && Math.abs(b.position.z - z) < 3.2);
      if (free) return [x, y, z];
    }
    return [near.x + 2, y, near.z + 2];
  }
  /** Cheap per-frame move detection: bumps layoutVersion when any node moved. */
  detectMoves() {
    let h = 0;
    for (const n of this.nodes) h += n.position.x * 1.31 + n.position.y * 7.17 + n.position.z * 13.3 + n.scale.x * 0.7 + n.scale.y * 0.53 + n.scale.z * 0.41 + n.rotation.y * 3.1 + n.rotation.x * 2.3 + n.rotation.z * 1.9 + (n.visible ? 0 : 99);
    if (Math.abs(h - this._posHash) > 1e-6) { this._posHash = h; this.bumpLayout(); return true; }
    return false;
  }
  /**
   * Take the whole content out of the scene without disposing it (a project tab going to the
   * background keeps its live objects): returns { nodes, connections, groups, named } for `attach`.
   */
  detach() {
    this.selection?.clear?.();
    const snap = { nodes: this.nodes, connections: this.connections, groups: this.groups, named: this.named || {} };
    snap.groups.forEach((g) => this.scene.remove(g));
    snap.connections.forEach((c) => this.scene.remove(c));
    snap.nodes.forEach((n) => this.scene.remove(n));
    this.nodes = []; this.connections = []; this.groups = []; this.named = {};
    this.bumpLayout();
    this.changed('detach');
    return snap;
  }
  /** Put a detached content back (the world must be empty). */
  attach(snap) {
    if (this.nodes.length || this.connections.length || this.groups.length) this.clear();
    this.nodes = snap.nodes; this.connections = snap.connections; this.groups = snap.groups; this.named = snap.named || {};
    this.nodes.forEach((n) => { n.world = this; this.scene.add(n); });
    this.connections.forEach((c) => { c.world = this; this.scene.add(c); });
    this.groups.forEach((g) => { g.world = this; this.scene.add(g); });
    this.bumpLayout();
    this.changed('attach');
  }
  /** Free a detached content for good (its tab closed). */
  static disposeDetached(snap) {
    if (!snap) return;
    snap.connections.forEach((c) => c.dispose?.());
    snap.nodes.forEach((n) => n.dispose?.());
    snap.groups.forEach((g) => g.dispose?.());
  }
  clear() {
    this.selection?.clear?.();
    [...this.groups].forEach((g) => this.removeGroup(g));
    [...this.connections].forEach((c) => { this.scene.remove(c); c.dispose(); });
    this.connections = [];
    [...this.nodes].forEach((n) => { this.scene.remove(n); n.dispose(); });
    this.nodes = [];
    this.bumpLayout();
    this.changed('clear');
  }
}
