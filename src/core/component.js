// core/component.js — the component schema. One definition object per component type.
//
// {
//   id, category, label, description, icon,
//   inputs:  [{ key, label, type, subtype?, loose?, multi?, optional? }],
//   outputs: [{ key, label, type, subtype? }],
//   describeLink?(fromPort, toDef, toPort, names) → a sentence for a cable leaving this component
//   params:  [{ key, label, type: 'number'|'text'|'boolean'|'select'|'json'|'color', default, min?, max?, step?, options? }],
//   size?: 'S'|'M'|'L',            // node footprint; devices ignore it
//   device?: 'phone'|'tablet'|'laptop'|'monitor',   // renders as a device instead of a slab
//   evaluate(ctx) → { [outputKey]: value },
//   onEvent?(ctx, inputKey, pulse),
//   face?: { render(g, w, h, ctx), onPointer?(ctx, ev), live?: boolean, fps?: number },
//   onCreate?(instance), onDestroy?(instance),
// }
// ctx = { inputs, params, state, time, dt, emit(key, payload), touch(key), instance, upstream(key), engine }
import { TYPES, SUBTYPES } from './types.js';

const PARAM_TYPES = ['number', 'text', 'boolean', 'select', 'json', 'color'];

/** Validate + normalise a definition. Throws on schema errors so mistakes surface at load. */
export function defineComponent(def) {
  if (!def || typeof def !== 'object') throw new Error('defineComponent: definition must be an object');
  const { id, category, label } = def;
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`defineComponent: bad id "${id}" (lowercase, dashes)`);
  if (!category) throw new Error(`defineComponent(${id}): category is required`);
  if (!label) throw new Error(`defineComponent(${id}): label is required`);
  if (typeof def.evaluate !== 'function') throw new Error(`defineComponent(${id}): evaluate(ctx) is required`);
  const inputs = (def.inputs || []).map((p) => normPort(id, p, 'in'));
  const outputs = (def.outputs || []).map((p) => normPort(id, p, 'out'));
  const params = (def.params || []).map((p) => normParam(id, p));
  const seen = new Set();
  for (const p of [...inputs, ...outputs]) {
    const k = p.dir + ':' + p.key;
    if (seen.has(k)) throw new Error(`defineComponent(${id}): duplicate port ${k}`);
    seen.add(k);
  }
  return Object.freeze({
    ...def,
    description: def.description || '',
    icon: def.icon || '',
    size: def.size || 'S',
    inputs, outputs, params,
  });
}

function normPort(id, p, dir) {
  if (!p.key) throw new Error(`defineComponent(${id}): port without key`);
  if (!TYPES.includes(p.type)) throw new Error(`defineComponent(${id}): port ${p.key} has unknown type ${p.type}`);
  if (p.subtype !== undefined && (typeof p.subtype !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.subtype))) throw new Error(`defineComponent(${id}): port ${p.key} has a bad subtype "${p.subtype}"`);
  if (p.subtype && !SUBTYPES.includes(p.subtype)) console.warn(`defineComponent(${id}): port ${p.key} uses an unregistered subtype "${p.subtype}" (no colour of its own)`);
  return Object.freeze({ key: p.key, label: p.label || p.key, type: p.type, subtype: p.subtype || null, loose: !!p.loose, dir, multi: !!p.multi && dir === 'in', optional: !!p.optional });
}
function normParam(id, p) {
  if (!p.key) throw new Error(`defineComponent(${id}): param without key`);
  if (!PARAM_TYPES.includes(p.type)) throw new Error(`defineComponent(${id}): param ${p.key} has unknown type ${p.type}`);
  if (p.type === 'select' && !Array.isArray(p.options)) throw new Error(`defineComponent(${id}): select param ${p.key} needs options`);
  return Object.freeze({ label: p.key, ...p });
}

/** Default parameter values for a definition (deep-cloned so instances never share). */
export function defaultParams(def) {
  const out = {};
  for (const p of def.params) out[p.key] = clone(p.default);
  return out;
}
export const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

/** Ports are addressed as "dir:key"; helper used by serialization and lookups. */
export const portId = (dir, key) => `${dir}:${key}`;
