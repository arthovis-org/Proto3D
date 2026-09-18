// Compare — a ⋈ b → boolean. b comes from the input when connected, else from the param.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { compareValues, parseLiteral, OPS, formatValue } from '../util.js';

export default registry.register({
  id: 'compare', category: 'logic', label: 'Compare', icon: icons.compare, size: 'S',
  description: 'a = ≠ < > ≤ ≥ contains b → boolean',
  inputs: [{ key: 'a', label: 'a', type: 'any' }, { key: 'b', label: 'b', type: 'any', optional: true }],
  outputs: [{ key: 'result', label: 'result', type: 'boolean' }],
  params: [
    { key: 'op', label: 'operator', type: 'select', options: OPS, default: '>' },
    { key: 'b', label: 'b (if unconnected)', type: 'text', default: '3' },
  ],
  evaluate({ inputs, params }) {
    if (inputs.a === undefined) return {};
    const b = inputs.b !== undefined ? inputs.b : parseLiteral(params.b);
    return { result: compareValues(inputs.a, b, params.op) };
  },
  footer: ({ inputs, params, outputs }) => (inputs.a === undefined ? 'no a' : `${formatValue(inputs.a, 8)} ${params.op} ${formatValue(inputs.b !== undefined ? inputs.b : parseLiteral(params.b), 8)} → ${outputs.result}`),
});
