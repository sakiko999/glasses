import type { ContentSurface } from './types';
import type { PaintContext, PaintSurface } from '@/platform/types';

export interface ContentSurfaceHost {
  onInvalidate(id: string): void;
  uploadContent(id: string, surface: PaintSurface): void;
  /** Platform surface factory — the portability seam (see PlatformHost). */
  createSurface(width: number, height: number, dpr: number): PaintSurface;
}

/**
 * Canvas-shaped surface for app content → GPU texture upload. The backing
 * store comes from the platform factory; this class owns only the lifecycle
 * (size, dpr transform, dirty tracking, commit).
 */
export class CanvasContentSurface implements ContentSurface {
  readonly id: string;
  private _width: number;
  private _height: number;
  private _dpr: number;
  private surface: PaintSurface;
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
    this.surface = host.createSurface(this._width, this._height, dpr);
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

  get2D(): PaintContext {
    return this.surface.getContext2D();
  }

  /** The backing PaintSurface — for shell-side texture upload only. */
  get paintSurface(): PaintSurface {
    return this.surface;
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
    this.surface = this.host.createSurface(w, h, dpr);
    this.invalidate();
  }

  /** Called by shell after app onRender */
  commit(): void {
    this.dirty = false;
    this.host.uploadContent(this.id, this.surface);
  }
}
