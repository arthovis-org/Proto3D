// The occlusion math: sample points, the screen-rect pre-filter, the verdict, and the THREE
// raycast tester on a fake world (boxes standing between a camera and a face).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleOffsets, screenRect, rectsOverlap, decide, occluderMeshes, createOccluder, INSET } from '../../src/occlusion.js';

test('sampleOffsets: the centre and four points inset 15 % from the corners', () => {
  const s = sampleOffsets(8, 6);
  assert.deepEqual(s[0], [0, 0]); assert.equal(s.length, 5);
  assert.deepEqual(s[1], [-4 * (1 - 2 * INSET), 3 * (1 - 2 * INSET)]); assert.deepEqual(s[4], [4 * 0.7, -3 * 0.7]);
});
test('decide: any sample with a nearer foreign hit occludes; hits behind the face or within epsilon do not', () => {
  assert.equal(decide([{ distance: 10, hit: null }, { distance: 10, hit: 12 }]), false);
  assert.equal(decide([{ distance: 10, hit: null }, { distance: 10, hit: 6 }]), true, 'a half-covered frame hides too');
  assert.equal(decide([{ distance: 10, hit: 9.98 }]), false, 'the face itself, within epsilon');
  assert.equal(decide([]), false);
});
test('screenRect / rectsOverlap: NDC boxes, everything behind the camera never overlaps', () => {
  const a = screenRect([{ x: -0.5, y: -0.5, z: 0.5 }, { x: 0.5, y: 0.5, z: 0.5 }]);
  assert.deepEqual(a, { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, behind: false });
  assert.equal(rectsOverlap(a, screenRect([{ x: 0.4, y: 0.4, z: 0.2 }, { x: 0.9, y: 0.9, z: 0.2 }])), true);
  assert.equal(rectsOverlap(a, screenRect([{ x: 0.6, y: 0.6, z: 0.2 }, { x: 0.9, y: 0.9, z: 0.2 }])), false);
  assert.equal(rectsOverlap(a, screenRect([{ x: 0, y: 0, z: 1.5 }])), false, 'behind the camera');
});

/** A fake block: a box mesh at `pos` with the block's AABB around it. */
function block(uid, pos, size = [8, 6, 0.2]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size)); mesh.position.set(...pos); mesh.updateMatrixWorld(true);
  const b = { uid, kind: 'node', visible: true, meshes: [mesh], face: null, position: mesh.position, getAABB(box = new THREE.Box3()) { return box.setFromCenterAndSize(mesh.position, new THREE.Vector3(...size)); } };
  return b;
}
test('createOccluder: a card behind another block is occluded, one with a clear line of sight is not; partial cover counts; hidden blocks are ignored', () => {
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.1, 400); camera.position.set(0, 4, 40); camera.lookAt(0, 3, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const card = block('card', [0, 3, 0]);
  const clear = block('clear', [30, 3, 0]);
  const blocker = block('blocker', [0, 3, 15]);           // right between the camera and the card
  const partial = block('partial', [2, 3, 15], [4, 6, 0.2]);   // covers the card's right side only (the rays to the right samples pass x ≈ 1.7 at z = 15)
  const occ = createOccluder(THREE);
  const face = { facePos: card.position.clone().add(new THREE.Vector3(0, 0, 0.1)), faceQuat: new THREE.Quaternion(), w: 7.8, h: 5.8 };
  assert.equal(occ.test(card, camera, [card, clear], face).occluded, false, 'nothing in front');
  const r = occ.test(card, camera, [card, clear, blocker], face);
  assert.equal(r.occluded, true); assert.equal(r.tested, 1, 'only the pre-filtered block was raycast'); assert.ok(r.samples.every((s) => s.hit < s.distance));
  const p = occ.test(card, camera, [card, partial], face);
  assert.equal(p.occluded, true, 'a partly covered frame hides'); assert.ok(p.samples.some((s) => s.hit === null) && p.samples.some((s) => s.hit !== null));
  blocker.visible = false;
  assert.equal(occ.test(card, camera, [card, blocker], face).occluded, false, 'a hidden block does not occlude');
  assert.deepEqual(occluderMeshes(blocker), []); blocker.visible = true; assert.equal(occluderMeshes(blocker).length, 1);
  assert.equal(occluderMeshes({ kind: 'group', collapsed: true, visible: true, slab: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)) }).length, 1);
  // a block behind the card never occludes it
  assert.equal(occ.test(card, camera, [card, block('behind', [0, 3, -10])], face).occluded, false);
});
