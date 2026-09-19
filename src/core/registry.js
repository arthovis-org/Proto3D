// core/registry.js — every component type registers here. The registry drives the Add
// toolbar (categories, icons, search), the properties panel (params → controls), the engine
// (evaluate), node construction (ports) and serialization (type id + params + state).
import { defineComponent } from './component.js';

/** Category order and labels. `kind` decides which toolbar section a category lives in. */
export const CATEGORIES = [
  { id: 'media',     label: 'Media',     kind: 'node',   description: 'Images, video, audio and galleries' },
  { id: 'text',      label: 'Text',      kind: 'node',   description: 'Strings, templates and formatting' },
  { id: 'data',      label: 'Data',      kind: 'node',   description: 'JSON values, picking, filtering, merging' },
  { id: 'input',     label: 'Input',     kind: 'node',   description: 'Buttons, toggles, keys, timers, sliders' },
  { id: 'logic',     label: 'Logic',     kind: 'node',   description: 'Comparisons, gates and branching' },
  { id: 'action',    label: 'Action',    kind: 'node',   description: 'Do something when an event arrives' },
  { id: 'transform', label: 'Transform', kind: 'node',   description: 'Math and range processing' },
  { id: 'layout',    label: 'Layout',    kind: 'node',   description: 'Arrange other components in 3D' },
  { id: 'output',    label: 'Output',    kind: 'node',   description: 'Displays and logs' },
  { id: 'project',   label: 'Project',   kind: 'node',   description: 'Kanban boards, flows, timelines, people, dashboards' },
  { id: 'devices',   label: 'Devices',   kind: 'device', description: 'Phone, tablet, laptop, monitor' },
];

const defs = new Map();
const listeners = new Set();

export const registry = {
  /** Register a definition (validated through defineComponent). Returns the frozen definition. */
  register(def) {
    const d = defineComponent(def);
    if (defs.has(d.id)) throw new Error(`registry: duplicate component id "${d.id}"`);
    defs.set(d.id, d);
    listeners.forEach((cb) => cb(d));
    return d;
  },
  get(id) { return defs.get(id) || null; },
  has(id) { return defs.has(id); },
  all() { return [...defs.values()]; },
  ids() { return [...defs.keys()]; },
  /** Categories in display order, each with its components (only categories that have some). */
  categories() {
    const known = CATEGORIES.map((c) => ({ ...c, components: registry.all().filter((d) => d.category === c.id) }));
    const extra = [...new Set(registry.all().map((d) => d.category))].filter((id) => !CATEGORIES.some((c) => c.id === id))
      .map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), kind: 'node', description: '', components: registry.all().filter((d) => d.category === id) }));
    return [...known, ...extra].filter((c) => c.components.length);
  },
  category(id) { return CATEGORIES.find((c) => c.id === id) || { id, label: id, kind: 'node' }; },
  /** Case-insensitive search over id, label, description, category and param/select options. */
  search(q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return registry.all();
    return registry.all().filter((d) => {
      const hay = [d.id, d.label, d.description, d.category, registry.category(d.category).label,
        ...d.params.flatMap((p) => [p.label, ...(p.options || [])]), ...d.inputs.map((p) => p.label), ...d.outputs.map((p) => p.label)]
        .join(' ').toLowerCase();
      return hay.includes(s);
    });
  },
  onRegister(cb) { listeners.add(cb); return () => listeners.delete(cb); },
};
export default registry;
