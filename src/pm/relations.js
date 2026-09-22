// pm/relations.js — what a cable between two project components *means*. The engine already
// delivers values; this module reads the graph as relationships so components can act on who
// they are plugged into (a Person lists the tasks of every board it feeds, a board lays out the
// people connected to it) and so the UI can say it in a sentence ("Maya's tasks appear on
// Website relaunch"). No Three.js: everything works from `world.connections` and params.
import { normalizeBoard, isOverdue, isBlocked, lastColumn } from './model.js';

export const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const boardOf = (node) => normalizeBoard(node.params?.board);

/** Person nodes plugged into a board's `people` slot, in cable order (the slot order). */
export function connectedPeople(boardNode) {
  const port = boardNode.getPort?.('people', 'in');
  const world = boardNode.world;
  if (!port || !world) return [];
  return world.connections.filter((c) => c.to === port && c.from.owner.typeId === 'person' && c.valid !== false).map((c) => c.from.owner);
}
/** The Person node (if any) whose name matches an assignee, preferring the people connected to `boardNode`. */
export function personFor(boardNode, name) {
  if (!name) return null;
  const linked = connectedPeople(boardNode).find((p) => sameName(p.params.name, name));
  if (linked) return linked;
  return boardNode.world?.nodes.find((n) => n.typeId === 'person' && sameName(n.params.name, name)) || null;
}

/**
 * Boards a Person is related to: the boards its `person` output feeds (their `people` slot) and
 * the boards whose `tasks` output feeds its `tasks` input. Deduplicated, in cable order.
 */
export function personBoards(personNode) {
  const world = personNode.world;
  if (!world) return [];
  const out = [];
  const add = (n) => { if (n && n.typeId === 'kanban-board' && !out.includes(n)) out.push(n); };
  const me = personNode.getPort?.('person', 'out'), tasks = personNode.getPort?.('tasks', 'in');
  for (const c of world.connections) {
    if (c.valid === false || !c.to) continue;
    if (me && c.from === me && c.to.key === 'people') add(c.to.owner);
    if (tasks && c.to === tasks && c.from.key === 'tasks') add(c.from.owner);
  }
  return out;
}
/**
 * Every card assigned to a Person on every board it is related to:
 * `[{ card, column, columnIndex, board, done, overdue, blocked }]` in board / column / card order.
 */
export function personTasks(personNode) {
  const name = personNode.params?.name;
  const rows = [];
  for (const board of personBoards(personNode)) {
    const b = boardOf(board); const last = lastColumn(b);
    b.columns.forEach((column, columnIndex) => {
      for (const card of column.cards) {
        if (!sameName(card.assignee, name)) continue;
        const done = column === last;
        rows.push({ card, column, columnIndex, board, done, overdue: !done && isOverdue(card), blocked: isBlocked(b, card) });
      }
    });
  }
  return rows;
}
/** Group task rows by column title (board order kept): `[{ column, rows }]`. */
export function groupByColumn(rows) {
  const groups = [];
  for (const r of rows) {
    const key = r.column.title;
    let g = groups.find((x) => x.column === key);
    if (!g) { g = { column: key, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  return groups;
}

/* ---------------- sentences ---------------- */
const poss = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
/**
 * Sentence for a link between two components, or null when there is nothing better than the
 * "from → to · type" text. A definition may provide `describeLink(fromPort, toDef, toPort, names)`
 * for its own outputs; otherwise the table below covers the project relationships.
 */
export function describeLink(conn) {
  if (!conn || !conn.from || !conn.to) return null;
  return describePorts(conn.from, conn.to);
}
export function describePorts(from, to) {
  const A = from.owner, B = to.owner;
  if (!A || !B || A.kind === 'group' || B.kind === 'group') return null;
  const names = { from: A.title, to: B.title, fromPoss: poss(A.title), toPoss: poss(B.title) };
  const own = A.def?.describeLink?.(from, B.def, to, names);
  if (own) return own;
  const key = `${A.typeId}.${from.key}>${B.typeId}.${to.key}`;
  const T = TABLE[key] || TABLE[`${A.typeId}.${from.key}>*`] || TABLE[`*>${B.typeId}.${to.key}`];
  if (T) return T(names, from, to);
  if (from.type === 'event' && /^when /.test(from.label)) return `${cap(from.label)} on ${names.from}, ${names.to} ${to.type === 'event' ? verbFor(to) : 'reacts'}`;
  return null;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const verbFor = (to) => ({ start: 'starts', trigger: 'fires', in: 'runs' }[to.key] || `gets ${to.label}`);
const TABLE = {
  'person.person>kanban-board.people': (n) => `${n.fromPoss} tasks appear on ${n.to}`,
  'checklist.progress>project-dashboard.checklists': (n) => `${n.from} shows as a checklist bar on ${n.to}`,
  'media.media>media-grid.items': (n) => `${n.from} joins the ${n.to} gallery`,
  'media.media>*': (n) => `${n.from} shows on ${n.to}`,
  'media-grid.layout>*': (n) => `The ${n.from} gallery shows on ${n.to}`,
  'input.trigger>kanban-board.addTask': (n) => `Pressing ${n.from} adds a task to ${n.to}`,
  '*.tap>flow-terminal.in': (n) => `Tapping ${n.from} starts the flow at ${n.to}`,
  'text.text>*': (n) => `${n.fromPoss} text shows on ${n.to}`,
  'action.result>*': (n) => `${n.fromPoss} result goes to ${n.to}`,
  'action.done>*': (n) => `When ${n.from} is done, ${n.to} runs`,
  'person.person>project-dashboard.people': (n) => `${n.fromPoss} load shows on ${n.to}`,
  'person.person>*': (n, f, t) => `${n.fromPoss} details go to ${n.to}`,
  'person.summary>*': (n) => `${n.fromPoss} task list shows on ${n.to}`,
  'person.load>*': (n) => `${n.fromPoss} load feeds ${n.to}`,
  'kanban-board.tasks>timeline.tasks': (n) => `${n.fromPoss} tasks fill the ${n.to}`,
  'kanban-board.tasks>person.tasks': (n) => `${n.to} takes their tasks from ${n.from}`,
  'kanban-board.tasks>project-dashboard.tasks': (n) => `${n.fromPoss} tasks feed ${n.to}`,
  'kanban-board.tasks>*': (n) => `${n.fromPoss} tasks go to ${n.to}`,
  'kanban-board.progress>project-dashboard.progress': (n) => `${n.fromPoss} progress drives the ${n.to}`,
  'kanban-board.progress>*': (n) => `${n.fromPoss} progress goes to ${n.to}`,
  'kanban-board.done>flow-terminal.in': (n) => `When a card is done on ${n.from}, the flow starts at ${n.to}`,
  'kanban-board.done>*': (n) => `When a card is done on ${n.from}, ${n.to} runs`,
  'kanban-board.moved>*': (n) => `When a card moves on ${n.from}, ${n.to} runs`,
  '*>kanban-board.addTask': (n) => `${n.from} adds tasks to ${n.to}`,
  '*>kanban-board.moveTask': (n) => `${n.from} moves tasks on ${n.to}`,
  'milestone.milestone>kanban-board.milestone': (n) => `${n.from} is the deadline on ${n.to}`,
  'milestone.milestone>timeline.milestones': (n) => `${n.from} is flagged on the ${n.to}`,
  'milestone.milestone>project-dashboard.milestone': (n) => `${n.to} counts down to ${n.from}`,
  'milestone.reached>*': (n) => `When ${n.from} is reached, ${n.to} runs`,
  'timeline.next>*': (n) => `${n.fromPoss} next milestone goes to ${n.to}`,
  'timeline.overdue>*': (n) => `${n.fromPoss} overdue tasks go to ${n.to}`,
  'checklist.done>*': (n) => `When ${n.from} is complete, ${n.to} runs`,
  'checklist.progress>*': (n) => `${n.fromPoss} progress drives ${n.to}`,
  'project-dashboard.progress>*': (n) => `${n.fromPoss} progress shows on ${n.to}`,
  'flow-terminal.out>*': (n) => `${n.from} passes the token to ${n.to}`,
  'flow-step.out>*': (n) => `After ${n.from}, the token goes to ${n.to}`,
  'flow-decision.yes>*': (n) => `If ${n.from} says yes, ${n.to} runs`,
  'flow-decision.no>*': (n) => `If ${n.from} says no, ${n.to} runs`,
  'sticky-note.text>*': (n) => `${n.fromPoss} note text goes to ${n.to}`,
  // generate: prompts in, results out (the components also carry describeLink for their own outputs)
  '*>prompt.variables': (n) => `${n.from} is a {variable} in ${n.to}`,
  '*>prompt.text': (n) => `${n.from} is the {text} of ${n.to}`,
  'input.trigger>*': (n, f, t) => (t.key === 'run' ? `Pressing ${n.from} runs ${n.to}` : `Pressing ${n.from} fires ${n.to}`),
  '*>kanban-board.cover': (n) => `${n.fromPoss} media becomes a card cover on ${n.to}`,
  // generate round: settings, guides and masks shape a generator; images go through edits and enhancement
  '*>generate-text.settings': (n) => `${n.fromPoss} settings drive ${n.to}`,
  '*>generate-image.settings': (n) => `${n.fromPoss} settings drive ${n.to}`,
  '*>generate-video.settings': (n) => `${n.fromPoss} settings drive ${n.to}`,
  '*>generate-audio.settings': (n) => `${n.fromPoss} settings drive ${n.to}`,
  '*>generate-image.guides': (n) => `${n.from} guides ${n.to}`,
  '*>generate-video.guides': (n) => `${n.from} guides ${n.to}`,
  '*>generate-image.mask': (n) => `${n.to} paints only inside ${n.from}`,
  '*>generate-image.negative': (n) => `${n.from} is what ${n.to} avoids`,
  '*>generate-video.negative': (n) => `${n.from} is what ${n.to} avoids`,
  '*>image-edit.image': (n) => `${n.to} edits ${n.fromPoss} image`,
  '*>image-edit.imageB': (n) => `${n.from} is image B of ${n.to}`,
  '*>image-edit.mask': (n) => `${n.from} decides where ${n.to} shows B over A`,
  '*>generate-guide.image': (n) => `${n.fromPoss} image guides through ${n.to}`,
  '*>generate-mask.image': (n) => `${n.fromPoss} image sizes the mask of ${n.to}`,
  '*>enhance.image': (n) => `${n.to} enhances ${n.fromPoss} image`,
  'action.index>*': (n) => `${n.fromPoss} position goes to ${n.to}`,
};

/* ---------------- drop-to-link: relationships without cables ---------------- */
/**
 * Port pairs a drop creates (`dragged` dropped on `target` → dragged.output → target.input).
 * Rows are `fromType.port>toType.port`; `*` stands for any type; a `to` of `*.screen` covers the
 * four devices. Beyond the table, a flow-ish event output (`out`, `next`, `yes`, `no`, `done`,
 * `tap`, `trigger`, `reached`) dropped on a block with a flow-ish event input (`in`, `start`,
 * `trigger`) pairs up as well, so flows can be assembled by dropping shapes on each other.
 */
export const DROP_LINKS = [
  'person.person>kanban-board.people', 'person.person>project-dashboard.people', 'person.summary>*.screen', 'person.summary>display.in',
  'milestone.milestone>kanban-board.milestone', 'milestone.milestone>timeline.milestones', 'milestone.milestone>project-dashboard.milestone',
  'kanban-board.tasks>timeline.tasks', 'kanban-board.progress>project-dashboard.progress', 'kanban-board.tasks>project-dashboard.tasks', 'kanban-board.tasks>person.tasks', 'kanban-board.done>flow-terminal.in',
  'checklist.progress>project-dashboard.checklists',
  'media.media>media-grid.items', 'media.media>*.screen', 'media.media>display.in', 'media-grid.layout>*.screen', 'media-grid.layout>display.in',
  'input.trigger>kanban-board.addTask', '*.tap>flow-terminal.in',
  'text.text>*.screen', 'text.text>display.in', 'action.result>*.screen', 'action.result>display.in', 'action.result>text.in',
  'project-dashboard.progress>display.in', 'sticky-note.text>display.in', 'sticky-note.text>*.screen',
  // generate: a Prompt dropped on a Generate component prompts it; results drop onto grids, screens, displays, boards; an Input runs a job
  'prompt.prompt>generate-text.prompt', 'prompt.prompt>generate-image.prompt', 'prompt.prompt>generate-video.prompt', 'prompt.prompt>generate-audio.prompt',
  'text.text>generate-text.prompt', 'text.text>generate-image.prompt', 'text.text>prompt.variables', 'data.value>prompt.variables', 'data.data>prompt.variables', 'milestone.milestone>prompt.variables', 'person.person>prompt.variables', 'kanban-board.tasks>prompt.variables',
  'generate-text.text>display.in', 'generate-text.text>*.screen', 'generate-text.text>text.in', 'generate-text.text>prompt.variables', 'generate-text.done>kanban-board.addTask', 'generate-text.text>generate-image.prompt',
  'generate-image.media>media-grid.items', 'generate-image.media>*.screen', 'generate-image.media>display.in', 'generate-image.media>kanban-board.cover', 'generate-image.media>generate-video.reference',
  'generate-video.media>media-grid.items', 'generate-video.media>*.screen', 'generate-video.media>display.in', 'generate-video.media>kanban-board.cover',
  'generate-audio.media>media-grid.items', 'generate-audio.media>*.screen', 'generate-audio.media>display.in',
  'media.media>kanban-board.cover', 'media.media>generate-image.reference', 'media.media>generate-text.image',
  'input.trigger>generate-text.run', 'input.trigger>generate-image.run', 'input.trigger>generate-video.run', 'input.trigger>generate-audio.run',
  // generate round: a Settings on any generator, a Guide / Mask on a Generate Image (Video), images into Image Edit / Guide / Mask / Enhance, edited and enhanced images on to grids, screens, displays, covers and references
  'generate-settings.settings>generate-text.settings', 'generate-settings.settings>generate-image.settings', 'generate-settings.settings>generate-video.settings', 'generate-settings.settings>generate-audio.settings',
  'generate-guide.guide>generate-image.guides', 'generate-guide.guide>generate-video.guides',
  'generate-mask.mask>generate-image.mask', 'generate-mask.mask>image-edit.mask',
  'media.media>image-edit.image', 'media.media>generate-guide.image', 'media.media>generate-mask.image', 'media.media>enhance.image',
  'generate-image.media>image-edit.image', 'generate-image.media>generate-guide.image', 'generate-image.media>generate-mask.image', 'generate-image.media>enhance.image',
  'image-edit.image>media-grid.items', 'image-edit.image>*.screen', 'image-edit.image>display.in', 'image-edit.image>kanban-board.cover', 'image-edit.image>generate-image.reference', 'image-edit.image>generate-video.reference', 'image-edit.image>enhance.image', 'image-edit.image>generate-mask.image', 'image-edit.image>generate-guide.image',
  'enhance.media>media-grid.items', 'enhance.media>*.screen', 'enhance.media>display.in', 'enhance.media>kanban-board.cover', 'enhance.media>generate-image.reference', 'enhance.media>generate-video.reference', 'enhance.media>image-edit.image',
  'text.text>generate-image.negative', 'text.text>generate-video.negative', 'input.trigger>enhance.run', 'action.result>prompt.variables',
];
const FLOW_OUT = new Set(['out', 'next', 'yes', 'no', 'done', 'tap', 'trigger', 'reached']);
const FLOW_IN = new Set(['in', 'start', 'trigger']);
const DEVICE_TYPES = new Set(['phone', 'tablet', 'laptop', 'monitor']);
function matchesRow(row, from, to) {
  const [f, t] = row.split('>');
  const [ft, fk] = f.split('.'), [tt, tk] = t.split('.');
  const A = from.owner, B = to.owner;
  const typeOk = (want, owner) => want === '*' || want === owner.typeId;
  if (!typeOk(ft, A) || fk !== from.key) return false;
  if (tt === '*' && tk === 'screen') return DEVICE_TYPES.has(B.typeId) && to.key === 'screen';
  return typeOk(tt, B) && tk === to.key;
}
/**
 * Candidate links for dropping `dragged` onto `target`: `[{ from, to, sentence }]`, most specific
 * first, excluding pairs that already exist, occupied single inputs and incompatible ports.
 */
export function dropLinkCandidates(dragged, target, world) {
  if (!dragged || !target || dragged === target || dragged.kind === 'group' || target.kind === 'group') return [];
  const out = [];
  const seen = new Set();
  const consider = (from, to, generic) => {
    if (seen.has(to) || !world.canConnect(from, to)) return;
    if (world.connections.some((c) => c.from === from && c.to === to)) return;
    if (!to.multi && world.connections.some((c) => c.to === to)) return;   // an occupied single input keeps its cable
    seen.add(to);
    out.push({ from, to, generic, sentence: describePorts(from, to) || `${dragged.title}.${from.label} → ${target.title}.${to.label}` });
  };
  for (const from of dragged.outputs) for (const to of target.inputs) {
    if (DROP_LINKS.some((row) => matchesRow(row, from, to))) consider(from, to, false);
  }
  for (const from of dragged.outputs) for (const to of target.inputs) {
    if (from.type === 'event' && to.type === 'event' && FLOW_OUT.has(from.key) && FLOW_IN.has(to.key)) consider(from, to, true);
  }
  return out;
}
