// scene-demo.js — the world model (blocks, connections, factories) and the demo graph.
// Blocks are instantiated from graph.js block types so ports, params and evaluation agree.
import { Node3D } from './node3d.js';
import { Device3D } from './device3d.js';
import { Connection3D } from './connection3d.js';
import { sizes } from './theme.js';
import { blockTypes, defaultParams } from './graph.js';

/** Grid helper: column/row on the layout pitch, plus a height (in units). */
const at = (col, row, y = 1.6) => [col * sizes.spacing.pitchX, y, row * sizes.spacing.pitchZ];

/** Instantiate a block (node or device) of a graph.js type. */
export function createBlock(typeId, overrides = {}) {
  const t = blockTypes[typeId];
  if (!t) throw new Error(`Unknown block type ${typeId}`);
  const common = {
    typeId, title: overrides.title || t.title, params: { ...defaultParams(typeId), ...(overrides.params || {}) },
    inputs: t.inputs || [], outputs: t.outputs || [], mode: overrides.mode,
  };
  if (t.kind === 'device') return new Device3D({ ...common, type: t.device, label: common.title });
  return new Node3D({ ...common, category: t.category, width: t.width, footer: '…' });
}

export function createWorld(scene) {
  const world = {
    scene, blocks: [], connections: [], named: {},
    addBlock(b, pos) { b.position.set(...pos); scene.add(b); world.blocks.push(b); return b; },
    addConnection(from, to, state) {
      const valid = from.type === to.type;
      const c = new Connection3D(from, to, { state: state || (valid ? 'idle' : 'invalid'), hasValue: false });
      scene.add(c); world.connections.push(c); return c;
    },
    removeConnection(c) {
      scene.remove(c); c.dispose();
      world.connections = world.connections.filter((x) => x !== c);
    },
    removeBlock(b) {
      world.connections.filter((c) => c.from.owner === b || (c.to && c.to.owner === b)).forEach(world.removeConnection);
      scene.remove(b); b.dispose();
      world.blocks = world.blocks.filter((x) => x !== b);
    },
    /** Connections touching a port. */
    connectionsOf(port) { return world.connections.filter((c) => c.from === port || c.to === port); },
    /** Free slot near a point for "Add node". */
    nextFreeSlot(near) {
      for (let i = 0; i < 40; i++) {
        const col = Math.round(near.x / sizes.spacing.pitchX) + (i % 5) - 2;
        const row = Math.round(near.z / sizes.spacing.pitchZ) + Math.floor(i / 5) + 1;
        const [x, , z] = at(col, row);
        if (!world.blocks.some((b) => Math.abs(b.position.x - x) < 1 && Math.abs(b.position.z - z) < 1)) return [x, 1.6, z];
      }
      return [near.x, 1.6, near.z + sizes.spacing.pitchZ];
    },
  };
  return world;
}

export function buildDemo(scene) {
  const world = createWorld(scene);
  const N = (typeId, pos, overrides) => world.addBlock(createBlock(typeId, overrides), pos);

  /* ---- Nodes ---- */
  const sensor    = N('sensor',    at(-1, 0, 1.8));
  const constant  = N('constant',  at(-1, 1.5, 1.2), { params: { value: 0.25 } });
  const transform = N('transform', at(0, -1, 2.6));
  const filter    = N('filter',    at(0, 1, 1.4));
  const merge     = N('merge',     at(1, 0.6, 2.4));
  const format    = N('format',    at(1, -1.2, 3.4));
  const output    = N('output',    at(2, -0.3, 2.2));
  const logger    = N('logger',    at(1, 2, 1.0), { mode: 'disabled' });

  /* ---- Devices (sources and sinks with screens) ---- */
  const phone   = N('phone',   at(-1.8, -0.6, 0));
  const desktop = N('desktop', at(-1.8, 1.3, 0));
  const laptop  = N('laptop',  at(2.8, -0.8, 0));
  const tablet  = N('tablet',  at(2.8, 1.2, 0));

  /* ---- Connections ---- */
  const A = world.addConnection;
  // phone -> Transform -> Format -> Laptop / Output   (the headline chain)
  A(phone.outputs[0], transform.inputs[0]);
  A(transform.outputs[0], format.inputs[0]);
  A(format.outputs[0], laptop.inputs[0]);
  A(format.outputs[0], output.inputs[0]);
  A(format.outputs[0], merge.inputs[1]);
  // sensor branch: reading -> Filter (threshold from Constant) -> Merge / Output.enable
  A(sensor.outputs[0], filter.inputs[0]);
  A(constant.outputs[0], filter.inputs[1]);
  A(desktop.outputs[0], filter.inputs[1]);          // data -> number : invalid (red, dashed), Filter shows error
  A(filter.outputs[1], merge.inputs[0]);
  A(filter.outputs[0], merge.inputs[2]);
  A(filter.outputs[0], output.inputs[2]);
  // data branch: Merge -> Output / Tablet / Laptop / Logger, Desktop -> Logger
  A(merge.outputs[0], output.inputs[1]);
  A(merge.outputs[0], tablet.inputs[0]);
  A(merge.outputs[0], laptop.inputs[1]);
  A(desktop.outputs[0], logger.inputs[0]);

  world.named = { sensor, constant, transform, filter, merge, format, output, logger, phone, desktop, laptop, tablet };
  return world;
}
