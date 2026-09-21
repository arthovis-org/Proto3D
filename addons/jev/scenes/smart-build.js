// scenes/smart-build.js — "Ask the system to build": four Media nodes and a Person, nothing else.
// The tutorial drives Smart Add (Ctrl+J): "put these images on a wall" adds a Media Grid wired to
// the pictures; "show the person's tasks" adds a Kanban board with the person plugged in.
export const INTENTS = { wall: 'put these images on a wall', tasks: "show the person's tasks" };

export default {
  id: 'smart-build', label: 'Ask the system to build',
  description: 'Four pictures and a person. Select them, press Ctrl+J and say what you want — Jev picks the component and the link',
  camera: { position: [0, 18, 28], target: [0, 1, 0] },
  names: { maya: 'Maya', note: 'Try it' },
  focus: (n) => [...(n.media || []), n.maya].filter(Boolean),
  build({ add, group }) {
    const media = ['Dune', 'Harbour', 'Lagoon', 'Orchid'].map((t, i) => add('media', [-15 + i * 6, null, -4], { title: t, params: { mode: 'image', source: `sample ${i + 1}` } }));
    const maya = add('person', [12, null, -4], { title: 'Maya', params: { name: 'Maya Chen', role: 'Designer', colour: '#e25aa6', capacity: 4 } });
    const note = add('sticky-note', [-2, null, 7], { title: 'Try it', params: { text: 'Select the four pictures, press Ctrl+J and type: put these images on a wall', colour: '#f5d76e', tilt: -3 } });
    group('Pictures', media);
    return { media, maya, note };
  },
};
