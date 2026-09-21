// sizing.js — how big a hub-page card is and where its page frame sits. Pure, shared by the node
// body (nodes.js), the CSS3D live layer (live-layer.js) and the flows (flows.js).
//
// The card is "the width of the page": the iframe renders the page at its natural CSS width for
// the device (desktop 1280 px, tablet 1024 px, phone 390 px, or a custom width) and is scaled so
// that width fills the card's frame exactly. The card's height then decides how much of the page
// is visible: a global embed height (the slider, `setEmbedHeight`) unless the card's own `height`
// param overrides it. Face canvases are 120 logical px per unit (sizes.face.pxPerUnit).
export const PX = 120;
export const PAGE_WIDTHS = Object.freeze({ desktop: 1280, tablet: 1024, phone: 390 });
export const CARD_WIDTHS = Object.freeze({ desktop: 8.6, tablet: 7.0, phone: 3.4 });
export const ASPECTS = Object.freeze(['device', 'desktop', 'tablet', 'phone', 'custom']);
export const DEFAULT_EMBED_HEIGHT = 8;
export const EMBED_HEIGHT = Object.freeze({ min: 4, max: 14, step: 0.5 });
/** Card body: title band above the face, margin around the face, slab depth, corner radius. */
export const CARD = Object.freeze({ header: 0.46, pad: 0.1, depth: 0.16, radius: 0.3, minWidth: 2.8, maxWidth: 16, minHeight: 3, maxHeight: 16 });
/** Face px: the route / status strip at the top, the margin around the frame, the phone bezel. */
export const FACE = Object.freeze({ strip: 30, margin: 8, bezelX: 10, bezelY: 14, radius: 14 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let globalHeight = DEFAULT_EMBED_HEIGHT;
export const embedHeight = () => globalHeight;
export function setEmbedHeight(h) { const v = +h; globalHeight = Number.isFinite(v) && v > 0 ? clamp(v, EMBED_HEIGHT.min, EMBED_HEIGHT.max) : DEFAULT_EMBED_HEIGHT; return globalHeight; }

/** The page's CSS width in px for a card's params (`aspect` preset, `pageWidth` for custom, else the device). */
export function pageWidthOf(params = {}) {
  const a = ASPECTS.includes(params.aspect) ? params.aspect : 'device';
  if (a === 'custom') return clamp(Math.round(+params.pageWidth) || PAGE_WIDTHS.desktop, 240, 2560);
  if (a !== 'device') return PAGE_WIDTHS[a];
  return PAGE_WIDTHS[params.device] || PAGE_WIDTHS.desktop;
}
/** How the frame is drawn: a phone bezel for narrow pages, a plain browser frame otherwise. */
export const kindOf = (params = {}) => (pageWidthOf(params) <= 520 ? 'phone' : pageWidthOf(params) <= 1100 ? 'tablet' : 'desktop');

/** Card body size in world units for a hub-page's params: width from the page width, height from the card or the global setting. */
export function cardDims(params = {}, H = globalHeight) {
  const p = params && !Array.isArray(params) ? params : {};   // a definition's `params` is the spec array: use the defaults
  const a = ASPECTS.includes(p.aspect) ? p.aspect : 'device';
  const kind = kindOf(p);
  const width = a === 'custom' ? clamp(pageWidthOf(p) * 0.75 / PX + 0.6, CARD.minWidth, CARD.maxWidth) : CARD_WIDTHS[kind];
  const own = +p.height;
  const height = clamp(Number.isFinite(own) && own > 0 ? own : H, CARD.minHeight, CARD.maxHeight);
  return { width: +width.toFixed(3), height: +height.toFixed(3), depth: CARD.depth, kind, pageW: pageWidthOf(p) };
}
/** The face plane inside the card: full width minus the margin, everything under the title band. */
export function faceSize(dims) { return { w: +(dims.width - 2 * CARD.pad).toFixed(3), h: +(dims.height - CARD.header - 2 * CARD.pad).toFixed(3) }; }

/**
 * Where things sit on a face of `cw × ch` logical px: the strip (route · chips · status), the frame,
 * the screen the page fills (the whole frame, or the inside of a phone bezel) and the iframe's CSS
 * size + scale so its width fills the screen exactly and its height equals the screen's at that scale.
 * `element` is the rect the live DOM element covers (= screen).
 */
export function faceLayout(params = {}, cw, ch) {
  const kind = kindOf(params), pageW = pageWidthOf(params);
  const strip = { x: 0, y: 0, w: cw, h: FACE.strip };
  const frame = { x: FACE.margin, y: FACE.strip + 4, w: cw - 2 * FACE.margin, h: ch - FACE.strip - 4 - FACE.margin };
  let screen = frame, bezel = null;
  if (kind === 'phone') {
    bezel = { ...frame };
    screen = { x: frame.x + FACE.bezelX, y: frame.y + FACE.bezelY, w: frame.w - 2 * FACE.bezelX, h: frame.h - 2 * FACE.bezelY };
  }
  const scale = screen.w / pageW;
  const iframe = { w: pageW, h: Math.max(1, Math.round(screen.h / scale)) };
  return { kind, pageW, strip, frame, screen, bezel, iframe, scale, element: screen };
}
