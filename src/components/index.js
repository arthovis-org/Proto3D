// components/index.js — importing this module registers every core component. Add a new
// component by creating src/components/<category>/<name>.js and importing it here.
import './media/media.js';
import './media/media-grid.js';
import './text/text.js';
import './data/data.js';
import './input/input.js';
import './logic/compare.js';
import './logic/gate.js';
import './logic/branch.js';
import './action/action.js';
import './transform/transform.js';
import './layout/layout.js';
import './output/display.js';
import './output/log.js';
import './devices/phone.js';
import './devices/tablet.js';
import './devices/laptop.js';
import './devices/monitor.js';
export { registry } from '../core/registry.js';
