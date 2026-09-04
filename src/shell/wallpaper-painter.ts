import type { PaintSurface } from '@/platform/types';

/**
 * Canvas2D poster-style wallpaper.
 *
 * Glass refraction/dispersion reads best over high-contrast type on light
 * paper (see docs/liquid-glass.md), so the default wallpaper is a typographic
 * poster: big serif headline, thin accent rules, monospace captions.
 *
 * Takes a platform PaintSurface whose context is already dpr-scaled.
 */
export function paintPosterWallpaper(
  surface: PaintSurface,
  width: number,
  height: number,
): void {
  const c = surface.getContext2D();
  c.clearRect(0, 0, width, height);

  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const ink = '#1a1b20';
  const blue = '#2b4fd8';
  const muted = 'rgba(26, 27, 32, 0.52)';
  const mono = `'SF Mono', ui-monospace, Menlo, Consolas, monospace`;
  const serif = `Georgia, 'Times New Roman', serif`;

  // Paper with a gentle vertical falloff
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#f5f3ed');
  bg.addColorStop(1, '#e9e6de');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  // Accent geometry: two thin circles + a diagonal rule
  c.strokeStyle = blue;
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(w * 0.72, h * 0.4, h * 0.3, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 1;
  c.beginPath();
  c.arc(w * 0.18, h * 0.74, h * 0.16, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.moveTo(w * 0.06, h * 0.88);
  c.lineTo(w * 0.94, h * 0.1);
  c.stroke();

  // Small registration crosses
  c.lineWidth = 1;
  for (const [cx, cy] of [
    [w * 0.32, h * 0.14],
    [w * 0.86, h * 0.78],
  ] as const) {
    c.beginPath();
    c.moveTo(cx - 5, cy);
    c.lineTo(cx + 5, cy);
    c.moveTo(cx, cy - 5);
    c.lineTo(cx, cy + 5);
    c.stroke();
  }

  // Headline — big serif, centered
  c.fillStyle = ink;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const big = Math.min(h * 0.26, w * 0.21);
  c.font = `700 ${big}px ${serif}`;
  c.fillText('GLASS', w * 0.5, h * 0.36);
  c.fillText('FORM', w * 0.5, h * 0.63);

  // Italic date row
  c.font = `italic 600 ${Math.max(18, h * 0.06)}px ${serif}`;
  c.fillText('7.13 — 8.22', w * 0.5, h * 0.87);

  // Corner captions
  c.font = `11px ${mono}`;
  c.fillStyle = muted;
  c.textAlign = 'left';
  c.fillText('LIQUID GLASS ENGINE', 18, 26);
  c.fillText('SNELL / FRESNEL / DISPERSION', 18, 44);
  c.textAlign = 'right';
  c.fillText('WEBGPU · TYPESCRIPT', w - 18, 26);
  c.fillText('AFTER A POSTER BY YAAN.DESIGN', w - 18, 44);

  // Bottom-left name list (poster roster rhythm)
  c.textAlign = 'left';
  c.fillStyle = ink;
  const roster = ['SNELL', 'FRESNEL', 'IOR 1.52', 'BEER-LAMBERT'];
  roster.forEach((s, i) => {
    c.fillText(s, 18, h - 72 + i * 18);
  });

  // Bottom-right Japanese accent
  c.textAlign = 'right';
  c.fillStyle = muted;
  c.fillText('液体ガラス', w - 18, h - 20);
}
