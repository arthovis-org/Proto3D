// scenes/guard-generation.js — "Guard a generation": a Prompt feeds a Yes / no check; only `pass`
// presses Run on the Generate Text node (offline Demo provider), `fail` lights a "Blocked" display
// before any generation money is spent. A sticky note carries the cost comparison.
export const PASS_PROMPT = 'Write a short, upbeat launch tweet for Nimbus, notes that organise themselves. One emoji, two hashtags.';
export const FAIL_PROMPT = 'Text my colleague Sam at +1 555 010 0199 and tell him the launch party moved to Friday; his email is sam@example.com';

export default {
  id: 'guard-generation', label: 'Guard a generation',
  description: 'Prompt → Yes / no check → pass runs Generate Text (Demo provider), fail shows "Blocked before spending"',
  camera: { position: [2, 20, 30], target: [2, 1, 0] },
  names: { prompt: 'Request', check: 'Safe to generate?', gen: 'Launch copy', draft: 'Draft', blocked: 'Blocked', note: 'Cost' },
  focus: (n) => [n.prompt, n.check, n.gen, n.draft, n.blocked].filter(Boolean),
  build({ add, connect, group }) {
    const prompt = add('prompt', [-15, null, 0], { title: 'Request', params: { template: PASS_PROMPT } });
    const check = add('jev-check', [-3, null, 0], { title: 'Safe to generate?', params: { instructions: 'Is this request on-topic for a product launch and free of personal data?', threshold: 0.5, mode: 'auto' } });
    const gen = add('generate-text', [10, null, -5], { title: 'Launch copy', params: { provider: 'demo', model: 'demo/writer', maxTokens: 120 } });
    const draft = add('display', [21, null, -5], { title: 'Draft', params: { caption: 'generated' } });
    const blockedPass = add('action', [10, null, 6], { title: 'Stop', params: { mode: 'pass', payload: 'Blocked before spending' } });
    const blocked = add('display', [18, null, 6], { title: 'Blocked', params: { caption: 'guardrail' } });
    const note = add('sticky-note', [-9, null, 9], { title: 'Cost', params: { text: 'One Jev check ≈ $0.00003.\nThe generation it protects ≈ $0.002–0.02 on a hosted model.', colour: '#f5d76e', tilt: -4 } });
    connect(prompt, 'prompt', check, 'state');
    connect(prompt, 'prompt', gen, 'prompt');
    connect(check, 'pass', gen, 'run');
    connect(gen, 'text', draft, 'in');
    connect(check, 'fail', blockedPass, 'trigger');
    connect(blockedPass, 'result', blocked, 'in');
    group('Guardrail', [prompt, check, note]);
    group('Generation', [gen, draft, blockedPass, blocked]);
    return { prompt, check, gen, draft, blocked, blockedPass, note };
  },
};
