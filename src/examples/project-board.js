// examples/project-board.js — starter template: a small Kanban board with two people plugged into
// its people slot (swimlanes), a milestone, a timeline fed by the board and a project dashboard.
// Everything is a registry component; the relationships are cables the user can also make by
// dropping one block onto another.
import { isoDate, addDays } from '../pm/model.js';

const today = isoDate();
const d = (n) => addDays(today, n);

export default {
  id: 'project-board', label: 'Project board', template: true,
  description: 'A Kanban board with two people (swimlanes), a milestone, a timeline and a dashboard',
  hint: 'Drag a card into Done — the dashboard, the timeline and the people update at once.',
  focus: (named) => Object.values(named).flat(),
  build({ add, connect }) {
    const board = add('kanban-board', [0, null, 0], {
      title: 'Website relaunch',
      params: {
        board: {
          columns: [
            { id: 'todo', title: 'To do', cards: [
              { id: 'c1', title: 'Write the new landing copy', assignee: 'Ada Lin', due: d(5), priority: 'medium', tags: ['content'], estimate: 2 },
              { id: 'c2', title: 'Set up analytics', assignee: 'Ben Okafor', due: d(9), priority: 'low', tags: ['data'], estimate: 1 },
            ] },
            { id: 'doing', title: 'In progress', wipLimit: 2, cards: [
              { id: 'c3', title: 'Redesign the pricing page', assignee: 'Ada Lin', due: d(2), priority: 'high', tags: ['design'], estimate: 3, checklist: [{ text: 'Wireframe', done: true }, { text: 'Visuals', done: false }] },
              { id: 'c4', title: 'Move the blog to the new CMS', assignee: 'Ben Okafor', due: d(-1), priority: 'urgent', tags: ['backend'], estimate: 5 },
            ] },
            { id: 'done', title: 'Done', cards: [
              { id: 'c5', title: 'Brand refresh', assignee: 'Ada Lin', due: d(-6), priority: 'low', tags: ['design'], estimate: 2, movedAt: new Date(Date.now() - 4 * 864e5).toISOString() },
            ] },
          ],
        },
      },
    });
    const people = [['Ada Lin', 'Designer', '#e25aa6', 3], ['Ben Okafor', 'Engineer', '#2dd4bf', 4]]
      .map(([name, role, colour, capacity], i) => add('person', [-13.5, null, -3.8 + i * 7.6], { title: name.split(' ')[0], params: { name, role, colour, capacity } }));
    const milestone = add('milestone', [-13.5, null, -11], { title: 'Relaunch day', params: { date: d(12) } });
    const timeline = add('timeline', [18, null, -7.5], { title: 'Relaunch timeline' });
    const dashboard = add('project-dashboard', [16, null, 4.5], { title: 'Relaunch health' });

    people.forEach((p) => connect(p, 'person', board, 'people'));       // two slots → two swimlanes
    connect(milestone, 'milestone', board, 'milestone');
    connect(milestone, 'milestone', timeline, 'milestones');
    connect(milestone, 'milestone', dashboard, 'milestone');
    connect(board, 'tasks', timeline, 'tasks');
    connect(board, 'progress', dashboard, 'progress');
    people.forEach((p) => connect(p, 'person', dashboard, 'people'));
    return { board, people, milestone, timeline, dashboard };
  },
};
