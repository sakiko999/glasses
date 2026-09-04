import type { PaintSurface } from '../types';

/**
 * Web PaintSurface: an OffscreenCanvas wrapper whose 2D context is
 * pre-scaled by dpr, so consumers always draw in logical px. A native port
 * implements the same interface over a Skia/Cairo surface.
 */
export function createOffscreenPaintSurface(
  width: number,
  height: number,
  dpr: number,
): PaintSurface {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.floor(w * dpr)),
    Math.max(1, Math.floor(h * dpr)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D 不可用');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    width: w,
    height: h,
    devicePixelRatio: dpr,
    getContext2D: () => ctx,
    blitInto(dest, dx, dy, dw, dh) {
      dest.drawImage(canvas, 0, 0, canvas.width, canvas.height, dx, dy, dw, dh);
    },
    backend: canvas,
  };
}
