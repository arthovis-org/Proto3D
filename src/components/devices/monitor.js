import { registry } from '../../core/registry.js';
import { deviceDefinition } from './device-common.js';
export default registry.register(deviceDefinition({
  id: 'monitor', label: 'Monitor', description: 'Large screen: tap events and an ambient-light sensor',
  sensor: { key: 'sensor', label: 'ambient', min: 0, max: 100, decimals: 0 }, seed: 0.4,
}));
