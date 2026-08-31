import type { ContentSurface } from './types';

export interface ContentSurfaceHost {
  onInvalidate(id: string): void;
  uploadContent(id: string, canvas: OffscreenCanvas | HTMLCanvasElement): void;
}

/**
 * Offscreen canvas surface for app content → GPU texture upload.
 */
export class OffscreenContentSurface implements ContentSurface {
  readonly id: string;
  private _width: number;
  private _height: number;
  private _dpr: number;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private readonly host: ContentSurfaceHost;
  private dirty = true;

  constructor(
    id: string,
    width: number,
    height: number,
    dpr: number,
    host: ContentSurfaceHost,
  ) {
    this.id = id;
    this._width = Math.max(1, Math.floor(width));
    this._height = Math.max(1, Math.floor(height));
    this._dpr = dpr;
    this.host = host;
    this.canvas = new OffscreenCanvas(
      Math.max(1, Math.floor(this._width * dpr)),
      Math.max(1, Math.floor(this._height * dpr)),
    );
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D 不可用');
    this.ctx = ctx;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get dpr(): number {
    return this._dpr;
  }

  get2D(): OffscreenCanvasRenderingContext2D {
    return this.ctx;
  }

  invalidate(): void {
    this.dirty = true;
    this.host.onInvalidate(this.id);
  }

  isDirty(): boolean {
    return this.dirty;
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this._width && h === this._height && dpr === this._dpr) return;
    this._width = w;
    this._height = h;
    this._dpr = dpr;
    this.canvas = new OffscreenCanvas(
      Math.max(1, Math.floor(w * dpr)),
      Math.max(1, Math.floor(h * dpr)),
    );
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D 不可用');
    this.ctx = ctx;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidate();
  }

  /** Called by shell after app onRender */
  commit(): void {
    this.dirty = false;
    this.host.uploadContent(this.id, this.canvas);
  }

  getCanvas(): OffscreenCanvas {
    return this.canvas;
  }
}
