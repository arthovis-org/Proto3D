// examples/phone-to-laptop.js — Demo 2: a phone provides input, logic decides, an action
// affects the laptop. Tap the phone screen: after more than 3 taps the laptop shows "Unlocked".
//   Phone.tap → Action(count) → Compare(> 3) → Branch → Action(pass "Unlocked") ─┐
//                                                    └→ Action(pass "Locked")   ─┴→ Laptop.screen
//   Phone.tilt → Transform(map range −45..45 → 0..100) → Display
export default {
  id: 'phone-to-laptop', label: 'Phone → Logic → Laptop',
  description: 'Tap the phone 4 times to unlock the laptop; tilt drives a display',
  camera: { position: [1, 24, 34], target: [1, 1, 1] },
  build({ add, connect, group }) {
    const phone = add('phone', [-14, 0, 2]);
    const count = add('action', [-7.5, null, 2], { title: 'Count taps', params: { mode: 'count' } });
    const compare = add('compare', [-1.5, null, 2], { title: 'More than 3?', params: { op: '>', b: '3' } });
    const branch = add('branch', [4.5, null, 2], { title: 'Unlocked?' });
    const unlock = add('action', [10.5, null, -1], { title: 'Say Unlocked', params: { mode: 'pass', payload: 'Unlocked' } });
    const lock = add('action', [10.5, null, 5], { title: 'Say Locked', params: { mode: 'pass', payload: 'Locked' } });
    const laptop = add('laptop', [16.5, 0, 2]);
    const map = add('transform', [-7.5, null, -4.5], { title: 'Tilt → %', params: { mode: 'map range', inMin: -45, inMax: 45, outMin: 0, outMax: 100 } });
    const show = add('display', [-1.5, null, -6], { title: 'Tilt %', params: { caption: 'phone tilt as percent' } });

    connect(phone, 'tap', count, 'trigger');
    connect(count, 'result', compare, 'a');
    connect(compare, 'result', branch, 'condition');
    connect(branch, 'onTrue', unlock, 'trigger');
    connect(branch, 'onFalse', lock, 'trigger');
    connect(unlock, 'result', laptop, 'screen');
    connect(lock, 'result', laptop, 'screen');
    connect(phone, 'tilt', map, 'a');
    connect(map, 'result', show, 'in');
    group('Unlock logic', [count, compare, branch, unlock, lock]);
    return { phone, count, compare, branch, unlock, lock, laptop, map, show };
  },
};
