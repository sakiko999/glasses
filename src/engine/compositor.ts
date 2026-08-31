import type { FrameScene, Layer, OverlayRect } from './layers';
import type { GlassMaterial } from './glass/material';
import {
  BLIT_FS,
  BLUR_FS,
  FULLSCREEN_VS,
  GLASS_FS,
  WALLPAPER_FS,
} from './glass/shaders';
import {
  createColorTarget,
  createLinearSampler,
  createPlaceholderContent,
  createUniformBuffer,
  writeFloatUniforms,
} from './resources';

interface Pipelines {
  wallpaper: GPURenderPipeline;
  blit: GPURenderPipeline;
  /** Copy within the internal rgba8unorm chain (blit targets the canvas format). */
  blitInternal: GPURenderPipeline;
  blur: GPURenderPipeline;
  glass: GPURenderPipeline;
}

/**
 * GlassUniforms packing — must match GLASS_FS struct (8 x vec4 = 128 bytes).
 */
function packGlassUniforms(
  layer: {
    bounds: { x: number; y: number; width: number; height: number };
    opacity: number;
    scale: number;
    material: GlassMaterial;
    shape: { cornerRadius: number; bevel: number };
    titleBarHeight: number;
    shadowStrength: number;
  },
  viewportW: number,
  viewportH: number,
  dpr: number,
  time: number,
): Float32Array {
  const m = layer.material;
  const data = new Float32Array(32);
  data[0] = layer.bounds.x;
  data[1] = layer.bounds.y;
  data[2] = layer.bounds.width;
  data[3] = layer.bounds.height;
  data[4] = viewportW;
  data[5] = viewportH;
  data[6] = dpr;
  data[7] = time;
  data[8] = m.ior;
  data[9] = m.thickness;
  data[10] = m.roughness;
  data[11] = m.transmission;
  data[12] = m.dispersion;
  data[13] = m.specular;
  data[14] = m.edgeBoost;
  data[15] = m.absorption;
  data[16] = m.liquidity;
  data[17] = m.liquidSpeed;
  data[18] = layer.opacity;
  data[19] = layer.scale;
  data[20] = m.tint.r;
  data[21] = m.tint.g;
  data[22] = m.tint.b;
  data[23] = layer.shape.cornerRadius;
  data[24] = layer.shape.bevel;
  data[25] = layer.titleBarHeight;
  data[26] = layer.shadowStrength;
  data[27] = m.curvature;
  data[28] = m.sceneDistance;
  data[29] = m.milkiness;
  data[30] = 0; // reserved (internalReflect removed)
  data[31] = 0;
  return data;
}

/**
 * Per-frame uniform buffer pool.
 * WebGPU queue.writeBuffer is resolved before submit; reusing one UBO for multiple
 * passes inside a single command buffer would leave only the last write visible.
 */
class UniformPool {
  private readonly device: GPUDevice;
  private readonly size: number;
  private readonly label: string;
  private readonly buffers: GPUBuffer[] = [];
  private index = 0;

  constructor(device: GPUDevice, size: number, label: string) {
    this.device = device;
    this.size = size;
    this.label = label;
  }

  beginFrame(): void {
    this.index = 0;
  }

  take(data: Float32Array): GPUBuffer {
    if (this.index >= this.buffers.length) {
      this.buffers.push(
        createUniformBuffer(this.device, this.size, `${this.label}-${this.buffers.length}`),
      );
    }
    const buf = this.buffers[this.index]!;
    this.index += 1;
    writeFloatUniforms(this.device, buf, data);
    return buf;
  }

  destroy(): void {
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
  }
}

export class Compositor {
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly pipelines: Pipelines;
  private readonly sampler: GPUSampler;
  private readonly contentSampler: GPUSampler;
  private readonly placeholder: GPUTexture;

  private readonly wallpaperPool: UniformPool;
  private readonly blurPool: UniformPool;
  private readonly glassPool: UniformPool;

  private sceneA: GPUTexture | null = null;
  private sceneB: GPUTexture | null = null;
  private blurA: GPUTexture | null = null;
  private blurB: GPUTexture | null = null;
  private targetW = 0;
  private targetH = 0;

  private readonly wallpaperBgl: GPUBindGroupLayout;
  private readonly blitBgl: GPUBindGroupLayout;
  private readonly blurBgl: GPUBindGroupLayout;
  private readonly glassBgl: GPUBindGroupLayout;
  /** rgba8unorm is universally filterable; keeps quality high with sRGB-ish path. */
  private readonly internalFormat: GPUTextureFormat = 'rgba8unorm';

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;
    this.sampler = createLinearSampler(device);
    this.contentSampler = createLinearSampler(device);
    this.placeholder = createPlaceholderContent(device);

    this.wallpaperPool = new UniformPool(device, 16, 'wallpaper-ubo');
    this.blurPool = new UniformPool(device, 16, 'blur-ubo');
    this.glassPool = new UniformPool(device, 128, 'glass-ubo');

    const vsModule = device.createShaderModule({ label: 'fullscreen-vs', code: FULLSCREEN_VS });
    const wallpaperModule = device.createShaderModule({ label: 'wallpaper-fs', code: WALLPAPER_FS });
    const blitModule = device.createShaderModule({ label: 'blit-fs', code: BLIT_FS });
    const blurModule = device.createShaderModule({ label: 'blur-fs', code: BLUR_FS });
    const glassModule = device.createShaderModule({ label: 'glass-fs', code: GLASS_FS });

    // Surface WGSL compile errors with exact line numbers at startup;
    // otherwise they only show up as an opaque "invalid pipeline".
    const reportCompileErrors = async (label: string, mod: GPUShaderModule): Promise<void> => {
      try {
        const info = await mod.getCompilationInfo();
        for (const msg of info.messages) {
          if (msg.type === 'error') {
            console.error(`[Glasses] WGSL ${label}:${msg.lineNum}:${msg.linePos} ${msg.message}`);
          }
        }
      } catch {
        // getCompilationInfo unavailable — ignore
      }
    };
    void reportCompileErrors('wallpaper-fs', wallpaperModule);
    void reportCompileErrors('blit-fs', blitModule);
    void reportCompileErrors('blur-fs', blurModule);
    void reportCompileErrors('glass-fs', glassModule);

    this.wallpaperBgl = device.createBindGroupLayout({
      label: 'wallpaper-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.blitBgl = device.createBindGroupLayout({
      label: 'blit-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.blurBgl = device.createBindGroupLayout({
      label: 'blur-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.glassBgl = device.createBindGroupLayout({
      label: 'glass-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const makePipeline = (
      label: string,
      fs: GPUShaderModule,
      bgl: GPUBindGroupLayout,
      targetFormat: GPUTextureFormat,
    ): GPURenderPipeline =>
      device.createRenderPipeline({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: vsModule, entryPoint: 'vs_main' },
        fragment: {
          module: fs,
          entryPoint: 'fs_main',
          targets: [{ format: targetFormat }],
        },
        primitive: { topology: 'triangle-list' },
      });

    this.pipelines = {
      wallpaper: makePipeline('wallpaper-pipe', wallpaperModule, this.wallpaperBgl, this.internalFormat),
      blit: makePipeline('blit-pipe', blitModule, this.blitBgl, format),
      blitInternal: makePipeline('blit-internal-pipe', blitModule, this.blitBgl, this.internalFormat),
      blur: makePipeline('blur-pipe', blurModule, this.blurBgl, this.internalFormat),
      glass: makePipeline('glass-pipe', glassModule, this.glassBgl, this.internalFormat),
    };
  }

  private ensureTargets(pixelW: number, pixelH: number): void {
    if (this.sceneA && this.targetW === pixelW && this.targetH === pixelH) return;
    this.sceneA?.destroy();
    this.sceneB?.destroy();
    this.blurA?.destroy();
    this.blurB?.destroy();
    this.targetW = pixelW;
    this.targetH = pixelH;
    this.sceneA = createColorTarget(this.device, pixelW, pixelH, this.internalFormat, 'scene-a');
    this.sceneB = createColorTarget(this.device, pixelW, pixelH, this.internalFormat, 'scene-b');
    const bw = Math.max(1, Math.floor(pixelW / 2));
    const bh = Math.max(1, Math.floor(pixelH / 2));
    this.blurA = createColorTarget(this.device, bw, bh, this.internalFormat, 'blur-a');
    this.blurB = createColorTarget(this.device, bw, bh, this.internalFormat, 'blur-b');
  }

  private fullscreenPass(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTexture,
    clear?: GPUColor,
    scissor?: [number, number, number, number],
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: clear ?? { r: 0, g: 0, b: 0, a: 1 },
          loadOp: clear ? 'clear' : 'load',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    if (scissor) pass.setScissorRect(scissor[0]!, scissor[1]!, scissor[2]!, scissor[3]!);
    pass.draw(3);
    pass.end();
  }

  private buildBlur(encoder: GPUCommandEncoder, source: GPUTexture): GPUTexture {
    const blurA = this.blurA!;
    const blurB = this.blurB!;
    const bw = blurA.width;
    const bh = blurA.height;

    const run = (src: GPUTexture, dst: GPUTexture, dirX: number, dirY: number, tw: number, th: number) => {
      const buf = this.blurPool.take(new Float32Array([dirX, dirY, 1 / tw, 1 / th]));
      const bg = this.device.createBindGroup({
        layout: this.blurBgl,
        entries: [
          { binding: 0, resource: src.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: buf } },
        ],
      });
      this.fullscreenPass(encoder, this.pipelines.blur, bg, dst, { r: 0, g: 0, b: 0, a: 1 });
    };

    // H/V from full-res scene into half-res, then second H/V for smoother blur
    run(source, blurA, 1, 0, source.width, source.height);
    run(blurA, blurB, 0, 1, bw, bh);
    run(blurB, blurA, 1, 0, bw, bh);
    run(blurA, blurB, 0, 1, bw, bh);
    return blurB;
  }

  /**
   * Scissor rect (device px) covering the glass footprint plus shadow/refraction
   * falloff; the pass is restricted to it so the heavy shader only runs there.
   */
  private glassScissor(
    bounds: { x: number; y: number; width: number; height: number },
    dpr: number,
  ): [number, number, number, number] | null {
    const margin = 72;
    const x0 = Math.floor((bounds.x - margin) * dpr);
    const y0 = Math.floor((bounds.y - margin) * dpr);
    const x1 = Math.ceil((bounds.x + bounds.width + margin) * dpr);
    const y1 = Math.ceil((bounds.y + bounds.height + margin * 1.6) * dpr);
    const sx = Math.max(0, Math.min(x0, this.targetW - 1));
    const sy = Math.max(0, Math.min(y0, this.targetH - 1));
    const ex = Math.max(sx + 1, Math.min(x1, this.targetW));
    const ey = Math.max(sy + 1, Math.min(y1, this.targetH));
    if (sx >= this.targetW || sy >= this.targetH) return null;
    return [sx, sy, ex - sx, ey - sy];
  }

  private drawGlassLayer(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    blur: GPUTexture,
    dst: GPUTexture,
    layer: Layer | OverlayRect,
    scene: FrameScene,
  ): void {
    const dpr = scene.viewport.dpr;
    const scissor = this.glassScissor(layer.bounds, dpr);
    if (!scissor) return;

    // Copy the current scene into dst first so the scissored glass pass
    // (loadOp: load) keeps correct content outside its rect.
    const blitBg = this.device.createBindGroup({
      layout: this.blitBgl,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.fullscreenPass(encoder, this.pipelines.blitInternal, blitBg, dst, { r: 0, g: 0, b: 0, a: 1 });

    const content = layer.contentTexture ?? this.placeholder;
    const glassBuf = this.glassPool.take(
      packGlassUniforms(
        {
          bounds: layer.bounds,
          opacity: layer.opacity,
          scale: 'scale' in layer ? layer.scale : 1,
          material: layer.material,
          shape: layer.shape,
          titleBarHeight: layer.titleBarHeight,
          shadowStrength: layer.shadowStrength,
        },
        scene.viewport.width,
        scene.viewport.height,
        dpr,
        scene.time,
      ),
    );

    const bg = this.device.createBindGroup({
      layout: this.glassBgl,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: blur.createView() },
        { binding: 2, resource: content.createView() },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: this.contentSampler },
        { binding: 5, resource: { buffer: glassBuf } },
      ],
    });
    this.fullscreenPass(encoder, this.pipelines.glass, bg, dst, undefined, scissor);
  }

  render(scene: FrameScene, swapchain: GPUTexture): void {
    const pixelW = Math.max(1, Math.floor(scene.viewport.width * scene.viewport.dpr));
    const pixelH = Math.max(1, Math.floor(scene.viewport.height * scene.viewport.dpr));
    this.ensureTargets(pixelW, pixelH);

    this.wallpaperPool.beginFrame();
    this.blurPool.beginFrame();
    this.glassPool.beginFrame();

    const encoder = this.device.createCommandEncoder({ label: 'compose-encoder' });
    let read = this.sceneA!;
    let write = this.sceneB!;

    const wallpaperBuf = this.wallpaperPool.take(
      new Float32Array([
        scene.wallpaper.time,
        scene.viewport.width / Math.max(scene.viewport.height, 1),
        0,
        0,
      ]),
    );
    const wallTex = scene.wallpaper.texture ?? this.placeholder;
    const wallBg = this.device.createBindGroup({
      layout: this.wallpaperBgl,
      entries: [
        { binding: 0, resource: wallTex.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: wallpaperBuf } },
      ],
    });
    this.fullscreenPass(encoder, this.pipelines.wallpaper, wallBg, read, {
      r: 0.94,
      g: 0.93,
      b: 0.9,
      a: 1,
    });

    const layers = [...scene.layers]
      .filter((l) => l.visible && l.opacity > 0.001)
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of layers) {
      const blur = this.buildBlur(encoder, read);
      this.drawGlassLayer(encoder, read, blur, write, layer, scene);
      const tmp = read;
      read = write;
      write = tmp;
    }

    for (const overlay of scene.overlays) {
      if (overlay.opacity <= 0.001) continue;
      const blur = this.buildBlur(encoder, read);
      this.drawGlassLayer(encoder, read, blur, write, overlay, scene);
      const tmp = read;
      read = write;
      write = tmp;
    }

    const presentBg = this.device.createBindGroup({
      layout: this.blitBgl,
      entries: [
        { binding: 0, resource: read.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.fullscreenPass(encoder, this.pipelines.blit, presentBg, swapchain, {
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });

    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.sceneA?.destroy();
    this.sceneB?.destroy();
    this.blurA?.destroy();
    this.blurB?.destroy();
    this.placeholder.destroy();
    this.wallpaperPool.destroy();
    this.blurPool.destroy();
    this.glassPool.destroy();
  }
}
