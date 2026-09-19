// examples/project.js — Demo 3: project management. A Kanban board with ten cards feeds a
// Timeline (cards → bars), a Dashboard (stats → ring / bars / burndown) and three People (load).
// Moving a card into Done fires a small executable flow: Start → Notify → "urgent?" decision →
// yes: an Action writes "Urgent item shipped: <title>" on the laptop; no: a Log records it.
import { isoDate, addDays } from '../pm/model.js';

const today = isoDate();
const d = (n) => addDays(today, n);

export default {
  id: 'project', label: 'Project management',
  description: 'Kanban board → timeline, dashboard, people; Done cards run a flow that updates a laptop',
  camera: { position: [8, 28, 50], target: [6, 2, 3] },
  build({ add, connect, group }) {
    // a plausible burndown so the dashboard line has history on first load (points are { t, remaining, total, cards, done })
    const history = [[-9, 30, 0], [-7, 30, 0], [-6, 27, 1], [-4, 27, 1], [-3, 25, 2], [0, 25, 2]].map(([n, remaining, done]) => ({ t: new Date(Date.now() + n * 864e5).toISOString(), remaining, total: 30, cards: 10, done }));
    const board = add('kanban-board', [-14, null, 4], {
      title: 'Website relaunch',
      state: { history },
      params: {
        board: {
          columns: [
            { id: 'todo', title: 'To do', cards: [
              { id: 'c1', title: 'Write launch announcement', assignee: 'Maya Chen', due: d(6), priority: 'medium', tags: ['content'], estimate: 2, checklist: [{ text: 'Draft', done: false }, { text: 'Review', done: false }] },
              { id: 'c2', title: 'Set up analytics dashboards', assignee: 'Jonas Weber', due: d(9), priority: 'low', tags: ['data'], estimate: 3 },
              { id: 'c3', title: 'Final QA pass on checkout', assignee: 'Priya Nair', due: d(4), priority: 'urgent', tags: ['qa', 'checkout'], estimate: 2, blockedBy: ['c6'] },
            ] },
            { id: 'doing', title: 'In progress', wipLimit: 3, cards: [
              { id: 'c4', title: 'Redesign pricing page', assignee: 'Maya Chen', due: d(-2), priority: 'high', tags: ['design'], estimate: 4, checklist: [{ text: 'Wireframe', done: true }, { text: 'Visuals', done: true }, { text: 'Copy', done: false }] },
              { id: 'c5', title: 'Migrate blog to new CMS', assignee: 'Jonas Weber', due: d(3), priority: 'medium', tags: ['backend'], estimate: 5 },
              { id: 'c6', title: 'Payment provider integration', assignee: 'Priya Nair', due: d(-1), priority: 'urgent', tags: ['checkout', 'backend'], estimate: 6, checklist: [{ text: 'Sandbox keys', done: true }, { text: 'Webhooks', done: false }] },
            ] },
            { id: 'review', title: 'Review', wipLimit: 2, cards: [
              { id: 'c7', title: 'Accessibility audit fixes', assignee: 'Maya Chen', due: d(1), priority: 'high', tags: ['a11y'], estimate: 2 },
              { id: 'c8', title: 'Performance budget for images', assignee: 'Jonas Weber', due: d(-4), priority: 'medium', tags: ['perf'], estimate: 1 },
            ] },
            { id: 'done', title: 'Done', cards: [
              { id: 'c9', title: 'Brand guidelines v2', assignee: 'Maya Chen', due: d(-8), priority: 'low', tags: ['design'], estimate: 3, movedAt: new Date(Date.now() - 6 * 864e5).toISOString() },
              { id: 'c10', title: 'Staging environment', assignee: 'Priya Nair', due: d(-6), priority: 'high', tags: ['infra'], estimate: 2, movedAt: new Date(Date.now() - 3 * 864e5).toISOString() },
            ] },
          ],
        },
      },
    });
    const people = [
      ['Maya Chen', 'Designer', '#e25aa6', 4], ['Jonas Weber', 'Backend', '#2dd4bf', 4], ['Priya Nair', 'QA & payments', '#f5b942', 3],
    ].map(([name, role, colour, capacity], i) => add('person', [-1, null, -3 + i * 6.5], { title: name.split(' ')[0], params: { name, role, colour, capacity } }));
    const milestone = add('milestone', [-1, null, -11], { title: 'Public launch', params: { date: d(10) } });
    const timeline = add('timeline', [11, null, -10], { title: 'Release plan' });
    const dashboard = add('project-dashboard', [25, null, -10], { title: 'Relaunch health' });
    const progress = add('display', [33, null, -10], { title: 'Progress', params: { caption: 'done ratio' } });
    const note1 = add('sticky-note', [23, null, 1], { title: 'Note', params: { text: 'Drag a card into Done and watch the flow light up.', colour: '#f5d76e', tilt: -5 } });
    const note2 = add('sticky-note', [27.5, null, 2.5], { title: 'Note', params: { text: 'Overdue cards show a red date; the lock means blocked.', colour: '#9be7c4', tilt: 4 } });
    const checklist = add('checklist', [33.5, null, 0.5], { title: 'Launch checklist', params: { items: [{ text: 'Freeze scope', done: true }, { text: 'Load test', done: false }, { text: 'Press kit', done: false }] } });

    // the executable flow: board.done → Start → Notify → urgent? → yes: Action → Laptop, no: Log
    const start = add('flow-terminal', [-1, null, 17], { title: 'Card done', params: { mode: 'start' } });
    const notify = add('flow-step', [6, null, 17], { title: 'Notify team', params: { duration: 400 } });
    const decide = add('flow-decision', [13.5, null, 17], { title: 'Urgent?', params: { field: 'priority', op: '=', value: 'urgent' } });
    const shipped = add('action', [21, null, 14.5], { title: 'Announce', params: { mode: 'pass', payload: '' } });   // empty payload → passes the card that triggered it
    const template = add('text', [27.5, null, 14.5], { title: 'Shipped message', params: { mode: 'template', template: 'Urgent item shipped: {value.title}' } });
    const laptop = add('laptop', [35, 0, 14.5], { title: 'Team laptop' });
    const log = add('log', [21, null, 20.5], { title: 'Done log' });

    connect(board, 'cards', timeline, 'tasks');
    connect(milestone, 'milestone', timeline, 'milestones');
    connect(board, 'stats', dashboard, 'stats');
    connect(milestone, 'milestone', dashboard, 'milestone');
    connect(dashboard, 'progress', progress, 'in');
    people.forEach((p) => connect(board, 'cards', p, 'cards'));
    connect(board, 'done', start, 'in');
    connect(start, 'out', notify, 'in');
    connect(notify, 'out', decide, 'in');
    connect(decide, 'yes', shipped, 'trigger');
    connect(shipped, 'result', template, 'in');
    connect(template, 'text', laptop, 'screen');
    connect(decide, 'no', log, 'trigger');
    group('Team', people);
    group('Done flow', [start, notify, decide, shipped, template, log]);
    return { board, people, timeline, dashboard, milestone, progress, note1, note2, checklist, start, notify, decide, shipped, template, laptop, log };
  },
};
