// scenes/route-message.js — "Route a customer message": a Text node holds the message and shows it
// on a Phone; Route by meaning sends it to one of three desks (laptops lit through an Action that
// passes the message on) or to "Ask a human" when Jev is not sure.
export const SAMPLE_MESSAGES = [
  'My running shoes arrived in the wrong size, can I swap for a 10?',
  'Where is my parcel, it was due Tuesday',
  'I was charged twice this month',
  'hello??',
];
export const EXPECTED_LANES = ['returns', 'shipping', 'billing', 'unsure'];

export default {
  id: 'route-message', label: 'Route a customer message',
  description: 'A message on a phone → Route by meaning → Returns, Shipping or Billing desk, or Ask a human below the confidence floor',
  camera: { position: [4, 22, 34], target: [4, 1, 0] },
  names: { message: 'Customer message', phone: 'Customer phone', route: 'Which desk?', returns: 'Returns desk', shipping: 'Shipping desk', billing: 'Billing desk', human: 'Ask a human', note: 'Note' },
  focus: (n) => [n.message, n.phone, n.route, n.returns, n.shipping, n.billing, n.human].filter(Boolean),
  build({ add, connect, group }) {
    const message = add('text', [-13, null, 5], { title: 'Customer message', params: { mode: 'source', text: SAMPLE_MESSAGES[0] } });
    const phone = add('phone', [-13, 0, -3], { title: 'Customer phone', params: { caption: 'Inbox' } });
    const route = add('jev-route', [-3, null, 0], { title: 'Which desk?', params: { instructions: 'Which team should handle this customer message?', threshold: 0.6, mode: 'auto' } });
    const desks = ['Returns desk', 'Shipping desk', 'Billing desk'].map((t, i) => add('laptop', [12, 0, -9 + i * 8], { title: t, params: { caption: t } }));
    const passes = ['returns', 'shipping', 'billing'].map((k, i) => add('action', [5, null, -9 + i * 8], { title: `To ${k}`, params: { mode: 'pass', payload: '' } }));
    const humanPass = add('action', [5, null, 15], { title: 'Escalate', params: { mode: 'pass', payload: '' } });
    const human = add('display', [12, null, 15], { title: 'Ask a human', params: { caption: 'needs a person' } });
    const note = add('sticky-note', [-3, null, 12], { title: 'Note', params: { text: 'Double-click the message to change it. Below the confidence floor the ticket goes to Ask a human.', colour: '#9be7c4', tilt: 3 } });
    connect(message, 'text', phone, 'screen');
    connect(message, 'text', route, 'state');
    passes.forEach((p, i) => { connect(route, `lane${i + 1}`, p, 'trigger'); connect(p, 'result', desks[i], 'screen'); });
    connect(route, 'unsure', humanPass, 'trigger');
    connect(humanPass, 'result', human, 'in');
    group('Inbox', [message, phone]);
    group('Desks', [...passes, ...desks, humanPass, human]);
    return { message, phone, route, returns: desks[0], shipping: desks[1], billing: desks[2], human, note, passes, humanPass };
  },
};
