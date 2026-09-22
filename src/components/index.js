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
// project management
import './project/kanban-board.js';
import './project/flow-shapes.js';
import './project/timeline.js';
import './project/person.js';
import './project/milestone.js';
import './project/sticky-note.js';
import './project/checklist.js';
import './project/project-dashboard.js';
import './project/calendar.js';
// generate (AI): prompt editor + text / image / video / audio generation, and the round that
// shapes them: Settings, Guide, Mask, Image Edit (browser), Enhance
import './generate/prompt.js';
import './generate/generate-text.js';
import './generate/generate-media.js';
import './generate/generate-settings.js';
import './generate/generate-guide.js';
import './generate/generate-mask.js';
import './generate/image-edit.js';
import './generate/enhance.js';
export { registry } from '../core/registry.js';
