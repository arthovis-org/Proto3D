// lod.js — level of detail by camera distance. Beyond `sizes.lod.far` nodes drop port labels
// and footers and grow their title, connections thin out, group titles enlarge. Hysteresis
// keeps the switch from flickering; the blocks themselves animate the crossfade.
import * as THREE from 'three';
import { sizes } from './theme.js';

const _m = new THREE.Vector3();
export function updateLOD(world, camera, dt) {
  const far = sizes.lod.far, hys = sizes.lod.hysteresis;
  const cam = camera.position;
  for (const n of world.nodes) {
    const d = cam.distanceTo(n.position);
    const level = n.lod ? (d < far - hys ? 0 : 1) : (d > far + hys ? 1 : 0);
    n.setLOD(level, d);
  }
  for (const c of world.connections) {
    c.midpoint(_m);
    const d = cam.distanceTo(_m);
    c.setFar(c.far ? d > far - hys : d > far + hys);
  }
  for (const g of world.groups) {
    const d = cam.distanceTo(g.center);
    g.setFar(g.far ? d > far - hys : d > far + hys, d);
  }
}
/** Distance from the camera to the nearest node (workspace panel readout). */
export function nearestDistance(world, camera) {
  let best = Infinity;
  for (const n of world.nodes) best = Math.min(best, camera.position.distanceTo(n.position));
  return best;
}
