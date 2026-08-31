import type { Rect } from '@/math/types';
import type { GlassMaterial, RoundedRectShape } from './glass/material';

export type LayerId = string;

export interface Layer {
  id: LayerId;
  zIndex: number;
  bounds: Rect;
  opacity: number;
  visible: boolean;
  /** Optional scale for open/close animation (around center) */
  scale: number;
  material: GlassMaterial;
  shape: RoundedRectShape;
  /** Content texture (premultiplied RGBA), may be null while loading */
  contentTexture: GPUTexture | null;
  /** Title-bar height in logical px; content starts below */
  titleBarHeight: number;
  /** Soft shadow strength 0–1 */
  shadowStrength: number;
}

export interface WallpaperDesc {
  /** Uploaded wallpaper texture (rgba8unorm); null until first upload */
  texture: GPUTexture | null;
  time: number;
}

export interface OverlayRect {
  id: string;
  bounds: Rect;
  opacity: number;
  material: GlassMaterial;
  shape: RoundedRectShape;
  contentTexture: GPUTexture | null;
  titleBarHeight: number;
  shadowStrength: number;
}

export interface FrameScene {
  wallpaper: WallpaperDesc;
  layers: Layer[];
  overlays: OverlayRect[];
  viewport: { width: number; height: number; dpr: number };
  time: number;
}
