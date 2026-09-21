// arrange.js — apply a flow preset to the hub nodes of the current world as one undoable, animated
// move (position and rotation y). The set keeps the floor-plan centre it had (so the flows do not
// wander off), y comes from the flow's levels, and the moved blocks are framed when the tween lands. Off-contract seams: window.__proto.{world, history}.
import { layoutFlow, flowById, layoutBounds } from './flows.js';
import { isHubNode } from './nodes.js';
import { blueprintSlug } from './generate.js';
import { tweenNodes } from './motion.js';

const str = (v) => String(v ?? '').trim();
/** The client key of a hub node: page → client, blueprint → slug, section → client. */
export const clientKeyOf = (n) => (n.typeId === 'hub-blueprint' ? blueprintSlug(n.params) : str(n.params?.client));

export function arrangeFlow(host, flowId, { client = null, frame = true, duration = 0.45 } = {}) {
  const proto = typeof window !== 'undefined' ? window.__proto : null;
  const flow = flowById(flowId);
  if (!proto || !flow) return null;
  const { world, history } = proto;
  const nodes = world.nodes.filter((n) => isHubNode(n) && n.visible !== false && (!client || clientKeyOf(n) === client));
  if (!nodes.length) { host.ui.toast('No hub nodes to arrange — load a demo from the Hubs menu'); return null; }
  const items = nodes.map((n) => ({ uid: n.uid, type: n.typeId, params: n.params, width: n.width * (n.scale?.x || 1), height: n.height * (n.scale?.x || 1) }));
  const map = layoutFlow(flow.id, items);
  const b = layoutBounds(map);
  const cx = nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length, cz = nodes.reduce((s, n) => s + n.position.z, 0) / nodes.length;
  const dx = cx - b.cx, dz = cz - b.cz;
  // y: the flow gives the base elevation; the block's origin is its centre, the floor gap 0.4 as the example builder uses
  const positions = nodes.map((n) => { const p = map.get(n.uid); return [+(p.x + dx).toFixed(3), +(p.y + (n.height * (n.scale?.x || 1)) / 2 + 0.4).toFixed(3), +(p.z + dz).toFixed(3), p.ry]; });
  const before = nodes.map((n) => [...n.position.toArray(), n.rotation?.y || 0]);
  const after = () => { if (frame) host.ui.frameBlocks(nodes, { fill: 0.85 }); };
  const cmd = {
    label: `Arrange · ${flow.label} (${nodes.length})`, nodes,
    do: () => tweenNodes(nodes, positions, { duration, world, onDone: after }),
    undo: () => tweenNodes(nodes, before, { duration, world, onDone: after }),
  };
  history.execute(cmd);
  return { flow, nodes, positions };
}
