// boot.js — the add-on's entry point. Order matters: the isolation patches must be in place before
// main.js constructs Tabs and the Start panel, the provider and the components must be registered
// before main.js boots (a saved scene holding jev-* nodes is restored, not skipped), and the plugin
// installs last, against the live window.__proto.
import './isolate.js';
import './provider.js';
import './components/index.js';
import '../../src/main.js';
import { install } from './plugin.js';

install(window.__proto);
