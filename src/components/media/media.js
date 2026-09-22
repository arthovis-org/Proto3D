// Media — one asset: image, video or audio. Built-in generated samples, a custom URL, or a file
// from this computer: the panel's "Choose file…", a file dropped on the block (main.js resolves
// the block under the pointer and calls `onFileDrop`), or Ctrl+V of an image while the block is
// selected. Files go into the IndexedDB blob store (ai/store.js) and the media record with its
// `storeId` lives in `params.file`, so a reload finds the picture again.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawMedia } from '../../faces.js';
import { store } from '../../ai/store.js';
import * as cmd from '../../core/commands.js';
import { sampleMedia, SAMPLE_COUNT } from './samples.js';

const SOURCES = [...Array.from({ length: SAMPLE_COUNT }, (_, i) => `sample ${i + 1}`), 'custom URL', 'file'];
const kindOfFile = (file) => (/^video\//.test(file.type) ? 'video' : /^audio\//.test(file.type) ? 'audio' : 'image');
let seq = 0;
/** Natural size of an image or video file, or {} when it cannot be read. */
function measure(blob, kind) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    if (kind === 'image') { const im = new Image(); im.onload = () => done({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => done({}); im.src = url; }
    else if (kind === 'video') { const v = document.createElement('video'); v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, duration: v.duration }); v.onerror = () => done({}); v.src = url; }
    else done({});
  });
}
/**
 * Store a file and make it the block's source. `api.setParam(key, value)` is the undoable write
 * (the panel's or the one main.js hands over); without one the params are written directly.
 */
export async function setFile(inst, file, api = null) {
  if (!file) return null;
  const kind = kindOfFile(file);
  const id = `file-${Date.now().toString(36)}${(++seq).toString(36)}`;
  const size = await measure(file, kind);
  const rec = await store.putMedia(id, file, { kind, title: file.name.replace(/\.[^.]+$/, '') || 'file', ...size, name: file.name, bytes: file.size, type: file.type });
  if (api?.setParam) { api.setParam('mode', kind); api.setParam('source', 'file'); api.setParam('file', rec); }
  else if (inst.world) { const w = inst.world; for (const [k, v] of [['mode', kind], ['source', 'file'], ['file', rec]]) cmd.setParam(w, inst, k, v).do(); }
  else { inst.params.mode = kind; inst.params.source = 'file'; inst.params.file = rec; }
  inst.faceDirty = true;
  return rec;
}

export default registry.register({
  id: 'media', category: 'media', label: 'Media', icon: icons.media, size: 'M',
  description: 'An image, video or audio asset (built-in sample, URL, or a file: choose, drop or paste)',
  outputs: [{ key: 'media', label: 'media', type: 'media' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['image', 'video', 'audio'], default: 'image' },
    { key: 'source', label: 'source', type: 'select', options: SOURCES, default: 'sample 1' },
    { key: 'url', label: 'custom URL', type: 'text', default: '' },
    { key: 'title', label: 'title', type: 'text', default: '' },
    { key: 'file', label: 'file', type: 'json', default: null, hidden: true },
  ],
  onCreate(inst) { if (inst.params.file?.storeId) store.hydrate(inst.params.file).then(() => { inst.state._key = null; inst.faceDirty = true; }); },
  /** A file dropped on the block (main.js) or pasted while it is selected. */
  onFileDrop(inst, file, api) { return setFile(inst, file, api); },
  evaluate({ params, state }) {
    const key = `${params.mode}|${params.source}|${params.url}|${params.title}|${params.file?.src || ''}`;
    if (state._key !== key) {
      state._key = key;
      let m;
      if (params.source === 'custom URL') m = params.url ? { kind: params.mode, src: params.url, title: params.title || params.url.split('/').pop() } : undefined;
      else if (params.source === 'file') m = params.file?.src ? { ...params.file, kind: params.file.kind || params.mode, title: params.title || params.file.title } : undefined;
      else {
        const i = Math.max(0, parseInt(params.source.replace(/\D/g, ''), 10) - 1) || 0;
        m = sampleMedia(params.mode, i);
        if (params.title) m = { ...m, title: params.title };
      }
      state._media = m;
    }
    return { media: state._media };
  },
  footer: ({ outputs, params }) => (outputs.media ? `${outputs.media.kind} · ${outputs.media.title}` : params.source === 'file' ? 'choose, drop or paste a file' : 'no source'),
  face: {
    live: true, fps: 6,
    render(g, w, h, { outputs, time }) {
      clear(g, w, h);
      drawMedia(g, outputs.media, 8, 8, w - 16, h - 16, { fit: 'contain', time });
    },
  },
  panel(api, b) {
    const s = api.section('File');
    const input = api.h('input'); input.type = 'file'; input.accept = 'image/*,video/*,audio/*'; input.hidden = true; input.id = 'media-file'; s.appendChild(input);
    input.addEventListener('change', () => { const f = input.files?.[0]; if (f) setFile(b, f, api).then(() => { api.world.overlays?.toast?.(`${f.name} · stored in this browser`, 1800); api.rebuild(); }); input.value = ''; });
    api.action(s, 'Choose file…', () => input.click(), 'media-choose');
    api.readonly(s, 'file', () => (b.params.file ? `${b.params.file.name || b.params.file.title}${b.params.file.w ? ` · ${b.params.file.w}×${b.params.file.h}` : ''}${b.params.file.bytes ? ` · ${Math.round(b.params.file.bytes / 1024)} KB` : ''}` : '—'));
    s.appendChild(api.h('div', 'panel-note', 'Or drop an image, video or audio file on the block, or select it and press Ctrl+V with an image in the clipboard. Files are stored in this browser (IndexedDB), not in the project file.'));
  },
});
