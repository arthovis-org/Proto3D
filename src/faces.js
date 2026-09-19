// faces.js — 2D drawing helpers for the live faces on node bodies and device screens.
// Faces are canvases mapped onto a plane; components draw into them through def.face.render.
// Everything here reads the live palette so faces follow the theme.
//
// Design language (flat, modern UI on a 120 px/unit canvas, 8-pt grid):
//   • `clear` paints a rounded face card with transparent corners so it sits on the bevelled body;
//   • type: Inter stack, title 600 / label 500 / value 400 (`typography.scale`), small caps with
//     letter-spacing (`drawCaps`), tabular numbers (`tabular`);
//   • structure through spacing and 1 px dividers (`drawDivider`), not boxes; inner sections are
//     slightly lighter tiles (`drawTile`); chips for tags / assignees (`drawChip`); thin rounded
//     bars for progress (`drawBar`); muted timestamps; colour reserved for meaning
//     (`palette.faceAccent / faceGood / faceWarn / faceBad`, type hues) and neutral greys otherwise.
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
export const PAD = 24;           // face margin in canvas px (≈ 8 % of a small face)
export const GRID = 8;           // spacing unit
export const RADIUS = 18;        // face card corner radius
export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/** Wipe the canvas and paint the rounded face card (transparent outside the corners). `radius: 0` = full bleed. */
export function clear(g, w, h, bg = palette.faceBg, radius = RADIUS) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = bg;
  if (!radius || bg === 'rgba(0,0,0,0)') { if (bg !== 'rgba(0,0,0,0)') g.fillRect(0, 0, w, h); return; }
  roundRect(g, 0, 0, w, h, radius); g.fill();
}
export const font = (px, weight = 500, mono = false) => `${weight} ${px}px ${mono ? typography.mono : typography.family}`;
/** Tabular figures (numbers align in columns). */
export const tabular = (g) => { try { g.fontVariantNumeric = 'tabular-nums'; } catch (_) { /* older canvases */ } };

/** Small caps label with letter-spacing (section headers, column titles). Returns the drawn width. */
export function drawCaps(g, text, x, y, { size = typography.scale.caps, color = palette.faceDim, weight = typography.weight.caps, align = 'left', spacing = typography.capsSpacing } = {}) {
  const t = String(text).toUpperCase();
  g.font = font(size, weight); g.fillStyle = color; g.textBaseline = 'middle';
  try { g.letterSpacing = `${spacing}em`; } catch (_) { /* unsupported */ }
  const w = g.measureText(t).width + (g.letterSpacing === undefined ? spacing * size * (t.length - 1) : 0);
  g.textAlign = 'left';
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  if (g.letterSpacing !== undefined) g.fillText(t, x0, y);
  else { let cx = x0; for (const ch of t) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + spacing * size; } }
  try { g.letterSpacing = '0px'; } catch (_) { /* ignore */ }
  return w;
}
/** 1 px divider. */
export function drawDivider(g, x, y, w, color = palette.faceLine) { g.fillStyle = color; g.fillRect(x, Math.round(y), w, 1); }
/** A slightly lighter inner tile (section background). */
export function drawTile(g, x, y, w, h, { bg = palette.faceCard, r = 12 } = {}) { g.fillStyle = bg; roundRect(g, x, y, w, h, r); g.fill(); }
/** A chip (tag, assignee, status). Returns its width. */
export function drawChip(g, text, x, y, { h = 22, bg = palette.faceCard, color = palette.faceText, size = 12, weight = 600, padX = 9, dot = null } = {}) {
  g.font = font(size, weight);
  const tw = g.measureText(text).width;
  const w = tw + padX * 2 + (dot ? h * 0.55 : 0);
  g.fillStyle = bg; roundRect(g, x, y, w, h, h / 2); g.fill();
  let tx = x + padX;
  if (dot) { g.fillStyle = dot; g.beginPath(); g.arc(x + padX + h * 0.18, y + h / 2, h * 0.18, 0, Math.PI * 2); g.fill(); tx += h * 0.55; }
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, tx, y + h / 2 + 0.5);
  return w;
}
/** Thin rounded progress bar. */
export function drawBar(g, x, y, w, h, ratio, { track = palette.faceLine, fill = palette.faceAccent } = {}) {
  g.fillStyle = track; roundRect(g, x, y, w, h, h / 2); g.fill();
  const k = Math.max(0, Math.min(1, ratio || 0));
  if (k > 0) { g.fillStyle = fill; roundRect(g, x, y, Math.max(h, w * k), h, h / 2); g.fill(); }
}
/** Round avatar with initials. */
export function drawAvatar(g, text, cx, cy, r, colour) {
  g.fillStyle = colour || palette.faceAccent; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = font(r * 0.85, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cx, cy + r * 0.05);
}
/** Single line, ellipsised to `maxW`. Returns the text drawn. */
export function fitLine(g, text, maxW) {
  let s = String(text ?? '');
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
/** Stat tile: small caps label over a big tabular value. */
export function drawStat(g, x, y, w, h, label, value, { color = palette.faceText, bg = palette.faceCard, sub = '' } = {}) {
  drawTile(g, x, y, w, h, { bg });
  drawCaps(g, label, x + 12, y + 15, { size: 11 });
  const vs = Math.min(26, h * 0.36);
  g.font = font(vs, 600); tabular(g); g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(String(value), x + 12, y + 26 + vs);
  if (sub) { g.font = font(11, 500); g.fillStyle = palette.faceDim; g.textBaseline = 'alphabetic'; g.fillText(sub, x + 12 + g.measureText(String(value)).width * (vs / 11) * 0 + Math.ceil(vs * 0.05) + (() => { g.font = font(vs, 600); const wv = g.measureText(String(value)).width; g.font = font(11, 500); return wv + 8; })(), y + 26 + vs); }
}

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
export function drawText(g, text, x, y, w, h, { size = 40, min = 14, color = palette.faceText, weight = 500, mono = false, align = 'center', valign = 'middle', lineHeight = 1.3 } = {}) {
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
export function drawMedia(g, media, x, y, w, h, { fit = 'cover', time = 0, radius = 12, caption = true } = {}) {
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
    g.strokeStyle = palette.faceDim; g.setLineDash([6, 6]); g.lineWidth = 1.5;
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
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y + h - 4, w, 4);
    g.fillStyle = MEDIA_HUES.video; g.fillRect(x, y + h - 4, w * p, 4);
  }
  if (caption && media && media.title && h >= 60) {
    const ch = Math.min(26, h * 0.26);
    const grad = g.createLinearGradient(0, y + h - ch * 1.6, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = grad; g.fillRect(x, y + h - ch * 1.6, w, ch * 1.6);
    g.fillStyle = '#fff'; g.font = font(Math.max(11, ch * 0.5), 600); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(media.title, x + 10, y + h - 9 - (media.kind === 'video' ? 4 : 0));
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
    drawMedia(g, m, cx, cy, cw, ch, { fit, time, radius: 10, caption: ch > 70 });
  });
  return { cols: c, rows };
}

/* ---------------- generic value ---------------- */
/** Render any value into a box: text, numbers, booleans, JSON, media, media lists and grid layouts. */
export function drawValue(g, value, x, y, w, h, { time = 0, placeholder = 'no input' } = {}) {
  switch (kindOf(value)) {
    case 'none': drawText(g, placeholder, x, y, w, h, { size: 17, color: palette.faceDim, weight: 500 }); break;
    case 'number': tabular(g); drawText(g, formatNumber(value), x, y, w, h, { size: Math.min(h * 0.55, 88), weight: 600 }); break;
    case 'boolean': {
      const ph = Math.min(h * 0.4, 44), text = value ? 'true' : 'false';
      g.font = font(ph * 0.45, 600); const pw = g.measureText(text).width + ph * 1.4;
      const px = x + (w - pw) / 2, py = y + (h - ph) / 2;
      g.fillStyle = value ? palette.faceGood : palette.faceCard; roundRect(g, px, py, pw, ph, ph / 2); g.fill();
      g.fillStyle = value ? '#0b2a22' : palette.faceDim; g.beginPath(); g.arc(px + ph * 0.5, py + ph / 2, ph * 0.16, 0, Math.PI * 2); g.fill();
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, px + ph * 0.85, py + ph / 2 + 1);
      break;
    }
    case 'text': drawText(g, value, x, y, w, h, { size: Math.min(h * 0.36, 44), weight: 500 }); break;
    case 'event': drawText(g, `↯ event #${value.n}${value.payload !== undefined ? '\n' + formatValue(value.payload, 40) : ''}`, x, y, w, h, { size: 24, weight: 600 }); break;
    case 'media': drawMedia(g, value, x, y, w, h, { fit: 'contain', time }); break;
    case 'media-list': drawMediaGrid(g, value, x, y, w, h, { time }); break;
    case 'media-layout': drawMediaGrid(g, value.items, x, y, w, h, { cols: value.cols, gap: value.gap ?? 8, fit: value.fit || 'cover', time }); break;
    default: {
      const lines = jsonLines(value, Math.floor(h / 20));
      const px = Math.max(11, Math.min(17, Math.floor(h / (lines.length * 1.35))));
      g.font = font(px, 500, true); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l.length > 60 ? l.slice(0, 59) + '…' : l, x + 8, y + 6 + i * px * 1.35));
    }
  }
}

/* ---------------- device screens ---------------- */
/** Device screen: flat lit glass, a slim status bar with title + state dot, the value below. */
export function drawScreen(g, w, h, { title = '', value, accent = palette.faceAccent, time = 0, hint = '' } = {}) {
  g.clearRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, palette.screenTop); grad.addColorStop(1, palette.screenBottom);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const bar = Math.max(24, Math.round(h * 0.1));
  g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, 0, w, bar);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, bar, w, 1);
  g.fillStyle = accent; g.beginPath(); g.arc(bar * 0.6, bar / 2, bar * 0.14, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = font(bar * 0.46, 600); g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(title, bar * 1.05, bar / 2 + 1);
  if (hint) { g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = font(bar * 0.4, 500); g.fillText(hint, w - bar * 0.5, bar / 2 + 1); }
  const pad = Math.round(Math.min(w, h) * 0.06);
  if (value === undefined) {
    // abstract UI lines while nothing is connected
    g.fillStyle = 'rgba(255,255,255,0.09)';
    for (let i = 0; i < 4; i++) { roundRect(g, pad, bar + pad + i * (h - bar) * 0.17, (w - 2 * pad) * (0.7 - i * 0.14), (h - bar) * 0.06, 6); g.fill(); }
    return;
  }
  g.save();
  // text on screens is always light: force the light-on-dark palette locally
  const saved = { t: palette.faceText, d: palette.faceDim, c: palette.faceCard, l: palette.faceLine };
  palette.faceText = '#eaf1ff'; palette.faceDim = 'rgba(234,241,255,0.6)'; palette.faceCard = 'rgba(255,255,255,0.09)'; palette.faceLine = 'rgba(255,255,255,0.12)';
  drawValue(g, value, pad, bar + pad, w - 2 * pad, h - bar - 2 * pad, { time });
  palette.faceText = saved.t; palette.faceDim = saved.d; palette.faceCard = saved.c; palette.faceLine = saved.l;
  g.restore();
}
