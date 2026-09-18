// Media — one asset: image, video or audio. Built-in generated samples or a custom URL.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawMedia } from '../../faces.js';
import { sampleMedia, SAMPLE_COUNT } from './samples.js';

const SOURCES = [...Array.from({ length: SAMPLE_COUNT }, (_, i) => `sample ${i + 1}`), 'custom URL'];

export default registry.register({
  id: 'media', category: 'media', label: 'Media', icon: icons.media, size: 'M',
  description: 'An image, video or audio asset (built-in sample or URL)',
  outputs: [{ key: 'media', label: 'media', type: 'media' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['image', 'video', 'audio'], default: 'image' },
    { key: 'source', label: 'source', type: 'select', options: SOURCES, default: 'sample 1' },
    { key: 'url', label: 'custom URL', type: 'text', default: '' },
    { key: 'title', label: 'title', type: 'text', default: '' },
  ],
  evaluate({ params, state }) {
    const key = `${params.mode}|${params.source}|${params.url}|${params.title}`;
    if (state._key !== key) {
      state._key = key;
      let m;
      if (params.source === 'custom URL') m = params.url ? { kind: params.mode, src: params.url, title: params.title || params.url.split('/').pop() } : undefined;
      else {
        const i = Math.max(0, parseInt(params.source.replace(/\D/g, ''), 10) - 1) || 0;
        m = sampleMedia(params.mode, i);
        if (params.title) m = { ...m, title: params.title };
      }
      state._media = m;
    }
    return { media: state._media };
  },
  footer: ({ outputs }) => (outputs.media ? `${outputs.media.kind} · ${outputs.media.title}` : 'no source'),
  face: {
    live: true, fps: 6,
    render(g, w, h, { outputs, time }) {
      clear(g, w, h);
      drawMedia(g, outputs.media, 8, 8, w - 16, h - 16, { fit: 'contain', time });
    },
  },
});
