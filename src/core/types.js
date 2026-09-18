// core/types.js — the six port types (+ 'any'), compatibility and coercion rules.
// Colours live in theme.js (portTypes) so both palettes stay the single source of truth;
// this module owns the semantics only.

/** Port types, in legend order. */
export const TYPES = ['number', 'text', 'boolean', 'data', 'media', 'event', 'any'];

/** Short labels used in the legend, hover labels and the properties panel. */
export const typeInfo = {
  number:  { label: 'number',  short: 'num',  description: 'a scalar value' },
  text:    { label: 'text',    short: 'txt',  description: 'a string' },
  boolean: { label: 'boolean', short: 'bool', description: 'true / false' },
  data:    { label: 'data',    short: 'data', description: 'a plain JSON object or array' },
  media:   { label: 'media',   short: 'media', description: '{ kind, src, title, w?, h? } — image, video or audio' },
  event:   { label: 'event',   short: 'evt',  description: 'a pulse { t, payload? }' },
  any:     { label: 'any',     short: 'any',  description: 'generic passthrough' },
};

/**
 * Compatibility of an output type feeding an input type.
 * @returns {'ok'|'coerce'|'invalid'}
 */
export function compatible(from, to) {
  if (!from || !to) return 'invalid';
  if (from === to || from === 'any' || to === 'any') return 'ok';
  if (from === 'number' && to === 'text') return 'coerce';
  return 'invalid';
}
export const isCompatible = (from, to) => compatible(from, to) !== 'invalid';

/** Convert a value carried from `from` into what `to` expects (only number→text coerces). */
export function coerce(value, from, to) {
  if (value === undefined || value === null) return undefined;
  if (from === 'number' && to === 'text') return typeof value === 'number' ? formatNumber(value) : String(value);
  return value;
}

/** Runtime check used by faces and the panel to describe a value. */
export function kindOf(v) {
  if (v === undefined || v === null) return 'none';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return 'boolean';
  if (isPulse(v)) return 'event';
  if (isMedia(v)) return 'media';
  if (Array.isArray(v) && v.length && v.every(isMedia)) return 'media-list';
  if (typeof v === 'object' && Array.isArray(v.items) && v.items.every(isMedia) && 'cols' in v) return 'media-layout';
  return 'data';
}

export const isPulse = (v) => !!(v && typeof v === 'object' && v.__pulse === true);
export const isMedia = (v) => !!(v && typeof v === 'object' && typeof v.src === 'string' && ['image', 'video', 'audio'].includes(v.kind));

let pulseSeq = 0;
/** Create an event pulse. `n` is a global sequence number so equal payloads still read as new. */
export function makePulse(t, payload) { return { __pulse: true, t, n: ++pulseSeq, payload }; }

export function formatNumber(v) {
  if (!Number.isFinite(v)) return String(v);
  return Math.abs(v) >= 1000 ? v.toFixed(0) : (+v.toFixed(2)).toString();
}

/** Compact one-line formatting for footers, labels and the panel. */
export function formatValue(v, max = 26) {
  let s;
  switch (kindOf(v)) {
    case 'none': s = '—'; break;
    case 'number': s = formatNumber(v); break;
    case 'boolean': s = v ? 'true' : 'false'; break;
    case 'text': s = `"${v}"`; break;
    case 'event': s = `↯ ${v.n}${v.payload !== undefined ? ' ' + formatValue(v.payload, 12) : ''}`; break;
    case 'media': s = `${v.kind} ${v.title || ''}`.trim(); break;
    case 'media-list': s = `${v.length} media`; break;
    case 'media-layout': s = `grid ${v.cols}×${v.rows} · ${v.items.length}`; break;
    default:
      if (Array.isArray(v)) s = `[${v.map((x) => formatValue(x, 8)).join(', ')}]`;
      else s = '{' + Object.entries(v).map(([k, x]) => `${k}: ${formatValue(x, 10).replace(/^"|"$/g, '')}`).join(', ') + '}';
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Structural equality with fast paths (used for change detection; never stringifies). */
export function equal(a, b, depth = 0) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb) return false;
  if (ta === 'number') return Math.abs(a - b) < 1e-9;
  if (ta !== 'object') return false;
  if (depth > 6) return false;
  if (isPulse(a) || isPulse(b)) return isPulse(a) && isPulse(b) && a.n === b.n;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i], depth + 1)) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in b) || !equal(a[k], b[k], depth + 1)) return false;
  return true;
}
