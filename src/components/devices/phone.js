import { registry } from '../../core/registry.js';
import { deviceDefinition } from './device-common.js';
export default registry.register(deviceDefinition({
  id: 'phone', label: 'Phone', description: 'Handheld: tap events, tilt and battery outputs, any value on screen',
  sensor: { key: 'tilt', label: 'tilt', min: -45, max: 45 }, seed: 1.3,
  extraOutputs: [{ key: 'battery', label: 'battery', type: 'number' }],
  extraEvaluate: ({ time }) => ({ battery: Math.round(100 - (time * 0.4) % 100) }),
}));
