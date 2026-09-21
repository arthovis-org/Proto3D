// components/icons.js — the Jev category's glyphs and accent colour on the shared theme objects.
// A module of its own so it is evaluated before the component modules that read `icons[...]`
// (ES imports are hoisted: assignments in index.js would run after its imports).
import { icons } from '../../../src/icons.js';
import { palettes, categories, getTheme } from '../../../src/theme.js';
import { CATEGORIES } from '../../../src/core/registry.js';

const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
// category: a fork with one chosen branch
icons.jev = svg('<path d="M4 12h5"/><path d="M9 12c3 0 3-6 6-6h5"/><path d="M9 12c3 0 3 6 6 6h5" opacity=".4"/><circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.6" fill="currentColor" stroke="none"/>');
icons['jev-route'] = svg('<path d="M3 12h4"/><path d="M7 12c3 0 3-7 6-7h8"/><path d="M7 12h14" opacity=".45"/><path d="M7 12c3 0 3 7 6 7h8" opacity=".45"/><path d="M18 2.5l2.5 2.5L18 7.5"/>');
icons['jev-check'] = svg('<circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-7"/>');
icons['jev-score'] = svg('<path d="M4 20h16"/><rect x="5" y="13" width="3.5" height="7" rx="1"/><rect x="10.25" y="9" width="3.5" height="11" rx="1"/><rect x="15.5" y="4" width="3.5" height="16" rx="1"/>');
icons['jev-rank'] = svg('<path d="M4 6h10M4 12h14M4 18h7"/><path d="M20 5v14M17 8l3-3 3 3"/>');
icons['jev-ask'] = svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M10 9.2a2 2 0 0 1 3.9.6c0 1.3-1.9 1.5-1.9 2.6"/><path d="M12 14.5v.01"/>');
// accent line on the body: a decisive teal per theme; registering the key on `categories` lets setTheme refresh it
palettes.dark.categories.jev = 0x22c7d6;
palettes.light.categories.jev = 0x0e8f9c;
// the category row (label, description) for the Add rail and menu — the registry lists unknown categories after these
if (!CATEGORIES.some((c) => c.id === 'jev')) CATEGORIES.push({ id: 'jev', label: 'Jev', kind: 'node', description: 'Decisions by TypeSafe Jev: route, check, score, rank, ask' });
categories.jev = { header: palettes[getTheme()]?.categories.jev ?? palettes.dark.categories.jev };

export { icons };
