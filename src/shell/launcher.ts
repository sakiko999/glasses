import type { Rect } from '@/math/types';
import type { AppManifest } from '@/app/types';
import { defaultGlassMaterial, defaultWindowShape } from '@/engine/glass/material';
import type { OverlayRect } from '@/engine/layers';
import { rectContains } from '@/math/rect';

export interface LauncherItemHit {
  appId: string;
}

/**
 * Floating glass launcher panel (overlay, not a full app window).
 */
export class Launcher {
  open = false;
  private bounds: Rect = { x: 0, y: 0, width: 360, height: 280 };
  private items: AppManifest[] = [];
  private contentTexture: GPUTexture | null = null;
  private readonly itemRects: { appId: string; rect: Rect }[] = [];

  setApps(list: AppManifest[]): void {
    this.items = list;
  }

  setContentTexture(tex: GPUTexture | null): void {
    this.contentTexture = tex;
  }

  toggle(viewportW: number, viewportH: number): void {
    this.open = !this.open;
    if (this.open) this.layout(viewportW, viewportH);
  }

  show(viewportW: number, viewportH: number): void {
    this.open = true;
    this.layout(viewportW, viewportH);
  }

  hide(): void {
    this.open = false;
  }

  layout(viewportW: number, viewportH: number): void {
    const width = 380;
    const rowH = 52;
    const height = Math.min(420, 72 + this.items.length * rowH + 24);
    this.bounds = {
      x: (viewportW - width) * 0.5,
      y: (viewportH - height) * 0.42,
      width,
      height,
    };
    this.itemRects.length = 0;
    let y = this.bounds.y + 64;
    for (const app of this.items) {
      this.itemRects.push({
        appId: app.id,
        rect: {
          x: this.bounds.x + 20,
          y,
          width: this.bounds.width - 40,
          height: rowH - 8,
        },
      });
      y += rowH;
    }
  }

  getBounds(): Rect {
    return this.bounds;
  }

  hitTest(x: number, y: number): LauncherItemHit | 'panel' | null {
    if (!this.open) return null;
    if (!rectContains(this.bounds, { x, y })) return null;
    for (const item of this.itemRects) {
      if (rectContains(item.rect, { x, y })) return { appId: item.appId };
    }
    return 'panel';
  }

  /** Draw launcher content into a 2D context (logical pixels). */
  paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, dpr: number): void {
    const w = this.bounds.width;
    const h = this.bounds.height;
    ctx.clearRect(0, 0, w, h);

    // Soft inner fill (glass handles exterior)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
    roundRect(ctx, 0, 0, w, h, 20);
    ctx.fill();

    ctx.fillStyle = 'rgba(24, 26, 32, 0.9)';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('启动器', 24, 36);
    ctx.fillStyle = 'rgba(52, 58, 70, 0.65)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('选择应用以打开玻璃窗口', 24, 54);

    let y = 64;
    const rowH = 52;
    for (const app of this.items) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      roundRect(ctx, 20, y, w - 40, rowH - 8, 12);
      ctx.fill();

      ctx.fillStyle = 'rgba(45, 79, 216, 0.22)';
      roundRect(ctx, 32, y + 8, 28, 28, 8);
      ctx.fill();

      ctx.fillStyle = 'rgba(24, 26, 32, 0.92)';
      ctx.font = '16px "Segoe UI", system-ui, sans-serif';
      const icon = app.icon ?? '◇';
      ctx.fillText(icon, 38, y + 28);

      ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(app.name, 72, y + 22);
      ctx.fillStyle = 'rgba(52, 58, 70, 0.55)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(app.id, 72, y + 38);
      y += rowH;
    }

    void dpr;
  }

  toOverlay(): OverlayRect | null {
    if (!this.open) return null;
    return {
      id: 'launcher',
      bounds: this.bounds,
      opacity: 1,
      material: defaultGlassMaterial({
        thickness: 22,
        roughness: 0.1,
        liquidity: 0.18,
        edgeBoost: 1.5,
        dispersion: 0.4,
      }),
      shape: defaultWindowShape(20),
      contentTexture: this.contentTexture,
      titleBarHeight: 0,
      shadowStrength: 0.9,
    };
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
