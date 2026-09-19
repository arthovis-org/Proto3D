// wiring.js — the global "Wiring" switch. Cables and ports are optional: with wiring off the
// workspace reads as clean cards (no pins, labels, IN / OUT captions, slot sockets or cables)
// and relationships are made by dropping one component onto another (interaction.js →
// pm/relations.js linkPairs). With wiring on everything is shown and pins can be dragged.
// A component may override the global flag for itself (`block.showPorts = true | false | null`,
// the eye icon in the panel header; persisted in the instance and saved with the world).
// The flag itself is persisted in localStorage and inside saved / autosaved documents.
const KEY = 'proto3d.wiring.v1';
let on = false;
const listeners = new Set();
try { on = localStorage.getItem(KEY) === '1'; } catch (_) { on = false; }

export function isWiringOn() { return on; }
export function setWiring(v, { persist = true } = {}) {
  v = !!v;
  if (v === on) return on;
  on = v;
  if (persist) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* private mode */ } }
  listeners.forEach((cb) => cb(on));
  return on;
}
export function toggleWiring() { return setWiring(!on); }
/** Subscribe to changes: cb(on). Returns an unsubscribe function. */
export function onWiringChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
/** Whether a block shows its ports: its own override wins, else the global flag. */
export function portsVisibleFor(block) { return block && block.showPorts != null ? !!block.showPorts : on; }
/** A cable is visible when the wiring is on, or when both of its blocks show their ports. */
export function cableVisibleFor(conn) {
  if (on) return true;
  const a = conn.from?.owner, b = conn.to?.owner;
  if (!a || !b) return true;                          // a preview while dragging is always shown
  const show = (o) => (o.kind === 'group' ? true : portsVisibleFor(o));
  return show(a) && show(b);
}
