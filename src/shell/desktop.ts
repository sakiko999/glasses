import type { PlatformHost, PointerEventLike, KeyEventLike, GpuContext } from '@/platform/types';
import type { ControlGlass, FrameScene, Layer } from '@/engine/layers';
import { Compositor } from '@/engine/compositor';
import type { GlassMaterial } from '@/engine/glass/material';
import { controlMaterial, controlShape, defaultGlassMaterial } from '@/engine/glass/material';
import { EventBus } from '@/runtime/events';
import { Scheduler } from '@/runtime/scheduler';
import { FrameLoop } from '@/runtime/frame-loop';
import { DebugStats } from '@/runtime/debug-stats';
import { AppRegistry } from '@/app/registry';
import {
  DEFAULT_THEME,
  type AppInstance,
  type AppContext,
  type AppModule,
  type ControlSpec,
} from '@/app/types';
import { CanvasContentSurface, type ContentSurfaceHost } from '@/app/content-surface';
import { createId } from '@/math/id';
import { rectContains } from '@/math/rect';
import { WindowManager, type WindowId } from './window-manager';
import { ContentTextureCache } from './content-gpu';
import { Launcher } from './launcher';
import { paintWindowChrome } from './chrome-painter';
import { paintPosterWallpaper } from './wallpaper-painter';

/** Desktop item: a solid 3D glass object (v1: sphere), below all windows. */
interface DesktopObject {
  id: string;
  pos: { x: number; y: number };
  diameter: number;
}

interface RunningApp {
  instanceId: string;
  appId: string;
  windowId: WindowId;
  instance: AppInstance;
  surface: CanvasContentSurface;
  /** Full window surface including title bar for GPU upload */
  chromeSurface: CanvasContentSurface;
  /** Control-tier glass declared by the app (content-local coords) */
  controls: ControlSpec[];
  /** Marks whether cropped control textures need re-upload after a chrome paint */
  controlsDirty: boolean;
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
  /** Dev-only FPS overlay; the composition root attaches it to the DOM. */
  readonly debugStats = new DebugStats();

  private drag:
    | { windowId: WindowId; offsetX: number; offsetY: number }
    | null = null;
  private objectDrag: { id: string; offsetX: number; offsetY: number } | null = null;
  private readonly objects: DesktopObject[] = [];
  private objectMaterial: GlassMaterial = defaultGlassMaterial();

  private globalMaterial: GlassMaterial = defaultGlassMaterial();
  /** Control-tier glass presence 0–1 (Glass Lab slider, default calm) */
  private controlIntensity = 0.35;
  /** Smoothed interaction state per control, key = instanceId:controlId */
  private readonly controlStates = new Map<string, { hover: number; press: number }>();
  private launcherSurface: CanvasContentSurface | null = null;
  private launcherDirty = true;
  private lastDt = 0;
  private elapsed = 0;
  /** Render-on-demand: set by any state change that alters the composited scene. */
  private sceneDirty = true;
  private wallpaperTexture: GPUTexture | null = null;
  private wallpaperSize: { w: number; h: number } = { w: 0, h: 0 };

  private markDirty(): void {
    this.sceneDirty = true;
  }

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
      getControlIntensity: () => this.controlIntensity,
      setControlIntensity: (v: number) => {
        this.controlIntensity = Math.min(1, Math.max(0, v));
        this.refreshChrome();
      },
    };
  }

  registerApp(module: AppModule): void {
    this.registry.register(module);
    this.launcher.setApps(this.registry.list());
    this.launcherDirty = true;
  }

  start(options: { autoLaunch?: boolean } = {}): void {
    this.host.surface.resizeToDisplay();
    this.ensureWallpaper();
    this.ensureLauncherSurface();
    this.spawnDemoObjects();
    if (options.autoLaunch ?? true) {
      // Auto-launch demo apps
      this.launch('builtin.glass-lab');
      this.launch('builtin.clock');
    }
    this.frameLoop.start();
  }

  /** Demo desktop item: one crystal ball, bottom-left, below all windows. */
  private spawnDemoObjects(): void {
    const vw = this.host.surface.width;
    const vh = this.host.surface.height;
    this.objectMaterial = defaultGlassMaterial({
      sceneDistance: 320,
      dispersion: 0.05,
      absorption: 0.008,
      roughness: 0.03,
      specular: 1.1,
    });
    const d = Math.round(Math.min(210, Math.max(150, vh * 0.17)));
    this.objects.push({
      id: createId('obj'),
      pos: { x: Math.round(vw * 0.12), y: Math.round(vh - d - 80) },
      diameter: d,
    });
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
      uploadContent: (id, surface) => {
        const tex = this.contentTextures.upload(id, surface);
        if (id.startsWith('chrome-')) {
          const wid = id.slice('chrome-'.length);
          this.wm.setContentTexture(wid, tex);
        } else if (id === 'launcher') {
          this.launcher.setContentTexture(tex);
        }
      },
      createSurface: (w, h, d) => this.host.createPaintSurface(w, h, d),
    };

    const contentH = Math.max(1, win.bounds.height - win.titleBarHeight);
    const contentSurface = new CanvasContentSurface(
      `content-${windowId}`,
      win.bounds.width,
      contentH,
      dpr,
      hostApi,
    );
    const chromeSurface = new CanvasContentSurface(
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
    const controlHolder: { specs: ControlSpec[]; app: RunningApp | null } = {
      specs: [],
      app: null,
    };
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
      setControls: (specs) => {
        controlHolder.specs = specs;
        if (controlHolder.app) {
          controlHolder.app.controls = specs;
          controlHolder.app.controlsDirty = true;
        }
      },
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
      controls: controlHolder.specs,
      controlsDirty: true,
    };
    controlHolder.app = running;
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
    for (const spec of app.controls) {
      this.contentTextures.destroy(`ctl-${app.windowId}-${spec.id}`);
    }
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
      // Blit the app content into the chrome texture at title offset
      app.surface.paintSurface.blitInto(
        chromeCtx,
        0,
        0,
        app.surface.width,
        app.surface.height,
      );
      // Erase control rects from the window film: the control-tier glass
      // refracts this film (sceneTex), so leaving the content here would
      // print it twice — once bent inside the control, once as its film.
      for (const spec of app.controls) {
        chromeCtx.clearRect(spec.x, spec.y, spec.width, spec.height);
      }
    });
    app.chromeSurface.commit();
    app.surface.commit(); // clear dirty

    this.uploadControlTextures(app);
  }

  /**
   * Crop each declared control out of the content canvas as its own texture
   * (the chrome copy is erased — controls are drawn by the control tier).
   */
  private uploadControlTextures(app: RunningApp): void {
    if (!app.controls.length) return;
    const dpr = this.host.surface.devicePixelRatio;
    // Crop with headroom: the film texture covers rect + CONTENT_PAD on
    // every side, so device-pixel rounding can never clip the control's
    // own edge pixels (the shader maps the rect back 1:1 via contentPad).
    const pad = 2;
    for (const spec of app.controls) {
      this.contentTextures.uploadCrop(`ctl-${app.windowId}-${spec.id}`, app.surface.paintSurface, {
        x: Math.floor((spec.x - pad) * dpr),
        y: Math.floor((spec.y - pad) * dpr),
        width: Math.ceil((spec.width + 2 * pad) * dpr),
        height: Math.ceil((spec.height + 2 * pad) * dpr),
      });
    }
    app.controlsDirty = false;
  }

  /** Regenerate + upload the poster wallpaper when the display size changes. */
  private ensureWallpaper(): void {
    const w = this.host.surface.width;
    const h = this.host.surface.height;
    if (this.wallpaperTexture && this.wallpaperSize.w === w && this.wallpaperSize.h === h) return;
    const dpr = this.host.surface.devicePixelRatio;
    const surface = this.host.createPaintSurface(w, h, dpr);
    paintPosterWallpaper(surface, w, h);
    this.wallpaperTexture = this.contentTextures.upload('wallpaper', surface);
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
      uploadContent: (id, surface) => {
        const tex = this.contentTextures.upload(id, surface);
        this.launcher.setContentTexture(tex);
      },
      createSurface: (w, h, d) => this.host.createPaintSurface(w, h, d),
    };
    this.launcherSurface = new CanvasContentSurface(
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
    this.markDirty();
  }

  private onPointer(e: PointerEventLike): void {
    // Any pointer activity may move windows, toggle hover/press states or
    // hit the launcher — cheapest correct rule: input dirties the scene.
    this.markDirty();
    const pos = e.position;

    // Active object drag (desktop items sit below windows, checked after)
    if (this.objectDrag) {
      const o = this.objects.find((x) => x.id === this.objectDrag!.id);
      if (o && (e.phase === 'move' || e.phase === 'down')) {
        o.pos.x = Math.min(
          this.host.surface.width - o.diameter - 8,
          Math.max(8, pos.x - this.objectDrag.offsetX),
        );
        o.pos.y = Math.min(
          this.host.surface.height - o.diameter - 8,
          Math.max(8, pos.y - this.objectDrag.offsetY),
        );
      }
      if (e.phase === 'up' || e.phase === 'cancel') {
        this.objectDrag = null;
      }
      return;
    }

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
      if (e.phase === 'move') {
        const appId = hit && typeof hit === 'object' && 'appId' in hit ? hit.appId : null;
        if (this.launcher.setHovered(appId)) {
          this.markDirty();
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
      } else {
        // Desktop items (below windows, above wallpaper)
        const obj = this.hitObject(pos);
        if (obj) {
          this.objectDrag = {
            id: obj.id,
            offsetX: pos.x - obj.pos.x,
            offsetY: pos.y - obj.pos.y,
          };
          e.preventDefault();
          return;
        }
        if (e.detail >= 2) {
          // Double-click desktop → launcher
          this.launcher.show(this.host.surface.width, this.host.surface.height);
          this.launcherDirty = true;
          e.preventDefault();
        }
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
      this.markDirty();
      if (e.code === 'F3') {
        this.debugStats.toggle();
        e.preventDefault();
        return;
      }
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

  /** Smooth control interaction state and build the GPU control list. */
  private buildControls(app: RunningApp, dt: number): ControlGlass[] {
    if (!app.controls.length) return [];
    const win = this.wm.get(app.windowId);
    if (!win || win.bounds.width < 1 || win.bounds.height < 1) return [];
    const cr = this.wm.contentRect(win);
    const mat = controlMaterial(win.material, this.controlIntensity);
    const shape = controlShape(this.controlIntensity);
    const out: ControlGlass[] = [];
    for (const spec of app.controls) {
      const key = `${app.instanceId}:${spec.id}`;
      let st = this.controlStates.get(key);
      if (!st) {
        st = { hover: 0, press: 0 };
        this.controlStates.set(key, st);
      }
      const k = 1 - Math.exp(-14 * dt);
      st.hover += ((spec.hovered ? 1 : 0) - st.hover) * k;
      st.press += ((spec.pressed ? 1 : 0) - st.press) * k;
      out.push({
        id: spec.id,
        bounds: {
          x: cr.x + spec.x,
          y: cr.y + spec.y,
          width: spec.width,
          height: spec.height,
        },
        material: mat,
        shape,
        contentTexture: this.contentTextures.get(`ctl-${app.windowId}-${spec.id}`),
        contentPad: 2,
        hover: st.hover,
        press: st.press,
        // Contact shadow gives the capsule elevation over the pane (the
        // resting-state boundary cue); press adds the additive dim in-shader.
        shadowStrength: 0.18,
      });
    }
    return out;
  }

  /** Hit-test desktop objects (circle, slight grab tolerance); topmost last. */
  private hitObject(pos: { x: number; y: number }): DesktopObject | null {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]!;
      const dx = pos.x - (o.pos.x + o.diameter * 0.5);
      const dy = pos.y - (o.pos.y + o.diameter * 0.5);
      const r = o.diameter * 0.5 + 6;
      if (dx * dx + dy * dy <= r * r) return o;
    }
    return null;
  }

  private frame(dt: number, time: number): void {
    this.debugStats.begin();
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
    if (removed.length) this.markDirty();

    this.scheduler.runUpdate(dt);
    const painted = this.scheduler.runContentPaints();

    if (this.launcher.open && this.launcherDirty) {
      this.paintLauncher();
      this.markDirty();
    }

    // Controls hover/press decay toward their 0/1 targets for ~0.4s after
    // the pointer stops — keep compositing until they settle.
    let controlsAnimating = false;
    for (const st of this.controlStates.values()) {
      if (
        Math.abs(st.hover - Math.round(st.hover)) > 0.002 ||
        Math.abs(st.press - Math.round(st.press)) > 0.002
      ) {
        controlsAnimating = true;
        break;
      }
    }

    const dirty =
      this.sceneDirty ||
      painted > 0 ||
      this.wm.animating ||
      controlsAnimating ||
      this.drag !== null ||
      this.objectDrag !== null;
    this.sceneDirty = false;

    const tex = this.host.surface.getCurrentTexture();
    if (!dirty) {
      // Nothing changed — re-present the cached frame and skip the composite.
      this.compositor.presentCached(tex);
      this.debugStats.end();
      return;
    }

    const scene: FrameScene = {
      wallpaper: (() => {
        this.ensureWallpaper();
        return { texture: this.wallpaperTexture, time };
      })(),
      objects: this.objects.map((o) => ({
        id: o.id,
        bounds: { x: o.pos.x, y: o.pos.y, width: o.diameter, height: o.diameter },
        material: this.objectMaterial,
        shadowStrength: 0.5,
        opacity: 1,
      })),
      layers: (() => {
        const layers = this.wm.toLayers();
        for (const layer of layers) {
          const iid = this.byWindow.get(layer.id as string);
          if (!iid) continue;
          const app = this.apps.get(iid);
          if (!app) continue;
          const controls = this.buildControls(app, dt);
          if (controls.length) layer.controls = controls;
        }
        return layers as Layer[];
      })(),
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

    this.compositor.render(scene, tex);
    this.debugStats.end();
  }
}
