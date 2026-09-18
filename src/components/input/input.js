// Input — where interaction enters the graph: a tappable button, a toggle, a keyboard key, a
// timer or a slider. The face is live: clicking / dragging it in 3D drives the outputs.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, drawText, roundRect } from '../../faces.js';
import { num } from '../util.js';

const keyListeners = new WeakMap();
const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
const keyMatches = (e, name) => { const k = String(name || '').trim().toLowerCase(); return k === 'space' ? e.key === ' ' : e.key.toLowerCase() === k || e.code.toLowerCase() === k; };

export default registry.register({
  id: 'input', category: 'input', label: 'Input', icon: icons.input, size: 'M',
  description: 'Button, toggle, key, timer or slider — tap it in 3D',
  outputs: [{ key: 'trigger', label: 'trigger', type: 'event' }, { key: 'value', label: 'value', type: 'any' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['button', 'toggle', 'key', 'timer', 'slider'], default: 'button' },
    { key: 'label', label: 'label', type: 'text', default: 'Tap' },
    { key: 'key', label: 'key name', type: 'text', default: 'Space' },
    { key: 'interval', label: 'interval (s)', type: 'number', default: 1, min: 0.1, max: 60, step: 0.1 },
    { key: 'value', label: 'slider value', type: 'number', default: 0.5, step: 0.01 },
    { key: 'min', label: 'slider min', type: 'number', default: 0 },
    { key: 'max', label: 'slider max', type: 'number', default: 1 },
  ],
  onCreate(instance) {
    const fn = (e) => {
      if (instance.params.mode !== 'key' || isTyping(e) || e.repeat || !instance.world) return;
      if (keyMatches(e, instance.params.key)) { instance.state.count = (instance.state.count || 0) + 1; instance.state.pressedAt = performance.now(); instance.emit('trigger', instance.state.count); instance.faceDirty = true; }
    };
    window.addEventListener('keydown', fn);
    keyListeners.set(instance, fn);
  },
  onDestroy(instance) { const fn = keyListeners.get(instance); if (fn) window.removeEventListener('keydown', fn); },
  evaluate({ params, state, time, dt, emit }) {
    switch (params.mode) {
      case 'toggle': return { value: !!state.on };
      case 'timer': {
        state.acc = (state.acc || 0) + dt;
        if (state.acc >= params.interval) { state.acc = 0; state.count = (state.count || 0) + 1; emit('trigger', state.count); }
        return { value: state.count || 0 };
      }
      case 'slider': return { value: state.slider ?? params.value };
      default: return { value: state.count || 0 };
    }
  },
  footer: ({ params, outputs }) => `${params.mode} · ${params.mode === 'slider' ? (outputs.value ?? 0).toFixed(2) : params.mode === 'toggle' ? (outputs.value ? 'on' : 'off') : `${outputs.value ?? 0}×`}`,
  face: {
    live: true, fps: 12,
    render(g, w, h, { params, state, time }) {
      clear(g, w, h);
      const pressed = state.pressedAt && performance.now() - state.pressedAt < 160;
      const acc = palette.faceAccent;
      switch (params.mode) {
        case 'toggle': {
          const on = !!state.on; const tw = Math.min(w * 0.5, 220), th = tw * 0.42;
          g.fillStyle = on ? acc : palette.faceCard; roundRect(g, (w - tw) / 2, (h - th) / 2, tw, th, th / 2); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.arc((w - tw) / 2 + (on ? tw - th / 2 : th / 2), h / 2, th * 0.4, 0, Math.PI * 2); g.fill();
          drawText(g, on ? 'ON' : 'OFF', 0, h / 2 + th / 2, w, h / 2 - th / 2, { size: 22, weight: 600, color: palette.faceDim });
          break;
        }
        case 'key': {
          const kw = Math.min(w * 0.55, 240), kh = Math.min(h * 0.5, 110);
          g.fillStyle = pressed ? acc : palette.faceCard; roundRect(g, (w - kw) / 2, (h - kh) / 2 - 10, kw, kh, 14); g.fill();
          drawText(g, params.key, (w - kw) / 2, (h - kh) / 2 - 10, kw, kh, { size: 40, weight: 700, mono: true, color: pressed ? '#fff' : palette.faceText });
          drawText(g, `press ${params.key} · ${state.count || 0}×`, 0, h - 40, w, 32, { size: 18, color: palette.faceDim });
          break;
        }
        case 'timer': {
          const r = Math.min(w, h) * 0.3; const p = Math.min(1, (state.acc || 0) / params.interval);
          g.strokeStyle = palette.faceCard; g.lineWidth = r * 0.22; g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = acc; g.beginPath(); g.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
          drawText(g, String(state.count || 0), w / 2 - r, h / 2 - r, 2 * r, 2 * r, { size: r * 0.9, weight: 700, mono: true });
          drawText(g, `every ${params.interval}s`, 0, h - 36, w, 30, { size: 18, color: palette.faceDim });
          break;
        }
        case 'slider': {
          const v = state.slider ?? params.value; const lo = params.min, hi = params.max;
          const t = hi === lo ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
          const x0 = 30, x1 = w - 30, y = h * 0.62;
          g.strokeStyle = palette.faceCard; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
          g.strokeStyle = acc; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (x1 - x0) * t, y); g.stroke();
          g.fillStyle = '#fff'; g.beginPath(); g.arc(x0 + (x1 - x0) * t, y, 16, 0, Math.PI * 2); g.fill();
          drawText(g, (+v).toFixed(2), 0, 10, w, h * 0.4, { size: 44, weight: 700, mono: true });
          break;
        }
        default: {
          const bw = Math.min(w * 0.7, 300), bh = Math.min(h * 0.55, 120);
          g.fillStyle = pressed ? '#fff' : acc; roundRect(g, (w - bw) / 2, (h - bh) / 2 - 8, bw, bh, 22); g.fill();
          drawText(g, params.label || 'Tap', (w - bw) / 2, (h - bh) / 2 - 8, bw, bh, { size: 40, weight: 700, color: pressed ? acc : '#fff' });
          drawText(g, `${state.count || 0} presses`, 0, h - 36, w, 30, { size: 18, color: palette.faceDim });
        }
      }
    },
    onPointer({ params, state, instance }, ev) {
      switch (params.mode) {
        case 'button':
          if (ev.type !== 'click') return false;
          state.count = (state.count || 0) + 1; state.pressedAt = performance.now(); instance.emit('trigger', state.count); return true;
        case 'toggle':
          if (ev.type !== 'click') return false;
          state.on = !state.on; instance.emit('trigger', state.on); return true;
        case 'slider': {
          if (ev.type !== 'down' && ev.type !== 'drag' && ev.type !== 'up') return false;
          const t = Math.min(1, Math.max(0, (ev.u - 30 / instance.face.canvas.width) / (1 - 60 / instance.face.canvas.width)));
          state.slider = +(params.min + (params.max - params.min) * t).toFixed(3);
          if (ev.type === 'up') instance.emit('trigger', state.slider);
          return true;
        }
        default: return false; // key & timer are not pointer-driven
      }
    },
  },
});
