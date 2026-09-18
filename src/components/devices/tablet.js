import { registry } from '../../core/registry.js';
import { deviceDefinition } from './device-common.js';
export default registry.register(deviceDefinition({
  id: 'tablet', label: 'Tablet', description: 'Tablet: tap events and tilt output, any value on screen',
  sensor: { key: 'tilt', label: 'tilt', min: -45, max: 45 }, seed: 4.1,
}));
