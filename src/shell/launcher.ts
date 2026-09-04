import type { Rect } from '@/math/types';
import type { AppManifest } from '@/app/types';
import { defaultGlassMaterial, defaultWindowShape } from '@/engine/glass/material';
import type { OverlayRect } from '@/engine/layers';
import type { PaintContext } from '@/platform/types';
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
  private hovered: string | null = null;
  private readonly itemRects: { appId: string; rect: Rect }[] = [];

  setApps(list: AppManifest[]): void {
    this.items = list;
  }

  /** Track pointer hover for row highlight; returns true when it changed. */
  setHovered(appId: string | null): boolean {
    if (this.hovered === appId) return false;
    this.hovered = appId;
    return true;
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
    const height = Math.min(460, 96 + this.items.length * rowH + 22);
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

  /**
   * Draw launcher ink into a 2D context (logical px). Legibility first:
   * the glass substrate is already the showpiece, so rows get a near-opaque
   * "paper" card with hairline borders, solid accent icon chips and a
   * strong hover state — the ink must read over any wallpaper.
   */
  paint(ctx: PaintContext, dpr: number): void {
    const w = this.bounds.width;
    const h = this.bounds.height;
    ctx.clearRect(0, 0, w, h);

    // Header
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(24, 26, 32, 0.92)';
    ctx.font = '600 17px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('启动器', 24, 34);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(24, 26, 32, 0.45)';
    ctx.font = '10.5px ui-monospace, monospace';
    ctx.fillText(`${this.items.length} 个应用`, w - 24, 33);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(52, 58, 70, 0.62)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('选择应用以打开玻璃窗口', 24, 52);

    // Header hairline
    ctx.strokeStyle = 'rgba(24, 26, 32, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, 62.5);
    ctx.lineTo(w - 20, 62.5);
    ctx.stroke();

    // Rows
    let y = 64;
    const rowH = 52;
    for (const app of this.items) {
      const hoveredRow = app.id === this.hovered;

      // Paper card: near-opaque so entries read over any backdrop
      ctx.fillStyle = hoveredRow ? 'rgba(253, 253, 251, 0.85)' : 'rgba(250, 250, 248, 0.6)';
      roundRect(ctx, 20, y, w - 40, rowH - 8, 12);
      ctx.fill();
      ctx.strokeStyle = hoveredRow ? 'rgba(37, 72, 201, 0.6)' : 'rgba(24, 26, 32, 0.14)';
      ctx.lineWidth = hoveredRow ? 1.5 : 1;
      ctx.stroke();

      // Icon chip: solid accent anchor
      ctx.fillStyle = hoveredRow ? 'rgba(31, 51, 122, 0.95)' : 'rgba(37, 72, 201, 0.84)';
      roundRect(ctx, 30, y + 8, 28, 28, 9);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = '14px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(app.icon ?? '◇', 44, y + 27);
      ctx.textAlign = 'left';

      ctx.fillStyle = 'rgba(24, 26, 32, 0.94)';
      ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(app.name, 70, y + 22);
      ctx.fillStyle = 'rgba(52, 58, 70, 0.58)';
      ctx.font = '10.5px ui-monospace, monospace';
      ctx.fillText(app.id, 70, y + 37);

      if (hoveredRow) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(24, 40, 96, 0.85)';
        ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
        ctx.fillText('›', w - 34, y + 28);
        ctx.textAlign = 'left';
      }
      y += rowH;
    }

    // Footer hint
    const fy = h - 14.5;
    ctx.strokeStyle = 'rgba(24, 26, 32, 0.1)';
    ctx.beginPath();
    ctx.moveTo(20, fy - 12.5);
    ctx.lineTo(w - 20, fy - 12.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(24, 26, 32, 0.42)';
    ctx.font = '10.5px ui-monospace, monospace';
    ctx.fillText('点击启动 · ` 或 Esc 关闭', 24, fy);

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
  ctx: PaintContext,
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
