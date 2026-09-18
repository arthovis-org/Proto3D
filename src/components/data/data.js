// Data — JSON value source, path pick, filter, count or merge of connected data.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { asText, parseLiteral, pick, compareValues, OPS, formatValue } from '../util.js';

export default registry.register({
  id: 'data', category: 'data', label: 'Data', icon: icons.data, size: 'S',
  description: 'JSON value, pick a path, filter a list, count or merge',
  inputs: [{ key: 'in', label: 'data', type: 'data', multi: true, optional: true }],
  outputs: [{ key: 'data', label: 'data', type: 'data' }, { key: 'value', label: 'value', type: 'any' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['value', 'pick', 'filter', 'count', 'merge'], default: 'value' },
    { key: 'json', label: 'JSON', type: 'json', default: { name: 'Proto3D', items: [{ id: 1, ok: true }, { id: 2, ok: false }, { id: 3, ok: true }] } },
    { key: 'path', label: 'path', type: 'text', default: 'items[0].id' },
    { key: 'key', label: 'filter key', type: 'text', default: 'ok' },
    { key: 'op', label: 'op', type: 'select', options: OPS, default: '=' },
    { key: 'value', label: 'filter value', type: 'text', default: 'true' },
  ],
  evaluate({ inputs, params }) {
    const list = inputs.in || [];
    const src = list.length ? list[0] : params.json;
    switch (params.mode) {
      case 'pick': { const v = pick(src, params.path); return { data: v !== null && typeof v === 'object' ? v : { value: v }, value: v }; }
      case 'filter': {
        const arr = Array.isArray(src) ? src : src && typeof src === 'object' ? Object.values(src) : [];
        const want = parseLiteral(params.value);
        const out = arr.filter((row) => compareValues(params.key ? pick(row, params.key) : row, want, params.op));
        return { data: out, value: out.length };
      }
      case 'count': { const n = Array.isArray(src) ? src.length : src && typeof src === 'object' ? Object.keys(src).length : src === undefined ? 0 : 1; return { data: { count: n }, value: n }; }
      case 'merge': {
        if (!list.length) return { data: undefined, value: undefined };
        const merged = list.every(Array.isArray) ? list.flat() : Object.assign({}, ...list.map((x) => (Array.isArray(x) ? { list: x } : x)));
        return { data: merged, value: merged };
      }
      default: return { data: params.json, value: params.json };
    }
  },
  footer: ({ outputs, params }) => `${params.mode} → ${formatValue(outputs.value ?? outputs.data, 22)}`,
});
