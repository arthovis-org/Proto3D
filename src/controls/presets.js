// controls/presets.js — navigation presets: how mouse buttons, modifiers, the wheel and keys
// map to camera and selection actions. A preset is plain data, so the help sheet, the tour hint
// and the workspace panel are generated from it and a new preset appears everywhere at once.
//
//   mouse: ordered rows { button: 0 left | 1 middle | 2 right, mods: { shift, ctrl, alt }, action };
//          the first row whose button and modifiers match wins. Camera actions: orbit, pan,
//          dolly (drag to zoom), turn (rotate the camera in place). Pointer actions: marquee /
//          marqueeAdd (box select on empty space; a press on a body still selects and moves it),
//          contextSelect (select + open the panel).
//   wheel: { plain, shift, ctrl } → dolly | panY | panX | orbit | pan (orbit / pan are two-axis:
//          deltaX and deltaY both count, for a trackpad's two-finger scroll). A pinch (a wheel
//          event whose ctrlKey is set while no Control key is down) always dollies, in every preset.
//   wheelLabel / wheelFirst: how the sheet names the wheel ("Two-finger scroll") and whether the
//          wheel bindings are the primary ones (`bindingFor` prefers them over the mouse rows)
//   keys:  action → ['Code', 'Mod+Code'] using KeyboardEvent.code (Ctrl also matches Meta)
//   fly:   right-drag + WASD / QE flies the camera (Unreal); the wheel changes the fly speed
//   settings: per-preset defaults the workspace panel edits
//
// Touch (pointerType 'touch') ignores the mouse rows in every preset: TOUCH_GESTURES below is the
// fixed table controls/navigation.js and interaction.js implement.
export const PRESETS = {
  blender: {
    id: 'blender', label: 'Blender', description: 'Middle-drag orbits, Shift pans, Ctrl zooms; numpad views; left-drag box-selects',
    mouse: [
      { button: 1, mods: { shift: true }, action: 'pan' },
      { button: 1, mods: { ctrl: true }, action: 'dolly' },
      { button: 1, action: 'orbit' },
      { button: 0, mods: { alt: true, shift: true }, action: 'pan' },
      { button: 0, mods: { alt: true }, action: 'orbit' },
      { button: 0, mods: { shift: true }, action: 'marqueeAdd' },
      { button: 0, action: 'marquee' },
      { button: 2, action: 'contextSelect' },
    ],
    wheel: { plain: 'dolly', shift: 'panY', ctrl: 'panX' },
    addModifier: 'shift',
    keys: {
      focus: ['NumpadDecimal', 'Shift+KeyF', 'KeyF'], frameAll: ['Home'],
      viewFront: ['Numpad1'], viewRight: ['Numpad3'], viewTop: ['Numpad7'], viewBack: ['Ctrl+Numpad1'], viewLeft: ['Ctrl+Numpad3'], viewBottom: ['Ctrl+Numpad7'],
      ortho: ['Numpad5'], rotUp: ['Numpad8'], rotDown: ['Numpad2'], rotLeft: ['Numpad4'], rotRight: ['Numpad6'],
      selectAll: ['KeyA'], selectNone: ['Alt+KeyA'], delete: ['KeyX', 'Delete', 'Backspace'], duplicateMove: ['Shift+KeyD'],
      gizmoMove: ['KeyG'], gizmoRotate: ['KeyR'], gizmoScale: ['KeyS'], panel: ['Tab'],
    },
    settings: { invertOrbit: false, invertZoom: false, orbitSpeed: 1, panSpeed: 1, zoomToCursor: true, flySpeed: 1 },
  },
  unreal: {
    id: 'unreal', label: 'Unreal', description: 'Right-drag looks around (+ WASD flies), middle-drag pans, Alt+left orbits, wheel zooms',
    mouse: [
      { button: 0, mods: { alt: true }, action: 'orbit' },
      { button: 2, action: 'turn' },
      { button: 1, action: 'pan' },
      { button: 0, mods: { ctrl: true }, action: 'marqueeAdd' },
      { button: 0, action: 'marquee' },
    ],
    wheel: { plain: 'dolly' },
    addModifier: 'ctrl',
    fly: true,
    keys: { focus: ['KeyF'], frameAll: ['Home'], selectAll: ['Ctrl+KeyA'], delete: ['Delete', 'Backspace'], duplicateMove: ['Ctrl+KeyW'], gizmoMove: ['KeyW'], gizmoRotate: ['KeyE'], gizmoScale: ['KeyR'], viewTop: ['Numpad7'], viewFront: ['Numpad1'], viewRight: ['Numpad3'], ortho: ['Numpad5'] },
    settings: { invertOrbit: false, invertZoom: false, orbitSpeed: 1, panSpeed: 1, zoomToCursor: true, flySpeed: 1 },
  },
  maya: {
    id: 'maya', label: 'Maya', description: 'Alt+left orbits, Alt+middle pans, Alt+right zooms; left-drag box-selects',
    mouse: [
      { button: 0, mods: { alt: true }, action: 'orbit' },
      { button: 1, mods: { alt: true }, action: 'pan' },
      { button: 2, mods: { alt: true }, action: 'dolly' },
      { button: 0, mods: { shift: true }, action: 'marqueeAdd' },
      { button: 0, action: 'marquee' },
      { button: 2, action: 'contextSelect' },
    ],
    wheel: { plain: 'dolly' },
    addModifier: 'shift',
    keys: { focus: ['KeyF'], frameAll: ['Home', 'KeyA'], selectAll: ['Ctrl+KeyA'], delete: ['Delete', 'Backspace'], duplicateMove: ['Ctrl+KeyD'], gizmoMove: ['KeyW'], gizmoRotate: ['KeyE'], gizmoScale: ['KeyR'], viewTop: ['Numpad7'], viewFront: ['Numpad1'], viewRight: ['Numpad3'], ortho: ['Numpad5'] },
    settings: { invertOrbit: false, invertZoom: false, orbitSpeed: 1, panSpeed: 1, zoomToCursor: true, flySpeed: 1 },
  },
  simple: {
    id: 'simple', label: 'Simple', description: 'Left-drag on empty space orbits, right-drag pans, wheel zooms, Shift+left-drag box-selects',
    mouse: [
      { button: 0, mods: { shift: true }, action: 'marqueeAdd' },
      { button: 0, action: 'orbit' },
      { button: 2, action: 'pan' },
      { button: 1, action: 'dolly' },
    ],
    wheel: { plain: 'dolly' },
    addModifier: 'shift',
    keys: { focus: ['KeyF'], frameAll: ['Home'], selectAll: ['Ctrl+KeyA'], delete: ['Delete', 'Backspace'], gizmoMove: ['KeyW'], gizmoRotate: ['KeyE'], gizmoScale: ['KeyR'] },
    settings: { invertOrbit: false, invertZoom: false, orbitSpeed: 1, panSpeed: 1, zoomToCursor: false, flySpeed: 1 },
  },
  trackpad: {
    id: 'trackpad', label: 'Trackpad', description: 'Two-finger scroll orbits, Shift+scroll pans, pinch zooms; drag on empty space box-selects',
    mouse: [
      { button: 0, mods: { alt: true, shift: true }, action: 'pan' },
      { button: 0, mods: { alt: true }, action: 'orbit' },
      { button: 0, mods: { shift: true }, action: 'marqueeAdd' },
      { button: 0, action: 'marquee' },
      { button: 2, action: 'pan' },
    ],
    wheel: { plain: 'orbit', shift: 'pan', ctrl: 'dolly' },
    wheelLabel: 'Two-finger scroll', wheelFirst: true,
    addModifier: 'shift',
    keys: {
      focus: ['KeyF'], frameAll: ['Home'], selectAll: ['Ctrl+KeyA'], delete: ['Delete', 'Backspace'], gizmoMove: ['KeyW'], gizmoRotate: ['KeyE'], gizmoScale: ['KeyR'],
      viewFront: ['Numpad1'], viewRight: ['Numpad3'], viewTop: ['Numpad7'], viewBack: ['Ctrl+Numpad1'], viewLeft: ['Ctrl+Numpad3'], viewBottom: ['Ctrl+Numpad7'],
      ortho: ['Numpad5'], rotUp: ['Numpad8'], rotDown: ['Numpad2'], rotLeft: ['Numpad4'], rotRight: ['Numpad6'],
    },
    settings: { invertOrbit: false, invertZoom: false, orbitSpeed: 1, panSpeed: 1, zoomToCursor: true, flySpeed: 1 },
  },
};
export const PRESET_IDS = Object.keys(PRESETS);
export const DEFAULT_PRESET = 'blender';

/** Human names for actions (help sheet, panel). */
export const ACTION_LABELS = {
  orbit: 'Orbit', pan: 'Pan', dolly: 'Zoom (drag)', turn: 'Look around', marquee: 'Box select', marqueeAdd: 'Box select (add)', contextSelect: 'Select + properties',
  select: 'Select', add: 'Add to selection', panY: 'Pan up / down', panX: 'Pan left / right', fly: 'Fly (while looking around)', flySpeed: 'Fly speed',
  focus: 'Focus selection', frameAll: 'Frame all', viewFront: 'Front view', viewRight: 'Right view', viewTop: 'Top view', viewBack: 'Back view', viewLeft: 'Left view', viewBottom: 'Top view (mirrored)',
  ortho: 'Orthographic / perspective', rotUp: 'Orbit up 15°', rotDown: 'Orbit down 15°', rotLeft: 'Orbit left 15°', rotRight: 'Orbit right 15°',
  selectAll: 'Select all', selectNone: 'Select none', delete: 'Delete', duplicateMove: 'Duplicate + move', gizmoMove: 'Gizmo: move', gizmoRotate: 'Gizmo: rotate', gizmoScale: 'Gizmo: scale', panel: 'Properties panel',
  pinch: 'Zoom',
};
/** Wheel rows read as scrolling, not dragging: "Zoom" rather than "Zoom (drag)". */
export const WHEEL_LABELS = { dolly: 'Zoom', orbit: 'Orbit', pan: 'Pan', panX: 'Pan left / right', panY: 'Pan up / down' };
/** Touch gestures (the same in every preset; 2D swaps orbit for pan). */
export const TOUCH_GESTURES = [
  { gesture: 'One finger on empty space', action: 'Orbit (3D) · pan (2D)' },
  { gesture: 'Two fingers', action: 'Pan · pinch to zoom' },
  { gesture: 'Tap a block', action: 'Select' },
  { gesture: 'Drag a block', action: 'Move' },
  { gesture: 'Long-press empty space', action: 'Box select' },
  { gesture: 'Long-press a block', action: 'Select + properties' },
];
const BUTTON_NAMES = ['Left', 'Middle', 'Right'];
const MOD_NAMES = { shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt' };
/** "Shift+Middle-drag" */
export function mouseBindingText(row) {
  const mods = Object.keys(row.mods || {}).filter((k) => row.mods[k]).map((k) => MOD_NAMES[k]);
  return [...mods, `${BUTTON_NAMES[row.button]}-drag`].join('+');
}
export function keyBindingText(code) {
  return code.split('+').map((c) => c.replace(/^Key/, '').replace(/^Numpad(.+)$/, (m, k) => `Numpad ${k === 'Decimal' ? '.' : k}`).replace(/^Digit/, '')).join('+');
}
/** "Wheel" / "Shift+wheel", or the preset's own name for it ("Two-finger scroll" / "Shift+two-finger scroll"). */
export function wheelBindingText(preset, key) {
  const name = preset.wheelLabel || 'Wheel';
  return key === 'plain' ? name : `${MOD_NAMES[key]}+${name.charAt(0).toLowerCase() + name.slice(1)}`;
}
/** The cheat sheet for a preset: [{ group, action, label, binding }] in a stable order. */
export function presetSheet(preset) {
  const rows = [];
  for (const m of preset.mouse) rows.push({ group: 'Mouse', action: m.action, label: ACTION_LABELS[m.action] || m.action, binding: mouseBindingText(m) });
  rows.push({ group: 'Mouse', action: 'select', label: 'Select', binding: 'Left-click' });
  rows.push({ group: 'Mouse', action: 'add', label: 'Add to selection', binding: `${MOD_NAMES[preset.addModifier]}+click` });
  for (const [k, a] of Object.entries(preset.wheel)) rows.push({ group: 'Wheel', action: a, label: WHEEL_LABELS[a] || ACTION_LABELS[a] || a, binding: wheelBindingText(preset, k) });
  rows.push({ group: 'Wheel', action: 'pinch', label: ACTION_LABELS.pinch, binding: 'Pinch' });
  if (preset.fly) { rows.push({ group: 'Wheel', action: 'fly', label: ACTION_LABELS.fly, binding: 'Right-drag + W A S D / Q E' }); rows.push({ group: 'Wheel', action: 'flySpeed', label: ACTION_LABELS.flySpeed, binding: 'Wheel while looking around' }); }
  for (const [a, codes] of Object.entries(preset.keys)) rows.push({ group: 'Keys', action: a, label: ACTION_LABELS[a] || a, binding: codes.map(keyBindingText).join(' · ') });
  return rows;
}
/** The binding text for one action ("Middle-drag", "Alt+Left-drag", "Two-finger scroll", "Pinch"), or null. */
export function bindingFor(preset, action) {
  const m = preset.mouse.find((r) => r.action === action);
  const w = Object.entries(preset.wheel).find(([, a]) => a === action);
  const wheel = w ? (action === 'dolly' && preset.wheelFirst ? 'Pinch' : wheelBindingText(preset, w[0])) : null;
  if (preset.wheelFirst && wheel) return wheel;
  if (m) return mouseBindingText(m);
  if (wheel) return wheel;
  const k = preset.keys[action];
  return k ? keyBindingText(k[0]) : null;
}
