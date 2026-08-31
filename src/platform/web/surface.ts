import type { PlatformSurface } from '../types';

export function createWebSurface(canvas: HTMLCanvasElement): PlatformSurface {
  let width = 1;
  let height = 1;
  let dpr = 1;
  let context: GPUCanvasContext | null = null;
  let device: GPUDevice | null = null;
  let format: GPUTextureFormat = 'bgra8unorm';
  const resizeListeners = new Set<() => void>();

  const api: PlatformSurface = {
    canvas,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get devicePixelRatio() {
      return dpr;
    },
    configure(dev, fmt) {
      device = dev;
      format = fmt;
      context = canvas.getContext('webgpu');
      if (!context) {
        throw new Error('无法获取 WebGPU canvas context');
      }
      this.resizeToDisplay();
      context.configure({
        device: dev,
        format: fmt,
        alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      });
    },
    getCurrentTexture() {
      if (!context) throw new Error('Surface 尚未 configure');
      return context.getCurrentTexture();
    },
    onResize(cb) {
      resizeListeners.add(cb);
      return () => resizeListeners.delete(cb);
    },
    resizeToDisplay() {
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cssW = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth));
      const cssH = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight));
      const pw = Math.max(1, Math.floor(cssW * nextDpr));
      const ph = Math.max(1, Math.floor(cssH * nextDpr));
      if (pw === canvas.width && ph === canvas.height && nextDpr === dpr) {
        width = cssW;
        height = cssH;
        return false;
      }
      canvas.width = pw;
      canvas.height = ph;
      width = cssW;
      height = cssH;
      dpr = nextDpr;
      if (context && device) {
        context.configure({
          device,
          format,
          alphaMode: 'opaque',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        });
      }
      for (const cb of resizeListeners) cb();
      return true;
    },
  };

  return api;
}
