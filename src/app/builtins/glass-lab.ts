import type { AppModule, AppContext, ControlSpec } from '../types';
import type { PaintContext } from '@/platform/types';
import type { GlassMaterial, GlassPreset } from '@/engine/glass/material';
import { GLASS_PRESETS } from '@/engine/glass/material';
import type { PointerEventLike } from '@/platform/types';

interface Slider {
  key: keyof GlassMaterial | 'controlIntensity';
  label: string;
  min: number;
  max: number;
  step: number;
  y: number;
}

const SLIDERS: Omit<Slider, 'y'>[] = [
  { key: 'ior', label: 'IOR 折射率', min: 1.1, max: 1.9, step: 0.01 },
  { key: 'thickness', label: '厚度', min: 6, max: 60, step: 0.5 },
  { key: 'curvature', label: '顶部平坦度', min: 0.6, max: 5, step: 0.05 },
  { key: 'sceneDistance', label: '折射幅度', min: 100, max: 1200, step: 10 },
  { key: 'dispersion', label: '色散', min: 0, max: 0.3, step: 0.005 },
  { key: 'milkiness', label: '奶白磨砂', min: 0, max: 1, step: 0.01 },
  { key: 'roughness', label: '粗糙度', min: 0, max: 0.85, step: 0.01 },
  { key: 'specular', label: '反射', min: 0, max: 1.6, step: 0.01 },
  { key: 'edgeBoost', label: '边缘透镜', min: 0.4, max: 2.5, step: 0.01 },
  { key: 'liquidity', label: '液态扰动', min: 0, max: 1, step: 0.01 },
  { key: 'liquidSpeed', label: '液态速度', min: 0, max: 1.5, step: 0.01 },
  { key: 'transmission', label: '透射', min: 0.4, max: 1, step: 0.01 },
  { key: 'absorption', label: '吸收', min: 0, max: 0.25, step: 0.005 },
  // Self-hosted: this control glassifies the very controls it sits on
  { key: 'controlIntensity', label: '控件玻璃强度', min: 0, max: 1, step: 0.01 },
];

const PRESET_TOP = 62;
const PRESET_H = 30;
const SLIDER_TOP = 116;
const SLIDER_H = 34;

export interface GlassLabBridge {
  getMaterial(): GlassMaterial;
  setMaterial(m: GlassMaterial): void;
  /** When true, material applies to focused window; else global default for new windows */
  applyToFocused: boolean;
  getControlIntensity(): number;
  setControlIntensity(v: number): void;
}

export function createGlassLabApp(bridge: GlassLabBridge): AppModule {
  return {
    manifest: {
      id: 'builtin.glass-lab',
      name: 'Glass Lab',
      icon: '🔬',
      defaultSize: { width: 420, height: 660 },
      singleton: true,
    },
    create(ctx) {
      let material = { ...bridge.getMaterial() };
      let drag: { key: Slider['key']; min: number; max: number } | null = null;
      const matchPreset = (m: GlassMaterial): GlassPreset['id'] | null => {
        const json = JSON.stringify(m);
        return GLASS_PRESETS.find((p) => JSON.stringify(p.material) === json)?.id ?? null;
      };
      let activePreset: GlassPreset['id'] | null = matchPreset(material);
      let hoveredId: string | null = null;
      let pressedId: string | null = null;
      const pad = 20;

      const sliders: Slider[] = SLIDERS.map((s, i) => ({
        ...s,
        y: SLIDER_TOP + i * SLIDER_H,
      }));

      const valueOf = (key: Slider['key']): number => {
        if (key === 'controlIntensity') return bridge.getControlIntensity();
        const v = material[key];
        return typeof v === 'number' ? v : 0;
      };

      const setValue = (key: Slider['key'], v: number) => {
        if (key === 'controlIntensity') {
          bridge.setControlIntensity(v);
        } else {
          (material as Record<string, unknown>)[key] = v;
          activePreset = null;
          bridge.setMaterial({ ...material });
        }
        ctx.content.invalidate();
      };

      const hitSlider = (x: number, y: number) => {
        const w = ctx.content.width;
        for (const s of sliders) {
          if (y >= s.y && y <= s.y + 26 && x >= pad && x <= w - pad) return s;
        }
        return null;
      };

      const hitPreset = (x: number, y: number): GlassPreset | null => {
        const w = ctx.content.width;
        for (let i = 0; i < GLASS_PRESETS.length; i++) {
          const r = presetRectAt(i, w, pad);
          if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
            return GLASS_PRESETS[i] ?? null;
          }
        }
        return null;
      };

      const applyPointer = (e: PointerEventLike) => {
        const x = e.position.x;
        const y = e.position.y;
        if (e.phase === 'down') {
          const preset = hitPreset(x, y);
          if (preset) {
            material = { ...preset.material, tint: { ...preset.material.tint } };
            activePreset = preset.id;
            pressedId = `preset-${preset.id}`;
            bridge.setMaterial({ ...material });
            ctx.content.invalidate();
            e.preventDefault();
            return;
          }
          const s = hitSlider(x, y);
          if (s) {
            drag = { key: s.key, min: s.min, max: s.max };
            pressedId = `slider-${String(s.key)}`;
            const t = Math.min(1, Math.max(0, (x - pad) / (ctx.content.width - pad * 2)));
            const v = s.min + t * (s.max - s.min);
            setValue(s.key, Math.round(v / s.step) * s.step);
            e.preventDefault();
          }
        } else if (e.phase === 'move') {
          if (drag && e.buttons) {
            const t = Math.min(1, Math.max(0, (x - pad) / (ctx.content.width - pad * 2)));
            const v = drag.min + t * (drag.max - drag.min);
            const step = SLIDERS.find((s) => s.key === drag!.key)?.step ?? 0.01;
            setValue(drag.key, Math.round(v / step) * step);
            e.preventDefault();
          }
          // Hover tracking (also while dragging — the grab stays "pressed")
          const hSlider = hitSlider(x, y);
          const hPreset = hSlider ? null : hitPreset(x, y);
          const nextHover = hSlider
            ? `slider-${String(hSlider.key)}`
            : hPreset
              ? `preset-${hPreset.id}`
              : null;
          if (nextHover !== hoveredId) {
            hoveredId = nextHover;
            ctx.content.invalidate();
          }
        } else if (e.phase === 'up' || e.phase === 'cancel') {
          drag = null;
          pressedId = null;
          ctx.content.invalidate();
        }
      };

      /** Control rects for the GPU glass tier (content-local coords). */
      const controlSpecs = (): ControlSpec[] => {
        const w = ctx.content.width;
        const specs: ControlSpec[] = [];
        for (let i = 0; i < GLASS_PRESETS.length; i++) {
          const p = GLASS_PRESETS[i]!;
          const r = presetRectAt(i, w, pad);
          const id = `preset-${p.id}`;
          specs.push({
            id,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            hovered: hoveredId === id,
            pressed: pressedId === id,
          });
        }
        for (const s of sliders) {
          const id = `slider-${String(s.key)}`;
          // Capsule hugs the track + knob only (labels stay outside on the
          // window film); knob center y = s.y + 19 sits at the capsule mid.
          specs.push({
            id,
            x: pad,
            y: s.y + 11,
            width: w - pad * 2,
            height: 16,
            hovered: hoveredId === id,
            pressed: pressedId === id,
          });
        }
        return specs;
      };

      return {
        onMount() {
          ctx.window.setTitle('Glass Lab');
          material = { ...bridge.getMaterial() };
          ctx.content.invalidate();
        },
        onUpdate() {
          // sync if external — re-match the preset instead of clearing, so
          // an externally-set stock material still shows its active button
          const ext = bridge.getMaterial();
          if (JSON.stringify(ext) !== JSON.stringify(material)) {
            material = { ...ext };
            activePreset = matchPreset(material);
            ctx.content.invalidate();
          }
        },
        onPointer(e) {
          applyPointer(e);
        },
        onRender(surface) {
          paintLab(ctx, surface.get2D(), material, sliders, pad, activePreset, valueOf);
          ctx.setControls(controlSpecs());
        },
        onDispose() {},
      };
    },
  };
}

function formatValue(step: number, v: number): string {
  if (step >= 1) return v.toFixed(0);
  if (step >= 0.01) return v.toFixed(2);
  return v.toFixed(3);
}

function paintLab(
  ctx: AppContext,
  c: PaintContext,
  material: GlassMaterial,
  sliders: Slider[],
  pad: number,
  activePreset: GlassPreset['id'] | null,
  getValue: (key: Slider['key']) => number,
): void {
  const w = ctx.content.width;
  const h = ctx.content.height;
  c.clearRect(0, 0, w, h);

  c.fillStyle = ctx.theme.text;
  c.font = `600 18px ${ctx.theme.fontUi}`;
  c.fillText('液态玻璃参数', pad, 28);
  c.fillStyle = ctx.theme.textMuted;
  c.font = `12px ${ctx.theme.fontUi}`;
  c.fillText('预设一键切换 · 滑条实时作用于当前焦点窗口', pad, 48);

  // Preset buttons — glass substrate is drawn by the GPU control tier;
  // here only the ink: label + hairline + active accent tint.
  for (let i = 0; i < GLASS_PRESETS.length; i++) {
    const p = GLASS_PRESETS[i]!;
    const r = presetRectAt(i, w, pad);
    const active = p.id === activePreset;
    round(c, r.x + 0.75, r.y + 0.75, r.width - 1.5, r.height - 1.5, 8.5);
    if (active) {
      // Solid ink-blue fill reads through the glass; white type on top
      c.fillStyle = 'rgba(31, 51, 122, 0.62)';
      c.fill();
      c.strokeStyle = 'rgba(37, 72, 201, 0.9)';
      c.lineWidth = 1.5;
    } else {
      c.strokeStyle = 'rgba(24, 26, 32, 0.28)';
      c.lineWidth = 1;
    }
    c.stroke();
    c.fillStyle = active ? 'rgba(255, 255, 255, 0.97)' : ctx.theme.text;
    c.font = `600 13px ${ctx.theme.fontUi}`;
    c.textAlign = 'center';
    c.fillText(p.label, r.x + r.width * 0.5, r.y + 19);
    c.textAlign = 'left';
  }

  for (const s of sliders) {
    const val = getValue(s.key);
    const t = (val - s.min) / (s.max - s.min);
    const trackW = w - pad * 2;
    const cy = s.y + 19; // capsule axis (capsule covers s.y+11..s.y+27)
    const kx = pad + trackW * t;

    c.fillStyle = 'rgba(24, 26, 32, 0.85)';
    c.font = `12px ${ctx.theme.fontUi}`;
    c.fillText(s.label, pad, s.y + 7);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(24, 40, 96, 0.9)';
    c.font = `11px ${ctx.theme.fontMono}`;
    c.fillText(formatValue(s.step, val), w - pad, s.y + 7);
    c.textAlign = 'left';

    // Glass tube wall: a faint inner outline so the capsule reads as a
    // physical tube on bright backgrounds
    c.strokeStyle = 'rgba(24, 26, 32, 0.13)';
    c.lineWidth = 1;
    round(c, pad + 0.5, s.y + 11.5, trackW - 1, 15, 7.5);
    c.stroke();

    // Mercury column: a rounded capsule of liquid metal floating well
    // inside the glass tube (padding on every side) — both ends convex,
    // mirror shading with a directional sheen. It only appears when there is
    // liquid to show: at t≈0 just the bead blob; from t>0 the column grows
    // from the bucket to the fill line.
    const half = 4;
    const colX1 = pad + 7;
    const colX2 = Math.max(kx, colX1 + half + 2);
    if (t > 0.002) {
      const colGrad = c.createLinearGradient(0, cy - half, 0, cy + half);
      colGrad.addColorStop(0, 'rgba(52, 58, 70, 1)');
      colGrad.addColorStop(0.14, 'rgba(196, 202, 212, 1)');
      colGrad.addColorStop(0.3, '#ffffff');
      colGrad.addColorStop(0.42, 'rgba(214, 219, 227, 1)');
      colGrad.addColorStop(0.68, 'rgba(148, 155, 168, 1)');
      colGrad.addColorStop(0.88, 'rgba(84, 90, 103, 1)');
      colGrad.addColorStop(1, 'rgba(40, 45, 56, 1)');
      c.fillStyle = colGrad;
      c.beginPath();
      c.arc(colX1, cy, half, Math.PI / 2, -Math.PI / 2);
      c.arc(colX2, cy, half, -Math.PI / 2, Math.PI / 2);
      c.closePath();
      c.fill();
      // Directional sheen: environment falls off toward the right end
      const sheen = c.createLinearGradient(colX1, 0, colX2, 0);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
      sheen.addColorStop(1, 'rgba(60, 66, 80, 0.12)');
      c.fillStyle = sheen;
      c.fill();
      c.strokeStyle = 'rgba(30, 35, 45, 0.55)';
      c.lineWidth = 0.8;
      c.stroke();
    }

    // Meniscus bead at the fill line — the drag handle
    const beadX = Math.max(colX1 + 2, kx);
    paintMetalBall(c, beadX, cy, 7.5);
  }

  // Hint
  c.fillStyle = ctx.theme.textMuted;
  c.font = `12px ${ctx.theme.fontUi}`;
  c.textAlign = 'center';
  c.fillText('清水 / 海报 / 浓磨砂 · 曲面液态玻璃', w * 0.5, h - 16);
  c.textAlign = 'left';
}

function presetRectAt(i: number, w: number, pad: number) {
  const gap = 8;
  const bw = (w - pad * 2 - gap * (GLASS_PRESETS.length - 1)) / GLASS_PRESETS.length;
  return {
    x: pad + i * (bw + gap),
    y: PRESET_TOP,
    width: bw,
    height: PRESET_H,
  };
}

/** Polished mercury ball: hard radial metal shading, rim, specular dot. */
function paintMetalBall(
  c: PaintContext,
  x: number,
  y: number,
  r: number,
): void {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.12, x, y, r * 1.05);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.4, '#ccd2db');
  g.addColorStop(0.75, '#878e9b');
  g.addColorStop(1, '#525866');
  c.save();
  c.shadowColor = 'rgba(20, 24, 34, 0.4)';
  c.shadowBlur = 5;
  c.shadowOffsetY = 1;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = g;
  c.fill();
  c.restore();
  c.strokeStyle = 'rgba(36, 42, 54, 0.55)';
  c.lineWidth = 0.9;
  c.stroke();
  c.beginPath();
  c.arc(x - r * 0.35, y - r * 0.42, r * 0.2, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255, 255, 255, 0.95)';
  c.fill();
}

function round(
  c: PaintContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  c.beginPath();
  c.moveTo(x + radius, y);
  c.arcTo(x + w, y, x + w, y + h, radius);
  c.arcTo(x + w, y + h, x, y + h, radius);
  c.arcTo(x, y + h, x, y, radius);
  c.arcTo(x, y, x + w, y, radius);
  c.closePath();
}

export function resetMaterial(): GlassMaterial {
  return GLASS_PRESETS[0]!.material;
}
