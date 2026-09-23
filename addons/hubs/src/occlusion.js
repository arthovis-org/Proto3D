// occlusion.js — is anything standing between the camera and a page's face? The CSS3D layer paints
// its iframes over the WebGL canvas, so a live frame behind a nearer block (the core Timeline, the
// build board, another card) would otherwise show through it. The live layer asks this a few times
// a second for every live frame: five sample points on the face (the centre and four points inset
// 15 % from the corners) are raycast from the camera against every other block whose box could
// cover the card on screen; any sample whose nearest hit is not the card itself means the frame is
// occluded and the depth-correct canvas face (with its static preview) shows instead.
//   pure: sampleOffsets, screenRect, rectsOverlap, decide          (unit-tested without a renderer)
//   THREE: createOccluder(THREE) → { test(node, camera, others) }   (Raycaster over the blocks' meshes)
export const INSET = 0.15;
export const EPSILON = 0.05;

/** The five sample points of a `w × h` face in face-local units (x right, y up), centre first. */
export function sampleOffsets(w, h, inset = INSET) {
  const x = w / 2 * (1 - 2 * inset), y = h / 2 * (1 - 2 * inset);
  return [[0, 0], [-x, y], [x, y], [-x, -y], [x, -y]];
}
/** Screen rect (NDC) of a set of projected points: { minX, maxX, minY, maxY, behind } — `behind` when every point is behind the camera. */
export function screenRect(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, front = 0;
  for (const p of points) { if (p.z <= 1) front++; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { minX, maxX, minY, maxY, behind: front === 0 };
}
export const rectsOverlap = (a, b, pad = 0) => !(a.behind || b.behind) && a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;
/**
 * The verdict for one face: `samples` are { distance (camera → sample point), hit (nearest other hit's distance, or null) }.
 * Occluded when any sample's nearest foreign hit is closer than the sample point (minus epsilon): a half-covered frame hides too.
 */
export function decide(samples, epsilon = EPSILON) {
  return samples.some((s) => s.hit !== null && s.hit !== undefined && s.hit < s.distance - epsilon);
}

/** Meshes a block can occlude with: its body parts and face plane (Node3D / Shape3D `meshes`, `face.mesh`), a collapsed group's slab. */
export function occluderMeshes(block) {
  const out = [];
  if (!block || block.visible === false) return out;
  for (const m of block.meshes || []) if (m && m.geometry && m.visible !== false) out.push(m);
  if (block.face?.mesh && block.face.mesh.geometry) out.push(block.face.mesh);
  if (block.kind === 'group' && block.collapsed && block.slab?.geometry) out.push(block.slab);
  return out;
}

/**
 * A tester bound to a THREE namespace. `test(node, camera, others, { facePos, faceQuat, w, h })` returns
 * { occluded, tested, samples } — `others` are the blocks to consider (already pre-filtered by the caller).
 */
export function createOccluder(THREE) {
  const ray = new THREE.Raycaster();
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();
  const _box = new THREE.Box3(), _c = new THREE.Vector3();
  function project(v, camera) { return _c.copy(v).project(camera); }
  /** Screen rect of a block's AABB (NDC). */
  function rectOf(block, camera) {
    const b = block.getAABB(_box); const pts = [];
    for (let i = 0; i < 8; i++) pts.push(project(_o.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z), camera).clone());
    return screenRect(pts);
  }
  /** Blocks whose box overlaps the card's screen rect (the cheap pre-filter). */
  function candidates(node, camera, blocks, faceRect) {
    const out = [];
    for (const b of blocks) { if (b === node || b.visible === false || !b.getAABB) continue; if (rectsOverlap(faceRect, rectOf(b, camera), 0.02)) out.push(b); }
    return out;
  }
  function test(node, camera, blocks, { facePos, faceQuat, w, h }) {
    const camPos = camera.isOrthographicCamera ? null : camera.position;
    const corners = sampleOffsets(w, h).map(([x, y]) => new THREE.Vector3(x, y, 0).applyQuaternion(faceQuat).add(facePos));
    const faceRect = screenRect(corners.map((c) => project(c, camera).clone()));
    const others = candidates(node, camera, blocks, faceRect);
    const samples = [];
    if (!others.length) return { occluded: false, tested: 0, samples };
    const meshes = []; for (const b of others) meshes.push(...occluderMeshes(b));
    if (!meshes.length) return { occluded: false, tested: 0, samples };
    const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
    for (const c of corners) {
      if (camPos) { _p.copy(camPos); _d.copy(c).sub(camPos); } else { _p.copy(c).addScaledVector(camDir, -500); _d.copy(camDir); }   // orthographic: parallel rays from far behind the camera plane
      const distance = camPos ? _d.length() : 500;
      _d.normalize(); ray.set(_p, _d); ray.far = distance + 1;
      const hits = ray.intersectObjects(meshes, false);
      samples.push({ distance, hit: hits.length ? hits[0].distance : null });
    }
    return { occluded: decide(samples), tested: meshes.length, samples };
  }
  return { test, rectOf, candidates };
}
