// examples/index.js — example scenes and the small builder API they use.
import showcase from './showcase.js';
import { createInstance } from '../instance.js';
import { Group3D } from '../groups.js';

export const examples = [showcase];
/** The scene shown on first load and whenever the autosave is empty. */
export const DEFAULT_EXAMPLE = showcase.id;
export const exampleById = (id) => examples.find((e) => e.id === id) || null;

/** Build an example into a (cleared) world. Returns the example's named nodes. */
export function buildExample(world, example, { camera, controls } = {}) {
  world.clear();
  const api = {
    add(typeId, pos, { title, params, state } = {}) {
      const n = createInstance(typeId, { title, params, state });
      const y = pos[1] === null || pos[1] === undefined ? (n.kind === 'device' ? 0 : n.height / 2 + 0.4) : pos[1];
      return world.addNode(n, [pos[0], y, pos[2]]);
    },
    connect(a, outKey, b, inKey) {
      const from = a.getPort(outKey, 'out'), to = b.getPort(inKey, 'in');
      if (!from || !to) throw new Error(`example: no port ${outKey} → ${inKey}`);
      return world.addConnection(from, to);
    },
    group(title, members) { return world.addGroup(new Group3D({ title, members })); },
  };
  const named = example.build(api) || {};
  world.named = named;
  if (example.camera && camera && controls) { camera.position.fromArray(example.camera.position); controls.target.fromArray(example.camera.target); controls.update(); }
  world.changed('example');
  return named;
}
