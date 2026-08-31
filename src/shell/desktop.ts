import type { PlatformHost, PointerEventLike, KeyEventLike, GpuContext } from '@/platform/types';
import type { FrameScene } from '@/engine/layers';
import { Compositor } from '@/engine/compositor';
import type { GlassMaterial } from '@/engine/glass/material';
import { defaultGlassMaterial } from '@/engine/glass/material';
import { EventBus } from '@/runtime/events';
import { Scheduler } from '@/runtime/scheduler';
import { FrameLoop } from '@/runtime/frame-loop';
import { AppRegistry } from '@/app/registry';
import {
  DEFAULT_THEME,
  type AppInstance,
  type AppContext,
  type AppModule,
} from '@/app/types';
import { OffscreenContentSurface, type ContentSurfaceHost } from '@/app/content-surface';
import { createId } from '@/math/id';
import { rectContains } from '@/math/rect';
import { WindowManager, type WindowId } from './window-manager';
import { ContentTextureCache } from './content-gpu';
import { Launcher } from './launcher';
import { paintWindowChrome } from './chrome-painter';
import { paintPosterWallpaper } from './wallpaper-painter';

interface RunningApp {
  instanceId: string;
  appId: string;
  windowId: WindowId;
  instance: AppInstance;
  surface: OffscreenContentSurface;
  /** Full window surface including title bar for GPU upload */
  chromeSurface: OffscreenContentSurface;
}

/**
 * Desktop shell: window management, app lifecycle, input, compose.
 */
export class Desktop {
  private readonly host: PlatformHost;
  private readonly gpu: GpuContext;
  private readonly compositor: Compositor;
  private readonly registry = new AppRegistry();
  private readonly wm = new WindowManager();
  private readonly scheduler = new Scheduler();
  private readonly events = new EventBus();
  private readonly contentTextures: ContentTextureCache;
  private readonly launcher = new Launcher();
  private readonly apps = new Map<string, RunningApp>();
  private readonly byWindow = new Map<WindowId, string>();
  private readonly frameLoop: FrameLoop;

  private drag:
    | { windowId: WindowId; offsetX: number; offsetY: number }
    | null = null;

  private globalMaterial: GlassMaterial = defaultGlassMaterial();
  private launcherSurface: OffscreenContentSurface | null = null;
  private launcherDirty = true;
  private lastDt = 0;
  private elapsed = 0;
  private wallpaperTexture: GPUTexture | null = null;
  private wallpaperSize: { w: number; h: number } = { w: 0, h: 0 };

  constructor(host: PlatformHost, gpu: GpuContext) {
    this.host = host;
    this.gpu = gpu;
    this.compositor = new Compositor(gpu.device, gpu.format);
    this.contentTextures = new ContentTextureCache(gpu.device);

    this.frameLoop = new FrameLoop(host.clock, {
      onFrame: (dt, time) => this.frame(dt, time),
    });

    host.input.onPointer((e) => this.onPointer(e));
    host.input.onKey((e) => this.onKey(e));
    host.surface.onResize(() => this.onResize());
  }

  get appRegistry(): AppRegistry {
    return this.registry;
  }

  get glassBridge() {
    return {
      getMaterial: () => ({ ...this.globalMaterial }),
      setMaterial: (m: GlassMaterial) => {
        this.globalMaterial = { ...m, tint: { ...m.tint } };
        const fid = this.wm.focused;
        if (fid) {
          this.wm.setMaterial(fid, this.globalMaterial);
          this.invalidateWindow(fid);
        }
      },
      applyToFocused: true,
    };
  }

  registerApp(module: AppModule): void {
    this.registry.register(module);
    this.launcher.setApps(this.registry.list());
    this.launcherDirty = true;
  }

  start(): void {
    this.host.surface.resizeToDisplay();
    this.ensureWallpaper();
    this.ensureLauncherSurface();
    // Auto-launch demo apps
    this.launch('builtin.glass-lab');
    this.launch('builtin.clock');
    this.frameLoop.start();
  }

  stop(): void {
    this.frameLoop.stop();
    for (const app of [...this.apps.values()]) {
      this.teardownApp(app, false);
    }
    this.compositor.destroy();
    this.contentTextures.destroyAll();
  }

  launch(appId: string): void {
    const mod = this.registry.get(appId);
    if (!mod) {
      console.warn('未知应用', appId);
      return;
    }
    if (mod.manifest.singleton) {
      for (const app of this.apps.values()) {
        if (app.appId === appId) {
          this.wm.focus(app.windowId);
          return;
        }
      }
    }

    const instanceId = createId('inst');
    const viewport = {
      width: this.host.surface.width,
      height: this.host.surface.height,
    };
    const size = {
      width: mod.manifest.defaultSize.width,
      height: mod.manifest.defaultSize.height + 40, // title bar
    };
    const material = {
      ...this.globalMaterial,
      ...mod.manifest.preferredMaterial,
      tint: {
        ...this.globalMaterial.tint,
        ...mod.manifest.preferredMaterial?.tint,
      },
    };
    const windowId = this.wm.create({
      appId,
      instanceId,
      title: mod.manifest.name,
      size,
      material,
      viewport,
    });
    const win = this.wm.get(windowId)!;
    const dpr = this.host.surface.devicePixelRatio;

    const hostApi: ContentSurfaceHost = {
      onInvalidate: (id) => {
        // id is chrome or content; always repaint chrome surface
        const app = this.apps.get(instanceId);
        if (!app) return;
        this.scheduler.requestContentPaint(app.windowId, () => this.paintWindow(app));
      },
      uploadContent: (id, canvas) => {
        const tex = this.contentTextures.upload(id, canvas);
        if (id.startsWith('chrome-')) {
          const wid = id.slice('chrome-'.length);
          this.wm.setContentTexture(wid, tex);
        } else if (id === 'launcher') {
          this.launcher.setContentTexture(tex);
        }
      },
    };

    const contentH = Math.max(1, win.bounds.height - win.titleBarHeight);
    const contentSurface = new OffscreenContentSurface(
      `content-${windowId}`,
      win.bounds.width,
      contentH,
      dpr,
      hostApi,
    );
    const chromeSurface = new OffscreenContentSurface(
      `chrome-${windowId}`,
      win.bounds.width,
      win.bounds.height,
      dpr,
      hostApi,
    );

    let lastDt = 0;
    const timeApi = {
      now: () => this.elapsed,
      dt: () => lastDt,
    };

    const self = this;
    const appCtx: AppContext = {
      appId,
      instanceId,
      window: {
        id: windowId,
        setTitle: (t) => {
          self.wm.setTitle(windowId, t);
          contentSurface.invalidate();
        },
        close: () => self.closeWindow(windowId),
        focus: () => self.wm.focus(windowId),
      },
      content: contentSurface,
      time: timeApi,
      theme: DEFAULT_THEME,
      emit: (e, p) => self.events.emit(e, p),
      on: (e, cb) => self.events.on(e, cb),
    };

    let instance: AppInstance;
    try {
      instance = mod.create(appCtx);
    } catch (err) {
      console.error('应用创建失败', err);
      this.wm.destroy(windowId);
      return;
    }

    const running: RunningApp = {
      instanceId,
      appId,
      windowId,
      instance,
      surface: contentSurface,
      chromeSurface,
    };
    this.apps.set(instanceId, running);
    this.byWindow.set(windowId, instanceId);

    this.scheduler.addUpdate(
      instanceId,
      (dt) => {
        lastDt = dt;
        instance.onUpdate?.(dt);
      },
      0,
    );

    try {
      instance.onMount?.();
    } catch (err) {
      console.error('onMount failed', err);
    }
    contentSurface.invalidate();
    this.events.emit('app-launched', { appId, instanceId, windowId });
  }

  private closeWindow(windowId: WindowId): void {
    this.wm.close(windowId);
  }

  private teardownApp(app: RunningApp, animate: boolean): void {
    try {
      app.instance.onDispose();
    } catch (err) {
      console.error('onDispose', err);
    }
    this.scheduler.removeUpdate(app.instanceId);
    this.scheduler.cancelContentPaint(app.windowId);
    this.contentTextures.destroy(`chrome-${app.windowId}`);
    this.contentTextures.destroy(`content-${app.windowId}`);
    this.apps.delete(app.instanceId);
    this.byWindow.delete(app.windowId);
    if (!animate) this.wm.destroy(app.windowId);
  }

  private invalidateWindow(windowId: WindowId): void {
    const iid = this.byWindow.get(windowId);
    if (!iid) return;
    const app = this.apps.get(iid);
    if (app) app.surface.invalidate();
  }

  /** Re-chrome every window (close orb / title tint follow focus changes). */
  private refreshChrome(): void {
    for (const app of this.apps.values()) {
      this.scheduler.requestContentPaint(app.windowId, () => this.paintWindow(app));
    }
  }

  private paintWindow(app: RunningApp): void {
    const win = this.wm.get(app.windowId);
    if (!win) return;
    const dpr = this.host.surface.devicePixelRatio;
    app.surface.resize(
      win.bounds.width,
      Math.max(1, win.bounds.height - win.titleBarHeight),
      dpr,
    );
    app.chromeSurface.resize(win.bounds.width, win.bounds.height, dpr);

    // Render app into content surface first
    if (app.surface.isDirty() || true) {
      try {
        app.instance.onRender?.(app.surface);
      } catch (err) {
        const c = app.surface.get2D();
        c.clearRect(0, 0, app.surface.width, app.surface.height);
        c.fillStyle = 'rgba(252,165,165,0.9)';
        c.font = '14px sans-serif';
        c.fillText('应用渲染错误', 16, 32);
        console.error(err);
      }
      // content commit not uploaded alone — composite into chrome
    }

    const chromeCtx = app.chromeSurface.get2D();
    paintWindowChrome(chromeCtx, win, DEFAULT_THEME, () => {
      // blit content canvas into chrome at title offset (already translated)
      const src = app.surface.getCanvas();
      chromeCtx.drawImage(
        src,
        0,
        0,
        src.width,
        src.height,
        0,
        0,
        app.surface.width,
        app.surface.height,
      );
    });
    app.chromeSurface.commit();
    app.surface.commit(); // clear dirty
  }

  /** Regenerate + upload the poster wallpaper when the display size changes. */
  private ensureWallpaper(): void {
    const w = this.host.surface.width;
    const h = this.host.surface.height;
    if (this.wallpaperTexture && this.wallpaperSize.w === w && this.wallpaperSize.h === h) return;
    const dpr = this.host.surface.devicePixelRatio;
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.floor(w * dpr)),
      Math.max(1, Math.floor(h * dpr)),
    );
    paintPosterWallpaper(canvas, w, h, dpr);
    this.wallpaperTexture = this.contentTextures.upload('wallpaper', canvas);
    this.wallpaperSize = { w, h };
  }

  private ensureLauncherSurface(): void {
    const dpr = this.host.surface.devicePixelRatio;
    this.launcher.layout(this.host.surface.width, this.host.surface.height);
    const b = this.launcher.getBounds();
    const hostApi: ContentSurfaceHost = {
      onInvalidate: () => {
        this.launcherDirty = true;
      },
      uploadContent: (id, canvas) => {
        const tex = this.contentTextures.upload(id, canvas);
        this.launcher.setContentTexture(tex);
      },
    };
    this.launcherSurface = new OffscreenContentSurface(
      'launcher',
      b.width,
      b.height,
      dpr,
      hostApi,
    );
    this.launcherDirty = true;
  }

  private paintLauncher(): void {
    if (!this.launcherSurface || !this.launcher.open) return;
    const dpr = this.host.surface.devicePixelRatio;
    this.launcher.layout(this.host.surface.width, this.host.surface.height);
    const b = this.launcher.getBounds();
    this.launcherSurface.resize(b.width, b.height, dpr);
    this.launcher.paint(this.launcherSurface.get2D(), dpr);
    this.launcherSurface.commit();
    this.launcherDirty = false;
  }

  private onResize(): void {
    for (const app of this.apps.values()) {
      app.surface.invalidate();
    }
    this.launcherDirty = true;
  }

  private onPointer(e: PointerEventLike): void {
    const pos = e.position;

    // Active drag
    if (this.drag) {
      if (e.phase === 'move' || e.phase === 'down') {
        this.wm.move(
          this.drag.windowId,
          { x: pos.x - this.drag.offsetX, y: pos.y - this.drag.offsetY },
          { width: this.host.surface.width, height: this.host.surface.height },
        );
      }
      if (e.phase === 'up' || e.phase === 'cancel') {
        this.drag = null;
      }
      return;
    }

    // Launcher hits
    if (this.launcher.open) {
      const hit = this.launcher.hitTest(pos.x, pos.y);
      if (e.phase === 'down') {
        if (hit && typeof hit === 'object' && 'appId' in hit) {
          this.launch(hit.appId);
          this.launcher.hide();
          e.preventDefault();
          return;
        }
        if (hit === null) {
          this.launcher.hide();
          // fall through to desktop
        } else {
          e.preventDefault();
          return;
        }
      }
      if (hit) return;
    }

    const win = this.wm.hitTest(pos);

    if (e.phase === 'down') {
      if (win) {
        const prevFocused = this.wm.focused;
        this.wm.focus(win.id);
        if (prevFocused !== win.id) this.refreshChrome();
        const iid = this.byWindow.get(win.id);
        const app = iid ? this.apps.get(iid) : undefined;
        app?.instance.onFocus?.(true);

        if (rectContains(this.wm.closeButtonRect(win), pos)) {
          this.closeWindow(win.id);
          e.preventDefault();
          return;
        }
        if (rectContains(this.wm.titleBarRect(win), pos)) {
          this.drag = {
            windowId: win.id,
            offsetX: pos.x - win.bounds.x,
            offsetY: pos.y - win.bounds.y,
          };
          e.preventDefault();
          return;
        }
        // Content
        if (app) {
          const cr = this.wm.contentRect(win);
          const local = {
            ...e,
            position: { x: pos.x - cr.x, y: pos.y - cr.y },
          };
          app.instance.onPointer?.(local);
        }
      } else if (e.detail >= 2) {
        // Double-click desktop → launcher
        this.launcher.show(this.host.surface.width, this.host.surface.height);
        this.launcherDirty = true;
        e.preventDefault();
      }
      return;
    }

    if (e.phase === 'move' || e.phase === 'up') {
      if (win) {
        const iid = this.byWindow.get(win.id);
        const app = iid ? this.apps.get(iid) : undefined;
        if (app) {
          const cr = this.wm.contentRect(win);
          if (rectContains(cr, pos) || e.phase === 'up') {
            app.instance.onPointer?.({
              ...e,
              position: { x: pos.x - cr.x, y: pos.y - cr.y },
            });
          }
        }
      }
    }
  }

  private onKey(e: KeyEventLike): void {
    if (e.phase === 'down') {
      // Backquote or Ctrl+Space → launcher
      if (e.code === 'Backquote' || (e.code === 'Space' && e.ctrlKey)) {
        this.launcher.toggle(this.host.surface.width, this.host.surface.height);
        this.launcherDirty = true;
        e.preventDefault();
        return;
      }
      if (e.code === 'Escape' && this.launcher.open) {
        this.launcher.hide();
        e.preventDefault();
        return;
      }
    }
    const fid = this.wm.focused;
    if (!fid) return;
    const iid = this.byWindow.get(fid);
    if (!iid) return;
    this.apps.get(iid)?.instance.onKey?.(e);
  }

  private frame(dt: number, time: number): void {
    this.lastDt = dt;
    this.elapsed = time;
    this.host.surface.resizeToDisplay();

    // Shell animation update
    const removed = this.wm.update(dt);
    for (const windowId of removed) {
      const iid = this.byWindow.get(windowId);
      if (iid) {
        const app = this.apps.get(iid);
        if (app) this.teardownApp(app, true);
      }
    }

    this.scheduler.runUpdate(dt);
    this.scheduler.runContentPaints();

    if (this.launcher.open && this.launcherDirty) {
      this.paintLauncher();
    }

    const scene: FrameScene = {
      wallpaper: (() => {
        this.ensureWallpaper();
        return { texture: this.wallpaperTexture, time };
      })(),
      layers: this.wm.toLayers(),
      overlays: (() => {
        const o = this.launcher.toOverlay();
        return o ? [o] : [];
      })(),
      viewport: {
        width: this.host.surface.width,
        height: this.host.surface.height,
        dpr: this.host.surface.devicePixelRatio,
      },
      time,
    };

    const tex = this.host.surface.getCurrentTexture();
    this.compositor.render(scene, tex);
  }
}
