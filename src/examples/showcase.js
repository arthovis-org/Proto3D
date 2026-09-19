// examples/showcase.js — the default (and only) scene: one product launch, told in three zones.
//
//   Planning   Launch board (10 cards in 4 columns) with three People plugged into its people slot
//              (swimlanes), the "Public launch" Milestone, an Input button that adds a hotfix
//              card, and two sticky notes.
//   Tracking   Timeline fed from the board, Dashboard fed by the board's progress, the people,
//              the milestone and the Launch checklist.
//   Outputs    The Done flow — when a card is done (or the phone is tapped): Start → "Notify
//              team" → urgent? → yes: an Action passes the card to a Text template → the laptop
//              reads "Shipped: <title>"; no: the Log records it — and a Media Grid of four launch
//              assets shown on a Monitor.
//
// Wiring is off by default so the scene reads as a clean workspace; P reveals the system.
import { isoDate, addDays } from '../pm/model.js';

const today = isoDate();
const d = (n) => addDays(today, n);

export default {
  id: 'showcase', label: 'Showcase',
  description: 'A product launch: board with people, milestone, timeline, dashboard, checklist, a Done flow to a laptop, a phone, a hotfix button and a media wall',
  camera: { position: [-6, 26, 46], target: [-8, 2, 2] },
  /** What the camera frames first: the planning zone (the board and the people plugged into it). */
  focus: (named) => [named.board, ...(named.people || [])],
  build({ add, connect, group }) {
    // a plausible burndown so the dashboard line has history on first load (points are { t, remaining, total, cards, done })
    const history = [[-10, 34, 0], [-8, 34, 1], [-6, 31, 2], [-4, 29, 3], [-2, 26, 3], [0, 24, 3]].map(([n, remaining, done]) => ({ t: new Date(Date.now() + n * 864e5).toISOString(), remaining, total: 34, cards: 10, done }));

    /* ---- Planning ---- */
    const board = add('kanban-board', [-10, null, 0], {
      title: 'Launch board',
      state: { history },
      params: {
        board: {
          columns: [
            { id: 'todo', title: 'To do', cards: [
              { id: 'c1', title: 'Write launch announcement', assignee: 'Maya Chen', due: d(6), priority: 'medium', tags: ['content'], estimate: 2, checklist: [{ text: 'Draft', done: false }, { text: 'Review', done: false }] },
              { id: 'c2', title: 'Set up analytics dashboards', assignee: 'Jonas Weber', due: d(12), priority: 'low', tags: ['data'], estimate: 3 },
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
    // the team stands to the left of the board: their `person` outputs run into the board's people slot
    const people = [
      ['Maya Chen', 'Designer', '#e25aa6', 4], ['Jonas Weber', 'Backend', '#2dd4bf', 4], ['Priya Nair', 'QA & payments', '#f5b942', 3],
    ].map(([name, role, colour, capacity], i) => add('person', [-30.5, null, -7.5 + i * 7.5], { title: name.split(' ')[0], params: { name, role, colour, capacity } }));
    const milestone = add('milestone', [-30.5, null, -15.5], { title: 'Public launch', params: { date: d(10) } });
    const hotfix = add('input', [-21, null, 9], { title: 'Add hotfix task', params: { mode: 'button', label: 'Add hotfix', payload: '{"title":"Hotfix: checkout timeout","priority":"urgent","assignee":"Priya Nair","tags":["hotfix"],"estimate":1}' } });
    const note1 = add('sticky-note', [-11.5, null, 10], { title: 'Note', params: { text: 'Drag a card into Done and watch the flow reach the laptop.', colour: '#f5d76e', tilt: -5 } });
    const note2 = add('sticky-note', [-6.5, null, 10.5], { title: 'Note', params: { text: 'Press P to see the wiring. Drop a Person on the board to link them.', colour: '#9be7c4', tilt: 4 } });

    /* ---- Tracking ---- */
    const timeline = add('timeline', [14, null, -12], { title: 'Launch timeline' });
    const dashboard = add('project-dashboard', [30, null, -12], { title: 'Launch health' });
    const checklist = add('checklist', [30, null, -3.5], { title: 'Launch checklist', params: { items: [{ text: 'Freeze scope', done: true }, { text: 'Load test', done: false }, { text: 'Press kit', done: false }, { text: 'Support briefed', done: false }] } });

    /* ---- Outputs: the Done flow, a phone that triggers it, and a media wall ---- */
    const start = add('flow-terminal', [2, null, 20], { title: 'Card done', params: { mode: 'start' } });
    const notify = add('flow-step', [9, null, 20], { title: 'Notify team', params: { duration: 400 } });
    const decide = add('flow-decision', [16.5, null, 20], { title: 'Urgent?', params: { field: 'priority', op: '=', value: 'urgent' } });
    const shipped = add('action', [24, null, 17.5], { title: 'Announce', params: { mode: 'pass', payload: '' } });   // empty payload → passes the card that triggered it
    const template = add('text', [30.5, null, 17.5], { title: 'Shipped message', params: { mode: 'template', template: 'Shipped: {value.title}' } });
    const laptop = add('laptop', [38, 0, 17.5], { title: 'Team laptop' });
    const log = add('log', [24, null, 23.5], { title: 'Done log' });
    const phone = add('phone', [-8, 0, 22], { title: 'On-call phone', params: { caption: 'Tap to ship a hotfix' } });
    const hotfixCard = add('action', [-1.5, null, 26], { title: 'Hotfix shipped', params: { mode: 'pass', payload: '{"title":"Hotfix from the on-call phone","priority":"urgent"}' } });
    const media = ['image', 'image', 'video', 'image'].map((mode, i) => add('media', [6 + i * 6.5, null, 38], { title: ['Key visual', 'Hero shot', 'Teaser clip', 'Press photo'][i], params: { mode, source: `sample ${i + 1}` } }));
    const grid = add('media-grid', [30, null, 31], { title: 'Launch assets' });
    const monitor = add('monitor', [40, 0, 31], { title: 'Lobby screen' });

    /* ---- relationships (all of these can also be made by dropping one component onto another) ---- */
    people.forEach((p) => connect(p, 'person', board, 'people'));      // three cables → three slots → swimlanes
    connect(milestone, 'milestone', board, 'milestone');
    connect(milestone, 'milestone', timeline, 'milestones');
    connect(milestone, 'milestone', dashboard, 'milestone');
    connect(board, 'tasks', timeline, 'tasks');
    connect(board, 'progress', dashboard, 'progress');
    people.forEach((p) => connect(p, 'person', dashboard, 'people'));
    connect(checklist, 'progress', dashboard, 'checklists');
    connect(hotfix, 'trigger', board, 'addTask');
    connect(board, 'done', start, 'in');
    connect(phone, 'tap', hotfixCard, 'trigger');
    connect(hotfixCard, 'done', start, 'in');
    connect(start, 'out', notify, 'in');
    connect(notify, 'out', decide, 'in');
    connect(decide, 'yes', shipped, 'trigger');
    connect(shipped, 'result', template, 'in');
    connect(template, 'text', laptop, 'screen');
    connect(decide, 'no', log, 'trigger');
    media.forEach((m) => connect(m, 'media', grid, 'items'));
    connect(grid, 'layout', monitor, 'screen');

    group('Planning', [board, ...people, milestone, hotfix, note1, note2]);
    group('Tracking', [timeline, dashboard, checklist]);
    group('Outputs', [start, notify, decide, shipped, template, laptop, log, phone, hotfixCard, ...media, grid, monitor]);
    return { board, people, milestone, hotfix, note1, note2, timeline, dashboard, checklist, start, notify, decide, shipped, template, laptop, log, phone, hotfixCard, media, grid, monitor };
  },
};
