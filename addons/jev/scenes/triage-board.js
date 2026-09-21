// scenes/triage-board.js — "Triage a board": a Kanban board with eight cards written in varied
// urgency language feeds Rank a list; a Display shows the ranked order, a Sticky Note the top
// item, and Score on a rubric grades one picked card on its own.
import { isoDate, addDays } from '../../../src/pm/model.js';

const today = isoDate();
const d = (n) => addDays(today, n);
export const CARDS = [
  { id: 't1', title: 'Checkout crashes on Safari and customers lose their cart (data loss)', assignee: 'Priya Nair', due: d(1), priority: 'medium', tags: ['checkout'] },
  { id: 't2', title: 'Payment webhook retries fail silently', assignee: 'Jonas Weber', due: d(4), priority: 'medium', tags: ['backend'] },
  { id: 't3', title: 'Add dark mode to the marketing site', assignee: 'Maya Chen', due: d(20), priority: 'medium', tags: ['design'] },
  { id: 't4', title: 'Typo in the footer copyright', assignee: 'Maya Chen', due: d(9), priority: 'medium', tags: ['content'] },
  { id: 't5', title: 'Login page down for the EU region since 9am', assignee: 'Jonas Weber', due: d(0), priority: 'medium', tags: ['infra'] },
  { id: 't6', title: 'Export to CSV takes 40 s on large boards', assignee: 'Priya Nair', due: d(12), priority: 'medium', tags: ['perf'] },
  { id: 't7', title: 'Onboarding emails go out twice', assignee: 'Jonas Weber', due: d(3), priority: 'medium', tags: ['email'] },
  { id: 't8', title: 'Refresh the pricing page illustrations', assignee: 'Maya Chen', due: d(15), priority: 'medium', tags: ['design'] },
];

export default {
  id: 'triage-board', label: 'Triage a board',
  description: 'A Kanban board of bugs and asks → Rank a list ("how urgent for the launch?") → ranked Display and a Sticky Note with the top item; Score on a rubric grades one card',
  camera: { position: [6, 24, 40], target: [6, 2, 0] },
  names: { board: 'Launch board', rank: 'Triage', order: 'Triage order', top: 'Top priority', pick: 'One card', score: 'How urgent?' },
  focus: (n) => [n.board, n.rank, n.order, n.top, n.pick, n.score].filter(Boolean),
  build({ add, connect, group }) {
    const board = add('kanban-board', [-14, null, 0], {
      title: 'Launch board',
      params: { board: { columns: [{ id: 'inbox', title: 'Inbox', cards: CARDS.slice(0, 5) }, { id: 'next', title: 'Next', cards: CARDS.slice(5) }, { id: 'doing', title: 'Doing', cards: [] }, { id: 'done', title: 'Done', cards: [] }] } },
    });
    const rank = add('jev-rank', [6, null, -3], { title: 'Triage', params: { instructions: 'How urgent is this card for the launch?', mode: 'auto' } });
    const order = add('display', [18, null, -3], { title: 'Triage order', params: { caption: 'ranked by Jev' } });
    const top = add('sticky-note', [18, null, 6], { title: 'Top priority', params: { text: 'waiting for the ranking…', colour: '#ffb3b3', tilt: -6 } });
    const pick = add('data', [-1, null, 9], { title: 'One card', params: { mode: 'pick', path: '[1].title' } });
    const score = add('jev-score', [9, null, 12], { title: 'How urgent?', params: { instructions: 'How urgent is this card for the launch?', levels: ['low', 'medium', 'high', 'critical'], mode: 'auto' } });
    connect(board, 'tasks', rank, 'items');
    connect(rank, 'ranked_text', order, 'in');
    connect(rank, 'top', top, 'text');
    connect(board, 'tasks', pick, 'in');
    connect(pick, 'value', score, 'state');
    group('Board', [board]);
    group('Triage', [rank, order, top, pick, score]);
    return { board, rank, order, top, pick, score };
  },
};
