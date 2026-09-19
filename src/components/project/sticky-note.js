// Sticky Note — a tilted square slab in a paper colour with the note text on its face. Edit the
// text and colour in the panel or feed `text` from anything upstream; `text` passes it on.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { clear, drawText } from '../../faces.js';
import { asText } from '../util.js';

const S = 3.0, D = 0.1;
const tiltOf = (node) => (node.params.tilt || 0) * Math.PI / 180;
const paper = (node) => new THREE.Color(node.params.colour || '#f5d76e');
/** Dark ink on light paper, light ink on dark paper. */
const ink = (hexColour) => { const c = new THREE.Color(hexColour || '#f5d76e'); const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; return l > 0.5 ? '#2a2413' : '#fbf7ea'; };

export default registry.register({
  id: 'sticky-note', category: 'project', label: 'Sticky Note', icon: icons['sticky-note'], size: 'S',
  description: 'A tilted coloured note with editable text; optional text input',
  inputs: [{ key: 'text', label: 'text', type: 'text', optional: true }],
  outputs: [{ key: 'text', label: 'text', type: 'text' }],
  params: [
    { key: 'text', label: 'text', type: 'text', default: 'Remember to…' },
    { key: 'colour', label: 'colour', type: 'color', default: '#f5d76e' },
    { key: 'tilt', label: 'tilt (°)', type: 'number', default: -4, min: -30, max: 30, step: 1 },
  ],
  body3d: {
    dims: () => ({ width: S + 0.4, height: S + 0.4, depth: 0.5 }),
    titleAt: () => [0, S / 2 + 0.5, 0.06], titleSize: 0.22, titleColor: 'textDim',
    ports: () => ({ in: [[-(S + 0.4) / 2, 0, 0]], out: [[(S + 0.4) / 2, 0, 0]] }),
    build(node, h) {
      node.paper = new THREE.Group(); node.add(node.paper);
      node.slab = h.part(new h.RoundedBoxGeometry(S, S, D, 2, 0.04), new THREE.MeshStandardMaterial({ color: paper(node), roughness: 0.9, metalness: 0 }), { parent: node.paper });
      node.slab.userData.dimWhenDisabled = false;
      // the top edge curls a little: a thin strip slightly lifted
      const curl = h.part(new THREE.BoxGeometry(S * 0.96, 0.08, D * 1.6), new THREE.MeshStandardMaterial({ color: paper(node).clone().multiplyScalar(0.92), roughness: 0.9 }), { parent: node.paper });
      curl.position.set(0, S / 2 - 0.05, D * 0.3); node.curl = curl;
      const face = h.face(S - 0.3, S - 0.3, [0, -0.02, D / 2 + 0.006], { emissive: 0.0 });
      node.paper.add(face); face.material.color.set(0xffffff); face.material.emissiveIntensity = 0.35;
      node.paper.rotation.z = tiltOf(node);
      node.rim = h.rim(new h.RoundedBoxGeometry(S + 0.12, S + 0.12, D + 0.12, 2, 0.06));
      node.rim.rotation.z = tiltOf(node);
    },
    refresh(node) {
      node.slab.material.color.copy(paper(node)); node.curl.material.color.copy(paper(node)).multiplyScalar(0.92);
      node.paper.rotation.z = tiltOf(node); node.rim.rotation.z = tiltOf(node);
    },
  },
  evaluate({ inputs, params }) { return { text: inputs.text !== undefined ? asText(inputs.text) : String(params.text ?? '') }; },
  face: {
    render(g, w, h, { params, outputs }) {
      clear(g, w, h, params.colour || '#f5d76e');
      // faint ruled lines like paper
      g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 2;
      for (let y = 60; y < h; y += 44) { g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke(); }
      drawText(g, outputs.text ?? params.text ?? '', 20, 18, w - 40, h - 36, { size: 44, min: 16, weight: 600, color: ink(params.colour), align: 'left', valign: 'top', lineHeight: 1.3 });
    },
  },
});
