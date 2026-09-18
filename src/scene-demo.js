// scene-demo.js — builds the demo graph: nodes, devices and connections on a loose grid.
// Also owns the tiny "world" model the interaction layer talks to.
import { Node3D } from './node3d.js';
import { Device3D } from './device3d.js';
import { Connection3D } from './connection3d.js';
import { sizes } from './theme.js';

/** Grid helper: column/row on the layout pitch, plus a height (in units). */
const at = (col, row, y = 1.6) => [col * sizes.spacing.pitchX, y, row * sizes.spacing.pitchZ];

export function buildDemo(scene) {
  const world = {
    scene, blocks: [], connections: [],
    addBlock(b, pos) { b.position.set(...pos); scene.add(b); world.blocks.push(b); return b; },
    addConnection(from, to, state) {
      const valid = from.type === to.type;
      const c = new Connection3D(from, to, { state: state || (valid ? 'idle' : 'invalid') });
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

  /* ---- Nodes (5 processing + 1 disabled logger) ---- */
  const sensor = world.addBlock(new Node3D({
    title: 'Sensor Input', subtitle: 'source · 20 Hz', category: 'source',
    outputs: [{ name: 'reading', type: 'number' }, { name: 'event', type: 'signal' }],
  }), at(-1, 0, 1.8));

  const transform = world.addBlock(new Node3D({
    title: 'Transform', subtitle: 'scale · offset', category: 'process',
    inputs: [{ name: 'value', type: 'number' }, { name: 'factor', type: 'number' }],
    outputs: [{ name: 'value', type: 'number' }],
  }), at(0, -1, 2.6));

  const filter = world.addBlock(new Node3D({
    title: 'Filter', subtitle: 'threshold', category: 'process', width: 4.6,
    inputs: [{ name: 'value', type: 'number' }, { name: 'threshold', type: 'number' }],
    outputs: [{ name: 'passed', type: 'number' }, { name: 'rejected', type: 'boolean' }],
  }), at(0, 1, 1.4));

  const merge = world.addBlock(new Node3D({
    title: 'Merge', subtitle: 'join · latest', category: 'process', width: 4.4,
    inputs: [{ name: 'a', type: 'data' }, { name: 'b', type: 'data' }, { name: 'trigger', type: 'signal' }],
    outputs: [{ name: 'merged', type: 'data' }],
  }), at(1, 0.6, 2.4));

  const format = world.addBlock(new Node3D({
    title: 'Format', subtitle: 'template', category: 'process',
    inputs: [{ name: 'value', type: 'number' }],
    outputs: [{ name: 'text', type: 'string' }],
  }), at(1, -1.2, 3.4));

  const output = world.addBlock(new Node3D({
    title: 'Output', subtitle: 'sink', category: 'sink', width: 4.2,
    inputs: [{ name: 'text', type: 'string' }, { name: 'data', type: 'data' }, { name: 'enable', type: 'boolean' }],
    outputs: [{ name: 'done', type: 'signal' }],
  }), at(2, -0.3, 2.2));

  const logger = world.addBlock(new Node3D({
    title: 'Logger', subtitle: 'disabled', category: 'sink', width: 3.4,
    inputs: [{ name: 'in', type: 'data' }],
  }), at(1, 2, 1.0));

  /* ---- Devices ---- */
  const phone = world.addBlock(new Device3D({
    type: 'phone', label: 'Phone',
    outputs: [{ name: 'motion', type: 'number' }, { name: 'tap', type: 'signal' }],
  }), at(-1.8, -0.6, 0));
  const desktop = world.addBlock(new Device3D({
    type: 'desktop', label: 'Desktop',
    outputs: [{ name: 'dataset', type: 'data' }],
  }), at(-1.8, 1.3, 0));
  const laptop = world.addBlock(new Device3D({
    type: 'laptop', label: 'Laptop',
    inputs: [{ name: 'display', type: 'string' }, { name: 'feed', type: 'data' }],
  }), at(2.8, -0.8, 0));
  const tablet = world.addBlock(new Device3D({
    type: 'tablet', label: 'Tablet',
    inputs: [{ name: 'view', type: 'data' }],
  }), at(2.8, 1.2, 0));

  /* ---- Connections ---- */
  const A = world.addConnection;
  // phone -> Transform -> Format -> Laptop   (the headline chain, active)
  A(phone.outputs[0], transform.inputs[0], 'active');
  A(transform.outputs[0], format.inputs[0], 'active');
  A(format.outputs[0], laptop.inputs[0], 'active');
  A(format.outputs[0], output.inputs[0]);
  // sensor branch
  A(sensor.outputs[0], filter.inputs[0]);
  A(sensor.outputs[1], merge.inputs[2]);
  A(filter.outputs[0], merge.inputs[0]);            // number -> data : invalid (red, dashed)
  A(filter.outputs[1], output.inputs[2]);
  // data branch
  A(desktop.outputs[0], merge.inputs[1]);
  A(merge.outputs[0], output.inputs[1]);
  A(merge.outputs[0], tablet.inputs[0]);
  A(merge.outputs[0], laptop.inputs[1]);
  A(merge.outputs[0], logger.inputs[0]);

  /* ---- Node states for the showcase ---- */
  transform.setState('active');
  filter.setState('error');
  logger.setState('disabled');
  laptop.setState('active');

  world.named = { sensor, transform, filter, merge, format, output, logger, phone, desktop, laptop, tablet };
  return world;
}
