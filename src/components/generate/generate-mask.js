// Mask — a white-on-black image that says where a generator may paint (Generate Image `mask` =
// inpainting) or where a composite shows B over A (Image Edit `mask`). Sources: solid, a
// rectangle or an ellipse (fractions of the frame), a threshold of the reference image (its
// luminance, alpha or a colour key), or paint — the face is a canvas: press and drag to paint
// with a white brush, erase toggles, Clear wipes. Grow / feather / invert finish it. The mask is
// rendered off-screen at the reference image's size (1024 × 1024 when none) and cached until a
// param, the source or the painting changes; the painting itself lives in `state.paint` as a
// data URL bounded to 512 px so it survives save and reload.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { isMedia } from '../../core/types.js';
import { clear, drawCaps, drawDivider, drawMedia, drawChip, drawText, drawTile, bitmapFor, registerBitmap, roundRect, font, fitLine, tabular, PAD, beginFields } from '../../faces.js';

export const MASK_SOURCES = ['solid', 'rectangle', 'ellipse', 'from image', 'paint'];
const CHANNELS = ['luminance', 'alpha', 'colour key'];
const PAINT_MAX = 512, MAX_SIDE = 2048;
const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));

/** Output size: the reference image's pixels (capped), else 1024 × 1024. */
function maskSize(ref) {
  if (ref) { const bmp = bitmapFor(ref.src, ref); const w = ref.w || bmp?.naturalWidth || bmp?.width, h = ref.h || bmp?.naturalHeight || bmp?.height; if (w && h) { const k = Math.min(1, MAX_SIDE / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)]; } }
  return [1024, 1024];
}
/** The paint canvas (white on transparent), created from state.paint on first use. */
function paintCanvas(inst, W, H) {
  const aspect = W / H, pw = aspect >= 1 ? PAINT_MAX : Math.round(PAINT_MAX * aspect), ph = aspect >= 1 ? Math.round(PAINT_MAX / aspect) : PAINT_MAX;
  let c = inst._paint;
  if (!c || c.width !== pw || c.height !== ph) {
    const next = document.createElement('canvas'); next.width = pw; next.height = ph;
    if (c) next.getContext('2d').drawImage(c, 0, 0, pw, ph);   // the aspect changed with the reference: keep the strokes, rescaled
    else if (inst.state.paint && !inst._paintLoading) { inst._paintLoading = true; const im = new Image(); im.onload = () => { inst._paint?.getContext('2d').drawImage(im, 0, 0, inst._paint.width, inst._paint.height); inst._paintLoading = false; inst._maskKey = null; inst.faceDirty = true; }; im.onerror = () => { inst._paintLoading = false; }; im.src = inst.state.paint; }
    c = inst._paint = next;
  }
  return c;
}
/** Threshold the reference image into white / black by a channel. */
function fromImage(g, bmp, W, H, params) {
  g.drawImage(bmp, 0, 0, W, H);
  let id; try { id = g.getImageData(0, 0, W, H); } catch (_) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return; }
  const d = id.data, t = clamp01(params.threshold) * 255;
  const key = /^#?([0-9a-f]{6})$/i.exec(String(params.keyColor || '#ffffff')); const kr = key ? parseInt(key[1].slice(0, 2), 16) : 255, kg = key ? parseInt(key[1].slice(2, 4), 16) : 255, kb = key ? parseInt(key[1].slice(4, 6), 16) : 255;
  for (let i = 0; i < d.length; i += 4) {
    let v;
    if (params.channel === 'alpha') v = d[i + 3] >= t ? 255 : 0;
    else if (params.channel === 'colour key') v = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb) <= (1 - clamp01(params.threshold)) * 441 ? 255 : 0;
    else v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) >= t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}
/** Render the mask off-screen; returns the canvas. */
export function renderMask(inst, params, ref) {
  const [W, H] = maskSize(ref);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  const rx = clamp01(params.x) * W, ry = clamp01(params.y) * H, rw = clamp01(params.w) * W, rh = clamp01(params.h) * H;
  switch (params.source) {
    case 'solid': g.fillRect(0, 0, W, H); break;
    case 'rectangle': g.fillRect(rx, ry, rw, rh); break;
    case 'ellipse': g.beginPath(); g.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2); g.fill(); break;
    case 'from image': { const bmp = ref ? bitmapFor(ref.src, ref) : null; if (bmp) fromImage(g, bmp, W, H, params); break; }
    case 'paint': g.drawImage(paintCanvas(inst, W, H), 0, 0, W, H); break;
    default: break;
  }
  const grow = Math.round(+params.grow || 0), feather = Math.max(0, +params.feather || 0);
  if (grow) {   // dilate (grow > 0) or erode (grow < 0) by stamping the mask around a circle
    const src = document.createElement('canvas'); src.width = W; src.height = H; src.getContext('2d').drawImage(c, 0, 0);
    const r = Math.abs(grow);
    if (grow > 0) { g.globalCompositeOperation = 'lighter'; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; g.drawImage(src, Math.cos(a) * r, Math.sin(a) * r); } }
    else { g.globalCompositeOperation = 'darken'; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; g.drawImage(src, Math.cos(a) * r, Math.sin(a) * r); } }
    g.globalCompositeOperation = 'source-over';
  }
  if (feather) { const src = document.createElement('canvas'); src.width = W; src.height = H; src.getContext('2d').drawImage(c, 0, 0); g.filter = `blur(${feather}px)`; g.drawImage(src, 0, 0); g.filter = 'none'; }
  if (params.invert) { g.globalCompositeOperation = 'difference'; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
  return c;
}
const keyOf = (params, ref, inst) => JSON.stringify([params.source, params.x, params.y, params.w, params.h, params.channel, params.threshold, params.keyColor, params.grow, params.feather, params.invert, ref?.src || '', ref?.w, ref?.h, inst.state.paintV || 0]);

export default registry.register({
  id: 'generate-mask', category: 'generate', label: 'Mask', icon: icons['generate-mask'], size: 'L',
  description: 'A white-on-black mask: solid, rectangle, ellipse, a threshold of the image, or paint it on the face; grow, feather, invert',
  inputs: [{ key: 'image', label: 'image', type: 'media', optional: true }],
  outputs: [{ key: 'mask', label: 'mask', type: 'media' }],
  params: [
    { key: 'source', label: 'source', type: 'select', options: MASK_SOURCES, default: 'rectangle', hidden: true },
    { key: 'x', label: 'x', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'y', label: 'y', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'w', label: 'width', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'h', label: 'height', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'channel', label: 'channel', type: 'select', options: CHANNELS, default: 'luminance', hidden: true },
    { key: 'threshold', label: 'threshold', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, hidden: true },
    { key: 'keyColor', label: 'key colour', type: 'color', default: '#ffffff', hidden: true },
    { key: 'grow', label: 'grow (px)', type: 'number', default: 0, min: -64, max: 64, step: 1, hidden: true },
    { key: 'feather', label: 'feather (px)', type: 'number', default: 0, min: 0, max: 64, step: 1, hidden: true },
    { key: 'invert', label: 'invert', type: 'boolean', default: false, hidden: true },
    { key: 'brush', label: 'brush size', type: 'number', default: 40, min: 2, max: 200, step: 2, hidden: true },
    { key: 'erase', label: 'erase', type: 'boolean', default: false, hidden: true },
  ],
  describeLink(from, toDef, to, n) { return toDef.id === 'image-edit' ? `${n.from} decides where ${n.to} shows B over A` : to.key === 'mask' ? `${n.to} paints only inside ${n.from}` : `${n.fromPoss} mask shows on ${n.to}`; },
  evaluate({ inputs, params, instance }) {
    const ref = isMedia(inputs.image) && inputs.image.kind === 'image' ? inputs.image : null;
    const key = keyOf(params, ref, instance);
    if (instance._maskKey !== key || !instance._mask) {
      const c = renderMask(instance, params, ref);
      const src = c.toDataURL('image/png');
      registerBitmap(src, c);
      instance._maskKey = key;
      instance._mask = { kind: 'image', src, title: `${instance.title} mask`, w: c.width, h: c.height, role: 'mask' };
      instance.faceDirty = true;
    }
    return { mask: instance._mask };
  },
  footer: ({ params, outputs }) => `${params.source}${outputs.mask ? ` · ${outputs.mask.w}×${outputs.mask.h}` : ''}${params.invert ? ' · inverted' : ''}`,
  face: {
    live: true, fps: 6,
    portAnchors: ({ h }) => ({ image: (PAD + 40 + h - PAD) / 2, mask: (PAD + 40 + h - PAD) / 2 }),
    render(g, w, h, { params, inputs, outputs, instance, time }) {
      clear(g, w, h);
      const F = beginFields(instance);
      const hits = []; instance._hits = hits;
      const dim = palette.faceDim, text = palette.faceText, acc = palette.faceAccent;
      drawCaps(g, 'mask', PAD, PAD + 8, { size: 11 });
      // source chips (a click switches; also a select field for the editor)
      let cx = PAD + 56;
      for (const sname of MASK_SOURCES) { const on = params.source === sname; const cw = drawChip(g, sname, cx, PAD - 4, { h: 24, bg: on ? acc : palette.faceCard, color: on ? '#fff' : dim, size: 11, weight: 700, padX: 9 }); hits.push({ x: cx, y: PAD - 4, w: cw, h: 24, action: 'source', arg: sname }); cx += cw + 6; }
      F.add({ id: 'source', kind: 'select', param: 'source', label: 'source', options: MASK_SOURCES, mode: 'through', rect: { x: PAD + 56, y: PAD - 4, w: cx - PAD - 62, h: 24 }, font: { size: 11, weight: 700 } });
      drawDivider(g, PAD, PAD + 24, w - 2 * PAD);
      // preview box (left) at the mask's aspect; a column of the mode's numbers (right)
      const by = PAD + 40, bh = h - by - PAD, colW = 190, gap = 16, pw = w - 2 * PAD - colW - gap;
      const mask = outputs.mask, ref = isMedia(inputs?.image) ? inputs.image : null;
      const aspect = mask ? mask.w / mask.h : 1;
      let bw = pw, bhh = bw / aspect; if (bhh > bh) { bhh = bh; bw = bhh * aspect; }
      const bx = PAD + (pw - bw) / 2, byy = by + (bh - bhh) / 2;
      instance._box = { x: bx, y: byy, w: bw, h: bhh };
      g.save(); roundRect(g, bx, byy, bw, bhh, 12); g.clip();
      // checkerboard ground, the reference, then the mask as a translucent white overlay (black stays as the ground)
      g.fillStyle = palette.faceCard; g.fillRect(bx, byy, bw, bhh);
      g.fillStyle = palette.faceLine; for (let yy = 0; yy < bhh; yy += 14) for (let xx = ((yy / 14) % 2) * 14; xx < bw; xx += 28) g.fillRect(bx + xx, byy + yy, 14, 14);
      if (ref) { g.globalAlpha = 0.55; drawMedia(g, ref, bx, byy, bw, bhh, { fit: 'cover', time, radius: 0, caption: false }); g.globalAlpha = 1; }
      const mb = instance._stroke && instance._paint ? instance._paint : mask ? bitmapFor(mask.src, mask) : null;   // mid-stroke: the live painting; else the finished mask
      if (mb) { g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.85; g.drawImage(mb, bx, byy, bw, bhh); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
      if (params.source === 'paint' && instance._brushAt) { const B = instance._brushAt; g.strokeStyle = params.erase ? palette.faceBad : acc; g.lineWidth = 1.5; g.beginPath(); g.arc(B.x, B.y, Math.max(2, (+params.brush || 40) / 2) * (bw / (instance._paint?.width || PAINT_MAX)), 0, Math.PI * 2); g.stroke(); }
      g.restore();
      if (params.source === 'paint') drawCaps(g, params.erase ? 'erasing · press and drag' : 'painting · press and drag', bx, byy + bhh + 10, { size: 9, color: params.erase ? palette.faceBad : acc });
      else if (!ref && params.source === 'from image') drawText(g, 'connect an image to threshold', bx, byy, bw, bhh, { size: 14, color: dim });
      // the numbers
      const x = w - PAD - colW; let y = by;
      const row = (id, label, key, { min, max, step, fmt = (v) => String(v), kind = 'number' } = {}) => {
        drawCaps(g, label, x, y + 14, { size: 10 });
        const vw = 72, vx = x + colW - vw;
        const spec = kind === 'checkbox' ? { id, kind: 'checkbox', param: key, label, rect: { x: vx, y: y + 2, w: vw, h: 24 } } : { id, kind: 'number', param: key, label, min, max, step, rect: { x: vx, y: y + 2, w: vw, h: 24 }, font: { size: 14, weight: 600, align: 'right', mono: true } };
        const f = F.add(spec);
        if (kind === 'checkbox') { const on = !!params[key]; g.fillStyle = on ? acc : palette.faceLine; roundRect(g, vx + vw - 34, y + 5, 34, 18, 9); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(vx + vw - 34 + (on ? 25 : 9), y + 14, 6.5, 0, Math.PI * 2); g.fill(); }
        else if (!f.editing) { g.font = font(14, 600, true); tabular(g); g.fillStyle = text; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(fitLine(g, fmt(params[key]), vw), vx + vw, y + 15); }
        y += 30;
      };
      const pct = (v) => `${Math.round(clamp01(v) * 100)}%`;
      if (params.source === 'rectangle' || params.source === 'ellipse') { row('x', 'x', 'x', { min: 0, max: 1, step: 0.01, fmt: pct }); row('y', 'y', 'y', { min: 0, max: 1, step: 0.01, fmt: pct }); row('w', 'width', 'w', { min: 0, max: 1, step: 0.01, fmt: pct }); row('h', 'height', 'h', { min: 0, max: 1, step: 0.01, fmt: pct }); }
      else if (params.source === 'from image') { drawCaps(g, params.channel, x, y + 14, { size: 10, color: acc }); y += 30; row('threshold', 'threshold', 'threshold', { min: 0, max: 1, step: 0.01, fmt: pct }); }
      else if (params.source === 'paint') {
        row('brush', 'brush', 'brush', { min: 2, max: 200, step: 2, fmt: (v) => `${Math.round(+v || 0)} px` });
        row('erase', 'erase', 'erase', { kind: 'checkbox' });
        const cw = drawChip(g, 'Clear', x, y + 2, { h: 24, bg: palette.faceCard, color: text, size: 11, weight: 700, padX: 12 }); hits.push({ x, y: y + 2, w: cw, h: 24, action: 'clear' }); y += 30;
      }
      drawDivider(g, x, y + 4, colW); y += 12;
      row('grow', 'grow', 'grow', { min: -64, max: 64, step: 1, fmt: (v) => `${Math.round(+v || 0)} px` });
      row('feather', 'feather', 'feather', { min: 0, max: 64, step: 1, fmt: (v) => `${Math.round(+v || 0)} px` });
      row('invert', 'invert', 'invert', { kind: 'checkbox' });
      if (mask) { g.font = font(11, 500); g.fillStyle = dim; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(`${mask.w} × ${mask.h}`, w - PAD, h - PAD + 6); }
    },
    /**
     * Chips switch the source, Clear wipes the painting; in paint mode a press inside the preview
     * starts a stroke (the drag is captured), every move stamps the brush, the release stores the
     * painting in state.paint.
     */
    onPointer({ instance: inst, params }, ev) {
      const cw = inst.face.cw, ch = inst.face.ch, px = ev.u * cw, py = ev.v * ch;
      const B = inst._box;
      const inBox = B && px >= B.x && px <= B.x + B.w && py >= B.y && py <= B.y + B.h;
      const write = (key, v) => { inst.params[key] = v; inst._maskKey = null; inst.faceDirty = true; inst.world?.changed?.('param'); };
      if (ev.type === 'click') {
        const hit = (inst._hits || []).find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
        if (!hit) return false;
        if (hit.action === 'source') write('source', hit.arg);
        else if (hit.action === 'clear') { inst._paint?.getContext('2d').clearRect(0, 0, inst._paint.width, inst._paint.height); inst.state.paint = null; inst.state.paintV = (inst.state.paintV || 0) + 1; inst._maskKey = null; inst.faceDirty = true; inst.world?.changed?.('paint'); }
        return true;
      }
      if (params.source !== 'paint' || !B) return false;
      if (ev.type === 'down') { if (!inBox) return false; inst._stroke = { last: null }; }
      if (!inst._stroke) return false;
      if (ev.type === 'down' || ev.type === 'drag') {
        const c = inst._paint || paintCanvas(inst, ...maskSize(null)); const g = c.getContext('2d');
        const sx = c.width / B.w, x = (px - B.x) * sx, y = (py - B.y) * sx, r = Math.max(1, (+params.brush || 40) / 2);
        g.save(); g.globalCompositeOperation = params.erase ? 'destination-out' : 'source-over'; g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = r * 2;
        if (inst._stroke.last) { g.beginPath(); g.moveTo(inst._stroke.last.x, inst._stroke.last.y); g.lineTo(x, y); g.stroke(); }
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
        inst._stroke.last = { x, y }; inst._brushAt = { x: px, y: py };   // the face shows the live painting; the mask re-renders on release
        inst.faceDirty = true;
        return true;
      }
      if (ev.type === 'up') { inst._stroke = null; inst._brushAt = null; if (inst._paint) { inst.state.paint = inst._paint.toDataURL('image/png'); inst.state.paintV = (inst.state.paintV || 0) + 1; } inst.faceDirty = true; inst.world?.changed?.('paint'); return true; }
      return false;
    },
  },
  panel(api, b) {
    const s = api.section('Mask');
    api.select(s, 'source', MASK_SOURCES, () => b.params.source, (v) => { api.setParam('source', v); api.rebuild(); }, 'source');
    const src = b.params.source;
    if (src === 'rectangle' || src === 'ellipse') for (const [k, l] of [['x', 'x (0–1)'], ['y', 'y (0–1)'], ['w', 'width (0–1)'], ['h', 'height (0–1)']]) api.num(s, l, () => b.params[k], (v) => api.setParam(k, clamp01(v), k), { step: 0.01, min: 0, max: 1, attr: k });
    if (src === 'from image') {
      api.select(s, 'channel', CHANNELS, () => b.params.channel, (v) => { api.setParam('channel', v); api.rebuild(); }, 'channel');
      api.num(s, 'threshold', () => b.params.threshold, (v) => api.setParam('threshold', clamp01(v), 'threshold'), { step: 0.01, min: 0, max: 1, attr: 'threshold' });
      if (b.params.channel === 'colour key') api.color(s, 'key colour', () => b.params.keyColor || '#ffffff', (v) => api.setParam('keyColor', v, 'keyColor'), 'keyColor');
      s.appendChild(api.h('div', 'panel-note', 'White where the image\'s luminance (or alpha) is above the threshold, or where its colour is close to the key colour.'));
    }
    if (src === 'paint') {
      api.num(s, 'brush size (px)', () => b.params.brush, (v) => api.setParam('brush', Math.max(2, Math.round(v)), 'brush'), { step: 2, min: 2, max: 200, attr: 'brush' });
      api.check(s, 'erase', () => !!b.params.erase, (v) => api.setParam('erase', v), 'erase');
      api.action(s, 'Clear painting', () => { b._paint?.getContext('2d').clearRect(0, 0, b._paint.width, b._paint.height); b.state.paint = null; b.state.paintV = (b.state.paintV || 0) + 1; b._maskKey = null; b.faceDirty = true; api.world.changed('paint'); }, 'mask-clear');
      s.appendChild(api.h('div', 'panel-note', 'Press and drag on the face to paint white; the painting is kept at 512 px and saved with the project (not an undo step).'));
    }
    const ops = api.section('Finish');
    api.num(ops, 'grow (px, negative shrinks)', () => b.params.grow, (v) => api.setParam('grow', Math.round(v), 'grow'), { step: 1, min: -64, max: 64, attr: 'grow' });
    api.num(ops, 'feather (px)', () => b.params.feather, (v) => api.setParam('feather', Math.max(0, v), 'feather'), { step: 1, min: 0, max: 64, attr: 'feather' });
    api.check(ops, 'invert', () => !!b.params.invert, (v) => api.setParam('invert', v), 'invert');
    ops.appendChild(api.h('div', 'panel-note', 'The mask is rendered at the connected image\'s size (1024 × 1024 without one). Plug it into a Generate Image\'s "mask" to inpaint (fal: FLUX pro fill; Demo paints only inside it) or into an Image Edit composite.'));
  },
});
