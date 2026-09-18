// icons.js — inline SVG glyphs (24×24, stroke = currentColor) for categories, components and UI.
const svg = (inner, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;

export const icons = {
  // categories / components
  media: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5.5-5.5L7 19"/>'),
  'media-grid': svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  data: svg('<path d="M8 4c-2 0-3 1-3 3v2.5c0 1.2-.8 2.5-2 2.5 1.2 0 2 1.3 2 2.5V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.5c0 1.2.8 2.5 2 2.5-1.2 0-2 1.3-2 2.5V17c0 2-1 3-3 3"/>'),
  input: svg('<path d="M6 3l12 9-5.5 1.2L15 19l-2.4 1-2.4-5.6L6 17z"/>'),
  logic: svg('<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M8 7l8 4M8 17l8-4"/>'),
  compare: svg('<path d="M4 8h16M4 16h16M9 4l-5 4 5 4M15 12l5 4-5 4"/>'),
  gate: svg('<path d="M4 5h6a7 7 0 010 14H4zM2 9h2M2 15h2M17 12h5"/>'),
  branch: svg('<path d="M4 12h6M10 12c3 0 3-6 6-6h4M10 12c3 0 3 6 6 6h4"/><circle cx="4" cy="12" r="1.5"/>'),
  action: svg('<path d="M13 2L5 14h6l-1 8 9-13h-6z"/>'),
  transform: svg('<path d="M4 20l6-16M13 8h7M13 12h5M13 16h7"/>'),
  layout: svg('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 10h18M10 10v11"/>'),
  output: svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  display: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  log: svg('<path d="M5 6h14M5 12h14M5 18h9"/><circle cx="3" cy="6" r=".6"/><circle cx="3" cy="12" r=".6"/><circle cx="3" cy="18" r=".6"/>'),
  devices: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  tablet: svg('<rect x="4" y="3" width="16" height="18" rx="2.2"/><path d="M11 18h2"/>'),
  laptop: svg('<rect x="4" y="5" width="16" height="11" rx="1.6"/><path d="M2 19h20"/>'),
  monitor: svg('<rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M12 16v4M8 20h8"/>'),
  // UI
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  file: svg('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>'),
  frame: svg('<path d="M3 8V5a2 2 0 012-2h3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  group: svg('<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 3"/><rect x="7" y="7" width="4" height="4" rx="1"/><rect x="13" y="13" width="4" height="4" rx="1"/>'),
  node: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18"/><circle cx="3" cy="14" r="1.2" fill="currentColor"/><circle cx="21" cy="14" r="1.2" fill="currentColor"/>'),
  connection: svg('<circle cx="4" cy="16" r="2"/><circle cx="20" cy="8" r="2"/><path d="M6 16c6 0 6-8 12-8"/>'),
  workspace: svg('<path d="M3 20l9-16 9 16z"/><path d="M3 20h18"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.8-2.5 2-2.5 4M12 17.5v.01"/>'),
};
export const icon = (name) => icons[name] || icons.node;
