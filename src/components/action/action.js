// Action — does something when a trigger arrives: pass a payload on, toggle, count, latch,
// delay or iterate. `result` holds the outcome; `done` pulses when it happened. Iterate walks a
// list one item per trigger (or every `interval` ms when `auto` is on): `result` is the item,
// `index` its position, `done` pulses when the last item went out (the next trigger wraps) — pair
// it with a Prompt variable and a Generate `run` for one image per row.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { equal } from '../../core/types.js';
import { parseLiteral, formatValue } from '../util.js';

/** The list Iterate walks: an array payload, an object's values, or a text split on newlines / commas. */
function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return Object.values(payload);
  if (typeof payload === 'string') return payload.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
  return payload === undefined || payload === null ? [] : [payload];
}

export default registry.register({
  id: 'action', category: 'action', label: 'Action', icon: icons.action, size: 'S',
  description: 'On trigger: pass a payload, toggle, count, latch, delay or iterate a list',
  inputs: [{ key: 'trigger', label: 'trigger', type: 'event' }, { key: 'payload', label: 'payload', type: 'any', optional: true }],
  outputs: [{ key: 'result', label: 'result', type: 'any' }, { key: 'index', label: 'index', type: 'number' }, { key: 'done', label: 'done', type: 'event' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['pass', 'toggle', 'count', 'latch', 'delay', 'iterate'], default: 'pass' },
    { key: 'payload', label: 'payload (if unconnected; empty = trigger payload)', type: 'text', default: 'Go' },
    { key: 'delay', label: 'delay (ms)', type: 'number', default: 500, min: 0, max: 60000, step: 50 },
    { key: 'auto', label: 'iterate: auto (every interval)', type: 'boolean', default: false },
    { key: 'interval', label: 'iterate: interval (ms)', type: 'number', default: 2000, min: 100, max: 600000, step: 100 },
  ],
  evaluate({ inputs, params, state, time, emit, touch }) {
    const fired = !!inputs.trigger;
    const payload = inputs.payload !== undefined ? inputs.payload : params.payload === '' && inputs.trigger && inputs.trigger.payload !== undefined ? inputs.trigger.payload : parseLiteral(params.payload);
    switch (params.mode) {
      case 'iterate': {
        const list = listOf(payload);
        let step = fired;
        if (params.auto && list.length) { if (state.nextAt === undefined || state.nextAt === null) state.nextAt = time + params.interval / 1000; if (time >= state.nextAt) { step = true; state.nextAt = time + params.interval / 1000; } }
        else state.nextAt = null;
        if (step && list.length) {
          const i = Math.min(state.i || 0, list.length - 1);
          state.result = list[i]; state.index = i; touch('result');
          if (i + 1 >= list.length) { state.i = 0; emit('done', state.result); } else state.i = i + 1;
        }
        return { result: state.result, index: state.index };
      }
      case 'toggle':
        if (fired) { state.on = !state.on; emit('done', state.on); }
        return { result: !!state.on };
      case 'count':
        if (fired) { state.count = (state.count || 0) + 1; emit('done', state.count); }
        return { result: state.count || 0 };
      case 'latch':
        if (fired || (inputs.payload !== undefined && !equal(state.last, inputs.payload))) { state.last = inputs.payload; state.result = payload; touch('result'); if (fired) emit('done', payload); }
        return { result: state.result };
      case 'delay': {
        state.queue = state.queue || [];
        if (fired) state.queue.push({ at: time + params.delay / 1000, payload });
        while (state.queue.length && state.queue[0].at <= time) { state.result = state.queue.shift().payload; touch('result'); emit('done', state.result); }
        return { result: state.result };
      }
      default: // pass
        if (fired) { state.result = payload; touch('result'); emit('done', payload); }
        return { result: state.result };
    }
  },
  footer: ({ params, outputs, state, inputs }) => (params.mode === 'iterate' ? `iterate ${outputs.index !== undefined ? outputs.index + 1 : 0} / ${listOf(inputs.payload !== undefined ? inputs.payload : parseLiteral(params.payload)).length} → ${formatValue(outputs.result, 14)}` : `${params.mode} → ${formatValue(outputs.result, 18)}`),
});
