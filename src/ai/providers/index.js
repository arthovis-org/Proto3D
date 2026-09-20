// ai/providers/index.js — importing this registers every provider adapter. Order = the order
// the Connections page and the panel selects list them: the real services first, Demo last.
import './openrouter.js';
import './fal.js';
import './kie.js';
import './demo.js';
export { providerRegistry, providerStatus, credentialsFor, createJob, registerProvider, CAPABILITIES } from './base.js';
