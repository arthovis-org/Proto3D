// Action — does something when a trigger arrives: pass a payload on, toggle, count, latch or
// delay. `result` holds the outcome; `done` pulses when it happened.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { equal } from '../../core/types.js';
import { parseLiteral, formatValue } from '../util.js';

export default registry.register({
  id: 'action', category: 'action', label: 'Action', icon: icons.action, size: 'S',
  description: 'On trigger: pass a payload, toggle, count, latch or delay',
  inputs: [{ key: 'trigger', label: 'trigger', type: 'event' }, { key: 'payload', label: 'payload', type: 'any', optional: true }],
  outputs: [{ key: 'result', label: 'result', type: 'any' }, { key: 'done', label: 'done', type: 'event' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['pass', 'toggle', 'count', 'latch', 'delay'], default: 'pass' },
    { key: 'payload', label: 'payload (if unconnected; empty = trigger payload)', type: 'text', default: 'Go' },
    { key: 'delay', label: 'delay (ms)', type: 'number', default: 500, min: 0, max: 60000, step: 50 },
  ],
  evaluate({ inputs, params, state, time, emit, touch }) {
    const fired = !!inputs.trigger;
    const payload = inputs.payload !== undefined ? inputs.payload : params.payload === '' && inputs.trigger && inputs.trigger.payload !== undefined ? inputs.trigger.payload : parseLiteral(params.payload);
    switch (params.mode) {
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
  footer: ({ params, outputs }) => `${params.mode} → ${formatValue(outputs.result, 18)}`,
});
