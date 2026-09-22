// examples/index.js — example scenes (the Showcase), the four starter templates the Start panel
// offers, and the small builder API they use. A template is an example flagged `template: true`
// with a one-line `hint` (what to try first); it opens in a tab named after it.
import showcase from './showcase.js';
import projectBoard from './project-board.js';
import aiPipeline from './ai-pipeline.js';
import deviceFlow from './device-flow.js';
import imageStudio from './image-studio.js';
import { createInstance } from '../instance.js';
import { Group3D } from '../groups.js';

/** Starter templates, in the order the Start panel shows them. */
export const templates = [projectBoard, aiPipeline, deviceFlow, imageStudio];
/** Everything File → Examples lists: the templates first, then the Showcase. */
export const examples = [...templates, showcase];
/** The full example scene (File → Examples → Showcase, the Start panel's "More examples"). */
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
