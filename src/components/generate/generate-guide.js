// Guide — an image that steers a generator: image to image (the picture is the starting point,
// strength = how far to move from it), edges / depth / pose (a ControlNet condition; for edges the
// browser computes a live Sobel trace of the picture, cached per source, and sends it as the
// control image), or a style reference. The `guide` output plugs into a Generate Image / Video
// `guides` slot; the adapters pick the endpoint (fal: image-to-image, flux-general with
// controlnets, redux), kie refuses in plain words, Demo tints and traces so the flow shows offline.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { isMedia } from '../../core/types.js';
import { clear, drawCaps, drawDivider, drawMedia, drawChip, drawBar, drawText, drawTile, bitmapFor, registerBitmap, font, PAD, beginFields } from '../../faces.js';

export const GUIDE_MODES = ['image to image', 'edges', 'depth', 'pose', 'style reference'];
const EDGE_MAX = 512;   // longest side of the computed edge image

/** Sobel edge trace of a bitmap: white edges on black, ≤ EDGE_MAX px on the longest side. Null when the pixels cannot be read (a tainted cross-origin image). */
export function sobelEdges(bmp, threshold = 70) {
  const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
  if (!bw || !bh) return null;
  const k = Math.min(1, EDGE_MAX / Math.max(bw, bh)), w = Math.max(2, Math.round(bw * k)), h = Math.max(2, Math.round(bh * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  let src; try { src = g.getImageData(0, 0, w, h).data; } catch (_) { return null; }
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) gray[p] = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
  const out = g.createImageData(w, h), d = out.data;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
    const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
    const m = Math.hypot(gx, gy) / 4;
    const v = m > threshold ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return c;
}
/** The edge control record for a media source, computed once per src and kept on the instance. */
function edgesFor(inst, media) {
  if (inst._edge?.src === media.src) return inst._edge.record;
  const bmp = bitmapFor(media.src, media);
  if (!bmp) return null;   // still loading: try again next frame
  const c = sobelEdges(bmp);
  if (!c) { inst._edge = { src: media.src, record: null }; return null; }
  const src = c.toDataURL('image/png');
  registerBitmap(src, c);
  inst._edge = { src: media.src, record: { kind: 'image', src, title: `${media.title || 'image'} · edges`, w: c.width, h: c.height, role: 'control' } };
  return inst._edge.record;
}

export default registry.register({
  id: 'generate-guide', category: 'generate', label: 'Guide', icon: icons['generate-guide'], size: 'M',
  description: 'An image that steers a generator: image to image, edges (live Sobel trace), depth, pose or a style reference',
  inputs: [{ key: 'image', label: 'image', type: 'media' }],
  outputs: [{ key: 'guide', label: 'guide', type: 'data', subtype: 'guide' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: GUIDE_MODES, default: 'image to image' },
    { key: 'strength', label: 'strength', type: 'number', default: 0.75, min: 0, max: 1, step: 0.05 },
  ],
  describeLink(from, toDef, to, n) { return to.key === 'guides' ? `${n.from} guides ${n.to}` : `${n.fromPoss} guide goes to ${n.to}`; },
  evaluate({ inputs, params, instance }) {
    const image = isMedia(inputs.image) && inputs.image.kind === 'image' ? inputs.image : null;
    if (!image) return {};
    const strength = Math.max(0, Math.min(1, +params.strength || 0));
    const guide = { mode: params.mode, strength, image };
    if (params.mode === 'edges') { const control = edgesFor(instance, image); if (control) guide.control = control; }
    return { guide };
  },
  footer: ({ params, outputs }) => (outputs.guide ? `${params.mode} · ${Math.round((outputs.guide.strength || 0) * 100)}%${params.mode === 'edges' && !outputs.guide.control ? ' · tracing…' : ''}` : 'connect an image'),
  face: {
    live: true, fps: 6,
    portAnchors: ({ h }) => ({ image: (PAD + 40 + h - 48) / 2, guide: (PAD + 40 + h - 48) / 2 }),
    render(g, w, h, { params, outputs, inputs, instance, time }) {
      clear(g, w, h);
      const F = beginFields(instance);
      const guide = outputs.guide;
      drawCaps(g, 'guide', PAD, PAD + 8, { size: 11 });
      const mode = F.add({ id: 'mode', kind: 'select', param: 'mode', label: 'mode', options: GUIDE_MODES, rect: { x: PAD + 60, y: PAD - 4, w: 170, h: 24 }, font: { size: 12, weight: 700, align: 'left' } });
      if (!mode.editing) drawChip(g, params.mode, PAD + 60, PAD - 4, { h: 24, bg: palette.faceAccent, color: '#fff', size: 12, weight: 700 });
      drawDivider(g, PAD, PAD + 24, w - 2 * PAD);
      const by = PAD + 40, bh = h - by - 48, gap = 12, bw = (w - 2 * PAD - gap) / 2;
      const image = isMedia(inputs?.image) ? inputs.image : null;
      if (!image) { drawText(g, 'Connect an image to guide with', PAD, by, w - 2 * PAD, bh, { size: 16, color: palette.faceDim }); }
      else {
        drawMedia(g, image, PAD, by, bw, bh, { fit: 'contain', time, radius: 12, caption: false });
        drawCaps(g, 'source', PAD, by + bh + 12, { size: 9 });
        if (params.mode === 'edges') {
          if (guide?.control) drawMedia(g, guide.control, PAD + bw + gap, by, bw, bh, { fit: 'contain', time, radius: 12, caption: false });
          else drawText(g, instance._edge && instance._edge.src === image.src ? 'edges unavailable (cross-origin image)' : 'tracing edges…', PAD + bw + gap, by, bw, bh, { size: 14, color: palette.faceDim });
          drawCaps(g, 'edges · sent as control image', PAD + bw + gap, by + bh + 12, { size: 9 });
        } else {
          // the other modes send the picture itself: show what the strength means
          const x = PAD + bw + gap;
          drawTile(g, x, by, bw, bh, { r: 12 });
          const what = params.mode === 'image to image' ? 'the picture is the starting point; strength = how far the model may move from it' : params.mode === 'style reference' ? 'the model borrows this picture\'s look, not its content' : `a ${params.mode} map is estimated by the endpoint from this picture`;
          drawText(g, what, x + 14, by + 10, bw - 28, bh - 20, { size: 14, color: palette.faceDim, align: 'left', valign: 'top', lineHeight: 1.4 });
          drawCaps(g, params.mode, x, by + bh + 12, { size: 9 });
        }
      }
      // strength: a thin bar with the number editable in place
      const sy = h - PAD - 4;
      drawCaps(g, 'strength', PAD, sy, { size: 10 });
      drawBar(g, PAD + 80, sy - 3, w - 2 * PAD - 80 - 70, 6, +params.strength || 0);
      const f = F.add({ id: 'strength', kind: 'number', param: 'strength', label: 'strength', min: 0, max: 1, step: 0.05, rect: { x: w - PAD - 60, y: sy - 12, w: 60, h: 24 }, font: { size: 14, weight: 600, align: 'right', mono: true } });
      if (!f.editing) { g.font = font(14, 600, true); g.fillStyle = palette.faceText; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText((+params.strength || 0).toFixed(2), w - PAD, sy + 1); }
    },
  },
});
