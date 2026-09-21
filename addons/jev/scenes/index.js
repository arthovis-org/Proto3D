// scenes/index.js — the four demos in the core example shape ({ id, label, description, camera,
// focus(named), build({ add, connect, group }) }) plus `names`, a key → block title map, so a scene
// restored from storage can be re-addressed by the tutorial without the builder's return value.
import routeMessage from './route-message.js';
import guardGeneration from './guard-generation.js';
import triageBoard from './triage-board.js';
import smartBuild from './smart-build.js';

export const demos = [routeMessage, guardGeneration, triageBoard, smartBuild];
export const DEFAULT = routeMessage.id;
export const demoById = (id) => demos.find((d) => d.id === id) || null;

/** Named blocks of a demo from the live world: by title (and the media list for the smart-build scene). */
export function named(world, demo) {
  const out = {};
  for (const [k, title] of Object.entries(demo.names || {})) out[k] = world.nodes.find((n) => n.title === title) || null;
  if (demo.id === 'smart-build') out.media = world.nodes.filter((n) => n.typeId === 'media');
  return out;
}
