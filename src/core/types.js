// core/types.js — the six port types (+ 'any'), the project subtypes of `data`, compatibility
// and coercion rules. Colours live in theme.js (portTypes, subtypes) so both palettes stay the
// single source of truth; this module owns the semantics only.
//
// Subtypes: a `data` port may declare `subtype: 'person' | 'task' | 'tasks' | 'board' |
// 'milestone' | 'stats' | 'layout' | 'settings' | 'guide'` so a cable carries meaning, not just JSON. Base types must
// match as before; when both ports declare a subtype they must be the same; a subtyped input
// accepts a plain `data` output only when its definition says `loose: true`.

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

/** Project subtypes of `data` (legend order). */
export const SUBTYPES = ['person', 'task', 'tasks', 'board', 'milestone', 'stats', 'layout', 'settings', 'guide'];
export const subtypeInfo = {
  person:    { label: 'person',    description: 'a team member { name, role, colour, capacity, load, tasks }' },
  task:      { label: 'task',      description: 'one card { id, title, assignee, due, priority, column, done }' },
  tasks:     { label: 'tasks',     description: 'a list of cards / tasks' },
  board:     { label: 'board',     description: 'a whole board { columns }' },
  milestone: { label: 'milestone', description: '{ title, date, daysLeft, reached }' },
  stats:     { label: 'stats',     description: 'board progress { total, done, doneRatio, overdue, blocked, columns, burndown }' },
  layout:    { label: 'layout',    description: 'an arranged set { items, cols, rows }' },
  settings:  { label: 'settings',  description: 'generation settings { size, steps, guidance, strength, seed, seedMode, count, lora, stylePrefix }' },
  guide:     { label: 'guide',     description: 'an image guide { mode, strength, image, control }' },
};

/**
 * Compatibility of an output type feeding an input type (base types only).
 * @returns {'ok'|'coerce'|'invalid'}
 */
export function compatible(from, to) {
  if (!from || !to) return 'invalid';
  if (from === to || from === 'any' || to === 'any') return 'ok';
  if (from === 'number' && to === 'text') return 'coerce';
  return 'invalid';
}
export const isCompatible = (from, to) => compatible(from, to) !== 'invalid';
/**
 * Compatibility of two port records (or definitions) including subtypes: base types as
 * `compatible`; `any` on either side ignores subtypes; two subtypes must match; a subtyped input
 * takes a plain output only when it is `loose`.
 */
export function compatiblePorts(from, to) {
  if (!from || !to) return 'invalid';
  const k = compatible(from.type, to.type);
  if (k === 'invalid' || from.type === 'any' || to.type === 'any') return k;
  const a = from.subtype || null, b = to.subtype || null;
  if (a && b) return a === b ? k : 'invalid';
  if (b && !a) return to.loose ? k : 'invalid';
  return k;
}
/** Short name of what a port carries: the subtype when it has one ("person"), else the type. */
export const portTypeName = (p) => (p && p.subtype ? p.subtype : p ? p.type : '');
/** One-line description of a port's type for tooltips: "data · person" or "event". */
export const portTypeText = (p) => (p && p.subtype ? `${p.type} · ${p.subtype}` : p ? p.type : '');
/** Why two ports do not fit, in plain words (empty when they do). */
export function mismatchReason(from, to) {
  if (compatible(from.type, to.type) === 'invalid') return `${from.type} does not fit ${to.type}`;
  if (compatiblePorts(from, to) === 'invalid') return `${portTypeName(from)} is not ${to.subtype ? 'a ' + to.subtype : 'accepted'}`;
  return '';
}

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
