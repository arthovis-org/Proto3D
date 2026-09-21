// motion.js — a tiny position (+ rotation y) tween: targets are [x, y, z] or [x, y, z, ry] for the flows (the core's layout tween is not exposed through
// the SDK). `tweenNodes` starts, `update(dt)` advances (called from the live layer's frame loop),
// dragging blocks are left alone, `world.bumpLayout()` keeps cables following and the world gets one
// 'move' change when everything has landed. Progress is wall-clock (performance.now()), not the
// frame delta, so a slow renderer still lands the move in `duration` seconds.
const tweens = new Map();   // node → { from, to, start, dur, world, onDone }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const ease = (t) => 1 - Math.pow(1 - t, 3);

export function tweenNodes(nodes, targets, { duration = 0.45, world = null, onDone = null } = {}) {
  nodes.forEach((n, i) => {
    const to = targets[i]; if (!to) return;
    if (duration <= 0 || n.dragging) { tweens.delete(n); n.position.set(to[0], to[1], to[2]); if (to.length > 3 && n.rotation) n.rotation.y = to[3]; return; }
    tweens.set(n, { from: [...n.position.toArray(), n.rotation?.y || 0], to: [...to], start: now(), dur: duration, world: world || n.world, onDone: i === nodes.length - 1 ? onDone : null });
  });
  if (duration <= 0) { (world || nodes[0]?.world)?.bumpLayout?.(); (world || nodes[0]?.world)?.changed?.('move'); onDone?.(); }
  return nodes.length;
}
export function update() {
  if (!tweens.size) return false;
  const done = []; const worlds = new Set(); const t0 = now();
  for (const [n, tw] of tweens) {
    if (n.dragging) { done.push([n, tw]); continue; }
    tw.t = Math.min(1, (t0 - tw.start) / tw.dur);
    const e = ease(tw.t);
    n.position.set(tw.from[0] + (tw.to[0] - tw.from[0]) * e, tw.from[1] + (tw.to[1] - tw.from[1]) * e, tw.from[2] + (tw.to[2] - tw.from[2]) * e);
    if (tw.to.length > 3 && n.rotation) n.rotation.y = tw.from[3] + (tw.to[3] - tw.from[3]) * e;
    worlds.add(tw.world);
    if (tw.t >= 1) { n.position.set(tw.to[0], tw.to[1], tw.to[2]); if (tw.to.length > 3 && n.rotation) n.rotation.y = tw.to[3]; done.push([n, tw]); }
  }
  worlds.forEach((w) => w?.bumpLayout?.());
  for (const [n, tw] of done) { tweens.delete(n); tw.onDone?.(); }
  if (done.length && !tweens.size) worlds.forEach((w) => w?.changed?.('move'));
  return tweens.size > 0;
}
export const isTweening = () => tweens.size > 0;
export function cancelAll() { tweens.clear(); }
