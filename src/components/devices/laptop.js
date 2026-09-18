import { registry } from '../../core/registry.js';
import { deviceDefinition } from './device-common.js';
export default registry.register(deviceDefinition({
  id: 'laptop', label: 'Laptop', description: 'Laptop: tap events and a load sensor, any value on screen',
  sensor: { key: 'sensor', label: 'load', min: 5, max: 95, decimals: 0 }, seed: 2.7,
}));
