// workspace.js — the room: renderer, camera + orbit controls, lights, grid floor, fog.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { palette } from './theme.js';

// Home view: ~36 deg elevation, framed so the demo graph fills most of the viewport
const HOME = { position: new THREE.Vector3(5, 30, 42), target: new THREE.Vector3(5, 0.5, 2) };

export function createWorkspace(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.bg);
  scene.fog = new THREE.FogExp2(palette.fog, 0.011);

  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 400);
  camera.position.copy(HOME.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 140;
  controls.maxPolarAngle = Math.PI * 0.495; // never go under the floor
  controls.target.copy(HOME.target);
  controls.update();

  /* Lighting: soft sky/ground hemisphere + key light + cool fill. Calm, not dramatic. */
  scene.add(new THREE.HemisphereLight(0xb8c7e0, 0x141a26, 0.9));
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
    },
    vertexShader: /* glsl */`
      varying vec2 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 inner, outer, minorColor, majorColor; uniform float fadeRadius;
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
        float fade = 1.0 - smoothstep(0.3, 1.0, dist / fadeRadius);
        // screen-space cell size: drop minor lines when a cell is under ~4px, major under ~8px
        float px = max(fwidth(vW.x), fwidth(vW.y));
        float minorVis = 1.0 - smoothstep(0.12, 0.3, px);
        float majorVis = 1.0 - smoothstep(0.5, 0.9, px);
        float minor = gridLine(vW, 1.0) * minorVis * 0.55;
        float major = gridLine(vW, 5.0) * majorVis;
        col = mix(col, minorColor, minor * fade);
        col = mix(col, majorColor, major * fade);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function resetCamera() {
    camera.position.copy(HOME.position);
    controls.target.copy(HOME.target);
    controls.update();
  }

  return { renderer, scene, camera, controls, resize, resetCamera, HOME };
}
