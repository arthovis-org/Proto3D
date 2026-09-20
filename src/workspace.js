// workspace.js — the room: renderer, camera + navigation controller, lights, a soft procedural
// environment (so the bevels on every body catch light), grid floor, fog. Listens to theme
// changes and recolors background, fog, lights, environment and the floor shader.
// `ws.camera` is a getter: the Navigator may swap in an orthographic camera (Numpad 5).
import * as THREE from 'three';
import { palette, onThemeChange, setMaxAnisotropy } from './theme.js';
import { Navigator } from './controls/navigation.js';

// Home view: ~36 deg elevation, framed so the demo graph fills most of the viewport
const HOME = { position: new THREE.Vector3(5, 30, 42), target: new THREE.Vector3(5, 0.5, 2) };

export function createWorkspace(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());   // canvas faces and labels read it
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.bg);
  scene.fog = new THREE.FogExp2(palette.fog, 0.011);

  const perspective = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 400);
  perspective.position.copy(HOME.position);

  const swapListeners = new Set();
  const controls = new Navigator(perspective, renderer.domElement, { onCameraSwap: (cam) => swapListeners.forEach((cb) => cb(cam)) });
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 3;
  controls.maxDistance = 240;
  controls.maxPolarAngle = Math.PI * 0.495; // never go under the floor
  controls.target.copy(HOME.target);
  controls.update();
  /** Subscribe to camera swaps (perspective ↔ orthographic). */
  function onCameraSwap(cb) { swapListeners.add(cb); return () => swapListeners.delete(cb); }

  /* Environment: a small equirect gradient (sky → horizon → ground) run through PMREM. It gives
     the satin bodies and their bevels something to reflect without reading as glossy. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  function buildEnvironment() {
    const [sky, horizon, ground] = palette.env;
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, sky); grad.addColorStop(0.5, horizon); grad.addColorStop(1, ground);
    g.fillStyle = grad; g.fillRect(0, 0, 128, 64);
    // a soft, wide key "window" high on one side so bevels get a highlight
    const spot = g.createRadialGradient(40, 14, 2, 40, 14, 34);
    spot.addColorStop(0, 'rgba(255,255,255,0.85)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spot; g.fillRect(0, 0, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
    const env = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    if (scene.environment) scene.environment.dispose();
    scene.environment = env;
  }
  buildEnvironment();

  /* Lighting: soft sky/ground hemisphere + key light + cool fill. Calm, not dramatic. */
  const hemi = new THREE.HemisphereLight(palette.skyLight, palette.groundLight, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(12, 24, 14);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7f9cff, 0.5);
  fill.position.set(-16, 8, -10);
  scene.add(fill);

  /* Floor: one shader plane = gradient pool under the work + anti-aliased 1-unit / 5-unit grid,
     radially faded to nothing by ~40 units so there is no moire and no visible edge. */
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      inner: { value: new THREE.Color(palette.ground) },
      outer: { value: new THREE.Color(palette.bg) },
      minorColor: { value: new THREE.Color(palette.gridMinor) },
      majorColor: { value: new THREE.Color(palette.gridMajor) },
      fadeRadius: { value: 40.0 },
      gridOn: { value: 1.0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 inner, outer, minorColor, majorColor; uniform float fadeRadius; uniform float gridOn;
      varying vec2 vW;
      // 1px anti-aliased grid line mask for a given cell size
      float gridLine(vec2 p, float scale) {
        vec2 c = p / scale;
        vec2 fw = fwidth(c);
        vec2 g = abs(fract(c - 0.5) - 0.5) / fw;
        return 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y));
      }
      void main() {
        float dist = length(vW);
        vec3 col = mix(inner, outer, smoothstep(0.08, 1.0, dist / (fadeRadius * 1.5)));
        float fade = (1.0 - smoothstep(0.3, 1.0, dist / fadeRadius)) * gridOn;
        // screen-space cell size: drop minor lines when a cell is under ~4px, major under ~8px
        float px = max(fwidth(vW.x), fwidth(vW.y));
        float minorVis = 1.0 - smoothstep(0.12, 0.3, px);
        float majorVis = 1.0 - smoothstep(0.5, 0.9, px);
        float minor = gridLine(vW, 1.0) * minorVis * 0.55;
        float major = gridLine(vW, 5.0) * majorVis;
        col = mix(col, minorColor, minor * fade);
        col = mix(col, majorColor, major * fade);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  function applyTheme() {
    buildEnvironment();
    scene.background.setHex(palette.bg);
    scene.fog.color.setHex(palette.fog);
    hemi.color.setHex(palette.skyLight); hemi.groundColor.setHex(palette.groundLight);
    floorMat.uniforms.inner.value.setHex(palette.ground);
    floorMat.uniforms.outer.value.setHex(palette.bg);
    floorMat.uniforms.minorColor.value.setHex(palette.gridMinor);
    floorMat.uniforms.majorColor.value.setHex(palette.gridMajor);
  }
  onThemeChange(applyTheme);

  function setGridVisible(on) { floorMat.uniforms.gridOn.value = on ? 1 : 0; }
  function isGridVisible() { return floorMat.uniforms.gridOn.value > 0.5; }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    controls.setAspect(w / h);
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);

  function resetCamera() {
    controls.camera.position.copy(HOME.position);
    controls.target.copy(HOME.target);
    controls.update();
  }

  /* Camera flights: F focuses the selection, Home frames everything, double-click focuses a block. */
  let flight = null;
  function flyTo(position, target, duration = 0.55) {
    const camera = controls.camera;
    if (duration <= 0) { camera.position.copy(position); controls.target.copy(target); controls.update(); flight = null; return; }
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: position.clone(), t1: target.clone(), k: 0, duration, start: performance.now() };
  }
  function cancelFlight() { flight = null; }
  controls.addEventListener('start', cancelFlight); // a hand on the camera always wins
  function updateFlight() {
    if (!flight) return;
    flight.k = Math.min(1, (performance.now() - flight.start) / 1000 / flight.duration);
    const e = 1 - Math.pow(1 - flight.k, 3);
    controls.camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    if (flight.k >= 1) flight = null;
  }
  /**
   * Frame a set of blocks. The visible area is the canvas (already excludes the left rail and the
   * right panel) minus `insetLeft` px (an open flyout). Keeping the current azimuth at a fixed
   * ~35° elevation, find the distance at which the blocks' bounding box fills `fill` (75 %) of the
   * visible width or height, whichever binds, then centre the box in that area.
   */
  const ELEVATION = THREE.MathUtils.degToRad(35);
  function frameBlocks(blocks, { fill = 0.75, minRadius = 3, instant = false, insetLeft = 0 } = {}) {
    const list = (blocks || []).filter(Boolean);
    const dur = instant ? 0 : 0.55;
    if (!list.length) { flyTo(HOME.position, HOME.target, dur); return null; }
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const b of list) { if (b.getAABB) box.union(b.getAABB(tmp)); else if (b.center) box.expandByPoint(b.center); }
    box.expandByScalar(minRadius * 0.2);
    const center = box.getCenter(new THREE.Vector3());
    const camera = controls.perspective;
    // view direction: current azimuth, fixed elevation
    const cur = controls.camera.position.clone().sub(controls.target);
    const az = Math.atan2(cur.x, cur.z || 1e-6);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(az) * Math.cos(ELEVATION));
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const W = container.clientWidth || 1, H = container.clientHeight || 1;
    const visW = Math.max(100, W - insetLeft);               // visible pixels
    const cam = new THREE.PerspectiveCamera(camera.fov, W / H, camera.near, camera.far);
    const ndc = new THREE.Vector3();
    // projected extents of the box (in pixels) at a given distance
    const extents = (dist) => {
      cam.position.copy(center).addScaledVector(dir, dist); cam.lookAt(center); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      let minX = 1, maxX = -1, minY = 1, maxY = -1;
      for (const c of corners) { ndc.copy(c).project(cam); minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x); minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y); }
      return { pxW: (maxX - minX) / 2 * W, pxH: (maxY - minY) / 2 * H, minX, maxX, minY, maxY };
    };
    // the projected size is ~inversely proportional to distance: two passes converge closely
    let dist = Math.max(8, box.getSize(new THREE.Vector3()).length());
    for (let i = 0; i < 4; i++) {
      const e = extents(dist);
      const k = Math.max(e.pxW / (visW * fill), e.pxH / (H * fill)); // >1 → too close
      dist = THREE.MathUtils.clamp(dist * k, 6, controls.maxDistance);
    }
    // centre the box in the visible area (shift target sideways / up in view space)
    const e = extents(dist);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), halfW = halfH * (W / H);
    const visCentreNdc = insetLeft / W;                       // centre of the visible area in NDC x
    const cx = (e.minX + e.maxX) / 2 - visCentreNdc, cy = (e.minY + e.maxY) / 2;
    const target = center.clone().addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH);
    flyTo(target.clone().addScaledVector(dir, dist), target, dur);
    return dist;
  }
  /** Fog thins as the camera pulls back so a far overview stays readable instead of fading out. */
  function updateFog() {
    const d = controls.camera.position.distanceTo(controls.target);
    scene.fog.density = 0.011 * THREE.MathUtils.clamp(45 / Math.max(d, 1), 0.28, 1);
    floorMat.uniforms.fadeRadius.value = Math.max(40, d * 0.5); // the lit pool grows with the overview
  }

  return {
    renderer, scene, controls, resize, resetCamera, applyTheme, setGridVisible, isGridVisible, HOME, flyTo, cancelFlight, updateFlight, frameBlocks, updateFog, onCameraSwap, buildEnvironment,
    /** True while a camera flight (F, Home, Go to) is still animating. */
    inFlight: () => !!flight,
    /** The active camera (perspective, or orthographic after Numpad 5). */
    get camera() { return controls.camera; },
    get perspective() { return controls.perspective; },
  };
}
