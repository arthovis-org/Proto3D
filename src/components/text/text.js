// Text — a string source or a string operation on its inputs (case, template, join).
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawText } from '../../faces.js';
import { asText, pick } from '../util.js';

export default registry.register({
  id: 'text', category: 'text', label: 'Text', icon: icons.text, size: 'M',
  description: 'Text source, upper/lower case, {value} / {value.path} template or join',
  inputs: [{ key: 'in', label: 'in', type: 'any', multi: true, optional: true }],
  outputs: [{ key: 'text', label: 'text', type: 'text' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['source', 'uppercase', 'lowercase', 'template', 'join'], default: 'source' },
    { key: 'text', label: 'text', type: 'text', default: 'Hello, world' },
    { key: 'template', label: 'template', type: 'text', default: '{name}: {value}' },
    { key: 'separator', label: 'separator', type: 'text', default: ', ' },
  ],
  evaluate({ inputs, params, upstream }) {
    const vals = inputs.in || [];
    const first = vals.length ? vals[0] : undefined;
    const base = first !== undefined ? asText(first) : params.text;
    let text;
    switch (params.mode) {
      case 'uppercase': text = base.toUpperCase(); break;
      case 'lowercase': text = base.toLowerCase(); break;
      case 'template': {
        const src = upstream('in')[0];
        text = String(params.template)
          .replace(/\{value\}/g, first !== undefined ? asText(first) : '')
          .replace(/\{value\.([\w.[\]]+)\}/g, (_, path) => asText(pick(first, path)))
          .replace(/\{name\}/g, src ? src.node.title : '')
          .replace(/\{(\d+)\}/g, (_, i) => asText(vals[+i]));
        break;
      }
      case 'join': text = vals.map(asText).join(params.separator); break;
      default: text = params.text;
    }
    return { text };
  },
  face: {
    portAnchors: ({ h }) => ({ in: h / 2, text: h / 2 }),   // both pins level with the text line
    render(g, w, h, { outputs }) {
      clear(g, w, h);
      drawText(g, outputs.text ?? '', 16, 12, w - 32, h - 24, { size: 48, weight: 600 });
    },
  },
});
