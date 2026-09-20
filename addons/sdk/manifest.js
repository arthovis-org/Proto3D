// sdk/manifest.js — reads and validates an add-on's `addon.json`. Environment-agnostic (no DOM,
// no fs): the shell fetches the file in the browser, the test kit reads it from disk, both hand
// the parsed object to `validateManifest`, which returns a frozen, normalised manifest or throws
// an Error naming the offending field.
//
//   {
//     "id": "gateway-credits",      // ^[a-z][a-z0-9-]*$ · storage namespace, page badge, CI matrix
//     "name": "Gateway Credits",    // shown in the page title and the badge
//     "version": "0.2.0",           // the add-on's own version (semver-ish, informational)
//     "prefix": "gw",               // ^[a-z][a-z0-9]*$ · every node id must start with "<prefix>-"
//     "sdk": 1,                     // host API major version the add-on was written against
//     "entry": "./src/index.js",    // module exporting register(host)? and install(host)
//     "description": "...",         // optional
//     "styles": ["./src/x.css"]     // optional stylesheets the shell links, relative to the page
//   }

/** Major version of the host API this SDK implements. `createHost` refuses manifests written for another major. */
export const SDK_VERSION = 1;

const ID_RE = /^[a-z][a-z0-9-]*$/;
const PREFIX_RE = /^[a-z][a-z0-9]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Validate + normalise a manifest object. Throws with the field name on any schema error. */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('addon.json: manifest must be an object');
  const fail = (field, why) => { throw new Error(`addon.json: "${field}" ${why}`); };
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) fail('id', `must match ${ID_RE} (got ${JSON.stringify(m.id)})`);
  if (typeof m.name !== 'string' || !m.name.trim()) fail('name', 'must be a non-empty string');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) fail('version', `must be semver like "0.1.0" (got ${JSON.stringify(m.version)})`);
  if (typeof m.prefix !== 'string' || !PREFIX_RE.test(m.prefix)) fail('prefix', `must match ${PREFIX_RE} (got ${JSON.stringify(m.prefix)}); node ids are "<prefix>-<name>"`);
  if (!Number.isInteger(m.sdk) || m.sdk < 1) fail('sdk', `must be a positive integer (got ${JSON.stringify(m.sdk)})`);
  if (typeof m.entry !== 'string' || !m.entry.startsWith('./')) fail('entry', `must be a relative module path starting with "./" (got ${JSON.stringify(m.entry)})`);
  if (m.description !== undefined && typeof m.description !== 'string') fail('description', 'must be a string when present');
  if (m.styles !== undefined && (!Array.isArray(m.styles) || m.styles.some((s) => typeof s !== 'string' || !s.startsWith('./')))) fail('styles', 'must be an array of relative paths starting with "./"');
  return Object.freeze({
    id: m.id, name: m.name.trim(), version: m.version, prefix: m.prefix, sdk: m.sdk, entry: m.entry,
    description: m.description || '',
    styles: Object.freeze([...(m.styles || [])]),
  });
}

/** The node-id prefix an add-on must use, with the dash. */
export const nodePrefix = (manifest) => `${manifest.prefix}-`;

/** True when `id` is a node id this manifest is allowed to register. */
export const ownsNodeId = (manifest, id) => typeof id === 'string' && id.startsWith(nodePrefix(manifest)) && id.length > nodePrefix(manifest).length;

/** The localStorage namespace `host.storage` writes under for this add-on. */
export const storageNamespace = (manifest) => `proto3d.addon.${manifest.id}.`;

/** The page-level storage prefix `shell.js` installs (see storage.js). */
export const pagePrefix = (id) => `addon.${id}:`;
export const pageDbPrefix = (id) => `addon.${id}.`;
