import type { Rect, Size, Vec2 } from '@/math/types';
import { clampRectToKeepPointVisible, rect, rectContains } from '@/math/rect';
import { createId } from '@/math/id';
import { easeOutCubic } from '@/math/easing';
import type { GlassMaterial, RoundedRectShape } from '@/engine/glass/material';
import {
  defaultGlassMaterial,
  defaultWindowShape,
  focusBoost,
} from '@/engine/glass/material';
import type { Layer } from '@/engine/layers';

export type WindowId = string;

export interface WindowState {
  id: WindowId;
  appId: string;
  instanceId: string;
  title: string;
  bounds: Rect;
  zIndex: number;
  focused: boolean;
  closing: boolean;
  /** 0..1 open animation */
  anim: number;
  animTarget: number;
  material: GlassMaterial;
  shape: RoundedRectShape;
  titleBarHeight: number;
  contentTexture: GPUTexture | null;
}

export interface CreateWindowOptions {
  appId: string;
  instanceId: string;
  title: string;
  size: Size;
  material?: Partial<GlassMaterial>;
  shape?: RoundedRectShape;
  viewport: Size;
}

const TITLE_BAR = 40;

export class WindowManager {
  private readonly windows = new Map<WindowId, WindowState>();
  private focusedId: WindowId | null = null;
  private nextZ = 1;
  private cascade = 0;

  get focused(): WindowId | null {
    return this.focusedId;
  }

  list(): WindowState[] {
    return [...this.windows.values()];
  }

  get(id: WindowId): WindowState | undefined {
    return this.windows.get(id);
  }

  create(opts: CreateWindowOptions): WindowId {
    const id = createId('win');
    this.cascade = (this.cascade + 1) % 8;
    const offset = this.cascade * 28;
    const x = Math.max(24, (opts.viewport.width - opts.size.width) * 0.5 + offset - 80);
    const y = Math.max(24, (opts.viewport.height - opts.size.height) * 0.5 + offset - 40);
    const material = defaultGlassMaterial(opts.material ?? {});
    const win: WindowState = {
      id,
      appId: opts.appId,
      instanceId: opts.instanceId,
      title: opts.title,
      bounds: rect(x, y, opts.size.width, opts.size.height),
      zIndex: this.nextZ++,
      focused: false,
      closing: false,
      anim: 0,
      animTarget: 1,
      material,
      shape: opts.shape ?? defaultWindowShape(22),
      titleBarHeight: TITLE_BAR,
      contentTexture: null,
    };
    this.windows.set(id, win);
    this.focus(id);
    return id;
  }

  setTitle(id: WindowId, title: string): void {
    const w = this.windows.get(id);
    if (w) w.title = title;
  }

  setContentTexture(id: WindowId, tex: GPUTexture | null): void {
    const w = this.windows.get(id);
    if (w) w.contentTexture = tex;
  }

  setMaterial(id: WindowId, material: GlassMaterial): void {
    const w = this.windows.get(id);
    if (w) w.material = material;
  }

  /** Apply material patch to focused or specific window */
  patchMaterial(id: WindowId, patch: Partial<GlassMaterial>): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.material = {
      ...w.material,
      ...patch,
      tint: { ...w.material.tint, ...patch.tint },
    };
  }

  close(id: WindowId): void {
    const w = this.windows.get(id);
    if (!w || w.closing) return;
    w.closing = true;
    w.animTarget = 0;
  }

  /** Hard remove after close animation */
  destroy(id: WindowId): void {
    this.windows.delete(id);
    if (this.focusedId === id) {
      this.focusedId = null;
      const top = this.topMost();
      if (top) this.focus(top.id);
    }
  }

  focus(id: WindowId): void {
    if (!this.windows.has(id)) return;
    for (const w of this.windows.values()) {
      w.focused = w.id === id;
    }
    this.focusedId = id;
    this.bringToFront(id);
  }

  bringToFront(id: WindowId): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.zIndex = this.nextZ++;
  }

  move(id: WindowId, pos: Vec2, viewport: Size): void {
    const w = this.windows.get(id);
    if (!w) return;
    w.bounds = clampRectToKeepPointVisible(
      { ...w.bounds, x: pos.x, y: pos.y },
      viewport,
      48,
    );
  }

  titleBarRect(w: WindowState): Rect {
    return {
      x: w.bounds.x,
      y: w.bounds.y,
      width: w.bounds.width,
      height: w.titleBarHeight,
    };
  }

  closeButtonRect(w: WindowState): Rect {
    const s = 18;
    return {
      x: w.bounds.x + w.bounds.width - 28 - s * 0.5,
      y: w.bounds.y + (w.titleBarHeight - s) * 0.5,
      width: s,
      height: s,
    };
  }

  contentRect(w: WindowState): Rect {
    return {
      x: w.bounds.x,
      y: w.bounds.y + w.titleBarHeight,
      width: w.bounds.width,
      height: Math.max(1, w.bounds.height - w.titleBarHeight),
    };
  }

  hitTest(pos: Vec2): WindowState | null {
    const sorted = this.list().sort((a, b) => b.zIndex - a.zIndex);
    for (const w of sorted) {
      if (w.closing && w.anim < 0.05) continue;
      if (rectContains(w.bounds, pos)) return w;
    }
    return null;
  }

  topMost(): WindowState | null {
    const list = this.list();
    if (!list.length) return null;
    return list.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
  }

  update(dt: number): WindowId[] {
    const removed: WindowId[] = [];
    for (const w of this.windows.values()) {
      const speed = 6.5;
      if (w.anim < w.animTarget) {
        w.anim = Math.min(w.animTarget, w.anim + dt * speed);
      } else if (w.anim > w.animTarget) {
        w.anim = Math.max(w.animTarget, w.anim - dt * speed);
      }
      if (w.closing && w.anim <= 0.001) {
        removed.push(w.id);
      }
    }
    for (const id of removed) this.destroy(id);
    return removed;
  }

  toLayers(): Layer[] {
    return this.list().map((w) => {
      const t = easeOutCubic(w.anim);
      const mat = w.focused ? focusBoost(w.material) : w.material;
      return {
        id: w.id,
        zIndex: w.zIndex,
        bounds: w.bounds,
        opacity: t,
        visible: t > 0.001,
        scale: 0.96 + 0.04 * t,
        material: mat,
        shape: w.shape,
        contentTexture: w.contentTexture,
        titleBarHeight: w.titleBarHeight,
        shadowStrength: 0.55 + (w.focused ? 0.15 : 0),
      };
    });
  }
}

export { TITLE_BAR };
