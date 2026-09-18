// Log — keeps the last n values that arrived (on change or on trigger) and lists them on its face.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { equal } from '../../core/types.js';
import { clear, font } from '../../faces.js';
import { asText } from '../util.js';

export default registry.register({
  id: 'log', category: 'output', label: 'Log', icon: icons.log, size: 'M',
  description: 'Keeps the last entries that arrived, with timestamps',
  inputs: [{ key: 'in', label: 'in', type: 'any', optional: true }, { key: 'trigger', label: 'trigger', type: 'event', optional: true }],
  outputs: [{ key: 'count', label: 'count', type: 'number' }],
  params: [{ key: 'keep', label: 'keep', type: 'number', default: 8, min: 1, max: 8, step: 1 }],
  evaluate({ inputs, params, state, time }) {
    state.entries = state.entries || [];
    state.total = state.total || 0;
    const push = (v) => { state.entries.push({ t: +time.toFixed(1), text: asText(v).slice(0, 60) }); state.total += 1; while (state.entries.length > Math.max(1, params.keep)) state.entries.shift(); };
    if (inputs.trigger) push(inputs.trigger.payload !== undefined ? inputs.trigger.payload : inputs.in);
    else if (inputs.in !== undefined && !equal(state.last, inputs.in)) push(inputs.in);
    state.last = inputs.in;
    return { count: state.total };
  },
  footer: ({ state }) => `${state.total || 0} entries`,
  face: {
    render(g, w, h, { state }) {
      clear(g, w, h);
      const entries = state.entries || [];
      const rows = 8, rh = (h - 16) / rows;
      g.textBaseline = 'middle'; g.textAlign = 'left';
      if (!entries.length) { g.fillStyle = palette.faceDim; g.font = font(18); g.fillText('nothing logged yet', 14, h / 2); return; }
      entries.slice().reverse().forEach((e, i) => {
        const y = 8 + i * rh + rh / 2;
        g.fillStyle = i === 0 ? palette.faceAccent : palette.faceDim; g.font = font(rh * 0.5, 500, true);
        g.fillText(`${e.t.toFixed(1)}s`, 12, y);
        g.fillStyle = i === 0 ? palette.faceText : palette.faceDim; g.font = font(rh * 0.55, i === 0 ? 600 : 500);
        const maxW = w - 110; let s = e.text; while (s.length > 2 && g.measureText(s).width > maxW) s = s.slice(0, -2);
        g.fillText(s === e.text ? s : s + '…', 96, y);
      });
    },
  },
});
