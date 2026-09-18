// components/devices/device-common.js — devices are components too: one "screen" input that
// renders any value, a "tap" event emitted by clicking the screen in 3D, and a slowly varying
// sensor number. This factory keeps the four devices identical in anatomy.
import { icons } from '../../icons.js';
import { states, hex } from '../../theme.js';
import { drawScreen } from '../../faces.js';
import { formatValue } from '../util.js';

export function deviceDefinition({ id, label, description, sensor, extraOutputs = [], extraEvaluate = () => ({}), seed = 0 }) {
  return {
    id, category: 'devices', label, description, icon: icons[id], device: id,
    inputs: [{ key: 'screen', label: 'screen', type: 'any', optional: true }],
    outputs: [{ key: 'tap', label: 'tap', type: 'event' }, { key: sensor.key, label: sensor.label, type: 'number' }, ...extraOutputs],
    params: [
      { key: 'caption', label: 'caption', type: 'text', default: '' },
      { key: 'sensorSpeed', label: `${sensor.label} speed`, type: 'number', default: 1, min: 0, max: 5, step: 0.1 },
    ],
    evaluate(ctx) {
      const { params, time } = ctx;
      const t = time * params.sensorSpeed + seed;
      const v = sensor.min + (sensor.max - sensor.min) * (0.5 + 0.5 * Math.sin(t * 0.6) * Math.cos(t * 0.23));
      return { [sensor.key]: +v.toFixed(sensor.decimals ?? 1), ...extraEvaluate(ctx) };
    },
    footer: ({ inputs }) => formatValue(inputs.screen, 24),
    face: {
      live: true, fps: 6,
      render(g, w, h, { inputs, params, state, instance, time }) {
        const s = instance.derivedState;
        drawScreen(g, w, h, {
          title: params.caption || instance.title, value: inputs.screen, time,
          accent: s === 'error' ? hex(states.error) : s === 'active' ? hex(states.active) : '#8fb6ff',
          hint: state.taps ? `${state.taps} tap${state.taps > 1 ? 's' : ''}` : 'tap me',
        });
      },
      onPointer({ state, instance }, ev) {
        if (ev.type !== 'click') return false;
        state.taps = (state.taps || 0) + 1;
        instance.emit('tap', { n: state.taps, u: +ev.u.toFixed(2), v: +ev.v.toFixed(2) });
        return true;
      },
    },
  };
}
