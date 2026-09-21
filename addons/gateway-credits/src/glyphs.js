// glyphs.js — SERVICE GLYPHS: one original, monochrome monogram per provider / tool service /
// node role, in the core icon style (24×24, stroke = currentColor, round caps), plus a per-service
// accent colour. These are NOT the providers' trademarked logos: each glyph is a small, distinct
// silhouette drawn here (a flame for a crawler, a sparkle for a search, a crescent for Moonshot…)
// so nodes are tellable apart at a glance on the 3D canvas, the way an n8n canvas reads by icon.
//
// One source of truth per glyph: a list of segments in a 24×24 box —
//   { d: [['M',x,y], ['L',x,y], ['Q',cx,cy,x,y], ['Z']] }   a stroked path
//   { c: [cx, cy, r] }                                       a circle
//   { r: [x, y, w, h, radius] }                              a rounded rectangle
//   { f: true, … }                                           filled instead of stroked
// `toSvg` renders the segments as an <svg> for the Add rail / panel (host.icons.set) and
// `drawGlyph` paints the same segments into a face canvas with plain path calls (moveTo / lineTo /
// quadraticCurveTo / arc / arcTo): no Image loading, no SVG rasterisation, works on any 2D
// context including the tests' recording double.
import { PROVIDERS, providerByLabel, toolByLabel } from './rates.js';

const P = (...ops) => ({ d: ops });
const M = (x, y) => ['M', x, y], L = (x, y) => ['L', x, y], Q = (cx, cy, x, y) => ['Q', cx, cy, x, y], Z = () => ['Z'];

/** id → { id, label, color, kind: 'model' | 'tool' | 'role', segments } */
export const GLYPHS = Object.freeze({
  /* ---- model providers ---- */
  openai:      { label: 'OpenAI',        kind: 'model', color: '#22b07d', segments: [P(M(12, 3), L(19.8, 7.5), L(19.8, 16.5), L(12, 21), L(4.2, 16.5), L(4.2, 7.5), Z()), { c: [12, 12, 2.4] }] },
  anthropic:   { label: 'Anthropic',     kind: 'model', color: '#e8743b', segments: [P(M(4, 20), L(12, 4), L(20, 20)), P(M(7.6, 14), L(16.4, 14))] },
  gemini:      { label: 'Google Gemini', kind: 'model', color: '#3b82f6', segments: [P(M(12, 3), Q(12.6, 11.4, 21, 12), Q(12.6, 12.6, 12, 21), Q(11.4, 12.6, 3, 12), Q(11.4, 11.4, 12, 3), Z())] },
  qwen:        { label: 'Alibaba Qwen',  kind: 'model', color: '#7c5cff', segments: [P(M(7, 18), Q(3, 18, 3, 14), Q(3, 10.5, 6.5, 10.2), Q(7.5, 5, 12.5, 5), Q(17, 5, 17.8, 9.4), Q(21, 10, 21, 13.8), Q(21, 18, 17, 18), Z())] },
  minimax:     { label: 'MiniMax',       kind: 'model', color: '#e0679a', segments: [{ r: [3, 5, 18, 14, 3] }, P(M(6, 12), Q(8, 8, 10, 12), Q(12, 16, 14, 12), Q(16, 8, 18, 12))] },
  kimi:        { label: 'Moonshot Kimi', kind: 'model', color: '#4cae4f', segments: [P(M(14, 3.5), Q(6, 5.5, 6, 12.5), Q(6.5, 19.5, 14, 20.5), Q(9.5, 18, 9.8, 12), Q(10, 6, 14, 3.5), Z()), P(M(18, 6), L(18, 10)), P(M(16, 8), L(20, 8))] },
  baseten:     { label: 'Baseten',       kind: 'model', color: '#0ea5e9', segments: [P(M(9, 4), L(15, 4)), P(M(7, 10), L(17, 10)), P(M(5, 16), L(19, 16)), P(M(3, 20.5), L(21, 20.5)), P(M(12, 4), L(12, 16))] },
  edenai:      { label: 'Eden AI',       kind: 'model', color: '#84cc16', segments: [P(M(5, 19), Q(5, 6, 19, 5), Q(19.5, 18, 6.5, 19), Z()), P(M(5, 19), L(14, 10))] },
  /* ---- tool services ---- */
  brave:       { label: 'Brave Search',  kind: 'tool', color: '#14b8a6', segments: [{ c: [10.5, 10.5, 6] }, P(M(15, 15), L(20.5, 20.5)), P(M(10.5, 7.5), L(10.5, 13.5)), P(M(7.5, 10.5), L(13.5, 10.5))] },
  firecrawl:   { label: 'Firecrawl',     kind: 'tool', color: '#f97316', segments: [P(M(12, 3), Q(12.5, 8, 16.5, 10.5), Q(19.5, 13, 18, 17), Q(16, 21, 12, 21), Q(8, 21, 6, 17), Q(4.5, 13, 8, 10), Q(8.5, 13, 10.5, 12.5), Q(12.5, 9, 12, 3), Z()), P(M(12, 21), Q(9, 19, 10.5, 16), Q(11.5, 14.5, 12, 14), Q(14, 16, 13.5, 18.5), Q(13.3, 20.5, 12, 21))] },
  browserbase: { label: 'Browserbase',   kind: 'tool', color: '#64748b', segments: [{ r: [3, 4, 18, 14, 2.5] }, P(M(3, 8.5), L(21, 8.5)), { c: [6, 6.3, 0.7], f: true }, { c: [8.6, 6.3, 0.7], f: true }, P(M(12, 12), L(17.5, 14.2), L(14.8, 15.2), L(13.7, 18), Z())] },
  llamaparse:  { label: 'LlamaParse',    kind: 'tool', color: '#ef4444', segments: [P(M(6, 3.5), L(14, 3.5), L(19, 8.5), L(19, 20.5), L(6, 20.5), Z()), P(M(14, 3.5), L(14, 8.5), L(19, 8.5)), P(M(9, 12.5), L(16, 12.5)), P(M(9, 15.5), L(16, 15.5)), P(M(9, 18.5), L(13, 18.5))] },
  pdfco:       { label: 'PDF.co',        kind: 'tool', color: '#a855f7', segments: [P(M(6, 3.5), L(14, 3.5), L(19, 8.5), L(19, 20.5), L(6, 20.5), Z()), P(M(14, 3.5), L(14, 8.5), L(19, 8.5)), { c: [12.5, 14.5, 2.6] }, P(M(12.5, 9.8), L(12.5, 11.2)), P(M(12.5, 17.8), L(12.5, 19.2)), P(M(7.8, 14.5), L(9.2, 14.5)), P(M(15.8, 14.5), L(17.2, 14.5))] },
  /* ---- node roles (not services) ---- */
  form:        { label: 'Form trigger',  kind: 'role', color: '#f59e0b', segments: [{ r: [3.5, 3.5, 17, 17, 2.5] }, { r: [6.5, 7, 3.5, 3.5, 0.8] }, P(M(12, 8.8), L(17.5, 8.8)), { r: [6.5, 13.5, 3.5, 3.5, 0.8] }, P(M(12, 15.3), L(17.5, 15.3)), P(M(7.2, 15.4), L(8.2, 16.4), L(9.7, 14.4))] },
  memory:      { label: 'Memory',        kind: 'role', color: '#06b6d4', segments: [P(M(4, 6.5), Q(4, 3.5, 12, 3.5), Q(20, 3.5, 20, 6.5), Q(20, 9.5, 12, 9.5), Q(4, 9.5, 4, 6.5), Z()), P(M(4, 6.5), L(4, 17.5), Q(4, 20.5, 12, 20.5), Q(20, 20.5, 20, 17.5), L(20, 6.5)), P(M(4, 12), Q(4, 15, 12, 15), Q(20, 15, 20, 12))] },
  agent:       { label: 'Agent',         kind: 'role', color: '#8b5cf6', segments: [{ r: [4, 8, 16, 12, 3.5] }, P(M(12, 8), L(12, 4.5)), { c: [12, 3.5, 1.1], f: true }, { c: [8.8, 13.5, 1.2], f: true }, { c: [15.2, 13.5, 1.2], f: true }, P(M(9, 17), L(15, 17))] },
  budget:      { label: 'Budget',        kind: 'role', color: '#f5b942', segments: [{ r: [3, 6, 18, 13, 2.5] }, P(M(3, 10), L(21, 10)), P(M(15, 14.5), L(18, 14.5))] },
  meter:       { label: 'Credits meter', kind: 'role', color: '#2dd4bf', segments: [P(M(4, 16), Q(4, 8, 12, 8), Q(20, 8, 20, 16)), P(M(12, 16), L(16, 11)), P(M(3, 20), L(21, 20))] },
});

export const GLYPH_IDS = Object.keys(GLYPHS);
/** The icon name a glyph is registered under (host.icons.set). */
export const iconName = (id) => `gw-svc-${id}`;

/* ---------- SVG ---------- */
const num = (v) => (Math.round(v * 100) / 100).toString();
function pathD(ops) {
  return ops.map((o) => (o[0] === 'Z' ? 'Z' : o[0] === 'Q' ? `Q${num(o[1])} ${num(o[2])} ${num(o[3])} ${num(o[4])}` : `${o[0]}${num(o[1])} ${num(o[2])}`)).join('');
}
/** The glyph as an inline <svg> in the core icon style (currentColor stroke). */
export function toSvg(id, { size = 20, strokeWidth = 1.7 } = {}) {
  const g = GLYPHS[id]; if (!g) return '';
  const parts = g.segments.map((s) => {
    const fill = s.f ? ' fill="currentColor" stroke="none"' : '';
    if (s.d) return `<path d="${pathD(s.d)}"${fill}/>`;
    if (s.c) return `<circle cx="${num(s.c[0])}" cy="${num(s.c[1])}" r="${num(s.c[2])}"${fill}/>`;
    if (s.r) return `<rect x="${num(s.r[0])}" y="${num(s.r[1])}" width="${num(s.r[2])}" height="${num(s.r[3])}" rx="${num(s.r[4])}"${fill}/>`;
    return '';
  }).join('');
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" data-glyph="${id}">${parts}</svg>`;
}
/** Every glyph as { name: svg } ready for host.icons.set. */
export function iconTable() { return Object.fromEntries(GLYPH_IDS.map((id) => [iconName(id), toSvg(id)])); }

/* ---------- canvas ---------- */
/**
 * Paint glyph `id` into a 2D context with its top-left at (x, y) and side `size` (face px), in
 * `color`. Path calls only — the same segments the SVG uses — so it renders on any context.
 */
export function drawGlyph(g, id, x, y, size, color = '#fff', { strokeWidth = 1.7 } = {}) {
  const spec = GLYPHS[id]; if (!spec) return false;
  const k = size / 24;
  const X = (v) => x + v * k, Y = (v) => y + v * k;
  g.save?.();
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1, strokeWidth * k); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of spec.segments) {
    g.beginPath();
    if (s.d) {
      for (const o of s.d) {
        if (o[0] === 'M') g.moveTo(X(o[1]), Y(o[2]));
        else if (o[0] === 'L') g.lineTo(X(o[1]), Y(o[2]));
        else if (o[0] === 'Q') g.quadraticCurveTo(X(o[1]), Y(o[2]), X(o[3]), Y(o[4]));
        else if (o[0] === 'Z') g.closePath();
      }
    } else if (s.c) g.arc(X(s.c[0]), Y(s.c[1]), s.c[2] * k, 0, Math.PI * 2);
    else if (s.r) {
      const [rx, ry, rw, rh, rr] = s.r; const x0 = X(rx), y0 = Y(ry), w = rw * k, h = rh * k, r = Math.min(rr * k, w / 2, h / 2);
      g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r); g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath();
    }
    if (s.f) g.fill(); else g.stroke();
  }
  g.restore?.();
  return true;
}
/** A circular service badge: accent-tinted disc, accent ring, the glyph inside. `r` = radius (face px). */
export function drawBadge(g, id, cx, cy, r, { color = GLYPHS[id]?.color || '#8b9ab5', ring = true, bg = null, ink = null, lit = true } = {}) {
  g.save?.();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = bg || withAlpha(color, lit ? 0.18 : 0.08); g.fill();
  if (ring) { g.lineWidth = Math.max(2, r * 0.11); g.strokeStyle = lit ? color : withAlpha(color, 0.35); g.beginPath(); g.arc(cx, cy, r - g.lineWidth / 2, 0, Math.PI * 2); g.stroke(); }
  const s = r <= 14 ? r * 1.5 : r * 1.1;   // a small badge shows the glyph big, else it vanishes at face resolution
  drawGlyph(g, id, cx - s / 2, cy - s / 2, s, ink || (lit ? color : withAlpha(color, 0.5)), { strokeWidth: r <= 14 ? 2.6 : 1.9 });
  g.restore?.();
}
/** #rrggbb → rgba(r, g, b, a); other strings pass through. */
export function withAlpha(c, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(c || '')); if (!m) return c;
  const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------- lookup ---------- */
/**
 * The glyph a node currently shows, from its kind and params:
 *   'llm'   → the provider (params.provider label)       'tool'  → the service (params.service label)
 *   'agent' | 'memory' | 'budget' | 'meter' | 'form' → the role glyph
 * Returns { id, svg, color, label } (a neutral fallback for an unknown provider, never null).
 */
export function glyphFor(kind, params = {}) {
  let id = null;
  if (kind === 'llm') id = providerByLabel(params.provider)?.id || null;
  else if (kind === 'tool') id = toolByLabel(params.service)?.id || null;
  else if (kind in GLYPHS && GLYPHS[kind].kind === 'role') id = kind;
  else if (params.providerId && GLYPHS[params.providerId]) id = params.providerId;
  if (!id || !GLYPHS[id]) return { id: null, svg: '', color: '#8b9ab5', label: params.provider || params.service || String(kind) };
  const g = GLYPHS[id];
  return { id, svg: toSvg(id), color: g.color, label: PROVIDERS[id]?.label || g.label };
}
/** Glyph id for a provider / service id on the rate card (or null). */
export const glyphIdFor = (providerId) => (GLYPHS[providerId] ? providerId : null);
