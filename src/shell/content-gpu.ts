/**
 * Manages GPU textures for window content surfaces.
 */
export class ContentTextureCache {
  private readonly device: GPUDevice;
  private readonly textures = new Map<string, GPUTexture>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  upload(id: string, source: OffscreenCanvas | HTMLCanvasElement): GPUTexture {
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
