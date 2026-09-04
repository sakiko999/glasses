import type { Vec2 } from '@/math/types';

export interface PlatformClock {
  now(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(id: number): void;
}

export interface PlatformSurface {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  configure(device: GPUDevice, format: GPUTextureFormat): void;
  getCurrentTexture(): GPUTexture;
  onResize(cb: () => void): () => void;
  resizeToDisplay(): boolean;
}

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

export interface PointerEventLike {
  id: number;
  phase: PointerPhase;
  position: Vec2;
  delta: Vec2;
  buttons: number;
  pressure: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** True if this is a synthetic double-click on up/down */
  detail: number;
  preventDefault(): void;
}

export interface KeyEventLike {
  phase: 'down' | 'up';
  key: string;
  code: string;
  repeat: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
}

export interface PlatformInput {
  onPointer(cb: (e: PointerEventLike) => void): () => void;
  onKey(cb: (e: KeyEventLike) => void): () => void;
}

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
}

/**
 * Canvas2D-shaped drawing context, as a type alias rather than a structural
 * interface: the Canvas2D API is the app-painting contract by decision
 * (docs/app-system.md) and is emulatable on any native 2D stack (Skia/Cairo).
 */
export type PaintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Platform-owned 2D painting surface (web: an OffscreenCanvas wrapper).
 * Constructed ONLY via PlatformHost.createPaintSurface — app and shell code
 * must never construct a canvas themselves; that factory is the portability
 * seam. `backend` is opaque and exists solely for the platform's own pixel
 * upload path; all other consumers go through the typed methods.
 */
export interface PaintSurface {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  getContext2D(): PaintContext;
  /** Blit this surface's full backing store into another paint context. */
  blitInto(dest: PaintContext, dx: number, dy: number, dw: number, dh: number): void;
  readonly backend: unknown;
}

export interface PlatformHost {
  clock: PlatformClock;
  surface: PlatformSurface;
  input: PlatformInput;
  /** Offscreen 2D surface factory — the ONLY sanctioned way to get one. */
  createPaintSurface(width: number, height: number, dpr: number): PaintSurface;
  createGpu(): Promise<GpuContext>;
}
