// Sticky Note — a tilted square slab in a paper colour with the note text on its face. Double-click
// the note to write on it (Enter saves), or edit the text and colour in the panel, or feed `text`
// from anything upstream; `text` passes it on.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawText, beginFields } from '../../faces.js';
import { asText } from '../util.js';

const S = 3.0, D = 0.1;
const tiltOf = (node) => (node.params.tilt || 0) * Math.PI / 180;
const paper = (node) => new THREE.Color(node.params.colour || '#f5d76e');
/** Dark ink on light paper, light ink on dark paper. */
const ink = (hexColour) => { const c = new THREE.Color(hexColour || '#f5d76e'); const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; return l > 0.5 ? '#2a2413' : '#fbf7ea'; };

export default registry.register({
  id: 'sticky-note', category: 'project', label: 'Sticky Note', icon: icons['sticky-note'], size: 'S',
  description: 'A tilted paper note with your text on it',
  inputs: [{ key: 'text', label: 'text', type: 'text', optional: true }],
  outputs: [{ key: 'text', label: 'text', type: 'text' }],
  params: [
    { key: 'text', label: 'text', type: 'text', default: 'Remember to…', multiline: true },
    { key: 'colour', label: 'colour', type: 'color', default: '#f5d76e' },
    { key: 'tilt', label: 'tilt (°)', type: 'number', default: -4, min: -30, max: 30, step: 1 },
  ],
  body3d: {
    dims: () => ({ width: S + 0.4, height: S + 0.4, depth: 0.5 }),
    titleAt: () => [0, S / 2 + 0.5, 0.06], titleSize: 0.22, titleColor: 'textDim',
    ports: () => ({ in: [[-(S + 0.4) / 2, 0, 0]], out: [[(S + 0.4) / 2, 0, 0]] }),
    build(node, h) {
      node.paper = new THREE.Group(); node.add(node.paper);
      node.slab = h.part(h.panelGeometry(S, S, D, { radius: 0.12, bevel: 0.012 }), new THREE.MeshPhysicalMaterial({ color: paper(node), roughness: 0.85, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.6, envMapIntensity: 0.3 }), { parent: node.paper });
      node.slab.userData.dimWhenDisabled = false;
      // the top edge curls a little: a thin strip slightly lifted
      const curl = h.part(new THREE.BoxGeometry(S * 0.96, 0.08, D * 1.6), new THREE.MeshStandardMaterial({ color: paper(node).clone().multiplyScalar(0.92), roughness: 0.9 }), { parent: node.paper });
      curl.position.set(0, S / 2 - 0.05, D * 0.3); node.curl = curl;
      const face = h.face(S - 0.3, S - 0.3, [0, -0.02, D / 2 + 0.006], { emissive: 0.0 });
      node.paper.add(face); face.material.color.set(0xffffff); face.material.emissiveIntensity = 0.35;
      node.paper.rotation.z = tiltOf(node);
      node.rim = h.rim(h.outlineGeometry(S, S, D, h.sizes.outline.grow, { radius: 0.12 }));
      node.rim.rotation.z = tiltOf(node);
    },
    refresh(node) {
      node.slab.material.color.copy(paper(node)); node.curl.material.color.copy(paper(node)).multiplyScalar(0.92);
      node.paper.rotation.z = tiltOf(node); node.rim.rotation.z = tiltOf(node);
    },
  },
  evaluate({ inputs, params }) { return { text: inputs.text !== undefined ? asText(inputs.text) : String(params.text ?? '') }; },
  face: {
    render(g, w, h, { params, outputs, inputs, instance }) {
      clear(g, w, h, params.colour || '#f5d76e', 6);
      // faint ruled lines like paper
      g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 1.5;
      for (let y = 64; y < h; y += 44) { g.beginPath(); g.moveTo(24, y); g.lineTo(w - 24, y); g.stroke(); }
      const F = beginFields(instance);
      const fed = inputs && inputs.text !== undefined;   // text arriving on the input is shown, not edited
      if (!F.editing('text')) { const r = drawText(g, outputs.text ?? params.text ?? '', 26, 22, w - 52, h - 44, { size: 40, min: 16, weight: 600, color: ink(params.colour), align: 'left', valign: 'top', lineHeight: 1.3 }); if (instance) instance._notePx = r.px; }
      if (!fed) F.add({ id: 'text', kind: 'multiline', param: 'text', label: 'note', rect: { x: 26, y: 22, w: w - 52, h: h - 44 }, placeholder: 'Write a note…', font: { size: instance?._notePx || 40, weight: 600, color: ink(params.colour), align: 'left', lineHeight: 1.3 }, bg: params.colour || '#f5d76e' });
    },
  },
});
