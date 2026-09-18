// components/util.js — small helpers shared by component definitions.
import { formatNumber, formatValue, isPulse, isMedia } from '../core/types.js';

/** Any value as plain text (strings unquoted). */
export function asText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (isPulse(v)) return `event #${v.n}`;
  if (isMedia(v)) return v.title || v.kind;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}
/** Parse a param string as the most specific literal: number, boolean, JSON, else the string. */
export function parseLiteral(s) {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if (t === '') return '';
  if (t === 'true') return true; if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if ((t[0] === '{' && t.endsWith('}')) || (t[0] === '[' && t.endsWith(']'))) { try { return JSON.parse(t); } catch (_) { /* fall through */ } }
  return s;
}
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);
/** Follow a path like "items[0].name" through an object. */
export function pick(obj, path) {
  if (obj === undefined || obj === null) return undefined;
  const parts = String(path || '').replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) { if (cur === undefined || cur === null) return undefined; cur = cur[p]; }
  return cur;
}
export const OPS = ['=', '≠', '<', '>', '≤', '≥', 'contains'];
export function compareValues(a, b, op) {
  const na = typeof a === 'number' ? a : num(a, NaN), nb = typeof b === 'number' ? b : num(b, NaN);
  const numeric = Number.isFinite(na) && Number.isFinite(nb);
  switch (op) {
    case '=': return numeric ? Math.abs(na - nb) < 1e-9 : asText(a) === asText(b);
    case '≠': return numeric ? Math.abs(na - nb) >= 1e-9 : asText(a) !== asText(b);
    case '<': return numeric && na < nb;
    case '>': return numeric && na > nb;
    case '≤': return numeric && na <= nb;
    case '≥': return numeric && na >= nb;
    case 'contains': return Array.isArray(a) ? a.some((x) => asText(x) === asText(b)) : asText(a).toLowerCase().includes(asText(b).toLowerCase());
    default: return false;
  }
}
export { formatValue };
