import type { Rect } from '@/math/types';
import type { GlassMaterial, RoundedRectShape } from './glass/material';

export type LayerId = string;

/**
 * Control-tier glass element (button, slider…) rendered right after its
 * parent window layer — sampling the already-composited scene gives the
 * control refraction over everything below it (wallpaper, lower windows,
 * and the parent window's own glass + content), for free.
 */
export interface ControlGlass {
  id: string;
  /** Absolute screen-space rect, logical px */
  bounds: Rect;
  material: GlassMaterial;
  shape: RoundedRectShape;
  /** Cropped content film drawn on top of the glass; null → placeholder */
  contentTexture: GPUTexture | null;
  /** Logical px of padding the film texture carries around the rect */
  contentPad: number;
  /** Interpolated interaction state 0–1 */
  hover: number;
  press: number;
  /** Controls start with no window-style shadow; press lifts it slightly */
  shadowStrength: number;
}

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
  /** Control-tier glass elements composited above this window's pane */
  controls?: ControlGlass[];
}

/**
 * Solid 3D glass object (sphere v1) — a desktop item, composited after the
 * wallpaper and BELOW all windows: windows refract it like any other scene
 * content, and it never covers work surfaces. Physical closed-form refraction
 * lives in shaders-solid.ts (SOLID_FS), same bind group layout as the pane
 * glass so packGlassUniforms is reused unchanged.
 */
export interface GlassObject {
  id: string;
  /** Screen-space square bounds; sphere diameter = min(width, height) */
  bounds: Rect;
  material: GlassMaterial;
  /** Contact-shadow strength 0–1 */
  shadowStrength: number;
  opacity: number;
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
  /** Desktop items (3D glass objects) — below every window layer */
  objects?: GlassObject[];
  layers: Layer[];
  overlays: OverlayRect[];
  viewport: { width: number; height: number; dpr: number };
  time: number;
}
