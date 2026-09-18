// components/media/samples.js — generated sample assets so Media works offline with no network:
// six placeholder images (distinct colours, label, simple pattern) drawn on canvases and
// registered as bitmaps, a tiny generated WAV for audio, and animated "video" posters.
import { registerBitmap } from '../../faces.js';

const PALETTE = [
  ['#ff8a5b', '#7a2e12', 'Dune'], ['#5aa9ff', '#0f2f6b', 'Harbour'], ['#2dd4bf', '#0b4a44', 'Lagoon'],
  ['#e25aa6', '#5a1240', 'Orchid'], ['#f5b942', '#6b4a05', 'Saffron'], ['#8b7cf6', '#2b1f6b', 'Nebula'],
];
export const SAMPLE_COUNT = PALETTE.length;
const cache = new Map();

function drawSample(i, kind) {
  const [c1, c2, name] = PALETTE[i % PALETTE.length];
  const w = 320, h = 200;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // a distinct geometric motif per sample
  g.fillStyle = 'rgba(255,255,255,0.18)';
  switch (i % 6) {
    case 0: for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(60 + k * 55, 120 - k * 12, 30 + k * 6, 0, Math.PI * 2); g.fill(); } break;
    case 1: for (let k = 0; k < 7; k++) g.fillRect(20 + k * 42, 40 + (k % 2) * 60, 26, 100); break;
    case 2: g.beginPath(); g.moveTo(0, 160); for (let x = 0; x <= w; x += 10) g.lineTo(x, 120 + 30 * Math.sin(x / 28)); g.lineTo(w, h); g.lineTo(0, h); g.fill(); break;
    case 3: for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(160, 100); g.arc(160, 100, 90, k * 1.05, k * 1.05 + 0.5); g.fill(); } break;
    case 4: for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * 40, y * 40, 40, 40); break;
    default: g.beginPath(); g.moveTo(40, 170); g.lineTo(160, 30); g.lineTo(280, 170); g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h - 44, w, 44);
  g.fillStyle = '#fff'; g.font = '600 20px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
  g.fillText(`${name}${kind === 'video' ? ' · clip' : ''}`, 16, h - 22);
  g.font = '500 13px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.75)'; g.textAlign = 'right';
  g.fillText(`sample ${i + 1} · ${w}×${h}`, w - 14, h - 22);
  return { canvas: c, name };
}

/** Sample media object for (kind, index). Stable identity per call site (cached). */
export function sampleMedia(kind, i) {
  const key = `${kind}:${i}`;
  if (cache.has(key)) return cache.get(key);
  let media;
  if (kind === 'audio') {
    const [, , name] = PALETTE[i % PALETTE.length];
    media = { kind: 'audio', src: makeWav(220 * Math.pow(1.2, i)), title: `${name} tone`, duration: 0.5 };
  } else {
    const { canvas, name } = drawSample(i, kind);
    const src = canvas.toDataURL('image/png');
    registerBitmap(src, canvas);
    media = kind === 'video'
      ? { kind: 'video', src, title: `${name} clip`, w: canvas.width, h: canvas.height, duration: 8 + i * 2, poster: true }
      : { kind: 'image', src, title: name, w: canvas.width, h: canvas.height };
  }
  cache.set(key, media);
  return media;
}

/** A 0.5 s 8-bit mono sine WAV as a data URL. */
function makeWav(freq = 440, seconds = 0.5, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) { const env = Math.min(1, i / 200, (n - i) / 400); v.setUint8(44 + i, 128 + Math.round(100 * env * Math.sin(2 * Math.PI * freq * i / rate))); }
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}
