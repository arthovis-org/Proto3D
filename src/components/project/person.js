// Person — a team member: name, role, colour, capacity. Its face is an initials avatar with the
// name and a load bar; connect a board's `cards` output and `load` becomes the number of cards
// assigned to this person (the card editor lists every Person in the world as an assignee).
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, drawText, roundRect, font } from '../../faces.js';
import { initials } from '../../pm/model.js';

const matches = (card, name) => String(card?.assignee || '').trim().toLowerCase() === String(name || '').trim().toLowerCase();

export default registry.register({
  id: 'person', category: 'project', label: 'Person', icon: icons.person, size: 'S',
  description: 'Team member: name, role, colour, capacity; load = cards assigned when fed a board\'s cards',
  inputs: [{ key: 'cards', label: 'cards', type: 'data', optional: true }],
  outputs: [{ key: 'person', label: 'person', type: 'data' }, { key: 'load', label: 'load', type: 'number' }],
  params: [
    { key: 'name', label: 'name', type: 'text', default: 'Alex' },
    { key: 'role', label: 'role', type: 'text', default: 'Engineer' },
    { key: 'colour', label: 'colour', type: 'color', default: '#5aa9ff' },
    { key: 'capacity', label: 'capacity (cards)', type: 'number', default: 4, min: 1, max: 50, step: 1 },
  ],
  evaluate({ inputs, params, instance }) {
    const cards = Array.isArray(inputs.cards) ? inputs.cards : [];
    const mine = cards.filter((c) => matches(c, params.name));
    const open = mine.filter((c) => !c.done);
    return {
      person: { id: instance.uid, name: params.name, role: params.role, colour: params.colour, capacity: params.capacity, load: open.length, cards: mine.map((c) => c.title) },
      load: open.length,
    };
  },
  footer: ({ params, outputs }) => `${outputs.load ?? 0} / ${params.capacity} ${params.role ? '· ' + params.role : ''}`,
  face: {
    render(g, w, h, { params, outputs, inputs }) {
      clear(g, w, h);
      const r = Math.min(h * 0.32, 60);
      g.fillStyle = params.colour || '#5aa9ff'; g.beginPath(); g.arc(20 + r, h / 2 - 12, r, 0, Math.PI * 2); g.fill();
      drawText(g, initials(params.name), 20, h / 2 - 12 - r, 2 * r, 2 * r, { size: r * 0.9, weight: 700, color: '#fff' });
      const x = 40 + 2 * r;
      drawText(g, params.name || '—', x, 14, w - x - 12, h * 0.4, { size: 34, weight: 700, align: 'left' });
      drawText(g, params.role || '', x, 14 + h * 0.38, w - x - 12, h * 0.22, { size: 20, color: palette.faceDim, align: 'left' });
      // load bar vs capacity
      const load = outputs.load ?? 0, cap = Math.max(1, params.capacity);
      const bw = w - x - 12, by = h - 34, bh = 12;
      g.fillStyle = palette.faceCard; roundRect(g, x, by, bw, bh, 6); g.fill();
      g.fillStyle = load > cap ? '#ff4d5e' : params.colour || '#5aa9ff'; roundRect(g, x, by, bw * Math.min(1, load / cap), bh, 6); g.fill();
      g.fillStyle = palette.faceDim; g.font = font(15, 500, true); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.fillText(inputs.cards ? `${load} / ${cap} cards` : 'connect cards', w - 12, by - 6);
    },
  },
});
