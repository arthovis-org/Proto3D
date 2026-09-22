// Image Edit — pixel work that needs no service: resize, crop, pad (an outpaint canvas), rotate /
// flip, adjust (brightness, contrast, saturation, blur, sharpen), blend B over A, composite B over
// A through a mask, invert, grayscale. Pure Canvas 2D (`filter` for the adjustments, a 3 × 3 kernel
// for sharpen), computed when an input or a param changes — debounced ~150 ms of engine time — and
// stored through ai/store.js so the result survives a reload; the store id is a hash of the sources
// and the params, so an unchanged edit is reused, never recomputed. The face shows before and
// after side by side with the mode in small caps; the mode's numbers edit in place.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { isMedia } from '../../core/types.js';
import { clear, drawCaps, drawDivider, drawMedia, drawChip, drawText, bitmapFor, font, fitLine, tabular, PAD, beginFields } from '../../faces.js';
import { store } from '../../ai/store.js';
import { drawDownloadChip, downloadMedia } from './common.js';

export const EDIT_MODES = ['resize', 'crop', 'pad', 'rotate/flip', 'adjust', 'blend', 'composite', 'invert', 'grayscale'];
const FITS = ['contain', 'cover', 'stretch'];
const BLENDS = ['normal', 'multiply', 'screen', 'overlay'];
const ANGLES = ['0', '90', '180', '270'];
const DEBOUNCE = 0.15;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
/** The params a mode reads (the key of the result depends on these only). */
const KEYS = {
  resize: ['width', 'height', 'keepAspect', 'fit'], crop: ['cx', 'cy', 'cw', 'ch'], pad: ['padL', 'padT', 'padR', 'padB', 'fill', 'transparent'], 'rotate/flip': ['angle', 'flipH', 'flipV'],
  adjust: ['brightness', 'contrast', 'saturation', 'blur', 'sharpen'], blend: ['opacity', 'blend'], composite: [], invert: [], grayscale: [],
};
/** Face fields per mode: [param, label, min, max, step, format]. */
const NUMS = {
  resize: [['width', 'w', 1, 8192, 1], ['height', 'h', 1, 8192, 1]], crop: [['cx', 'x', 0, 1, 0.01, 'pct'], ['cy', 'y', 0, 1, 0.01, 'pct'], ['cw', 'w', 0, 1, 0.01, 'pct'], ['ch', 'h', 0, 1, 0.01, 'pct']],
  pad: [['padL', 'left', 0, 4096, 1], ['padT', 'top', 0, 4096, 1], ['padR', 'right', 0, 4096, 1], ['padB', 'bottom', 0, 4096, 1]], 'rotate/flip': [],
  adjust: [['brightness', 'bright', 0, 3, 0.05], ['contrast', 'contrast', 0, 3, 0.05], ['saturation', 'sat', 0, 3, 0.05], ['blur', 'blur', 0, 50, 0.5], ['sharpen', 'sharp', 0, 1, 0.05]], blend: [['opacity', 'opacity', 0, 1, 0.05, 'pct']], composite: [], invert: [], grayscale: [],
};

/** Sharpen by a 3 × 3 kernel, mixed by `amount` (0..1). */
function sharpen(c, amount) {
  const w = c.width, h = c.height, g = c.getContext('2d', { willReadFrequently: true });
  let id; try { id = g.getImageData(0, 0, w, h); } catch (_) { return; }
  const s = id.data, out = new Uint8ClampedArray(s.length), k = amount;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { out[i] = s[i]; out[i + 1] = s[i + 1]; out[i + 2] = s[i + 2]; out[i + 3] = s[i + 3]; continue; }
    for (let ch = 0; ch < 3; ch++) {
      const v = 5 * s[i + ch] - s[i - 4 + ch] - s[i + 4 + ch] - s[i - w * 4 + ch] - s[i + w * 4 + ch];
      out[i + ch] = s[i + ch] * (1 - k) + v * k;
    }
    out[i + 3] = s[i + 3];
  }
  id.data.set(out); g.putImageData(id, 0, 0);
}
/** Run the edit on loaded bitmaps; returns a canvas. */
export function editImage(mode, params, A, B, M) {
  const aw = A.naturalWidth || A.width, ah = A.naturalHeight || A.height;
  const make = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  switch (mode) {
    case 'resize': {
      let w = Math.max(1, Math.round(+params.width) || aw), h = Math.max(1, Math.round(+params.height) || ah);
      if (params.keepAspect) h = Math.max(1, Math.round(w * ah / aw));
      const c = make(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      if (params.fit === 'stretch' || params.keepAspect) g.drawImage(A, 0, 0, w, h);
      else { const s = params.fit === 'cover' ? Math.max(w / aw, h / ah) : Math.min(w / aw, h / ah); const dw = aw * s, dh = ah * s; g.drawImage(A, (w - dw) / 2, (h - dh) / 2, dw, dh); }
      return c;
    }
    case 'crop': {
      const x = clamp01(params.cx) * aw, y = clamp01(params.cy) * ah, w = Math.max(1, clamp01(params.cw) * aw), h = Math.max(1, clamp01(params.ch) * ah);
      const c = make(w, h); c.getContext('2d').drawImage(A, x, y, w, h, 0, 0, c.width, c.height); return c;
    }
    case 'pad': {
      const l = Math.max(0, +params.padL || 0), t = Math.max(0, +params.padT || 0), r = Math.max(0, +params.padR || 0), b = Math.max(0, +params.padB || 0);
      const c = make(aw + l + r, ah + t + b), g = c.getContext('2d');
      if (!params.transparent) { g.fillStyle = params.fill || '#ffffff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(A, l, t); return c;
    }
    case 'rotate/flip': {
      const a = (+params.angle || 0) % 360, quarter = a === 90 || a === 270;
      const c = make(quarter ? ah : aw, quarter ? aw : ah), g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2); g.rotate(a * Math.PI / 180); g.scale(params.flipH ? -1 : 1, params.flipV ? -1 : 1); g.drawImage(A, -aw / 2, -ah / 2); return c;
    }
    case 'adjust': {
      const c = make(aw, ah), g = c.getContext('2d');
      g.filter = `brightness(${+params.brightness ?? 1}) contrast(${+params.contrast ?? 1}) saturate(${+params.saturation ?? 1})${+params.blur > 0 ? ` blur(${+params.blur}px)` : ''}`;
      g.drawImage(A, 0, 0); g.filter = 'none';
      if (+params.sharpen > 0) sharpen(c, clamp01(params.sharpen));
      return c;
    }
    case 'blend': {
      const c = make(aw, ah), g = c.getContext('2d'); g.drawImage(A, 0, 0);
      if (B) { g.globalAlpha = clamp01(params.opacity ?? 1); g.globalCompositeOperation = params.blend === 'normal' ? 'source-over' : params.blend || 'source-over'; g.drawImage(B, 0, 0, aw, ah); }
      return c;
    }
    case 'composite': {
      const c = make(aw, ah), g = c.getContext('2d'); g.drawImage(A, 0, 0);
      if (B) {
        const top = make(aw, ah), t = top.getContext('2d'); t.drawImage(B, 0, 0, aw, ah);
        if (M) {   // the mask's luminance becomes B's alpha
          const m = make(aw, ah), mg = m.getContext('2d', { willReadFrequently: true }); mg.drawImage(M, 0, 0, aw, ah);
          try { const id = mg.getImageData(0, 0, aw, ah), d = id.data; for (let i = 0; i < d.length; i += 4) d[i + 3] = Math.round((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * d[i + 3] / 255); mg.putImageData(id, 0, 0); t.globalCompositeOperation = 'destination-in'; t.drawImage(m, 0, 0); } catch (_) { /* tainted mask: B covers A */ }
        }
        g.drawImage(top, 0, 0);
      }
      return c;
    }
    case 'invert': { const c = make(aw, ah), g = c.getContext('2d'); g.filter = 'invert(1)'; g.drawImage(A, 0, 0); g.filter = 'none'; return c; }
    case 'grayscale': { const c = make(aw, ah), g = c.getContext('2d'); g.filter = 'grayscale(1)'; g.drawImage(A, 0, 0); g.filter = 'none'; return c; }
    default: { const c = make(aw, ah); c.getContext('2d').drawImage(A, 0, 0); return c; }
  }
}
const toBlob = (c) => new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));

export default registry.register({
  id: 'image-edit', category: 'generate', label: 'Image Edit', icon: icons['image-edit'], size: 'L',
  description: 'Resize, crop, pad, rotate / flip, adjust, blend, composite through a mask, invert or grayscale an image in the browser — free and offline',
  inputs: [
    { key: 'image', label: 'image', type: 'media' },
    { key: 'imageB', label: 'image B', type: 'media', optional: true },
    { key: 'mask', label: 'mask', type: 'media', optional: true },
  ],
  outputs: [{ key: 'image', label: 'image', type: 'media' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: EDIT_MODES, default: 'resize', hidden: true },
    { key: 'width', label: 'width', type: 'number', default: 512, min: 1, max: 8192, step: 1, hidden: true },
    { key: 'height', label: 'height', type: 'number', default: 512, min: 1, max: 8192, step: 1, hidden: true },
    { key: 'keepAspect', label: 'keep aspect', type: 'boolean', default: false, hidden: true },
    { key: 'fit', label: 'fit', type: 'select', options: FITS, default: 'cover', hidden: true },
    { key: 'cx', label: 'crop x', type: 'number', default: 0.1, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'cy', label: 'crop y', type: 'number', default: 0.1, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'cw', label: 'crop width', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'ch', label: 'crop height', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'padL', label: 'pad left', type: 'number', default: 0, min: 0, max: 4096, step: 1, hidden: true },
    { key: 'padT', label: 'pad top', type: 'number', default: 0, min: 0, max: 4096, step: 1, hidden: true },
    { key: 'padR', label: 'pad right', type: 'number', default: 128, min: 0, max: 4096, step: 1, hidden: true },
    { key: 'padB', label: 'pad bottom', type: 'number', default: 0, min: 0, max: 4096, step: 1, hidden: true },
    { key: 'fill', label: 'fill colour', type: 'color', default: '#ffffff', hidden: true },
    { key: 'transparent', label: 'transparent (outpaint canvas)', type: 'boolean', default: false, hidden: true },
    { key: 'angle', label: 'rotate', type: 'select', options: ANGLES, default: '90', hidden: true },
    { key: 'flipH', label: 'flip horizontal', type: 'boolean', default: false, hidden: true },
    { key: 'flipV', label: 'flip vertical', type: 'boolean', default: false, hidden: true },
    { key: 'brightness', label: 'brightness', type: 'number', default: 1, min: 0, max: 3, step: 0.05, hidden: true },
    { key: 'contrast', label: 'contrast', type: 'number', default: 1, min: 0, max: 3, step: 0.05, hidden: true },
    { key: 'saturation', label: 'saturation', type: 'number', default: 1, min: 0, max: 3, step: 0.05, hidden: true },
    { key: 'blur', label: 'blur (px)', type: 'number', default: 0, min: 0, max: 50, step: 0.5, hidden: true },
    { key: 'sharpen', label: 'sharpen', type: 'number', default: 0, min: 0, max: 1, step: 0.05, hidden: true },
    { key: 'opacity', label: 'opacity', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05, hidden: true },
    { key: 'blend', label: 'blend mode', type: 'select', options: BLENDS, default: 'normal', hidden: true },
  ],
  describeLink(from, toDef, to, n) { return toDef.id === 'media-grid' ? `${n.fromPoss} edited image joins the ${n.to} gallery` : toDef.id === 'kanban-board' && to.key === 'cover' ? `${n.fromPoss} edited image becomes a card cover on ${n.to}` : toDef.id === 'enhance' ? `${n.to} enhances ${n.fromPoss} edit` : to.key === 'reference' ? `${n.fromPoss} edited image is the reference for ${n.to}` : `${n.fromPoss} edited image shows on ${n.to}`; },
  onCreate(inst) { if (inst.state.current?.media) store.hydrate(inst.state.current.media).then(() => { inst.faceDirty = true; }); },
  evaluate({ inputs, params, state, time, instance: inst }) {
    const A = isMedia(inputs.image) && inputs.image.kind === 'image' ? inputs.image : null;
    if (!A) return {};
    const B = isMedia(inputs.imageB) ? inputs.imageB : null, M = isMedia(inputs.mask) ? inputs.mask : null;
    const mode = EDIT_MODES.includes(params.mode) ? params.mode : 'resize';
    const key = hash(JSON.stringify([mode, KEYS[mode].map((k) => params[k]), A.src, A.storeId, B?.src, B?.storeId, (mode === 'composite' && M) ? M.src : null]));
    if (state.current?.key === key) return { image: state.current.media };
    if (inst._pendingKey !== key) { inst._pendingKey = key; inst._dueAt = time + DEBOUNCE; }
    else if (time >= inst._dueAt && !inst._busy) {
      const a = bitmapFor(A.src, A), b = B ? bitmapFor(B.src, B) : null, m = M ? bitmapFor(M.src, M) : null;
      if (a && (!B || b) && (!M || m || mode !== 'composite')) {
        inst._busy = true; inst._err = null;
        (async () => {
          try {
            const c = editImage(mode, params, a, b, m);
            const blob = await toBlob(c);
            const rec = await store.putMedia(`edit-${key}`, blob, { kind: 'image', title: `${A.title || 'image'} · ${mode}`, w: c.width, h: c.height, mode, createdAt: new Date().toISOString() });
            if (inst._pendingKey === key) { state.current = { key, media: rec }; inst.faceDirty = true; inst.world?.changed?.('edit'); }
          } catch (e) { inst._err = e?.message || String(e); inst.faceDirty = true; }
          finally { inst._busy = false; }
        })();
      }
    }
    return { image: state.current?.media };   // the previous result stays out while the new one is computed
  },
  footer: ({ params, outputs, instance }) => (instance._busy ? `${params.mode}…` : outputs.image ? `${params.mode} · ${outputs.image.w}×${outputs.image.h}` : 'connect an image'),
  face: {
    live: true, fps: 6,
    portAnchors: ({ h }) => ({ image: PAD + 40 + (h - PAD - 40 - 56) * 0.3, imageB: PAD + 40 + (h - PAD - 40 - 56) * 0.55, mask: PAD + 40 + (h - PAD - 40 - 56) * 0.8 }),
    render(g, w, h, { params, inputs, outputs, instance, time }) {
      clear(g, w, h);
      const F = beginFields(instance);
      const hits = []; instance._hits = hits;
      const dim = palette.faceDim, text = palette.faceText, acc = palette.faceAccent;
      const mode = EDIT_MODES.includes(params.mode) ? params.mode : 'resize';
      drawCaps(g, 'image edit', PAD, PAD + 8, { size: 11 });
      const sel = F.add({ id: 'mode', kind: 'select', param: 'mode', label: 'mode', options: EDIT_MODES, rect: { x: PAD + 96, y: PAD - 4, w: 150, h: 24 }, font: { size: 12, weight: 700 } });
      if (!sel.editing) drawChip(g, mode, PAD + 96, PAD - 4, { h: 24, bg: acc, color: '#fff', size: 12, weight: 700 });
      if (instance._busy) drawChip(g, 'computing…', w - PAD - 96, PAD - 4, { h: 24, bg: palette.faceCard, color: dim, size: 11, weight: 600 });
      else if (instance._err) drawChip(g, fitLine(g, instance._err, 200), w - PAD - 200, PAD - 4, { h: 24, bg: palette.faceCard, color: palette.faceBad, size: 11, weight: 600 });
      drawDivider(g, PAD, PAD + 24, w - 2 * PAD);
      // before / after
      const by = PAD + 40, bh = h - by - 56, gap = 16, bw = (w - 2 * PAD - gap) / 2;
      const A = isMedia(inputs?.image) ? inputs.image : null, out = outputs.image;
      if (!A) drawText(g, 'Connect an image (and, for blend / composite, an image B)', PAD, by, w - 2 * PAD, bh, { size: 16, color: dim });
      else {
        drawMedia(g, A, PAD, by, bw, bh, { fit: 'contain', time, radius: 12, caption: false });
        drawCaps(g, `before · ${A.w || '?'}×${A.h || '?'}`, PAD, by + bh + 12, { size: 9 });
        if (out) { drawMedia(g, out, PAD + bw + gap, by, bw, bh, { fit: 'contain', time, radius: 12, caption: false }); drawCaps(g, `after · ${out.w}×${out.h}`, PAD + bw + gap, by + bh + 12, { size: 9 }); }
        else drawText(g, instance._busy ? 'computing…' : 'waiting for the image', PAD + bw + gap, by, bw, bh, { size: 14, color: dim });
      }
      // numbers of the mode, editable in place; the download chip at the right
      const ny = h - PAD - 13; let x = PAD;
      for (const [key, label, min, max, step, fmt] of NUMS[mode]) {
        drawCaps(g, label, x, ny, { size: 9 }); x += g.measureText(label.toUpperCase()).width + 8;
        const f = F.add({ id: key, kind: 'number', param: key, label, min, max, step, rect: { x, y: ny - 12, w: 60, h: 24 }, font: { size: 13, weight: 600, align: 'left', mono: true } });
        if (!f.editing) { g.font = font(13, 600, true); tabular(g); g.fillStyle = text; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fmt === 'pct' ? `${Math.round(clamp01(params[key]) * 100)}%` : String(+params[key] ?? ''), x, ny + 1); }
        x += 72;
      }
      if (mode === 'rotate/flip') { g.font = font(13, 500); g.fillStyle = dim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`${params.angle || 0}°${params.flipH ? ' · flip H' : ''}${params.flipV ? ' · flip V' : ''}`, x, ny + 1); }
      if (mode === 'blend') { g.font = font(13, 500); g.fillStyle = dim; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(params.blend || 'normal', x, ny + 1); }
      drawDownloadChip(g, w - PAD - 26, ny - 13, hits, { enabled: !!out });
    },
    onPointer({ instance }, ev) {
      if (ev.type !== 'click') return false;
      const px = ev.u * instance.face.cw, py = ev.v * instance.face.ch;
      const hit = (instance._hits || []).find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
      if (!hit) return false;
      if (hit.action === 'download') downloadMedia(instance.state.current?.media);
      return true;
    },
  },
  panel(api, b) {
    const s = api.section('Image Edit');
    api.select(s, 'mode', EDIT_MODES, () => b.params.mode, (v) => { api.setParam('mode', v); api.rebuild(); }, 'mode');
    const num = (k, l, o) => api.num(s, l, () => b.params[k], (v) => api.setParam(k, v, k), { ...o, attr: k });
    switch (b.params.mode) {
      case 'crop': num('cx', 'x (0–1)', { step: 0.01, min: 0, max: 1 }); num('cy', 'y (0–1)', { step: 0.01, min: 0, max: 1 }); num('cw', 'width (0–1)', { step: 0.01, min: 0, max: 1 }); num('ch', 'height (0–1)', { step: 0.01, min: 0, max: 1 }); break;
      case 'pad': for (const [k, l] of [['padL', 'left (px)'], ['padT', 'top (px)'], ['padR', 'right (px)'], ['padB', 'bottom (px)']]) num(k, l, { step: 1, min: 0, max: 4096 }); api.color(s, 'fill colour', () => b.params.fill || '#ffffff', (v) => api.setParam('fill', v, 'fill'), 'fill'); api.check(s, 'transparent (outpaint canvas)', () => !!b.params.transparent, (v) => api.setParam('transparent', v), 'transparent'); s.appendChild(api.h('div', 'panel-note', 'A transparent pad is an outpaint canvas: send it to a Generate Image with a Mask of its alpha channel.')); break;
      case 'rotate/flip': api.select(s, 'rotate (°)', ANGLES, () => String(b.params.angle), (v) => api.setParam('angle', v), 'angle'); api.check(s, 'flip horizontal', () => !!b.params.flipH, (v) => api.setParam('flipH', v), 'flipH'); api.check(s, 'flip vertical', () => !!b.params.flipV, (v) => api.setParam('flipV', v), 'flipV'); break;
      case 'adjust': num('brightness', 'brightness', { step: 0.05, min: 0, max: 3 }); num('contrast', 'contrast', { step: 0.05, min: 0, max: 3 }); num('saturation', 'saturation', { step: 0.05, min: 0, max: 3 }); num('blur', 'blur (px)', { step: 0.5, min: 0, max: 50 }); num('sharpen', 'sharpen (0–1)', { step: 0.05, min: 0, max: 1 }); break;
      case 'blend': num('opacity', 'opacity', { step: 0.05, min: 0, max: 1 }); api.select(s, 'blend mode', BLENDS, () => b.params.blend, (v) => api.setParam('blend', v), 'blend'); s.appendChild(api.h('div', 'panel-note', 'Image B is drawn over the image with this opacity and mode.')); break;
      case 'composite': s.appendChild(api.h('div', 'panel-note', 'Image B shows over the image where the mask is white (everywhere without a mask).')); break;
      case 'invert': case 'grayscale': break;
      default: num('width', 'width (px)', { step: 1, min: 1, max: 8192 }); num('height', 'height (px)', { step: 1, min: 1, max: 8192 }); api.check(s, 'keep aspect (height follows)', () => !!b.params.keepAspect, (v) => api.setParam('keepAspect', v), 'keepAspect'); api.select(s, 'fit', FITS, () => b.params.fit, (v) => api.setParam('fit', v), 'fit');
    }
    api.readonly(s, 'result', () => { const m = b.state.current?.media; return b._busy ? 'computing…' : b._err ? `failed · ${b._err}` : m ? `${m.w}×${m.h} · stored (${m.storeId})` : 'waiting for an image'; });
    api.action(s, 'Download result', () => downloadMedia(b.state.current?.media), 'edit-download');
    s.appendChild(api.h('div', 'panel-note', 'Computed in the browser as soon as an input or a value changes; the result is stored with the project so a reload keeps it. Ctrl+B bypasses the step and passes the image through.'));
  },
});
