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

export interface PlatformHost {
  clock: PlatformClock;
  surface: PlatformSurface;
  input: PlatformInput;
  createGpu(): Promise<GpuContext>;
}
