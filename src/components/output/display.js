// Display — shows whatever arrives: text, numbers, booleans, JSON, a media thumbnail or a gallery.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawValue } from '../../faces.js';
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
    render(g, w, h, { inputs, time }) {
      clear(g, w, h);
      drawValue(g, inputs.in, 12, 12, w - 24, h - 24, { time });
    },
  },
});
