import type { Size } from '@/math/types';
import type { GlassMaterial } from '@/engine/glass/material';
import type { KeyEventLike, PointerEventLike } from '@/platform/types';

export interface AppManifest {
  id: string;
  name: string;
  version?: string;
  icon?: string;
  defaultSize: Size;
  singleton?: boolean;
  preferredMaterial?: Partial<GlassMaterial>;
}

export interface WindowHandle {
  readonly id: string;
  setTitle(title: string): void;
  close(): void;
  focus(): void;
}

export interface ContentSurface {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  get2D(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  invalidate(): void;
}

export interface ThemeTokens {
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
  panelFill: string;
  fontUi: string;
  fontMono: string;
}

export interface TimeApi {
  now(): number;
  dt(): number;
}

export interface AppContext {
  readonly appId: string;
  readonly instanceId: string;
  readonly window: WindowHandle;
  readonly content: ContentSurface;
  readonly time: TimeApi;
  readonly theme: ThemeTokens;
  emit(event: string, payload?: unknown): void;
  on(event: string, cb: (payload: unknown) => void): () => void;
}

export interface AppInstance {
  onMount?(): void;
  onUpdate?(dt: number): void;
  onRender?(surface: ContentSurface): void;
  onPointer?(e: PointerEventLike): void;
  onKey?(e: KeyEventLike): void;
  onFocus?(focused: boolean): void;
  onResize?(size: Size): void;
  onDispose(): void;
}

export interface AppModule {
  manifest: AppManifest;
  create(ctx: AppContext): AppInstance;
}

export const DEFAULT_THEME: ThemeTokens = {
  // Ink-on-glass palette: content sits on bright refracting glass, so text
  // and controls use dark ink for contrast instead of the old white set.
  text: 'rgba(24, 26, 32, 0.92)',
  textMuted: 'rgba(52, 58, 70, 0.65)',
  accent: 'rgba(37, 72, 201, 0.95)',
  danger: 'rgba(202, 52, 44, 0.95)',
  panelFill: 'rgba(15, 23, 42, 0.12)',
  fontUi: '"Segoe UI", system-ui, -apple-system, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
