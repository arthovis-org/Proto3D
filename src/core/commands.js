// core/commands.js — undoable operations built from World's low-level mutations. Each returns
// a { label, do(), undo() } command for History.execute. Composite commands bundle several.
import * as THREE from 'three';
import { clone } from './component.js';
import { RouteNode } from '../routing.js';

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

/**
 * Move (and optionally rotate / scale) a set of nodes: before/after snapshots. `routes` carries the
 * cable waypoints that travel with the set — `[{ node: RouteNode, before: [x,y,z], after: [x,y,z] }]`.
 */
export function transform(world, nodes, before, after, routes = null) {
  const apply = (snaps, which) => {
    nodes.forEach((n, i) => { const s = snaps[i]; n.position.fromArray(s.p); n.rotation.y = s.r; n.scale.setScalar(s.s); });
    if (routes) for (const r of routes) { r.node.position.fromArray(r[which]); r.node.conns.forEach((c) => c.routeChanged()); }
    world.bumpLayout(); world.changed('move');
  };
  return { label: `Move ${nodes.length}`, do: () => apply(after, 'after'), undo: () => apply(before, 'before') };
}

/* ---------- cable routes (waypoints) ---------- */
const routeTouched = (world, conns) => { conns.forEach((c) => c.routeChanged()); world.bumpLayout(); world.changed('route'); };
/** Insert a waypoint into a cable's route at `index`: a new private node at `point`, or an existing (shared) RouteNode. */
export function addWaypoint(world, conn, index, pointOrNode) {
  const node = pointOrNode instanceof RouteNode ? pointOrNode : new RouteNode(pointOrNode);
  return {
    label: 'Add waypoint', node,
    do() { conn.route.splice(Math.min(index, conn.route.length), 0, node); node.conns.add(conn); routeTouched(world, [conn]); },
    undo() { const i = conn.route.indexOf(node); if (i >= 0) conn.route.splice(i, 1); node.conns.delete(conn); routeTouched(world, [conn]); },
  };
}
/** Remove the waypoint at `index` from a cable (a shared node stays with its other cables). */
export function removeWaypoint(world, conn, index) {
  const node = conn.route[index];
  return {
    label: 'Remove waypoint',
    do() { const i = conn.route.indexOf(node); if (i >= 0) conn.route.splice(i, 1); node.conns.delete(conn); routeTouched(world, [conn]); },
    undo() { conn.route.splice(Math.min(index, conn.route.length), 0, node); node.conns.add(conn); routeTouched(world, [conn]); },
  };
}
/** Move a waypoint (every cable through it follows). */
export function moveWaypoint(world, node, before, after) {
  const apply = (p) => { node.position.fromArray(p); routeTouched(world, [...node.conns]); };
  return { label: 'Move waypoint', do: () => apply(after), undo: () => apply(before) };
}
/** Back to automatic routing: drop every waypoint of a cable. */
export function resetRoute(world, conn) {
  const prev = [...conn.route];
  return { label: 'Reset cable route', do: () => { conn.setRoute([]); routeTouched(world, [conn]); }, undo: () => { conn.setRoute(prev); routeTouched(world, [conn]); } };
}
/** Pin a cable's waypoint to another node (the two cables then share it and bundle through it). */
export function pinWaypoint(world, conn, index, target) {
  const prev = conn.route[index];
  return {
    label: 'Share waypoint',
    do() { if (conn.route.includes(target)) { const i = conn.route.indexOf(prev); if (i >= 0) conn.route.splice(i, 1); } else conn.route[conn.route.indexOf(prev)] = target; prev.conns.delete(conn); target.conns.add(conn); routeTouched(world, [conn, ...target.conns]); },
    undo() { const i = conn.route.indexOf(target); if (i >= 0) conn.route[i] = prev; else conn.route.splice(Math.min(index, conn.route.length), 0, prev); target.conns.delete(conn); prev.conns.add(conn); routeTouched(world, [conn, ...target.conns]); },
  };
}
/** Unpin a cable from a shared node: it gets its own waypoint at the same place. */
export function unpinWaypoint(world, conn, index) {
  const shared = conn.route[index];
  const own = new RouteNode(shared.position);
  return {
    label: 'Unpin waypoint',
    do() { conn.route[conn.route.indexOf(shared)] = own; shared.conns.delete(conn); own.conns.add(conn); routeTouched(world, [conn, ...shared.conns]); },
    undo() { conn.route[conn.route.indexOf(own)] = shared; own.conns.delete(conn); shared.conns.add(conn); routeTouched(world, [conn, ...shared.conns]); },
  };
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
  const nodeMap = new Map();   // a shared waypoint stays shared among the copies
  const copyNode = (n) => { if (!nodeMap.has(n)) nodeMap.set(n, new RouteNode(n.position.clone().add(offset))); return nodeMap.get(n); };
  const links = world.connections.filter((c) => src.includes(c.from.owner) && c.to && src.includes(c.to.owner))
    .map((c) => ({ a: src.indexOf(c.from.owner), ak: c.from.key, b: src.indexOf(c.to.owner), bk: c.to.key, route: c.route.map(copyNode) }));
  let made = [];
  const cmd = {
    label: `Duplicate ${src.length}`,
    copies,
    do() {
      copies.forEach((c, i) => world.addNode(c, positions[i]));
      made = links.map((l) => { const c = world.addConnection(copies[l.a].getPort(l.ak, 'out'), copies[l.b].getPort(l.bk, 'in')); if (c && l.route.length && !c.route.length) c.setRoute(l.route); return c; }).filter(Boolean);
    },
    undo() { copies.forEach((c) => world.removeNode(c)); made = []; },
  };
  return cmd;
}
