// Media Grid — arranges any number of media inputs into a gallery; outputs the layout as data
// so a device screen or a Display can show the same gallery.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawMediaGrid, gridShape } from '../../faces.js';
import { downloadMedia } from '../generate/common.js';

export default registry.register({
  id: 'media-grid', category: 'media', label: 'Media Grid', icon: icons['media-grid'], size: 'L',
  description: 'Gallery of all connected media; outputs the grid layout as data',
  inputs: [{ key: 'items', label: 'media', type: 'media', multi: true }],
  outputs: [{ key: 'layout', label: 'layout', type: 'data' }],
  params: [
    { key: 'columns', label: 'columns (0 = auto)', type: 'number', default: 0, min: 0, max: 12, step: 1 },
    { key: 'gap', label: 'gap (px)', type: 'number', default: 10, min: 0, max: 60, step: 1 },
    { key: 'fit', label: 'fit', type: 'select', options: ['cover', 'contain'], default: 'cover' },
  ],
  evaluate({ inputs, params, instance }) {
    const items = inputs.items || [];
    const aspect = instance.face ? instance.face.w / instance.face.h : 1.6;
    const { cols, rows } = gridShape(items.length, Math.round(params.columns), aspect);
    return { layout: { items, cols, rows, gap: params.gap, fit: params.fit } };
  },
  footer: ({ outputs }) => { const L = outputs.layout; return L && L.items.length ? `${L.items.length} items · ${L.cols} × ${L.rows}` : 'connect media'; },
  panel(api, b) {
    const s = api.section('Gallery');
    api.readonly(s, 'items', () => String(b.rt?.outputs?.layout?.items?.length || 0));
    api.action(s, 'Download all', async () => { const items = b.rt?.outputs?.layout?.items || []; for (let i = 0; i < items.length; i++) await downloadMedia(items[i], `${items[i].title || 'media'}-${i + 1}`); if (!items.length) api.world.overlays?.toast?.('Nothing to download yet', 1400); }, 'grid-download-all');
  },
  face: {
    live: true, fps: 6,
    render(g, w, h, { outputs, time }) {
      clear(g, w, h);
      const L = outputs.layout || { items: [], cols: 0 };
      drawMediaGrid(g, L.items, 10, 10, w - 20, h - 20, { cols: L.cols, gap: L.gap ?? 10, fit: L.fit, time });
    },
  },
});
