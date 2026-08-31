import type { AppModule, AppContext } from '../types';
import type { GlassMaterial, GlassPreset } from '@/engine/glass/material';
import { GLASS_PRESETS } from '@/engine/glass/material';
import type { PointerEventLike } from '@/platform/types';

interface Slider {
  key: keyof GlassMaterial;
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
      let drag: { key: keyof GlassMaterial; min: number; max: number } | null = null;
      let activePreset: GlassPreset['id'] | null = null;
      const pad = 20;

      const sliders: Slider[] = SLIDERS.map((s, i) => ({
        ...s,
        y: SLIDER_TOP + i * SLIDER_H,
      }));

      const valueOf = (key: keyof GlassMaterial): number => {
        const v = material[key];
        return typeof v === 'number' ? v : 0;
      };

      const setValue = (key: keyof GlassMaterial, v: number) => {
        (material as Record<string, unknown>)[key] = v;
        activePreset = null;
        bridge.setMaterial({ ...material });
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
            bridge.setMaterial({ ...material });
            ctx.content.invalidate();
            e.preventDefault();
            return;
          }
          const s = hitSlider(x, y);
          if (s) {
            drag = { key: s.key, min: s.min, max: s.max };
            const t = Math.min(1, Math.max(0, (x - pad) / (ctx.content.width - pad * 2)));
            const v = s.min + t * (s.max - s.min);
            setValue(s.key, Math.round(v / s.step) * s.step);
            e.preventDefault();
          }
        } else if (e.phase === 'move' && drag && e.buttons) {
          const t = Math.min(1, Math.max(0, (x - pad) / (ctx.content.width - pad * 2)));
          const v = drag.min + t * (drag.max - drag.min);
          const step = SLIDERS.find((s) => s.key === drag!.key)?.step ?? 0.01;
          setValue(drag.key, Math.round(v / step) * step);
          e.preventDefault();
        } else if (e.phase === 'up' || e.phase === 'cancel') {
          drag = null;
        }
      };

      return {
        onMount() {
          ctx.window.setTitle('Glass Lab');
          material = { ...bridge.getMaterial() };
          ctx.content.invalidate();
        },
        onUpdate() {
          // sync if external
          const ext = bridge.getMaterial();
          if (JSON.stringify(ext) !== JSON.stringify(material)) {
            material = { ...ext };
            activePreset = null;
            ctx.content.invalidate();
          }
        },
        onPointer(e) {
          applyPointer(e);
        },
        onRender(surface) {
          paintLab(ctx, surface.get2D(), material, sliders, pad, activePreset);
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
  c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  material: GlassMaterial,
  sliders: Slider[],
  pad: number,
  activePreset: GlassPreset['id'] | null,
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

  // Preset buttons
  for (let i = 0; i < GLASS_PRESETS.length; i++) {
    const p = GLASS_PRESETS[i]!;
    const r = presetRectAt(i, w, pad);
    const active = p.id === activePreset;
    c.fillStyle = active ? 'rgba(45, 79, 216, 0.3)' : 'rgba(15, 23, 42, 0.1)';
    round(c, r.x, r.y, r.width, r.height, 9);
    c.fill();
    c.fillStyle = active ? ctx.theme.text : ctx.theme.textMuted;
    c.font = `600 13px ${ctx.theme.fontUi}`;
    c.textAlign = 'center';
    c.fillText(p.label, r.x + r.width * 0.5, r.y + 19);
    c.textAlign = 'left';
  }

  for (const s of sliders) {
    const val = typeof material[s.key] === 'number' ? (material[s.key] as number) : 0;
    const t = (val - s.min) / (s.max - s.min);
    const trackW = w - pad * 2;
    const trackY = s.y + 14;

    c.fillStyle = ctx.theme.textMuted;
    c.font = `12px ${ctx.theme.fontUi}`;
    c.fillText(s.label, pad, s.y + 9);
    c.textAlign = 'right';
    c.fillStyle = ctx.theme.accent;
    c.font = `11px ${ctx.theme.fontMono}`;
    c.fillText(formatValue(s.step, val), w - pad, s.y + 9);
    c.textAlign = 'left';

    c.fillStyle = 'rgba(15, 23, 42, 0.16)';
    round(c, pad, trackY, trackW, 6, 3);
    c.fill();

    c.fillStyle = 'rgba(70, 105, 225, 0.55)';
    round(c, pad, trackY, Math.max(6, trackW * t), 6, 3);
    c.fill();

    const kx = pad + trackW * t;
    c.beginPath();
    c.arc(kx, trackY + 3, 7, 0, Math.PI * 2);
    c.fillStyle = 'rgba(252, 252, 250, 0.98)';
    c.fill();
    c.strokeStyle = 'rgba(24, 26, 32, 0.4)';
    c.lineWidth = 1;
    c.stroke();
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

function round(
  c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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
