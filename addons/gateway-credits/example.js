// example.js — the bundled sample graph, in the same builder shape as src/examples/project.js
// (built through buildExample's { add, connect, group } API, examples/index.js:12-32):
//   Input "New ticket" → gw-llm "Summarize" (Anthropic, standard tier, Gateway credits)
//   → gw-tool "Web search" (Brave Search) → gw-llm "Draft reply" (OpenAI GPT-5 mini, Own key → one
//   bypassed row) → Log "Reply log"; a gw-budget for the workflow and a gw-meter beside them.
export default {
  id: 'gateway-triage', label: 'Gateway credits · Support inbox triage',
  description: 'Ticket trigger → metered model call → metered tool call → own-key model call → log; with a workflow budget and a credits meter',
  camera: { position: [2, 22, 34], target: [2, 1, 3] },
  focus: (named) => [named.trigger, named.summarize, named.search, named.draft, named.log, named.budget, named.meter],
  build({ add, connect, group }) {
    const trigger = add('input', [-20, null, 0], { title: 'New ticket', params: { mode: 'button', label: 'Run', key: 'Space' } });
    const ticket = add('text', [-20, null, 8], { title: 'Ticket text', params: { mode: 'source', text: 'Customer cannot log in after the password reset email; error 403 on the account page since Tuesday.' } });
    const summarize = add('gw-llm', [-9, null, 0], { title: 'Summarize', params: { credential: 'Gateway credits', provider: 'Anthropic', model: 'auto', tier: 'standard', workflow: 'Support inbox triage' } });
    const search = add('gw-tool', [0, null, 0], { title: 'Web search', params: { credential: 'Gateway credits', service: 'Brave Search', units: 1, workflow: 'Support inbox triage' } });
    const draft = add('gw-llm', [9, null, 0], { title: 'Draft reply', params: { credential: 'Own key', provider: 'OpenAI', model: 'gpt5-mini', tier: 'fixed', apiKey: 'sk-demo-placeholder', workflow: 'Support inbox triage' } });
    const log = add('log', [19, null, 0], { title: 'Reply log' });
    const budget = add('gw-budget', [-6, null, 9], { title: 'Triage budget', params: { workflow: 'Support inbox triage', limit: 50, period: 'monthly' } });
    const meter = add('gw-meter', [5, null, 9], { title: 'Credits meter' });

    connect(ticket, 'text', summarize, 'prompt');
    connect(trigger, 'trigger', summarize, 'trigger');
    connect(summarize, 'done', search, 'trigger');
    connect(summarize, 'result', search, 'query');
    connect(search, 'done', draft, 'trigger');
    connect(search, 'result', draft, 'prompt');
    connect(draft, 'done', log, 'trigger');
    connect(draft, 'result', log, 'in');
    group('Support inbox triage', [summarize, search, draft]);
    return { trigger, ticket, summarize, search, draft, log, budget, meter };
  },
};
