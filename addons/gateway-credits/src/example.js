// example.js — the bundled sample graph, in the core example shape ({ id, label, camera, focus,
// build({ add, connect, group }) }), loaded through host.examples.build(). Justin's shape:
//
//   Input "New research request" ─trigger→ gw-agent "Research agent" ─done/answer→ gw-llm "Draft summary"
//   (OpenAI, Own key → one bypassed row) ─→ Log "Report"
//   hanging under the agent (slot sub-nodes): gw-llm "Chat model" (Anthropic, Gateway credits) →
//   `model`, gw-memory "Memory" → `memory`, gw-tool ×3 (Brave Search · Firecrawl · PDF.co) → `tools`
//   top row: gw-budget "Research budget" · gw-meter "Credits meter"
//
// Positions come from flowLayout() (the same pure function Credits → Flow layout applies), so the
// sample opens already arranged on three levels: budget / meter floating above, the chain left →
// right at eye level, the agent's sub-nodes standing on the floor directly beneath it.
import { flowLayout } from './flowLayout.js';

export const WORKFLOW = 'Research desk';
const SPEC = [
  ['trigger', 'input', 'S'], ['agent', 'gw-agent', 'L'], ['draft', 'gw-llm', 'M'], ['log', 'log', 'M'],
  ['model', 'gw-llm', 'M'], ['memory', 'gw-memory', 'S'], ['search', 'gw-tool', 'M'], ['crawl', 'gw-tool', 'M'], ['pdf', 'gw-tool', 'M'],
  ['budget', 'gw-budget', 'M'], ['meter', 'gw-meter', 'M'],
];
const LINKS = [
  ['trigger', 'agent', 'trigger'], ['agent', 'draft', 'trigger'], ['agent', 'draft', 'prompt'], ['draft', 'log', 'trigger'], ['draft', 'log', 'in'],
  ['model', 'agent', 'model'], ['memory', 'agent', 'memory'], ['search', 'agent', 'tools'], ['crawl', 'agent', 'tools'], ['pdf', 'agent', 'tools'],
];
/** The sample's positions (uid → [x, y, z]) from the pure layout; exported so tests can check the shape without a world. */
export function samplePositions(opts) {
  return flowLayout(SPEC.map(([uid, type, size]) => ({ uid, type, size })), LINKS.map(([from, to, toKey]) => ({ from, to, toKey })), opts);
}
/** The chain's x-centre: the sample camera looks at it from the front, elevated, so all three levels read. */
const MID_X = (() => { const P = samplePositions(); return +((P.get('trigger')[0] + P.get('log')[0]) / 2).toFixed(2); })();

export default {
  id: 'gateway-research', label: 'Gateway credits · Research desk',
  description: 'Trigger → research agent (chat model, memory and three tools as sub-nodes, every step metered) → own-key draft → log; with a workflow budget and a credits meter',
  camera: { position: [MID_X, 22, 40], target: [MID_X, 8, 2] },
  focus: (named) => [named.trigger, named.agent, named.draft, named.log, named.model, named.memory, named.search, named.crawl, named.pdf, named.budget, named.meter],
  build({ add, connect }) {
    const P = samplePositions(); const at = (k) => P.get(k);   // [x, y, z]: the level is part of the layout
    const trigger = add('input', at('trigger'), { title: 'New research request', params: { mode: 'button', label: 'Run', key: 'Space', payload: 'Compare the September pricing changes across model providers' } });
    const agent = add('gw-agent', at('agent'), { title: 'Research agent', params: { prompt: 'Compare the September pricing changes across model providers', maxTools: 3, workflow: WORKFLOW } });
    const model = add('gw-llm', at('model'), { title: 'Chat model', params: { credential: 'Gateway credits', provider: 'Anthropic', model: 'auto', tier: 'standard', workflow: WORKFLOW } });
    const memory = add('gw-memory', at('memory'), { title: 'Memory', params: { window: 6 } });
    const search = add('gw-tool', at('search'), { title: 'Web search', params: { credential: 'Gateway credits', service: 'Brave Search', units: 2, workflow: WORKFLOW } });
    const crawl = add('gw-tool', at('crawl'), { title: 'Crawl pages', params: { credential: 'Gateway credits', service: 'Firecrawl', units: 5, workflow: WORKFLOW } });
    const pdf = add('gw-tool', at('pdf'), { title: 'Parse PDFs', params: { credential: 'Gateway credits', service: 'PDF.co', units: 2, workflow: WORKFLOW } });
    const draft = add('gw-llm', at('draft'), { title: 'Draft summary', params: { credential: 'Own key', provider: 'OpenAI', model: 'gpt5-mini', tier: 'fixed', apiKey: 'sk-demo-placeholder', prompt: 'Turn the research answer into a short report', workflow: WORKFLOW } });
    const log = add('log', at('log'), { title: 'Report' });
    const budget = add('gw-budget', at('budget'), { title: 'Research budget', params: { workflow: WORKFLOW, limit: 80, period: 'monthly' } });
    const meter = add('gw-meter', at('meter'), { title: 'Credits meter' });

    connect(trigger, 'trigger', agent, 'trigger');
    connect(model, 'handle', agent, 'model');
    connect(memory, 'handle', agent, 'memory');
    connect(search, 'handle', agent, 'tools');
    connect(crawl, 'handle', agent, 'tools');
    connect(pdf, 'handle', agent, 'tools');
    connect(agent, 'done', draft, 'trigger');
    connect(agent, 'answer', draft, 'prompt');
    connect(draft, 'done', log, 'trigger');
    connect(draft, 'result', log, 'in');
    return { trigger, agent, model, memory, search, crawl, pdf, draft, log, budget, meter };
  },
};
