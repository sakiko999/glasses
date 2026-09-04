import type { PaintSurface } from '@/platform/types';

/**
 * Manages GPU textures for window content surfaces.
 *
 * Upload internals are the one web-specific pixel path (`copyExternalImageToTexture`
 * + the OffscreenCanvas backend) — a native port rewrites this file's guts;
 * callers only ever hand it platform `PaintSurface`s.
 */
export class ContentTextureCache {
  private readonly device: GPUDevice;
  private readonly textures = new Map<string, GPUTexture>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  upload(id: string, surface: PaintSurface): GPUTexture {
    const source = surface.backend as OffscreenCanvas | HTMLCanvasElement;
    const width = source.width;
    const height = source.height;
    let tex = this.textures.get(id);
    if (!tex || tex.width !== width || tex.height !== height) {
      tex?.destroy();
      tex = this.device.createTexture({
        label: `content-${id}`,
        size: { width, height },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.textures.set(id, tex);
    }
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: tex },
      { width, height },
    );
    return tex;
  }

  /**
   * Upload a sub-rectangle of a canvas (device px) as its own texture —
   * used for control-tier content films cropped out of the window chrome.
   */
  uploadCrop(
    id: string,
    surface: PaintSurface,
    rect: { x: number; y: number; width: number; height: number },
  ): GPUTexture {
    const source = surface.backend as OffscreenCanvas | HTMLCanvasElement;
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const width = Math.max(1, Math.min(Math.floor(rect.width), source.width - x));
    const height = Math.max(1, Math.min(Math.floor(rect.height), source.height - y));
    let tex = this.textures.get(id);
    if (!tex || tex.width !== width || tex.height !== height) {
      tex?.destroy();
      tex = this.device.createTexture({
        label: `content-${id}`,
        size: { width, height },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.textures.set(id, tex);
    }
    this.device.queue.copyExternalImageToTexture(
      { source, origin: { x, y } },
      { texture: tex },
      { width, height },
    );
    return tex;
  }

  get(id: string): GPUTexture | null {
    return this.textures.get(id) ?? null;
  }

  destroy(id: string): void {
    const tex = this.textures.get(id);
    if (tex) {
      tex.destroy();
      this.textures.delete(id);
    }
  }

  destroyAll(): void {
    for (const tex of this.textures.values()) tex.destroy();
    this.textures.clear();
  }
}
