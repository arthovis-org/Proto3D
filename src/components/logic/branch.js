// Branch — routes a value to "then" or "else" by a condition, and fires an event whenever the
// condition flips (or when a trigger arrives) so Actions can react.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { formatValue } from '../util.js';

export default registry.register({
  id: 'branch', category: 'logic', label: 'Branch', icon: icons.branch, size: 'S',
  description: 'if / else: routes a value and fires on-true / on-false events',
  inputs: [
    { key: 'condition', label: 'condition', type: 'boolean' },
    { key: 'value', label: 'value', type: 'any', optional: true },
    { key: 'trigger', label: 'trigger', type: 'event', optional: true },
  ],
  outputs: [
    { key: 'then', label: 'then', type: 'any' }, { key: 'else', label: 'else', type: 'any' },
    { key: 'onTrue', label: 'on true', type: 'event' }, { key: 'onFalse', label: 'on false', type: 'event' },
  ],
  evaluate({ inputs, state, emit }) {
    if (inputs.condition === undefined) { state.prev = undefined; return {}; }
    const cond = !!inputs.condition;
    const value = inputs.value !== undefined ? inputs.value : cond;
    const flipped = state.prev !== cond;
    state.prev = cond;
    if (flipped || inputs.trigger) emit(cond ? 'onTrue' : 'onFalse', value);
    return { then: cond ? value : undefined, else: cond ? undefined : value };
  },
  footer: ({ inputs, outputs }) => (inputs.condition === undefined ? 'no condition' : `${inputs.condition ? 'then' : 'else'} ← ${formatValue(inputs.condition ? outputs.then : outputs.else, 16)}`),
});
