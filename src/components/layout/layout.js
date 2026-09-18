// Layout — a node that arranges the components connected to it in 3D space (row, column, grid
// or circle around itself) so related nodes stay tidy. Spatial arrangement as a node: the 3D
// advantage made composable. Outputs the list of arranged components as data.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';

export default registry.register({
  id: 'layout', category: 'layout', label: 'Layout', icon: icons.layout, size: 'S',
  description: 'Physically arranges its connected components in a row, column, grid or circle',
  inputs: [{ key: 'items', label: 'items', type: 'any', multi: true }],
  outputs: [{ key: 'list', label: 'list', type: 'data' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['row', 'column', 'grid', 'circle'], default: 'row' },
    { key: 'spacing', label: 'spacing', type: 'number', default: 7, min: 2, max: 30, step: 0.5 },
    { key: 'columns', label: 'grid columns', type: 'number', default: 3, min: 1, max: 12, step: 1 },
    { key: 'offset', label: 'distance', type: 'number', default: 8, min: 0, max: 40, step: 0.5 },
    { key: 'active', label: 'arrange', type: 'boolean', default: true },
  ],
  evaluate({ params, instance, upstream, dt }) {
    const nodes = [...new Set(upstream('items').map((u) => u.node))];
    const n = nodes.length;
    const P = instance.position;
    const targets = nodes.map((node, i) => {
      const s = params.spacing;
      switch (params.mode) {
        case 'column': return [P.x - params.offset, node.position.y, P.z + (i - (n - 1) / 2) * s];
        case 'grid': { const c = Math.max(1, Math.round(params.columns)); const rows = Math.ceil(n / c); const col = i % c, row = Math.floor(i / c);
          return [P.x + (col - (Math.min(c, n) - 1) / 2) * s, node.position.y, P.z - params.offset - (rows - 1 - row) * s * 0.8]; }
        case 'circle': { const r = Math.max(params.offset, n * s / (2 * Math.PI)); const a = (i / n) * Math.PI * 2 + Math.PI;
          return [P.x + Math.sin(a) * r, node.position.y, P.z + Math.cos(a) * r]; }
        default: return [P.x + (i - (n - 1) / 2) * s, node.position.y, P.z - params.offset];
      }
    });
    if (params.active && instance.enabled !== false) {
      const k = Math.min(1, dt * 5);
      nodes.forEach((node, i) => {
        if (node.dragging) return;
        const [x, y, z] = targets[i];
        node.position.x += (x - node.position.x) * k; node.position.y += (y - node.position.y) * k; node.position.z += (z - node.position.z) * k;
        if (Math.abs(x - node.position.x) < 0.04) node.position.x = x;
        if (Math.abs(z - node.position.z) < 0.04) node.position.z = z;
      });
    }
    return { list: nodes.map((node, i) => ({ title: node.title, type: node.typeId, x: +targets[i][0].toFixed(2), y: +targets[i][1].toFixed(2), z: +targets[i][2].toFixed(2) })) };
  },
  footer: ({ params, outputs }) => `${params.mode} · ${outputs.list ? outputs.list.length : 0} arranged`,
});
