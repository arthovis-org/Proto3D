// examples/image-studio.js — starter template: a sample picture guides (edges) and masks
// (rectangle) a Generate Image on the offline Demo provider, a Settings node drives its size,
// seed and count, the result goes through an Image Edit (adjust) and an Enhance (browser ×2)
// into a Media Grid; a Prompt with a {Product} variable and one Run button start it.
export default {
  id: 'image-studio', label: 'Image studio', template: true,
  description: 'Media → Guide (edges) + Mask (rectangle) → Generate Image (Demo) with a Settings node → Image Edit (adjust) → Enhance (browser ×2) → Media Grid; a Prompt with a {Product} variable and a Run button',
  hint: 'Press Run — the Demo paints inside the mask along the traced edges, then the edit and the ×2 upscale follow; double-click a Settings number to change it.',
  focus: (named) => Object.values(named).flat(),
  build({ add, connect }) {
    const product = add('data', [-7, null, -7], { title: 'Product', params: { mode: 'value', json: { name: 'Nimbus lamp', look: 'matte ceramic, warm light', scene: 'on a walnut desk at dusk' } } });
    const prompt = add('prompt', [3, null, -7], { title: 'Studio prompt', params: { template: 'Product photo of {Product.name}, {Product.look}, {Product.scene}. Soft studio light, shallow depth of field.' } });
    const source = add('media', [-16, null, 1], { title: 'Sketch', params: { mode: 'image', source: 'sample 2' } });
    const guide = add('generate-guide', [-7, null, 1], { title: 'Edges', params: { mode: 'edges', strength: 0.7 } });
    const mask = add('generate-mask', [-7, null, 9], { title: 'Mask', params: { source: 'rectangle', x: 0.2, y: 0.15, w: 0.6, h: 0.7, feather: 6 } });
    const settings = add('generate-settings', [13, null, -7], { title: 'Settings', params: { preset: 'landscape 4:3', steps: 24, guidance: 4, seed: '1234', seedMode: 'increment', count: 1 } });
    const run = add('input', [-16, null, -7], { title: 'Run', params: { mode: 'button', label: 'Run' } });
    const gen = add('generate-image', [3, null, 1], { title: 'Render', params: { provider: 'demo', model: 'demo/painter' } });
    const edit = add('image-edit', [13, null, 1], { title: 'Grade', params: { mode: 'adjust', brightness: 1.05, contrast: 1.15, saturation: 1.1, blur: 0, sharpen: 0.2 } });
    const enhance = add('enhance', [23, null, 1], { title: 'Upscale', params: { task: 'upscale', scale: '2', provider: 'browser', autoRun: true } });
    const grid = add('media-grid', [23, null, 9], { title: 'Results' });

    connect(product, 'data', prompt, 'variables');
    connect(prompt, 'prompt', gen, 'prompt');
    connect(source, 'media', guide, 'image');
    connect(source, 'media', mask, 'image');
    connect(guide, 'guide', gen, 'guides');
    connect(mask, 'mask', gen, 'mask');
    connect(settings, 'settings', gen, 'settings');
    connect(run, 'trigger', gen, 'run');
    connect(gen, 'media', edit, 'image');
    connect(edit, 'image', enhance, 'image');
    connect(enhance, 'media', grid, 'items');
    connect(gen, 'media', grid, 'items');
    return { product, prompt, source, guide, mask, settings, run, gen, edit, enhance, grid };
  },
};
