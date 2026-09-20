// examples/ai-pipeline.js — starter template: one data source feeding two prompts, a text and an
// image generator on the offline Demo provider, a display and a media grid, and a Run button that
// fires both. Swap the provider under File → Connections… to go live.
export default {
  id: 'ai-pipeline', label: 'AI content pipeline', template: true,
  description: 'Prompt with variables → Generate Text → Display, and Prompt → Generate Image → Media Grid, fed by a Data source and a Run button (offline Demo provider)',
  hint: 'Press Run — or the Run button on a Generate node — to write the post and paint the visual (offline Demo provider).',
  focus: (named) => Object.values(named).flat(),
  build({ add, connect }) {
    const product = add('data', [-17, null, 0.5], { title: 'Product', params: { mode: 'value', json: { name: 'Nimbus', tagline: 'notes that organise themselves', audience: 'busy teams', colour: 'deep blue and coral' } } });
    const run = add('input', [-17, null, 8], { title: 'Run', params: { mode: 'button', label: 'Run' } });
    const postPrompt = add('prompt', [-6, null, -4], { title: 'Post prompt', params: { template: 'Write a short, upbeat launch post for {Product.name} — {Product.tagline} — aimed at {Product.audience}. Two sentences, one emoji, two hashtags.' } });
    const post = add('generate-text', [5.5, null, -4], { title: 'Launch post', params: { provider: 'demo', model: 'demo/writer', maxTokens: 160 } });
    const display = add('display', [16, null, -4], { title: 'Post preview' });
    const visualPrompt = add('prompt', [-6, null, 5.5], { title: 'Visual prompt', params: { template: 'Key visual for {Product.name}: a bold, minimal poster in {Product.colour}, the product on a soft gradient, no text.' } });
    const visual = add('generate-image', [5.5, null, 5.5], { title: 'Key visual', params: { provider: 'demo', model: 'demo/painter' } });
    const grid = add('media-grid', [16, null, 5.5], { title: 'Visuals' });

    connect(product, 'data', postPrompt, 'variables');
    connect(product, 'data', visualPrompt, 'variables');
    connect(postPrompt, 'prompt', post, 'prompt');
    connect(visualPrompt, 'prompt', visual, 'prompt');
    connect(post, 'text', display, 'in');
    connect(visual, 'media', grid, 'items');
    connect(run, 'trigger', post, 'run');
    connect(run, 'trigger', visual, 'run');
    return { product, run, postPrompt, post, display, visualPrompt, visual, grid };
  },
};
