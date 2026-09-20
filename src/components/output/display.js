// Display — shows whatever arrives: text, numbers, booleans, JSON, a media thumbnail or a gallery.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawValue, drawCaps, beginFields } from '../../faces.js';
import { palette } from '../../theme.js';
import { formatValue } from '../util.js';

export default registry.register({
  id: 'display', category: 'output', label: 'Display', icon: icons.display, size: 'M',
  description: 'Renders any value on its face: text, number, JSON, media, gallery',
  inputs: [{ key: 'in', label: 'in', type: 'any' }],
  params: [{ key: 'caption', label: 'caption', type: 'text', default: '' }],
  evaluate() { return {}; },
  footer: ({ inputs, params }) => params.caption || formatValue(inputs.in, 24),
  face: {
    live: true, fps: 6,
    portAnchors: ({ h }) => ({ in: h / 2 }),   // the pin points at the value
    render(g, w, h, { inputs, params, time, instance }) {
      clear(g, w, h);
      // the caption is a small-caps line along the top, editable in place (a click on the empty strip types one)
      const F = beginFields(instance);
      const cap = String(params.caption || '');
      const f = F.add({ id: 'caption', kind: 'text', param: 'caption', label: 'caption', rect: { x: 12, y: 6, w: w - 24, h: 22 }, placeholder: 'Caption', font: { size: 12, weight: 600, color: palette.faceDim } });
      if (cap && !f.editing) drawCaps(g, cap, 16, 17, { size: 11 });
      const top = cap || f.editing ? 30 : 12;
      drawValue(g, inputs.in, 12, top, w - 24, h - top - 12, { time });
    },
  },
});
