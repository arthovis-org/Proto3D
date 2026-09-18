// faces.js — 2D drawing helpers for the live faces on node bodies and device screens.
// Faces are canvases mapped onto a plane; components draw into them through def.face.render.
// Everything here reads the live palette so faces follow the theme.
import { palette, typography } from './theme.js';
import { kindOf, formatValue, formatNumber } from './core/types.js';

/* ---------------- bitmap cache (media sources) ---------------- */
const bitmaps = new Map();       // src → { image, ready, failed }
const readyListeners = new Set();
/** Called when an async image finishes loading so faces can redraw. */
export function onBitmapReady(cb) { readyListeners.add(cb); return () => readyListeners.delete(cb); }
/** Register a pre-rendered canvas for a src (generated samples: synchronous, no network). */
export function registerBitmap(src, canvas) { bitmaps.set(src, { image: canvas, ready: true }); }
/** Bitmap for a media src, or null while loading / on failure. */
export function bitmapFor(src) {
  if (!src) return null;
  let e = bitmaps.get(src);
  if (!e) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    e = { image: img, ready: false, failed: false };
    bitmaps.set(src, e);
    img.onload = () => { e.ready = true; readyListeners.forEach((cb) => cb(src)); };
    img.onerror = () => { e.failed = true; readyListeners.forEach((cb) => cb(src)); };
    img.src = src;
  }
  return e.ready ? e.image : null;
}
export function bitmapFailed(src) { return !!bitmaps.get(src)?.failed; }

/* ---------------- primitives ---------------- */
export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function clear(g, w, h, bg = palette.faceBg) { g.clearRect(0, 0, w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h); }
export const font = (px, weight = 500, mono = false) => `${weight} ${px}px ${mono ? typography.mono : typography.family}`;

export function wrapLines(g, text, maxW, maxLines = 40) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (g.measureText(test).width <= maxW || !line) line = test; else { out.push(line); line = word; }
      if (out.length >= maxLines) return out;
    }
    out.push(line);
  }
  return out.slice(0, maxLines);
}

/** Text fitted in a box: wraps, shrinks the font until it fits, draws centered or left-aligned. */
export function drawText(g, text, x, y, w, h, { size = 40, min = 14, color = palette.faceText, weight = 500, mono = false, align = 'center', valign = 'middle', lineHeight = 1.25 } = {}) {
  let px = size, lines;
  for (;;) {
    g.font = font(px, weight, mono);
    lines = wrapLines(g, text, w, Math.max(1, Math.floor(h / (px * lineHeight))) + 1);
    const fits = lines.length * px * lineHeight <= h && lines.every((l) => g.measureText(l).width <= w);
    if (fits || px <= min) break;
    px = Math.max(min, Math.floor(px * 0.85));
  }
  const maxLines = Math.max(1, Math.floor(h / (px * lineHeight)));
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…'); }
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = align;
  const total = lines.length * px * lineHeight;
  const y0 = valign === 'top' ? y + px * lineHeight / 2 : y + (h - total) / 2 + px * lineHeight / 2;
  const tx = align === 'left' ? x : align === 'right' ? x + w : x + w / 2;
  lines.forEach((l, i) => g.fillText(l, tx, y0 + i * px * lineHeight));
  return { px, lines: lines.length };
}

/** Pretty JSON lines (compact, depth-limited). */
export function jsonLines(v, max = 14) {
  let s;
  try { s = JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 60 ? x.slice(0, 57) + '…' : x), 2); } catch (_) { s = String(v); }
  const lines = s.split('\n');
  return lines.length > max ? [...lines.slice(0, max - 1), '…'] : lines;
}

/* ---------------- media ---------------- */
const MEDIA_HUES = { image: '#5aa9ff', video: '#ff8a5b', audio: '#2dd4bf' };

/** Draw one media item (image thumbnail, video poster + progress, audio waveform) into a box. */
export function drawMedia(g, media, x, y, w, h, { fit = 'cover', time = 0, radius = 10, caption = true } = {}) {
  g.save();
  roundRect(g, x, y, w, h, radius); g.clip();
  g.fillStyle = palette.faceCard; g.fillRect(x, y, w, h);
  const bmp = media && media.kind !== 'audio' ? bitmapFor(media.src) : null;
  if (bmp) {
    const bw = bmp.width || bmp.naturalWidth || 1, bh = bmp.height || bmp.naturalHeight || 1;
    const s = fit === 'contain' ? Math.min(w / bw, h / bh) : Math.max(w / bw, h / bh);
    const dw = bw * s, dh = bh * s;
    g.drawImage(bmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else if (media && media.kind === 'audio') {
    // waveform bars: deterministic per title, animated phase
    const n = Math.max(8, Math.floor(w / 9));
    const seed = [...(media.title || 'a')].reduce((a, c) => a + c.charCodeAt(0), 0);
    g.fillStyle = MEDIA_HUES.audio;
    for (let i = 0; i < n; i++) {
      const a = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.7 + seed) * Math.cos(i * 0.31 + time * 2.2));
      const bh2 = h * 0.6 * a; const bx = x + 8 + i * ((w - 16) / n);
      roundRect(g, bx, y + h / 2 - bh2 / 2, (w - 16) / n * 0.55, bh2, 3); g.fill();
    }
  } else {
    // loading / missing: dashed frame + label
    g.strokeStyle = palette.faceDim; g.setLineDash([6, 6]); g.lineWidth = 2;
    roundRect(g, x + 6, y + 6, w - 12, h - 12, radius); g.stroke(); g.setLineDash([]);
    drawText(g, media ? (bitmapFailed(media.src) ? 'failed to load' : 'loading…') : 'no media', x, y, w, h, { size: 16, color: palette.faceDim });
  }
  if (media && media.kind === 'video') {
    // poster frame + play glyph + a progress bar that advances with time (honest fallback for playback)
    const r = Math.min(w, h) * 0.16;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath();
    g.moveTo(x + w / 2 - r * 0.32, y + h / 2 - r * 0.45); g.lineTo(x + w / 2 + r * 0.5, y + h / 2); g.lineTo(x + w / 2 - r * 0.32, y + h / 2 + r * 0.45); g.closePath(); g.fill();
    const dur = media.duration || 12, p = (time % dur) / dur;
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y + h - 5, w, 5);
    g.fillStyle = MEDIA_HUES.video; g.fillRect(x, y + h - 5, w * p, 5);
  }
  if (caption && media && media.title && h >= 60) {
    const ch = Math.min(26, h * 0.26);
    const grad = g.createLinearGradient(0, y + h - ch * 1.6, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = grad; g.fillRect(x, y + h - ch * 1.6, w, ch * 1.6);
    g.fillStyle = '#fff'; g.font = font(Math.max(11, ch * 0.5), 600); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(media.title, x + 8, y + h - 8 - (media.kind === 'video' ? 5 : 0));
  }
  g.restore();
}

/** Columns / rows for n items: cols = 0 → automatic (near-square for the box aspect). */
export function gridShape(n, cols = 0, aspect = 1.6) {
  if (!n) return { cols: 0, rows: 0 };
  const c = cols > 0 ? Math.min(cols, n) : Math.max(1, Math.min(n, Math.round(Math.sqrt(n * aspect))));
  return { cols: c, rows: Math.ceil(n / c) };
}

/** Grid of media thumbnails. cols = 0 → automatic (near-square). Returns the layout used. */
export function drawMediaGrid(g, items, x, y, w, h, { cols = 0, gap = 8, fit = 'cover', time = 0 } = {}) {
  const n = items.length;
  if (!n) { drawText(g, 'no media connected', x, y, w, h, { size: 18, color: palette.faceDim }); return { cols: 0, rows: 0 }; }
  const { cols: c, rows } = gridShape(n, cols, w / h);
  const cw = (w - gap * (c - 1)) / c, ch = (h - gap * (rows - 1)) / rows;
  items.forEach((m, i) => {
    const cx = x + (i % c) * (cw + gap), cy = y + Math.floor(i / c) * (ch + gap);
    drawMedia(g, m, cx, cy, cw, ch, { fit, time, radius: 8, caption: ch > 70 });
  });
  return { cols: c, rows };
}

/* ---------------- generic value ---------------- */
/** Render any value into a box: text, numbers, booleans, JSON, media, media lists and grid layouts. */
export function drawValue(g, value, x, y, w, h, { time = 0, placeholder = 'no input' } = {}) {
  switch (kindOf(value)) {
    case 'none': drawText(g, placeholder, x, y, w, h, { size: 18, color: palette.faceDim }); break;
    case 'number': drawText(g, formatNumber(value), x, y, w, h, { size: Math.min(h * 0.6, 96), weight: 600, mono: true }); break;
    case 'boolean': {
      const pw = Math.min(w * 0.6, 220), ph = Math.min(h * 0.5, 64);
      g.fillStyle = value ? '#2dd4bf' : palette.faceCard;
      roundRect(g, x + (w - pw) / 2, y + (h - ph) / 2, pw, ph, ph / 2); g.fill();
      drawText(g, value ? 'true' : 'false', x, y, w, h, { size: ph * 0.5, weight: 700, color: value ? '#06231f' : palette.faceDim });
      break;
    }
    case 'text': drawText(g, value, x, y, w, h, { size: Math.min(h * 0.4, 56), weight: 600 }); break;
    case 'event': drawText(g, `↯ event #${value.n}${value.payload !== undefined ? '\n' + formatValue(value.payload, 40) : ''}`, x, y, w, h, { size: 26, weight: 600 }); break;
    case 'media': drawMedia(g, value, x, y, w, h, { fit: 'contain', time }); break;
    case 'media-list': drawMediaGrid(g, value, x, y, w, h, { time }); break;
    case 'media-layout': drawMediaGrid(g, value.items, x, y, w, h, { cols: value.cols, gap: value.gap ?? 8, fit: value.fit || 'cover', time }); break;
    default: {
      const lines = jsonLines(value, Math.floor(h / 20));
      const px = Math.max(11, Math.min(18, Math.floor(h / (lines.length * 1.3))));
      g.font = font(px, 500, true); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l.length > 60 ? l.slice(0, 59) + '…' : l, x + 8, y + 6 + i * px * 1.3));
    }
  }
}

/* ---------------- device screens ---------------- */
/** Device screen: lit-glass gradient, status bar with title + state dot, value below. */
export function drawScreen(g, w, h, { title = '', value, accent = palette.faceAccent, time = 0, hint = '' } = {}) {
  g.clearRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, palette.screenTop); grad.addColorStop(1, palette.screenBottom);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const bar = Math.max(22, Math.round(h * 0.11));
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, w, bar);
  g.fillStyle = accent; g.beginPath(); g.arc(bar * 0.6, bar / 2, bar * 0.18, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = font(bar * 0.5, 600); g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(title, bar * 1.1, bar / 2 + 1);
  if (hint) { g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = font(bar * 0.42, 500); g.fillText(hint, w - bar * 0.5, bar / 2 + 1); }
  const pad = Math.round(w * 0.05);
  if (value === undefined) {
    // abstract UI bars while nothing is connected
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 4; i++) g.fillRect(pad, bar + pad + i * (h - bar) * 0.18, (w - 2 * pad) * (0.7 - i * 0.14), (h - bar) * 0.07);
    return;
  }
  g.save();
  // text on screens is always light: force the light-on-dark palette locally
  const saved = { t: palette.faceText, d: palette.faceDim, c: palette.faceCard };
  palette.faceText = '#eaf1ff'; palette.faceDim = 'rgba(234,241,255,0.55)'; palette.faceCard = 'rgba(255,255,255,0.08)';
  drawValue(g, value, pad, bar + pad, w - 2 * pad, h - bar - 2 * pad, { time });
  palette.faceText = saved.t; palette.faceDim = saved.d; palette.faceCard = saved.c;
  g.restore();
}
