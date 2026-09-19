// boot.js — order matters and is the whole integration trick (survey §7):
//   1. ./nodes.js registers the gw- components through the shared registry module instance,
//      BEFORE the app boots, so an autosaved graph containing them is not skipped on restore.
//   2. ../../src/main.js boots the real Proto3D app into this page's DOM and sets window.__proto.
//   3. install() attaches the admin UI, hooks and the namespaced autosave.
import './nodes.js';
import '../../src/main.js';
import { install } from './plugin.js';

install(window.__proto);
