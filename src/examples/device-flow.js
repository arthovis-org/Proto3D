// examples/device-flow.js — starter template: the reference interaction loop. A button (or a tap
// on the phone) counts presses; Compare and Gate turn the count into a condition; a decision routes
// each press to an Action that unlocks the laptop or to a Log; the phone shows the count.
export default {
  id: 'device-flow', label: 'Interactive device flow', template: true,
  description: 'Input button → Action (count) → Compare / Gate → decision → Action → Laptop, with the Phone showing the count and a Log',
  hint: 'Press the button — or tap the phone — three times: the laptop unlocks, the log keeps the earlier presses.',
  focus: (named) => Object.values(named).flat(),
  build({ add, connect }) {
    const button = add('input', [-19, null, 4], { title: 'Press me', params: { mode: 'button', label: 'Press' } });
    const phone = add('phone', [-19, 0, -4.5], { title: 'Phone', params: { caption: 'Tap to count' } });
    const count = add('action', [-10, null, 0], { title: 'Count presses', params: { mode: 'count' } });
    const compare = add('compare', [-2, null, -3.5], { title: 'Three or more?', params: { op: '≥', b: '3' } });
    const gate = add('gate', [5, null, -7], { title: 'Still locked', params: { mode: 'NOT' } });
    const locked = add('display', [13, null, -7], { title: 'Locked?' });
    const decide = add('flow-decision', [6, null, 1.5], { title: 'Reached 3?' });
    const unlock = add('action', [14, null, 0], { title: 'Unlock', params: { mode: 'pass', payload: 'Unlocked' } });
    const laptop = add('laptop', [24, 0, 0], { title: 'Laptop' });
    const log = add('log', [14, null, 6.5], { title: 'Presses so far' });

    connect(button, 'trigger', count, 'trigger');
    connect(phone, 'tap', count, 'trigger');
    connect(count, 'result', phone, 'screen');          // the phone shows the count
    connect(count, 'result', compare, 'a');
    connect(compare, 'result', gate, 'in');
    connect(gate, 'result', locked, 'in');
    connect(count, 'done', decide, 'in');
    connect(compare, 'result', decide, 'condition');
    connect(decide, 'yes', unlock, 'trigger');
    connect(unlock, 'result', laptop, 'screen');
    connect(decide, 'no', log, 'trigger');
    connect(count, 'result', log, 'in');
    return { button, phone, count, compare, gate, locked, decide, unlock, laptop, log };
  },
};
