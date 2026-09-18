// Gate — AND / OR / NOT / XOR over every connected boolean.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';

export default registry.register({
  id: 'gate', category: 'logic', label: 'Gate', icon: icons.gate, size: 'S',
  description: 'AND / OR / NOT / XOR of all connected booleans',
  inputs: [{ key: 'in', label: 'in', type: 'boolean', multi: true }],
  outputs: [{ key: 'result', label: 'result', type: 'boolean' }],
  params: [{ key: 'mode', label: 'mode', type: 'select', options: ['AND', 'OR', 'NOT', 'XOR'], default: 'AND' }],
  evaluate({ inputs, params }) {
    const v = (inputs.in || []).map(Boolean);
    if (!v.length) return {};
    switch (params.mode) {
      case 'OR': return { result: v.some(Boolean) };
      case 'NOT': return { result: !v[0] };
      case 'XOR': return { result: v.filter(Boolean).length % 2 === 1 };
      default: return { result: v.every(Boolean) };
    }
  },
  footer: ({ inputs, params, outputs }) => `${params.mode}(${(inputs.in || []).map((b) => (b ? '1' : '0')).join('') || '—'}) → ${outputs.result ?? '—'}`,
});
