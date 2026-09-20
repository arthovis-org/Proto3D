// core/commands.js — undoable operations built from World's low-level mutations. Each returns
// a { label, do(), undo() } command for History.execute. Composite commands bundle several.
import * as THREE from 'three';
import { clone } from './component.js';

export const composite = (label, cmds) => ({ label, do: () => cmds.forEach((c) => c.do()), undo: () => [...cmds].reverse().forEach((c) => c.undo()) });

export function addNode(world, node, position) {
  const pos = position ? [...position] : null;
  return { label: `Add ${node.def.label}`, do: () => world.addNode(node, pos), undo: () => world.removeNode(node) };
}

/** Remove nodes and everything attached (connections, group membership). */
export function removeNodes(world, nodes) {
  const uniq = [...new Set(nodes)];
  let removed = [];
  return {
    label: `Delete ${uniq.length} item${uniq.length > 1 ? 's' : ''}`,
    do() {
      removed = uniq.map((n) => ({ ...world.removeNode(n), group: n.group, pos: n.position.toArray() }));
    },
    undo() {
      for (const r of [...removed].reverse()) {
        world.addNode(r.node, r.pos);
        if (r.group && world.groups.includes(r.group)) r.group.addMember(r.node);
      }
      // re-add connections after every node exists again
      for (const r of removed) for (const c of r.connections) if (!world.connections.includes(c) && world.nodes.includes(c.from.owner) && world.nodes.includes(c.to.owner)) world.addConnection(c.from, c.to, { instance: c });
    },
  };
}

export function connect(world, from, to) {
  let conn = null;
  return {
    label: 'Connect',
    do() { conn = world.addConnection(from, to, conn ? { instance: conn } : {}); },
    undo() { if (conn) world.removeConnection(conn); },
  };
}
/** Remove a connection. `do` tolerates a link already detached by the interaction layer (cable-end drag). */
export function disconnect(world, conn) {
  return { label: 'Disconnect', do: () => { if (world.connections.includes(conn)) world.removeConnection(conn); }, undo: () => world.addConnection(conn.from, conn.to, { instance: conn }) };
}
/**
 * Move one end of an existing connection to another port (drag a cable end onto a compatible port).
 * `conn` may already be detached from the world; undo puts the original link back.
 */
export function reroute(world, conn, from, to) {
  let made = null;
  return {
    label: 'Re-route connection',
    do() { if (world.connections.includes(conn)) world.removeConnection(conn); made = world.addConnection(from, to, made ? { instance: made } : {}); },
    undo() { if (made) world.removeConnection(made); world.addConnection(conn.from, conn.to, { instance: conn }); },
    get connection() { return made; },
  };
}

/** Move (and optionally rotate / scale) a set of nodes: before/after snapshots. */
export function transform(world, nodes, before, after) {
  const apply = (snaps) => { nodes.forEach((n, i) => { const s = snaps[i]; n.position.fromArray(s.p); n.rotation.y = s.r; n.scale.setScalar(s.s); }); world.bumpLayout(); world.changed('move'); };
  return { label: `Move ${nodes.length}`, do: () => apply(after), undo: () => apply(before) };
}
export const snapshot = (n) => ({ p: n.position.toArray(), r: n.rotation.y, s: n.scale.x });

export function setParam(world, node, key, value) {
  const prev = clone(node.params[key]);
  const next = clone(value);
  return {
    label: `Set ${key}`,
    do: () => { node.params[key] = clone(next); node.faceDirty = true; world.changed('param'); },
    undo: () => { node.params[key] = clone(prev); node.faceDirty = true; world.changed('param'); },
  };
}
export function setTitle(world, node, title) {
  const prev = node.title;
  return { label: 'Rename', do: () => { node.setTitle(title); world.changed('rename'); }, undo: () => { node.setTitle(prev); world.changed('rename'); } };
}
export function setEnabled(world, node, on) {
  const prev = node.enabled;
  return { label: on ? 'Enable' : 'Disable', do: () => { node.enabled = on; world.changed('enable'); }, undo: () => { node.enabled = prev; world.changed('enable'); } };
}

/** Per-block override of the Wiring switch for a set of blocks: true (always show), false (always hide) or null (follow). */
export function setShowPorts(world, nodes, value) {
  const list = [...new Set(nodes)];
  const prev = list.map((n) => n.showPorts);
  const v = value === true || value === false ? value : null;
  return {
    label: v === null ? 'Ports follow wiring' : v ? 'Show ports' : 'Hide ports',
    do: () => list.forEach((n) => n.setShowPorts(v)),
    undo: () => list.forEach((n, i) => n.setShowPorts(prev[i])),
  };
}

export function addGroup(world, group) {
  return { label: 'Group', do: () => world.addGroup(group), undo: () => world.removeGroup(group) };
}
export function removeGroup(world, group) {
  return { label: 'Ungroup', do: () => world.removeGroup(group), undo: () => world.addGroup(group) };
}
export function setCollapsed(world, group, on) {
  const prev = group.collapsed;
  return { label: on ? 'Collapse' : 'Expand', do: () => { group.setCollapsed(on, world); world.changed('collapse'); }, undo: () => { group.setCollapsed(prev, world); world.changed('collapse'); } };
}
export function setGroupTitle(world, group, title) {
  const prev = group.title;
  return { label: 'Rename group', do: () => { group.setTitle(title); world.changed('rename'); }, undo: () => { group.setTitle(prev); world.changed('rename'); } };
}

/**
 * Duplicate nodes (with the connections among them), offset in +Z. `createInstance` builds the
 * copies so this module stays free of scene-construction imports.
 */
export function duplicate(world, nodes, createInstance, offset = new THREE.Vector3(0, 0, 4.5)) {
  const src = [...new Set(nodes)];
  const copies = src.map((n) => {
    const c = createInstance(n.def, { title: n.title, params: n.params, state: n.state, enabled: n.enabled });
    c.rotation.y = n.rotation.y; c.scale.copy(n.scale);
    return c;
  });
  const positions = src.map((n) => n.position.clone().add(offset).toArray());
  const links = world.connections.filter((c) => src.includes(c.from.owner) && c.to && src.includes(c.to.owner))
    .map((c) => ({ a: src.indexOf(c.from.owner), ak: c.from.key, b: src.indexOf(c.to.owner), bk: c.to.key }));
  let made = [];
  const cmd = {
    label: `Duplicate ${src.length}`,
    copies,
    do() {
      copies.forEach((c, i) => world.addNode(c, positions[i]));
      made = links.map((l) => world.addConnection(copies[l.a].getPort(l.ak, 'out'), copies[l.b].getPort(l.bk, 'in'))).filter(Boolean);
    },
    undo() { copies.forEach((c) => world.removeNode(c)); made = []; },
  };
  return cmd;
}
