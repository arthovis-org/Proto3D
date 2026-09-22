// import/comfyui.js — a ComfyUI workflow as a Proto3D document. Pure: no Three.js, no registry,
// no DOM; `main.js` opens the result through the normal document path (tabs.openDoc) and
// auto-layouts it. Both ComfyUI shapes are read: the UI format saved by the editor
// (`{ nodes: [{ id, type, pos, size, widgets_values, inputs, outputs, mode }], links: [[id,
// from, fromSlot, to, toSlot, type]], groups }`) and the API format (`{ "<id>": { class_type,
// inputs: { name: value | [nodeId, slot] } } }`).
//
// The rule from the Generate round holds — hosted APIs, not local diffusion — so ComfyUI's
// loaders, latents and samplers collapse: a KSampler with its EmptyLatentImage becomes one
// Settings node driving one Generate Image, CLIPTextEncode becomes a Prompt (positive → `prompt`,
// negative → `negative`), VAE encode / decode and the latent ops pass their links through,
// ControlNet and IP-Adapter applies become Guides, LoadImage a Media (and a Mask for its alpha),
// the image ops Image Edits, the mask ops fold onto one Mask, an upscale model an Enhance, Save /
// Preview a Media Grid, Notes Sticky Notes, unknown classes a Sticky Note placeholder. Everything
// that was mapped, folded, dropped or replaced is listed in the report. `CLASS_MAP` is the table
// to extend for another class.
export const FORMAT_VERSION = 2;
const PX_PER_UNIT = 70;   // ComfyUI canvas px → Proto3D units (a 315 px node ≈ a 4.6-unit block)

/* ------------------------------------------------------------------ */
/* the two ComfyUI shapes → one graph                                    */
/* ------------------------------------------------------------------ */
/** True for either ComfyUI format (a Proto3D document is never one). */
export function isComfyWorkflow(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  if (json.app === 'proto3d') return false;
  if (Array.isArray(json.nodes) && json.nodes.some((n) => n && typeof n.type === 'string' && ('widgets_values' in n || Array.isArray(n.inputs) || Array.isArray(n.outputs))) && (Array.isArray(json.links) || json.version !== undefined || json.last_node_id !== undefined)) return true;
  const vals = Object.values(json);
  return vals.length > 0 && vals.every((v) => v && typeof v === 'object' && typeof v.class_type === 'string' && v.inputs && typeof v.inputs === 'object');
}
/** Widget order per class (the UI format stores widget values as a bare array). */
export const WIDGETS = {
  KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  KSamplerAdvanced: ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
  SamplerCustom: ['add_noise', 'noise_seed', 'control_after_generate', 'cfg'],
  RandomNoise: ['noise_seed', 'control_after_generate'], KSamplerSelect: ['sampler_name'], BasicScheduler: ['scheduler', 'steps', 'denoise'], FluxGuidance: ['guidance'], CFGGuider: ['cfg'],
  EmptyLatentImage: ['width', 'height', 'batch_size'], EmptySD3LatentImage: ['width', 'height', 'batch_size'], EmptyLatentAudio: ['seconds', 'batch_size'],
  CLIPTextEncode: ['text'], CLIPTextEncodeFlux: ['clip_l', 't5xxl', 'guidance'], CLIPTextEncodeSDXL: ['width', 'height', 'crop_w', 'crop_h', 'target_width', 'target_height', 'text_g', 'text_l'],
  CheckpointLoaderSimple: ['ckpt_name'], UNETLoader: ['unet_name', 'weight_dtype'], ImageOnlyCheckpointLoader: ['ckpt_name'], VAELoader: ['vae_name'], CLIPLoader: ['clip_name', 'type'], DualCLIPLoader: ['clip_name1', 'clip_name2', 'type'],
  LoraLoader: ['lora_name', 'strength_model', 'strength_clip'], LoraLoaderModelOnly: ['lora_name', 'strength_model'],
  LoadImage: ['image', 'upload'], LoadImageMask: ['image', 'channel', 'upload'], LoadAudio: ['audio', 'upload'],
  SaveImage: ['filename_prefix'], PreviewImage: [], SaveAnimatedWEBP: ['filename_prefix', 'fps', 'lossless', 'quality', 'method'], VHS_VideoCombine: ['frame_rate', 'loop_count', 'filename_prefix', 'format'], SaveAudio: ['filename_prefix'],
  ImageScale: ['upscale_method', 'width', 'height', 'crop'], ImageScaleBy: ['upscale_method', 'scale_by'], ImageCrop: ['width', 'height', 'x', 'y'], ImagePadForOutpaint: ['left', 'top', 'right', 'bottom', 'feathering'],
  ImageBlend: ['blend_factor', 'blend_mode'], ImageCompositeMasked: ['x', 'y', 'resize_source'], ImageInvert: [], ImageBlur: ['blur_radius', 'sigma'], ImageSharpen: ['sharpen_radius', 'sigma', 'alpha'], Canny: ['low_threshold', 'high_threshold'],
  ControlNetLoader: ['control_net_name'], ControlNetApply: ['strength'], ControlNetApplyAdvanced: ['strength', 'start_percent', 'end_percent'],
  CannyEdgePreprocessor: ['low_threshold', 'high_threshold', 'resolution'], DepthAnythingPreprocessor: ['ckpt_name', 'resolution'], MiDaS_DepthMap_Preprocessor: ['a', 'bg_threshold', 'resolution'], DWPreprocessor: ['detect_hand', 'detect_body', 'detect_face', 'resolution'], OpenposePreprocessor: ['detect_hand', 'detect_body', 'detect_face', 'resolution'],
  IPAdapterApply: ['weight', 'noise', 'weight_type'], IPAdapterAdvanced: ['weight', 'weight_type', 'combine_embeds', 'start_at', 'end_at', 'embeds_scaling'], IPAdapter: ['weight', 'start_at', 'end_at', 'weight_type'],
  UpscaleModelLoader: ['model_name'], ImageUpscaleWithModel: [],
  SolidMask: ['value', 'width', 'height'], ImageToMask: ['channel'], MaskToImage: [], InvertMask: [], GrowMask: ['expand', 'tapered_corners'], FeatherMask: ['left', 'top', 'right', 'bottom'], MaskComposite: ['x', 'y', 'operation'], ThresholdMask: ['value'],
  SetLatentNoiseMask: [], VAEEncodeForInpaint: ['grow_mask_by'], LatentUpscale: ['upscale_method', 'width', 'height', 'crop'], LatentUpscaleBy: ['upscale_method', 'scale_by'], LatentComposite: ['x', 'y', 'feather'], LatentCrop: ['width', 'height', 'x', 'y'],
  Note: ['text'], MarkdownNote: ['text'], PrimitiveNode: ['value', 'control_after_generate'], Reroute: [],
  SVD_img2vid_Conditioning: ['width', 'height', 'video_frames', 'motion_bucket_id', 'fps', 'augmentation_level'], VideoLinearCFGGuidance: ['min_cfg'], ADE_AnimateDiffLoaderWithContext: ['model_name', 'beta_schedule'],
};
/** Output slot names per class (the API format has no output list; slot 0 is the primary output otherwise). */
const OUTPUTS = {
  CheckpointLoaderSimple: ['MODEL', 'CLIP', 'VAE'], ImageOnlyCheckpointLoader: ['MODEL', 'CLIP_VISION', 'VAE'], LoraLoader: ['MODEL', 'CLIP'], DualCLIPLoader: ['CLIP'], UNETLoader: ['MODEL'],
  LoadImage: ['IMAGE', 'MASK'], LoadImageMask: ['MASK'], LoadAudio: ['AUDIO'], KSampler: ['LATENT'], KSamplerAdvanced: ['LATENT'], SamplerCustom: ['LATENT', 'LATENT'], SamplerCustomAdvanced: ['LATENT', 'LATENT'],
  VAEDecode: ['IMAGE'], VAEDecodeTiled: ['IMAGE'], VAEEncode: ['LATENT'], VAEEncodeForInpaint: ['LATENT'], ControlNetApplyAdvanced: ['CONDITIONING', 'CONDITIONING'], ControlNetApply: ['CONDITIONING'],
  IPAdapterApply: ['MODEL'], IPAdapterAdvanced: ['MODEL'], IPAdapter: ['MODEL'], ImagePadForOutpaint: ['IMAGE', 'MASK'], SVD_img2vid_Conditioning: ['CONDITIONING', 'CONDITIONING', 'LATENT'],
};
/** Read either format into `{ nodes: Map(id → node), links: Map(id → link), groups: [] }`; a node is `{ id, cls, title, pos, size, mode, widgets, inputs: [{ name, type, link }], outputs: [{ name, links: [] }] }`. */
export function readWorkflow(json) {
  const nodes = new Map(), links = new Map(); let groups = [];
  if (Array.isArray(json.nodes)) {
    for (const L of json.links || []) { if (Array.isArray(L) && L.length >= 5) links.set(String(L[0]), { id: String(L[0]), from: String(L[1]), fromSlot: +L[2], to: String(L[3]), toSlot: +L[4], type: L[5] || null }); }
    for (const n of json.nodes) {
      if (!n || typeof n.type !== 'string') continue;
      const names = WIDGETS[n.type] || [];
      const widgets = {}; const wv = Array.isArray(n.widgets_values) ? n.widgets_values : n.widgets_values && typeof n.widgets_values === 'object' ? Object.values(n.widgets_values) : [];
      wv.forEach((v, i) => { widgets[names[i] || `w${i}`] = v; });
      const node = { id: String(n.id), cls: n.type, title: n.title || null, pos: Array.isArray(n.pos) ? [+n.pos[0] || 0, +n.pos[1] || 0] : n.pos && typeof n.pos === 'object' ? [+n.pos[0] || +n.pos.x || 0, +n.pos[1] || +n.pos.y || 0] : null, size: Array.isArray(n.size) ? n.size : n.size ? [n.size[0] ?? n.size.x, n.size[1] ?? n.size.y] : [315, 120], mode: n.mode || 0, widgets, raw: wv,
        inputs: (n.inputs || []).map((i) => ({ name: i.name, type: i.type, link: i.link === null || i.link === undefined ? null : String(i.link), widget: i.widget?.name || null })),
        outputs: (n.outputs || []).map((o, k) => ({ name: o.name || (OUTPUTS[n.type] || [])[k] || `out${k}`, type: o.type, links: (o.links || []).map(String) })) };
      nodes.set(node.id, node);
    }
    groups = (json.groups || []).map((g) => ({ title: g.title || 'Group', bounding: g.bounding || g.bounds || null })).filter((g) => Array.isArray(g.bounding) && g.bounding.length === 4);
  } else {
    let seq = 0;
    for (const [id, n] of Object.entries(json)) {
      if (!n || typeof n.class_type !== 'string') continue;
      const widgets = {}; const inputs = [];
      for (const [name, v] of Object.entries(n.inputs || {})) {
        if (Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && typeof v[1] === 'number') {
          const lid = `a${++seq}`; links.set(lid, { id: lid, from: String(v[0]), fromSlot: v[1], to: String(id), toSlot: inputs.length, type: null }); inputs.push({ name, type: null, link: lid, widget: null });
        } else widgets[name] = v;
      }
      nodes.set(String(id), { id: String(id), cls: n.class_type, title: n._meta?.title || null, pos: null, size: [315, 120], mode: 0, widgets, raw: Object.values(widgets), inputs, outputs: (OUTPUTS[n.class_type] || ['out0']).map((name) => ({ name, type: null, links: [] })) });
    }
    for (const L of links.values()) { const src = nodes.get(L.from); if (src) { while (src.outputs.length <= L.fromSlot) src.outputs.push({ name: `out${src.outputs.length}`, links: [] }); src.outputs[L.fromSlot].links.push(L.id); } }
  }
  return { nodes, links, groups };
}

/* ------------------------------------------------------------------ */
/* the class table                                                       */
/* ------------------------------------------------------------------ */
/**
 * How a ComfyUI class is treated. `kind`:
 *   'pass'   its output is the value of one of its inputs (`through`: input name, or a function)
 *   'silent' a loader or a helper another rule reads (checkpoint, LoRA, ControlNet model…): no node, no report line
 *   'node'   a Proto3D component is built by `build(ctx, n)`
 *   'drop'   dropped with a `reason` (listed in the report; links from it are dropped)
 */
export const CLASS_MAP = {
  // sampling → Settings + Generate Image (Video for the SVD family)
  KSampler: { kind: 'node', build: buildSampler }, KSamplerAdvanced: { kind: 'node', build: buildSampler }, SamplerCustom: { kind: 'node', build: buildSampler }, SamplerCustomAdvanced: { kind: 'node', build: buildSampler },
  EmptyLatentImage: { kind: 'silent' }, EmptySD3LatentImage: { kind: 'silent' }, EmptyLatentAudio: { kind: 'silent' },
  CheckpointLoaderSimple: { kind: 'silent' }, UNETLoader: { kind: 'silent' }, ImageOnlyCheckpointLoader: { kind: 'silent' }, VAELoader: { kind: 'silent' }, CLIPLoader: { kind: 'silent' }, DualCLIPLoader: { kind: 'silent' }, CLIPVisionLoader: { kind: 'silent' },
  LoraLoader: { kind: 'pass', through: 'model' }, LoraLoaderModelOnly: { kind: 'pass', through: 'model' }, ModelSamplingSD3: { kind: 'pass', through: 'model' }, ModelSamplingFlux: { kind: 'pass', through: 'model' }, ModelSamplingDiscrete: { kind: 'pass', through: 'model' }, FreeU: { kind: 'pass', through: 'model' }, FreeU_V2: { kind: 'pass', through: 'model' }, CLIPSetLastLayer: { kind: 'pass', through: 'clip' }, VideoLinearCFGGuidance: { kind: 'pass', through: 'model' }, ADE_AnimateDiffLoaderWithContext: { kind: 'pass', through: 'model' },
  RandomNoise: { kind: 'silent' }, KSamplerSelect: { kind: 'silent' }, BasicScheduler: { kind: 'silent' }, BasicGuider: { kind: 'silent' }, CFGGuider: { kind: 'silent' }, ControlNetLoader: { kind: 'silent' }, UpscaleModelLoader: { kind: 'silent' }, IPAdapterModelLoader: { kind: 'silent' }, IPAdapterUnifiedLoader: { kind: 'pass', through: 'model' },
  FluxGuidance: { kind: 'pass', through: 'conditioning' }, ConditioningCombine: { kind: 'pass', through: 'conditioning_1', note: 'ConditioningCombine keeps its first conditioning' }, ConditioningConcat: { kind: 'pass', through: 'conditioning_to', note: 'ConditioningConcat keeps its first conditioning' }, ConditioningSetArea: { kind: 'pass', through: 'conditioning' }, ConditioningSetMask: { kind: 'pass', through: 'conditioning' }, ConditioningZeroOut: { kind: 'pass', through: 'conditioning' },
  // prompts
  CLIPTextEncode: { kind: 'node', build: buildPrompt }, CLIPTextEncodeFlux: { kind: 'node', build: buildPrompt }, CLIPTextEncodeSDXL: { kind: 'node', build: buildPrompt },
  // latents in and out: pass through (the sampler reads what hangs on its latent chain)
  VAEDecode: { kind: 'pass', through: 'samples' }, VAEDecodeTiled: { kind: 'pass', through: 'samples' }, VAEEncode: { kind: 'pass', through: 'pixels' }, VAEEncodeTiled: { kind: 'pass', through: 'pixels' }, VAEEncodeForInpaint: { kind: 'pass', through: 'pixels' },
  SetLatentNoiseMask: { kind: 'pass', through: 'samples' }, LatentUpscale: { kind: 'pass', through: 'samples' }, LatentUpscaleBy: { kind: 'pass', through: 'samples' }, LatentComposite: { kind: 'pass', through: 'samples_to', note: 'LatentComposite keeps its destination latent' }, LatentCrop: { kind: 'pass', through: 'samples' }, LatentBlend: { kind: 'pass', through: 'samples1' }, RepeatLatentBatch: { kind: 'pass', through: 'samples' }, LatentFromBatch: { kind: 'pass', through: 'samples' },
  // images in and out
  LoadImage: { kind: 'node', build: buildLoadImage }, LoadImageMask: { kind: 'node', build: buildLoadImageMask }, LoadAudio: { kind: 'node', build: buildLoadAudio },
  SaveImage: { kind: 'node', build: buildSave }, PreviewImage: { kind: 'node', build: buildSave }, SaveAnimatedWEBP: { kind: 'node', build: buildSave }, VHS_VideoCombine: { kind: 'node', build: buildSave }, SaveAudio: { kind: 'node', build: buildSave },
  // image ops → Image Edit (Canny → Guide)
  ImageScale: { kind: 'node', build: buildImageEdit }, ImageScaleBy: { kind: 'node', build: buildImageEdit }, ImageCrop: { kind: 'node', build: buildImageEdit }, ImagePadForOutpaint: { kind: 'node', build: buildImageEdit }, ImageBlend: { kind: 'node', build: buildImageEdit }, ImageCompositeMasked: { kind: 'node', build: buildImageEdit }, ImageInvert: { kind: 'node', build: buildImageEdit }, ImageBlur: { kind: 'node', build: buildImageEdit }, ImageSharpen: { kind: 'node', build: buildImageEdit },
  Canny: { kind: 'node', build: buildCannyGuide }, CannyEdgePreprocessor: { kind: 'pass', through: 'image' }, DepthAnythingPreprocessor: { kind: 'pass', through: 'image' }, MiDaS_DepthMap_Preprocessor: { kind: 'pass', through: 'image' }, Zoe_DepthMap_Preprocessor: { kind: 'pass', through: 'image' }, DWPreprocessor: { kind: 'pass', through: 'image' }, OpenposePreprocessor: { kind: 'pass', through: 'image' }, LineArtPreprocessor: { kind: 'pass', through: 'image' }, HEDPreprocessor: { kind: 'pass', through: 'image' },
  // guides
  ControlNetApply: { kind: 'node', build: buildControlNet }, ControlNetApplyAdvanced: { kind: 'node', build: buildControlNet }, IPAdapterApply: { kind: 'node', build: buildIPAdapter }, IPAdapterAdvanced: { kind: 'node', build: buildIPAdapter }, IPAdapter: { kind: 'node', build: buildIPAdapter },
  // masks
  SolidMask: { kind: 'node', build: buildSolidMask }, ImageToMask: { kind: 'node', build: buildImageToMask }, MaskToImage: { kind: 'pass', through: 'mask' }, InvertMask: { kind: 'node', build: buildMaskOp }, GrowMask: { kind: 'node', build: buildMaskOp }, FeatherMask: { kind: 'node', build: buildMaskOp }, ThresholdMask: { kind: 'node', build: buildMaskOp }, MaskComposite: { kind: 'pass', through: 'destination', note: 'MaskComposite keeps its destination mask (compositing two masks is not offered)' },
  // enhance
  ImageUpscaleWithModel: { kind: 'node', build: buildEnhance },
  // wiring helpers, notes, primitives
  Reroute: { kind: 'pass', through: (n) => n.inputs[0]?.name || '' }, Note: { kind: 'node', build: buildNote }, MarkdownNote: { kind: 'node', build: buildNote }, PrimitiveNode: { kind: 'silent' },
  // video
  SVD_img2vid_Conditioning: { kind: 'silent' },
};

/* ------------------------------------------------------------------ */
/* the conversion                                                       */
/* ------------------------------------------------------------------ */
export function comfyToProto3D(json, { name = 'ComfyUI workflow' } = {}) {
  if (!isComfyWorkflow(json)) throw new Error('Not a ComfyUI workflow (neither the editor\'s JSON nor the API format)');
  const G = readWorkflow(json);
  const ctx = new Ctx(G, name);
  // producers first in reading order (top to bottom, left to right), so the document keeps the workflow's order
  const order = [...G.nodes.values()].sort((a, b) => (a.pos && b.pos ? (a.pos[1] - b.pos[1]) || (a.pos[0] - b.pos[0]) : 0));
  for (const n of order) ctx.visit(n);
  ctx.finish();
  return { doc: ctx.doc(), report: ctx.report };
}

class Ctx {
  constructor(G, name) {
    this.G = G; this.name = name;
    this.nodes = []; this.conns = []; this.groups = [];
    this.report = { mapped: [], skipped: [], placeholders: 0, notes: [], total: G.nodes.size };
    this.built = new Map();       // comfy id → { outputs: { [slot]: { uid, port } | null }, proto: [uid] } once visited
    this.visiting = new Set();
    this.seq = 0; this.linkSeq = 0;
    this.generators = [];
    this.noted = new Set();
  }
  /* --- documents --- */
  uid(hint) { return `cf${(++this.seq).toString(36)}${hint ? '-' + hint : ''}`; }
  add(type, { title, params = {}, at = null, enabled = true, hint = null, comfy = null }) {
    const uid = this.uid(hint || type.replace(/^generate-/, ''));
    const pos = at?.pos ? [+(at.pos[0] / PX_PER_UNIT).toFixed(2), 0, +(at.pos[1] / PX_PER_UNIT).toFixed(2)] : [0, 0, 0];
    const rec = { uid, type, title: title || type, params, state: {}, enabled, position: pos, rotationY: 0, scale: 1, _comfy: comfy?.id ?? null, _pos: at?.pos || null, _size: at?.size || null };
    this.nodes.push(rec);
    return rec;
  }
  link(from, to) {
    if (!from || !to || !from.uid || !to.uid) return null;
    if (this.conns.some((c) => c.from.node === from.uid && c.from.port === from.port && c.to.node === to.uid && c.to.port === to.port)) return null;
    const c = { uid: `cfl${(++this.linkSeq).toString(36)}`, from: { node: from.uid, port: from.port }, to: { node: to.uid, port: to.port } };
    this.conns.push(c); return c;
  }
  note(text) { if (!this.noted.has(text)) { this.noted.add(text); this.report.notes.push(text); } }
  mapped(n, protos, how = '') { this.report.mapped.push({ comfy: `${n.id} ${n.cls}${n.title && n.title !== n.cls ? ` "${n.title}"` : ''}`, proto: protos.map((p) => (typeof p === 'string' ? p : `${p.type} "${p.title}"`)), how }); }
  skip(n, reason) { this.report.skipped.push({ id: n.id, class: n.cls, reason }); }
  /* --- reading the graph --- */
  /** The link into `name` (or the input at `slot`), or null. */
  linkInto(n, name) {
    const inp = typeof name === 'number' ? n.inputs[name] : n.inputs.find((i) => i.name === name);
    return inp?.link ? this.G.links.get(inp.link) || null : null;
  }
  /** The source node + slot behind an input, or null. */
  source(n, name) { const L = this.linkInto(n, name); return L ? { node: this.G.nodes.get(L.from) || null, slot: L.fromSlot } : null; }
  /** A widget value: the node's own, or a PrimitiveNode's value when the input is linked to one. */
  widget(n, name, fallback) {
    const src = this.source(n, name);
    if (src?.node?.cls === 'PrimitiveNode') { this.consumed(src.node); return src.node.widgets.value ?? src.node.raw[0] ?? fallback; }
    const v = n.widgets[name]; return v === undefined || v === null ? fallback : v;
  }
  consumed(n) { if (!this.built.has(n.id)) { this.built.set(n.id, { outputs: {}, proto: [] }); this.report.mapped.push({ comfy: `${n.id} ${n.cls}`, proto: [], how: 'its value went into the linked param' }); } }
  /** Walk an input upstream through pass-through and silent classes until a predicate matches; returns that node (and the path) or null. */
  chain(n, name, pred, path = []) {
    let cur = this.source(n, name);
    for (let guard = 0; cur?.node && guard < 64; guard++) {
      const node = cur.node; path.push(node);
      if (pred(node, cur.slot)) return { node, slot: cur.slot, path };
      const rule = CLASS_MAP[node.cls];
      if (rule?.kind === 'pass') { const through = typeof rule.through === 'function' ? rule.through(node) : rule.through; cur = this.source(node, through); continue; }
      if (rule?.kind === 'node' && rule.build === buildControlNet) { cur = this.source(node, 'conditioning') || this.source(node, cur.slot === 1 ? 'negative' : 'positive'); continue; }
      if (rule?.kind === 'node' && rule.build === buildIPAdapter) { cur = this.source(node, 'model'); continue; }
      return null;
    }
    return null;
  }
  /** The Proto3D output `{ uid, port }` that carries a ComfyUI node's output slot (building it on demand; pass-throughs resolve upstream). */
  resolve(src, depth = 0) {
    if (!src?.node || depth > 64) return null;
    const { node, slot } = src;
    const rule = CLASS_MAP[node.cls];
    if (rule?.kind === 'pass') {
      const through = typeof rule.through === 'function' ? rule.through(node) : rule.through;
      if (rule.note) this.note(rule.note);
      const inner = this.source(node, through);
      // VAEDecode's images are the sampler's output; VAEEncode's latent is its pixels
      return this.resolve(inner, depth + 1);
    }
    if (rule?.kind === 'node' && rule.build === buildControlNet) { const inner = this.source(node, 'conditioning') || this.source(node, slot === 1 ? 'negative' : 'positive'); this.visit(node); return this.resolve(inner, depth + 1); }
    if (rule?.kind === 'node' && rule.build === buildIPAdapter) { this.visit(node); return this.resolve(this.source(node, 'model'), depth + 1); }
    this.visit(node);
    const b = this.built.get(node.id);
    return b?.outputs?.[slot] || b?.outputs?.[0] || null;
  }
  /** Build the Proto3D side of a node once. */
  visit(n) {
    if (this.built.has(n.id) || this.visiting.has(n.id)) return;
    this.visiting.add(n.id);
    const rule = CLASS_MAP[n.cls];
    let result = { outputs: {}, proto: [] };
    if (n.mode === 2) { const p = this.placeholder(n, `ComfyUI · ${n.cls} · muted`); result.proto = [p.uid]; this.skip(n, 'muted in ComfyUI (mode 2)'); }
    else if (!rule) { const p = this.placeholder(n, `ComfyUI · ${n.cls} · not supported`); result.proto = [p.uid]; this.skip(n, 'class not supported'); }
    else if (rule.kind === 'drop') this.skip(n, rule.reason);
    else if (rule.kind === 'silent' || rule.kind === 'pass') { /* read by the rules that consume it */ }
    else result = rule.build(this, n) || result;
    if (n.mode === 4) for (const uid of result.proto) { const rec = this.nodes.find((x) => x.uid === uid); if (rec) rec.enabled = false; }
    this.built.set(n.id, result);
    this.visiting.delete(n.id);
  }
  placeholder(n, text) {
    this.report.placeholders++;
    return this.add('sticky-note', { title: n.title || n.cls, params: { text: `${text}${n.title && n.title !== n.cls ? `\n${n.title}` : ''}${Object.keys(n.widgets).length ? `\n${Object.entries(n.widgets).slice(0, 4).map(([k, v]) => `${k}: ${String(v).slice(0, 24)}`).join(' · ')}` : ''}`, colour: '#f0a4a4', tilt: 0 }, at: n, hint: 'placeholder', comfy: n });
  }
  /* --- after every node --- */
  finish() {
    // one Run button into every generator (ComfyUI's Queue Prompt)
    if (this.generators.length) {
      const first = this.generators[0];
      const run = this.add('input', { title: 'Queue', params: { mode: 'button', label: 'Run' }, at: first._pos ? { pos: [first._pos[0] - 260, first._pos[1]] } : null, hint: 'run' });
      for (const g of this.generators) this.link({ uid: run.uid, port: 'trigger' }, { uid: g.uid, port: 'run' });
      this.note('A Run button (ComfyUI\'s Queue Prompt) was added into every generator\'s run input.');
    }
    // ComfyUI groups → Proto3D groups by bounding box
    for (const g of this.G.groups) {
      const [gx, gy, gw, gh] = g.bounding;
      const members = this.nodes.filter((r) => r._pos && r._pos[0] >= gx - 1 && r._pos[1] >= gy - 1 && r._pos[0] < gx + gw && r._pos[1] < gy + gh).map((r) => r.uid);
      if (members.length) this.groups.push({ uid: this.uid('group'), title: g.title, members, collapsed: false });
    }
    // every unbuilt node (a silent loader nobody read) is fine; a silent node that is not part of any mapping still counts as mapped-by-folding
    for (const n of this.G.nodes.values()) if (!this.built.has(n.id)) this.visit(n);
    const seen = new Set(this.report.mapped.map((m) => m.comfy.split(' ')[0]));
    for (const n of this.G.nodes.values()) if (!seen.has(n.id) && !this.report.skipped.some((s) => s.id === n.id)) { const r = CLASS_MAP[n.cls]; this.report.mapped.push({ comfy: `${n.id} ${n.cls}`, proto: [], how: r?.kind === 'pass' ? 'links pass through' : 'folded into the node that reads it' }); }
  }
  doc() {
    return {
      app: 'proto3d', version: FORMAT_VERSION, name: this.name, savedAt: new Date().toISOString(),
      nodes: this.nodes.map(({ _comfy, _pos, _size, ...rec }) => rec),
      connections: this.conns, groups: this.groups, wiring: true,
      comfy: { imported: new Date().toISOString(), nodes: this.G.nodes.size },
    };
  }
}

/* ------------------------------------------------------------------ */
/* builders (ctx, comfy node) → { outputs: { slot: { uid, port } }, proto: [uid] }             */
/* ------------------------------------------------------------------ */
const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fileTitle = (s) => String(s || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'image';
const outOf = (rec, port) => ({ uid: rec.uid, port });

function buildPrompt(ctx, n) {
  const text = n.cls === 'CLIPTextEncodeFlux' ? [ctx.widget(n, 'clip_l', ''), ctx.widget(n, 't5xxl', '')].filter(Boolean).join('\n') : n.cls === 'CLIPTextEncodeSDXL' ? [ctx.widget(n, 'text_g', ''), ctx.widget(n, 'text_l', '')].filter((v, i, a) => v && a.indexOf(v) === i).join('\n') : ctx.widget(n, 'text', '');
  const rec = ctx.add('prompt', { title: n.title || 'Prompt', params: { template: String(text ?? '') }, at: n, hint: 'prompt', comfy: n });
  ctx.mapped(n, [rec], 'the text is the template');
  return { outputs: { 0: outOf(rec, 'prompt') }, proto: [rec.uid] };
}
function buildNote(ctx, n) {
  const rec = ctx.add('sticky-note', { title: n.title || 'Note', params: { text: String(ctx.widget(n, 'text', n.raw[0] ?? '')), colour: '#f5d76e', tilt: -3 }, at: n, hint: 'note', comfy: n });
  ctx.mapped(n, [rec]);
  return { outputs: { 0: outOf(rec, 'text') }, proto: [rec.uid] };
}
function buildLoadImage(ctx, n) {
  const file = String(ctx.widget(n, 'image', 'image'));
  const media = ctx.add('media', { title: fileTitle(file), params: { mode: 'image', source: 'sample 1', title: fileTitle(file), url: '' }, at: n, hint: 'media', comfy: n });
  ctx.note(`Pick the file for "${fileTitle(file)}" (${file}): ComfyUI's input folder is not reachable — a sample stands in; choose, drop or paste the picture on the Media block.`);
  const out = { 0: outOf(media, 'media') }; const proto = [media.uid];
  if (n.outputs[1]?.links?.length) {   // its MASK output (1 where the picture is transparent) is used: a Mask from the alpha channel
    const mask = ctx.add('generate-mask', { title: `${fileTitle(file)} alpha`, params: { source: 'from image', channel: 'alpha', threshold: 0.5, invert: true }, at: n.pos ? { pos: [n.pos[0], n.pos[1] + 200] } : null, hint: 'mask', comfy: n });
    ctx.link(outOf(media, 'media'), { uid: mask.uid, port: 'image' });
    out[1] = outOf(mask, 'mask'); proto.push(mask.uid);
  }
  ctx.mapped(n, proto.map((u) => ctx.nodes.find((r) => r.uid === u)), 'a sample stands in for the file');
  return { outputs: out, proto };
}
function buildLoadImageMask(ctx, n) {
  const file = String(ctx.widget(n, 'image', 'mask')); const ch = String(ctx.widget(n, 'channel', 'alpha'));
  const media = ctx.add('media', { title: fileTitle(file), params: { mode: 'image', source: 'sample 1', title: fileTitle(file) }, at: n, hint: 'media', comfy: n });
  const mask = ctx.add('generate-mask', { title: n.title || `${fileTitle(file)} mask`, params: { source: 'from image', channel: ch === 'alpha' ? 'alpha' : 'luminance', threshold: 0.5, invert: ch === 'alpha' }, at: n.pos ? { pos: [n.pos[0] + 330, n.pos[1]] } : null, hint: 'mask', comfy: n });
  ctx.link(outOf(media, 'media'), { uid: mask.uid, port: 'image' });
  ctx.note(`Pick the file for "${fileTitle(file)}" (${file}): ComfyUI's input folder is not reachable — a sample stands in.`);
  ctx.mapped(n, [media, mask], `mask from the ${ch} channel`);
  return { outputs: { 0: outOf(mask, 'mask') }, proto: [media.uid, mask.uid] };
}
function buildLoadAudio(ctx, n) {
  const file = String(ctx.widget(n, 'audio', 'audio'));
  const media = ctx.add('media', { title: fileTitle(file), params: { mode: 'audio', source: 'sample 1', title: fileTitle(file) }, at: n, hint: 'media', comfy: n });
  ctx.note(`Pick the file for "${fileTitle(file)}" (${file}): ComfyUI's input folder is not reachable — a sample stands in.`);
  ctx.mapped(n, [media]);
  return { outputs: { 0: outOf(media, 'media') }, proto: [media.uid] };
}
function buildSave(ctx, n) {
  const prefix = ctx.widget(n, 'filename_prefix', n.cls === 'PreviewImage' ? 'Preview' : 'ComfyUI');
  const grid = ctx.add('media-grid', { title: String(prefix || 'Output').split('/').pop(), params: {}, at: n, hint: 'grid', comfy: n });
  const src = ctx.resolve(ctx.source(n, 'images') || ctx.source(n, 'audio') || ctx.source(n, 0));
  if (src) ctx.link(src, { uid: grid.uid, port: 'items' });
  ctx.mapped(n, [grid], 'the gallery shows the output');
  return { outputs: {}, proto: [grid.uid] };
}
/** The sampler: settings + generator; reads the latent chain (size, count, img2img guide, inpaint mask), the model chain (checkpoint, LoRA), the conditioning (prompts, guides). */
function buildSampler(ctx, n) {
  const custom = n.cls === 'SamplerCustom' || n.cls === 'SamplerCustomAdvanced';
  const adv = n.cls === 'KSamplerAdvanced';
  // sampling numbers
  let seed = ctx.widget(n, adv || custom ? 'noise_seed' : 'seed', null), control = ctx.widget(n, 'control_after_generate', 'fixed'), steps = ctx.widget(n, 'steps', 20), cfg = ctx.widget(n, 'cfg', 7), sampler = ctx.widget(n, 'sampler_name', ''), scheduler = ctx.widget(n, 'scheduler', ''), denoise = ctx.widget(n, 'denoise', 1);
  if (n.cls === 'SamplerCustomAdvanced') {
    const noise = ctx.source(n, 'noise')?.node, sel = ctx.source(n, 'sampler')?.node, sig = ctx.source(n, 'sigmas')?.node, guider = ctx.source(n, 'guider')?.node;
    if (noise) { seed = ctx.widget(noise, 'noise_seed', null); control = ctx.widget(noise, 'control_after_generate', 'fixed'); }
    if (sel) sampler = ctx.widget(sel, 'sampler_name', '');
    if (sig) { scheduler = ctx.widget(sig, 'scheduler', ''); steps = ctx.widget(sig, 'steps', 20); denoise = ctx.widget(sig, 'denoise', 1); }
    if (guider?.cls === 'CFGGuider') cfg = ctx.widget(guider, 'cfg', 7);
    n._guider = guider;
  } else if (custom) { const sel = ctx.source(n, 'sampler')?.node, sig = ctx.source(n, 'sigmas')?.node; if (sel) sampler = ctx.widget(sel, 'sampler_name', ''); if (sig) { scheduler = ctx.widget(sig, 'scheduler', ''); steps = ctx.widget(sig, 'steps', 20); denoise = ctx.widget(sig, 'denoise', 1); } }
  // conditioning: positive / negative prompts (through ControlNet applies, FluxGuidance, combines)
  const guider = n._guider;
  const posSrc = guider ? ctx.source(guider, 'conditioning') || ctx.source(guider, 'positive') : ctx.source(n, 'positive');
  const negSrc = guider ? ctx.source(guider, 'negative') : ctx.source(n, 'negative');
  const flux = ctx.chain(guider || n, guider ? 'conditioning' : 'positive', (x) => x.cls === 'FluxGuidance');
  if (flux) cfg = ctx.widget(flux.node, 'guidance', cfg);
  // model chain: checkpoint name, LoRAs
  const modelInput = guider ? { node: guider, name: 'model' } : { node: n, name: 'model' };
  const ck = ctx.chain(modelInput.node, modelInput.name, (x) => ['CheckpointLoaderSimple', 'UNETLoader', 'ImageOnlyCheckpointLoader'].includes(x.cls));
  const ckName = ck ? fileTitle(ctx.widget(ck.node, ck.node.cls === 'UNETLoader' ? 'unet_name' : 'ckpt_name', '')) : '';
  const loras = (ck?.path || []).filter((x) => x.cls === 'LoraLoader' || x.cls === 'LoraLoaderModelOnly');
  const video = !!ck && ck.node.cls === 'ImageOnlyCheckpointLoader' || (ck?.path || []).some((x) => /AnimateDiff|VideoLinearCFG/.test(x.cls)) || !!ctx.chain(n, 'positive', (x) => x.cls === 'SVD_img2vid_Conditioning');
  // latent chain: size / count, an img2img guide, an inpaint mask, a previous sampler as reference
  const latentName = custom ? 'latent_image' : 'latent_image';
  let size = null, count = 1, guideRec = null, maskSrc = null, refSrc = null;
  const latentPath = [];
  ctx.chain(n, latentName, () => false, latentPath);
  for (const x of latentPath) {
    if (['EmptyLatentImage', 'EmptySD3LatentImage'].includes(x.cls)) { size = { w: num(ctx.widget(x, 'width'), 1024), h: num(ctx.widget(x, 'height'), 1024) }; count = clamp(Math.round(num(ctx.widget(x, 'batch_size'), 1)), 1, 4); break; }
    if (x.cls === 'SVD_img2vid_Conditioning') { size = { w: num(ctx.widget(x, 'width'), 1024), h: num(ctx.widget(x, 'height'), 576) }; break; }
    if (x.cls === 'SetLatentNoiseMask' && !maskSrc) maskSrc = ctx.resolve(ctx.source(x, 'mask'));
    if (x.cls === 'VAEEncodeForInpaint') { if (!maskSrc) maskSrc = ctx.resolve(ctx.source(x, 'mask')); const pix = ctx.resolve(ctx.source(x, 'pixels')); if (pix) refSrc = pix; break; }
    if (x.cls === 'VAEEncode' || x.cls === 'VAEEncodeTiled') { const pix = ctx.resolve(ctx.source(x, 'pixels')); if (pix) { guideRec = { src: pix, strength: clamp(num(denoise, 1), 0, 1) }; refSrc = pix; } break; }
    if (CLASS_MAP[x.cls]?.build === buildSampler) { ctx.visit(x); const prev = ctx.built.get(x.id)?.outputs?.[0]; if (prev) { refSrc = prev; guideRec = { src: prev, strength: clamp(num(denoise, 1), 0, 1) }; ctx.note(`${x.cls} ${x.id} feeds ${n.cls} ${n.id}: the second pass takes the first's image as reference and an image-to-image guide.`); } break; }
    if (x.cls === 'LatentUpscale') { size = { w: num(ctx.widget(x, 'width'), 1024), h: num(ctx.widget(x, 'height'), 1024) }; }
  }
  const preset = size ? presetFor(size) : 'square';
  // Settings
  const settings = ctx.add('generate-settings', {
    title: n.title && n.title !== n.cls ? `${n.title} settings` : 'Settings', at: n.pos ? { pos: [n.pos[0], n.pos[1] - 190] } : null, hint: 'settings', comfy: n,
    params: { preset, width: size?.w || 1024, height: size?.h || 1024, steps: clamp(Math.round(num(steps, 20)), 1, 150), guidance: clamp(num(cfg, 7), 0, 30), strength: clamp(num(denoise, 1), 0, 1), seed: seed === null || seed === undefined || seed === '' ? '' : String(Math.max(0, Math.round(num(seed, 0)))), seedMode: ['fixed', 'increment', 'decrement', 'randomize', 'random'].includes(String(control)) ? String(control).replace('randomize', 'random') : 'fixed', count, loraUrl: loras.length ? String(ctx.widget(loras[0], 'lora_name', '')) : '', loraScale: loras.length ? clamp(num(ctx.widget(loras[0], 'strength_model'), 1), 0, 2) : 1, stylePrefix: '' },
  });
  if (loras.length > 1) ctx.note(`${loras.length} LoRAs on ${n.cls} ${n.id}: Settings takes the first (${ctx.widget(loras[0], 'lora_name', '')}); the others are dropped.`);
  // Generate
  const kind = video ? 'video' : 'image';
  const gen = ctx.add(`generate-${kind}`, { title: n.title && n.title !== n.cls ? n.title : ckName ? `Render · ${ckName}` : video ? 'Render video' : 'Render', at: n, hint: kind, comfy: n, params: { provider: 'demo', model: video ? 'demo/director' : 'demo/painter', note: [sampler && `sampler ${sampler}`, scheduler && `scheduler ${scheduler}`, ckName && `checkpoint ${ckName}`].filter(Boolean).join(' · ') } });
  ctx.generators.push(gen);
  ctx.link(outOf(settings, 'settings'), { uid: gen.uid, port: 'settings' });
  const pos = ctx.resolve(posSrc); if (pos) ctx.link(pos, { uid: gen.uid, port: 'prompt' });
  const neg = ctx.resolve(negSrc); if (neg && neg.uid !== pos?.uid) ctx.link(neg, { uid: gen.uid, port: 'negative' });
  // guides hanging on the conditioning / model chains (ControlNet applies, IP-Adapters) were built while resolving; wire them
  for (const src of [posSrc, negSrc, modelInput.node === n ? ctx.source(n, 'model') : ctx.source(guider, 'model')]) for (const g of ctx.guidesOn(src)) ctx.link(g, { uid: gen.uid, port: 'guides' });
  if (guideRec) {
    const guide = ctx.add('generate-guide', { title: 'Image to image', params: { mode: 'image to image', strength: guideRec.strength }, at: n.pos ? { pos: [n.pos[0] - 340, n.pos[1] + 120] } : null, hint: 'guide', comfy: n });
    ctx.link(guideRec.src, { uid: guide.uid, port: 'image' }); ctx.link(outOf(guide, 'guide'), { uid: gen.uid, port: 'guides' });
    ctx.report.mapped.push({ comfy: `${n.id} ${n.cls} (latent from pixels)`, proto: [`generate-guide "${guide.title}"`], how: 'VAEEncode → an image-to-image guide with the sampler\'s denoise as strength' });
  }
  if (refSrc && kind === 'image') ctx.link(refSrc, { uid: gen.uid, port: 'reference' });
  if (maskSrc && kind === 'image') ctx.link(maskSrc, { uid: gen.uid, port: 'mask' });
  ctx.mapped(n, [settings, gen], `seed ${seed ?? 'random'} · ${steps} steps · cfg ${cfg} · denoise ${denoise}${size ? ` · ${size.w}×${size.h}` : ''}`);
  return { outputs: { 0: outOf(gen, 'media'), 1: outOf(gen, 'media') }, proto: [settings.uid, gen.uid] };
}
function presetFor({ w, h }) {
  const r = w / h;
  const table = [['square', 1], ['portrait 3:4', 3 / 4], ['portrait 9:16', 9 / 16], ['landscape 4:3', 4 / 3], ['landscape 16:9', 16 / 9]];
  const best = table.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
  return Math.abs(best[1] - r) < 0.04 ? best[0] : 'custom';
}
/** Guides (ControlNet / IP-Adapter applies) on a chain: resolved while walking, returned as `{ uid, port }` outputs to wire into `guides`. */
Ctx.prototype.guidesOn = function guidesOn(src) {
  const out = [];
  let cur = src;
  for (let guard = 0; cur?.node && guard < 64; guard++) {
    const node = cur.node; const rule = CLASS_MAP[node.cls];
    if (rule?.build === buildControlNet || rule?.build === buildIPAdapter) { this.visit(node); const b = this.built.get(node.id); if (b?.guide) out.push(b.guide); cur = this.source(node, rule.build === buildIPAdapter ? 'model' : 'conditioning') || this.source(node, cur.slot === 1 ? 'negative' : 'positive'); continue; }
    if (rule?.kind === 'pass') { const through = typeof rule.through === 'function' ? rule.through(node) : rule.through; cur = this.source(node, through); continue; }
    break;
  }
  return out;
};
const GUIDE_MODE_BY_NAME = [[/canny|lineart|scribble|hed|softedge|sketch|mlsd/i, 'edges'], [/depth|zoe|midas|normal/i, 'depth'], [/pose|dwpose|openpose/i, 'pose'], [/ipadapter|ip-adapter|style|redux/i, 'style reference'], [/tile|inpaint|i2i|img2img/i, 'image to image']];
function guideMode(...names) { for (const s of names) { const str = String(s || ''); for (const [re, mode] of GUIDE_MODE_BY_NAME) if (re.test(str)) return mode; } return null; }
function buildControlNet(ctx, n) {
  const cn = ctx.source(n, 'control_net')?.node;
  const cnName = cn ? String(ctx.widget(cn, 'control_net_name', '')) : '';
  // the image: the picture *before* any preprocessor / Canny (Proto3D traces edges itself, the endpoint estimates depth and pose); a preprocessor feeding only this apply is folded into the guide
  let src = ctx.source(n, 'image'), pre = null;
  for (let guard = 0; src?.node && (/Preprocessor/.test(src.node.cls) || src.node.cls === 'Canny') && guard < 8; guard++) { pre = pre || src.node; src = ctx.source(src.node, 'image'); }
  const mode = guideMode(pre?.cls, cnName, n.title) || 'edges';
  if (!guideMode(pre?.cls, cnName, n.title)) ctx.note(`ControlNet "${cnName || n.id}": the model name says nothing about its kind — the guide is set to edges; change it in the panel.`);
  const guide = ctx.add('generate-guide', { title: n.title && n.title !== n.cls ? n.title : `ControlNet ${mode}`, params: { mode, strength: clamp(num(ctx.widget(n, 'strength'), 1), 0, 1) }, at: n, hint: 'guide', comfy: n });
  const img = ctx.resolve(src);
  if (img) ctx.link(img, { uid: guide.uid, port: 'image' });
  if (pre) {
    const single = pre.outputs.every((o) => o.links.length <= 1) && pre.outputs.reduce((a, o) => a + o.links.length, 0) === 1;
    if (single && !ctx.built.has(pre.id)) ctx.built.set(pre.id, { outputs: { 0: outOf(guide, 'guide') }, proto: [] });   // folded: no guide of its own
    ctx.report.mapped.push({ comfy: `${pre.id} ${pre.cls}`, proto: [`generate-guide "${guide.title}"`], how: single ? 'the preprocessor is the guide\'s mode' : 'the preprocessor is the guide\'s mode (it also feeds other nodes and keeps its own guide)' });
  }
  ctx.mapped(n, [guide], `${mode} · strength ${ctx.widget(n, 'strength', 1)}${cnName ? ` · ${cnName}` : ''}`);
  return { outputs: {}, proto: [guide.uid], guide: outOf(guide, 'guide') };
}
function buildIPAdapter(ctx, n) {
  const guide = ctx.add('generate-guide', { title: n.title && n.title !== n.cls ? n.title : 'Style reference', params: { mode: 'style reference', strength: clamp(num(ctx.widget(n, 'weight'), 1), 0, 1) }, at: n, hint: 'guide', comfy: n });
  const img = ctx.resolve(ctx.source(n, 'image'));
  if (img) ctx.link(img, { uid: guide.uid, port: 'image' });
  ctx.mapped(n, [guide], `style reference · weight ${ctx.widget(n, 'weight', 1)}`);
  return { outputs: {}, proto: [guide.uid], guide: outOf(guide, 'guide') };
}
function buildCannyGuide(ctx, n) {
  const guide = ctx.add('generate-guide', { title: n.title || 'Edges', params: { mode: 'edges', strength: 0.7 }, at: n, hint: 'guide', comfy: n });
  const img = ctx.resolve(ctx.source(n, 'image'));
  if (img) ctx.link(img, { uid: guide.uid, port: 'image' });
  ctx.mapped(n, [guide], 'Canny → an edges guide (the browser traces the edges)');
  return { outputs: { 0: outOf(guide, 'guide') }, proto: [guide.uid], guide: outOf(guide, 'guide'), image: img };
}
const BLEND = { normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', soft_light: 'overlay', difference: 'normal' };
function buildImageEdit(ctx, n) {
  let mode, params = {}, how = '';
  const A = ctx.resolve(ctx.source(n, 'image') || ctx.source(n, 'image1') || ctx.source(n, 'destination') || ctx.source(n, 0));
  let B = null, M = null;
  switch (n.cls) {
    case 'ImageScale': { const crop = ctx.widget(n, 'crop', 'disabled'); mode = 'resize'; params = { width: Math.round(num(ctx.widget(n, 'width'), 1024)), height: Math.round(num(ctx.widget(n, 'height'), 1024)), keepAspect: false, fit: crop === 'center' ? 'cover' : 'stretch' }; how = `${params.width}×${params.height}`; break; }
    case 'ImageScaleBy': { const k = num(ctx.widget(n, 'scale_by'), 1); mode = 'resize'; params = { width: Math.round(1024 * k), height: Math.round(1024 * k), keepAspect: true, fit: 'cover' }; how = `×${k} (on a 1024 px base — keep aspect)`; ctx.note(`ImageScaleBy ${n.id}: the source size is unknown here, so ×${k} became ${params.width} px wide with keep-aspect on; adjust the width if the source differs.`); break; }
    case 'ImageCrop': { const w = num(ctx.widget(n, 'width'), 512), h = num(ctx.widget(n, 'height'), 512), x = num(ctx.widget(n, 'x'), 0), y = num(ctx.widget(n, 'y'), 0); mode = 'crop'; params = { cx: clamp(x / 1024, 0, 1), cy: clamp(y / 1024, 0, 1), cw: clamp(w / 1024, 0, 1), ch: clamp(h / 1024, 0, 1) }; how = `${w}×${h} at ${x},${y} as fractions of 1024`; ctx.note(`ImageCrop ${n.id}: pixel values became fractions of a 1024 px frame; adjust them if the source differs.`); break; }
    case 'ImagePadForOutpaint': { mode = 'pad'; params = { padL: num(ctx.widget(n, 'left'), 0), padT: num(ctx.widget(n, 'top'), 0), padR: num(ctx.widget(n, 'right'), 0), padB: num(ctx.widget(n, 'bottom'), 0), transparent: true, fill: '#ffffff' }; how = 'transparent pad (outpaint canvas)'; break; }
    case 'ImageBlend': { mode = 'blend'; params = { opacity: clamp(num(ctx.widget(n, 'blend_factor'), 0.5), 0, 1), blend: BLEND[String(ctx.widget(n, 'blend_mode', 'normal'))] || 'normal' }; B = ctx.resolve(ctx.source(n, 'image2')); how = `${params.blend} · ${params.opacity}`; break; }
    case 'ImageCompositeMasked': { mode = 'composite'; B = ctx.resolve(ctx.source(n, 'source')); M = ctx.resolve(ctx.source(n, 'mask')); how = 'B over A through the mask'; break; }
    case 'ImageInvert': mode = 'invert'; break;
    case 'ImageBlur': { mode = 'adjust'; params = { brightness: 1, contrast: 1, saturation: 1, blur: clamp(num(ctx.widget(n, 'blur_radius'), 1), 0, 50), sharpen: 0 }; how = `blur ${params.blur} px`; break; }
    case 'ImageSharpen': { mode = 'adjust'; params = { brightness: 1, contrast: 1, saturation: 1, blur: 0, sharpen: clamp(num(ctx.widget(n, 'alpha'), 1) / 2, 0, 1) }; how = `sharpen ${params.sharpen}`; break; }
    default: mode = 'grayscale';
  }
  const rec = ctx.add('image-edit', { title: n.title && n.title !== n.cls ? n.title : n.cls.replace(/^Image/, 'Image '), params: { mode, ...params }, at: n, hint: 'edit', comfy: n });
  if (A) ctx.link(A, { uid: rec.uid, port: 'image' });
  if (B) ctx.link(B, { uid: rec.uid, port: 'imageB' });
  if (M) ctx.link(M, { uid: rec.uid, port: 'mask' });
  ctx.mapped(n, [rec], `${mode}${how ? ` · ${how}` : ''}`);
  return { outputs: { 0: outOf(rec, 'image'), 1: outOf(rec, 'image') }, proto: [rec.uid] };
}
function buildSolidMask(ctx, n) {
  const v = num(ctx.widget(n, 'value'), 1);
  const rec = ctx.add('generate-mask', { title: n.title || 'Solid mask', params: { source: 'solid', invert: v < 0.5 }, at: n, hint: 'mask', comfy: n });
  ctx.mapped(n, [rec], `solid ${v}`);
  return { outputs: { 0: outOf(rec, 'mask') }, proto: [rec.uid], mask: rec };
}
function buildImageToMask(ctx, n) {
  const ch = String(ctx.widget(n, 'channel', 'red'));
  const rec = ctx.add('generate-mask', { title: n.title || 'Image to mask', params: { source: 'from image', channel: ch === 'alpha' ? 'alpha' : 'luminance', threshold: 0.5 }, at: n, hint: 'mask', comfy: n });
  const img = ctx.resolve(ctx.source(n, 'image'));
  if (img) ctx.link(img, { uid: rec.uid, port: 'image' });
  ctx.mapped(n, [rec], `${ch} channel → luminance threshold`);
  return { outputs: { 0: outOf(rec, 'mask') }, proto: [rec.uid], mask: rec };
}
/** InvertMask / GrowMask / FeatherMask / ThresholdMask fold onto the Mask node upstream (or make one from an image). */
function buildMaskOp(ctx, n) {
  const src = ctx.source(n, 'mask');
  const up = ctx.resolve(src);
  let mask = up ? ctx.nodes.find((r) => r.uid === up.uid && r.type === 'generate-mask') : null;
  if (!mask) {
    mask = ctx.add('generate-mask', { title: n.title || 'Mask', params: { source: up ? 'from image' : 'solid', channel: 'luminance', threshold: 0.5 }, at: n, hint: 'mask', comfy: n });
    if (up) ctx.link(up, { uid: mask.uid, port: 'image' });
  }
  const P = mask.params;
  switch (n.cls) {
    case 'InvertMask': P.invert = !P.invert; break;
    case 'GrowMask': P.grow = clamp(Math.round((P.grow || 0) + num(ctx.widget(n, 'expand'), 0)), -64, 64); break;
    case 'FeatherMask': { const f = ['left', 'top', 'right', 'bottom'].map((k) => num(ctx.widget(n, k), 0)); P.feather = clamp(Math.round((P.feather || 0) + f.reduce((a, b) => a + b, 0) / 4), 0, 64); break; }
    case 'ThresholdMask': P.threshold = clamp(num(ctx.widget(n, 'value'), 0.5), 0, 1); break;
    default: break;
  }
  ctx.mapped(n, [mask], `folded onto the Mask (${n.cls.replace(/Mask$/, '').toLowerCase()})`);
  return { outputs: { 0: outOf(mask, 'mask') }, proto: [], mask };
}
function buildEnhance(ctx, n) {
  const um = ctx.source(n, 'upscale_model')?.node;
  const modelName = um ? String(ctx.widget(um, 'model_name', '')) : '';
  const m = /(?:^|[^0-9])([248])x|x([248])(?:[^0-9]|$)/i.exec(modelName);
  const scale = m ? (m[1] || m[2]) : '2';
  const rec = ctx.add('enhance', { title: n.title && n.title !== n.cls ? n.title : modelName ? `Upscale · ${fileTitle(modelName)}` : 'Upscale', params: { task: 'upscale', scale: scale === '8' ? '4' : scale, provider: 'browser', autoRun: true }, at: n, hint: 'enhance', comfy: n });
  const img = ctx.resolve(ctx.source(n, 'image'));
  if (img) ctx.link(img, { uid: rec.uid, port: 'image' });
  if (scale === '8') ctx.note(`${modelName}: ×8 is not offered; the Enhance is set to ×4.`);
  ctx.mapped(n, [rec], `upscale ×${rec.params.scale} in the browser${modelName ? ` (model ${modelName})` : ''}`);
  return { outputs: { 0: outOf(rec, 'media') }, proto: [rec.uid] };
}
