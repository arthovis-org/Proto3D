// instance.js — factory: a registered definition → a Node3D or a Device3D in the scene.
import { registry } from './core/registry.js';
import { Node3D } from './node3d.js';
import { Device3D } from './device3d.js';

/** Instantiate a component by definition or type id with { uid, title, params, state, enabled } overrides. */
export function createInstance(defOrId, opts = {}) {
  const def = typeof defOrId === 'string' ? registry.get(defOrId) : defOrId;
  if (!def) throw new Error(`Unknown component type "${defOrId}"`);
  return def.device ? new Device3D(def, opts) : new Node3D(def, opts);
}
