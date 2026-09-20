// Data — JSON value source, path pick, filter, count or merge of connected data. The face shows
// the value; in `value` mode the JSON is editable where it is drawn (double-click, with validation).
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, drawCaps, font, jsonLines, beginFields, PAD } from '../../faces.js';
import { asText, parseLiteral, pick, compareValues, OPS, formatValue } from '../util.js';

/** Parse JSON typed on the face; the message is what the editor shows under the field. */
function parseJSON(text) {
  const s = String(text ?? '').trim();
  if (!s) throw new Error('Enter a JSON value');
  try { return JSON.parse(s); } catch (e) { throw new Error(`Not valid JSON — ${String(e.message).replace(/^JSON\.parse: /, '').slice(0, 60)}`); }
}

export default registry.register({
  id: 'data', category: 'data', label: 'Data', icon: icons.data, size: 'M',
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
  face: {
    portAnchors: ({ h }) => ({ in: h / 2, data: h / 2 - 20, value: h / 2 + 20 }),
    render(g, w, h, { params, inputs, outputs, instance }) {
      clear(g, w, h);
      const fed = (inputs?.in || []).length > 0;
      drawCaps(g, fed ? `${params.mode} · from input` : params.mode === 'value' ? 'json' : params.mode, PAD, 16, { size: 11 });
      const F = beginFields(instance);
      const box = { x: PAD, y: 32, w: w - 2 * PAD, h: h - 32 - 12 };
      const own = params.mode === 'value' && !fed;
      const f = own ? F.add({ id: 'json', kind: 'multiline', param: 'json', label: 'JSON', rect: box, placeholder: '{ "key": "value" }', parse: parseJSON, format: (v) => JSON.stringify(v, null, 2), font: { size: 13, weight: 500, mono: true, align: 'left', lineHeight: 1.35 } }) : null;
      if (f?.editing) return;
      const v = own ? params.json : outputs.value !== undefined ? outputs.value : outputs.data;
      const lines = jsonLines(v, Math.floor(box.h / 17.5));
      g.font = font(13, 500, true); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l.length > 56 ? l.slice(0, 55) + '…' : l, box.x, box.y + i * 17.5));
    },
  },
});
