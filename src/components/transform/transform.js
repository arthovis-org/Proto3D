// Transform — number processing: math with a second operand, map range, clamp, round, invert.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { num, formatValue } from '../util.js';

const MATH = { '+': (a, b) => a + b, '−': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => (b === 0 ? NaN : a / b), mod: (a, b) => a % b, pow: Math.pow, min: Math.min, max: Math.max };

export default registry.register({
  id: 'transform', category: 'transform', label: 'Transform', icon: icons.transform, size: 'S',
  description: 'Math (a ⋈ b), map range, clamp, round or invert a number',
  inputs: [{ key: 'a', label: 'a', type: 'number' }, { key: 'b', label: 'b', type: 'number', optional: true }],
  outputs: [{ key: 'result', label: 'result', type: 'number' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['math', 'map range', 'clamp', 'round', 'invert'], default: 'math' },
    { key: 'op', label: 'operator', type: 'select', options: Object.keys(MATH), default: '×' },
    { key: 'b', label: 'b (if unconnected)', type: 'number', default: 2 },
    { key: 'inMin', label: 'in min', type: 'number', default: -45 }, { key: 'inMax', label: 'in max', type: 'number', default: 45 },
    { key: 'outMin', label: 'out min', type: 'number', default: 0 }, { key: 'outMax', label: 'out max', type: 'number', default: 100 },
    { key: 'min', label: 'clamp min', type: 'number', default: 0 }, { key: 'max', label: 'clamp max', type: 'number', default: 1 },
    { key: 'decimals', label: 'decimals', type: 'number', default: 0, min: 0, max: 6, step: 1 },
  ],
  evaluate({ inputs, params }) {
    const a = num(inputs.a, NaN);
    if (!Number.isFinite(a)) return {};
    const b = inputs.b !== undefined ? num(inputs.b) : params.b;
    let r;
    switch (params.mode) {
      case 'map range': { const span = params.inMax - params.inMin || 1; r = params.outMin + (a - params.inMin) / span * (params.outMax - params.outMin); break; }
      case 'clamp': r = Math.min(params.max, Math.max(params.min, a)); break;
      case 'round': { const k = Math.pow(10, Math.max(0, Math.round(params.decimals))); r = Math.round(a * k) / k; break; }
      case 'invert': r = -a; break;
      default: r = (MATH[params.op] || MATH['×'])(a, b);
    }
    return Number.isFinite(r) ? { result: +r.toFixed(6) } : {};
  },
  footer: ({ inputs, params, outputs }) => (inputs.a === undefined ? 'no input' : `${params.mode === 'math' ? `${formatValue(inputs.a, 7)} ${params.op} ${formatValue(inputs.b ?? params.b, 6)}` : params.mode} → ${formatValue(outputs.result, 10)}`),
});
