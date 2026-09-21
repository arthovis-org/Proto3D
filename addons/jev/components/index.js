// components/index.js — the Jev category: glyphs and accent first (icons.js), then the five
// components. Imported before ../../src/main.js so the registry knows them at boot and a saved
// scene holding jev-* nodes is restored rather than skipped.
import './icons.js';
import './jev-route.js';
import './jev-check.js';
import './jev-score.js';
import './jev-rank.js';
import './jev-ask.js';

export const JEV_TYPES = ['jev-route', 'jev-check', 'jev-score', 'jev-rank', 'jev-ask'];
