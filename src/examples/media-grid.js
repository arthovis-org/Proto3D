// examples/media-grid.js — Demo 1: five Media nodes feed a Media Grid; the grid shows the
// assets arranged and hands the same layout to a Monitor screen.
export default {
  id: 'media-grid', label: 'Media → Media Grid → Monitor',
  description: 'Five assets arranged by a grid, mirrored on a monitor',
  camera: { position: [4, 22, 40], target: [2, 2, 0] },
  build({ add, connect, group }) {
    const kinds = ['image', 'image', 'video', 'image', 'audio'];
    const media = kinds.map((mode, i) => add('media', [-16, null, -16 + i * 8], { title: `Asset ${i + 1}`, params: { mode, source: `sample ${i + 1}` } }));
    const grid = add('media-grid', [0, null, 0], { title: 'Gallery' });
    const monitor = add('monitor', [14, 0, 0], { title: 'Wall monitor' });
    media.forEach((m) => connect(m, 'media', grid, 'items'));
    connect(grid, 'layout', monitor, 'screen');
    group('Assets', media);
    return { media, grid, monitor };
  },
};
