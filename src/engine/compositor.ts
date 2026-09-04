import type { ControlGlass, FrameScene, GlassObject, Layer, OverlayRect } from './layers';
import type { GlassMaterial } from './glass/material';
import {
  BLIT_FS,
  BLUR_FS,
  FULLSCREEN_VS,
  GLASS_FS,
  WALLPAPER_FS,
} from './glass/shaders';
import { SOLID_FS } from './glass/shaders-solid';
import {
  createColorTarget,
  createLinearSampler,
  createPlaceholderContent,
  createUniformBuffer,
  writeFloatUniforms,
} from './resources';

/** Device-px scissor rect [x, y, w, h]. */
type Scissor = [number, number, number, number];

interface Pipelines {
  wallpaper: GPURenderPipeline;
  blit: GPURenderPipeline;
  /** Copy within the internal rgba8unorm chain (blit targets the canvas format). */
  blitInternal: GPURenderPipeline;
  blur: GPURenderPipeline;
  glass: GPURenderPipeline;
  /** Solid 3D glass objects (sphere) — same bind layout as `glass` */
  glassSolid: GPURenderPipeline;
}

/**
 * GlassUniforms packing — must match GLASS_FS struct (9 x vec4 = 144 bytes).
 * `hover`/`press` land in params3.z/w (controls); windows leave them at 0.
 * `contentPad` (params4.x) is the film texture's padding around the rect.
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
    hover?: number;
    press?: number;
    contentPad?: number;
  },
  viewportW: number,
  viewportH: number,
  dpr: number,
  time: number,
): Float32Array {
  const m = layer.material;
  const data = new Float32Array(36);
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
  data[30] = layer.hover ?? 0;
  data[31] = layer.press ?? 0;
  data[32] = layer.contentPad ?? 0;
  data[33] = 0;
  data[34] = 0;
  data[35] = 0;
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
  /** Last composited frame — re-presented on frames where nothing changed. */
  private lastFrame: GPUTexture | null = null;
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
  /**
   * Internal supersampling: targets render at dpr × this, the final blit
   * downsamples. Refraction is point-sampled displacement of a texture —
   * wherever the displacement derivative is high (sphere rim, pane bend band,
   * dispersion channels) the sampling alias prints as jaggies / RGB fringes.
   * SSAA filters all of it in one place. MSAA cannot: the pipeline rasterizes
   * no geometry, only fullscreen triangles + analytic masks (already fwidth-
   * antialiased). Texture-backed content (films, wallpaper) rasterizes at dpr
   * and gets mildly upsampled at 1.25 — bump the surfaces' dpr if ever visible.
   */
  private readonly renderScale = 1.25;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;
    this.sampler = createLinearSampler(device);
    this.contentSampler = createLinearSampler(device);
    this.placeholder = createPlaceholderContent(device);

    this.wallpaperPool = new UniformPool(device, 16, 'wallpaper-ubo');
    this.blurPool = new UniformPool(device, 16, 'blur-ubo');
    this.glassPool = new UniformPool(device, 144, 'glass-ubo');

    const vsModule = device.createShaderModule({ label: 'fullscreen-vs', code: FULLSCREEN_VS });
    const wallpaperModule = device.createShaderModule({ label: 'wallpaper-fs', code: WALLPAPER_FS });
    const blitModule = device.createShaderModule({ label: 'blit-fs', code: BLIT_FS });
    const blurModule = device.createShaderModule({ label: 'blur-fs', code: BLUR_FS });
    const glassModule = device.createShaderModule({ label: 'glass-fs', code: GLASS_FS });
    const solidModule = device.createShaderModule({ label: 'solid-fs', code: SOLID_FS });

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
    void reportCompileErrors('solid-fs', solidModule);

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
      glassSolid: makePipeline('glass-solid-pipe', solidModule, this.glassBgl, this.internalFormat),
    };
  }

  private ensureTargets(pixelW: number, pixelH: number): void {
    if (this.sceneA && this.targetW === pixelW && this.targetH === pixelH) return;
    this.sceneA?.destroy();
    this.sceneB?.destroy();
    this.blurA?.destroy();
    this.blurB?.destroy();
    this.lastFrame = null; // chain textures recreated — cache is dangling
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
   * Scissor rect (target px = logical × `scale`, where scale is dpr ×
   * renderScale) covering the glass footprint plus shadow/refraction falloff;
   * the pass is restricted to it so the heavy shader only runs there.
   */
  private glassScissor(
    bounds: { x: number; y: number; width: number; height: number },
    scale: number,
  ): [number, number, number, number] | null {
    const margin = 72;
    const x0 = Math.floor((bounds.x - margin) * scale);
    const y0 = Math.floor((bounds.y - margin) * scale);
    const x1 = Math.ceil((bounds.x + bounds.width + margin) * scale);
    const y1 = Math.ceil((bounds.y + bounds.height + margin * 1.6) * scale);
    const sx = Math.max(0, Math.min(x0, this.targetW - 1));
    const sy = Math.max(0, Math.min(y0, this.targetH - 1));
    const ex = Math.max(sx + 1, Math.min(x1, this.targetW));
    const ey = Math.max(sy + 1, Math.min(y1, this.targetH));
    if (sx >= this.targetW || sy >= this.targetH) return null;
    return [sx, sy, ex - sx, ey - sy];
  }

  /**
   * Fullscreen copy src→dst. Per-layer fullscreen blits are REQUIRED by the
   * ping-pong invariant: dst holds content from two steps ago, so a region-
   * limited copy would leak stale pixels into the final frame wherever the
   * last two steps' regions don't cover (this was attempted and reverted —
   * a correct version needs union-of-last-two-steps copies, which erases
   * the win on overlapping windows).
   */
  private blitFull(encoder: GPUCommandEncoder, src: GPUTexture, dst: GPUTexture): void {
    const blitBg = this.device.createBindGroup({
      layout: this.blitBgl,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.fullscreenPass(encoder, this.pipelines.blitInternal, blitBg, dst, { r: 0, g: 0, b: 0, a: 1 });
  }

  /** Glass pass for one window/overlay pane; the caller handles the blit. */
  private glassPass(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    blur: GPUTexture,
    dst: GPUTexture,
    layer: Layer | OverlayRect,
    scene: FrameScene,
    scissor: Scissor,
  ): void {
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
        scene.viewport.dpr,
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

  /**
   * Control-tier glass: a single render pass drawing every control, each
   * scissored tightly to its own bounds. One pass with per-draw scissor is
   * REQUIRED: the glass shader emits the undisplaced scene for mask=0
   * pixels, so a separate pass (or a wide union scissor across neighbours)
   * lets a later control erase the glass/shadow a neighbour already drew —
   * that overlap is what made truncation worse as the scissor widened. The
   * caller blits once over the union of `pairs` scissors. Samples the scene
   * AFTER the parent window + content (src), so controls refract the pane
   * and content they float on. Reuses the shared blur chain.
   */
  private controlsPass(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    blur: GPUTexture,
    dst: GPUTexture,
    pairs: Array<{ c: ControlGlass; r: Scissor }>,
    scene: FrameScene,
  ): void {
    const pass = encoder.beginRenderPass({
      label: 'controls-pass',
      colorAttachments: [
        { view: dst.createView(), loadOp: 'load', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.pipelines.glass);

    for (const { c, r: scissor } of pairs) {
      const glassBuf = this.glassPool.take(
        packGlassUniforms(
          {
            bounds: c.bounds,
            opacity: 1,
            scale: 1,
            material: c.material,
            shape: c.shape,
            titleBarHeight: 0,
            shadowStrength: c.shadowStrength,
            hover: c.hover,
            press: c.press,
            contentPad: c.contentPad,
          },
          scene.viewport.width,
          scene.viewport.height,
          scene.viewport.dpr,
          scene.time,
        ),
      );
      const content = c.contentTexture ?? this.placeholder;
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
      pass.setBindGroup(0, bg);
      pass.setScissorRect(scissor[0]!, scissor[1]!, scissor[2]!, scissor[3]!);
      pass.draw(3);
    }
    pass.end();
  }

  /** Tight scissor for a control: bounds + generous falloff for refraction
   * content and shadow — the 12px margin was clipping the press shadow and
   * the background displacement cast outside the control's rect (the "missing
   * a chunk / shadow cut" defect). Mirrors the window's glassScissor scale. */
  private glassScissorControl(
    bounds: { x: number; y: number; width: number; height: number },
    scale: number,
  ): [number, number, number, number] | null {
    // A single pass draws all controls with overlapping scissor regions —
    // but since the same pass both sets the scissor AND draws, a later draw
    // in the same pass can still overwrite a neighbour's refracted-overflow
    // pixels. Margins stay inside the layout gaps (sliders 34px apart
    // vertically, buttons 8px horizontally). The contact shadow falls below
    // (16px offset + falloff), so the bottom gets extra room while sides/top
    // stay tight — a symmetric margin either clipped the shadow (hard cut
    // line) or bled into the next control.
    const side = 8;
    const bottom = 24;
    const x0 = Math.max(0, Math.floor((bounds.x - side) * scale));
    const y0 = Math.max(0, Math.floor((bounds.y - side) * scale));
    const x1 = Math.min(this.targetW, Math.ceil((bounds.x + bounds.width + side) * scale));
    const y1 = Math.min(this.targetH, Math.ceil((bounds.y + bounds.height + bottom) * scale));
    if (x0 >= this.targetW || y0 >= this.targetH || x1 <= x0 || y1 <= y0) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }

  /**
   * Solid 3D glass objects (desktop items, below every window). One scissored
   * blit over the union of object scissors, then one pass with per-object
   * scissor so overlapping scissor regions can't clobber a neighbour's
   * shadow/refraction. Samples the scene after the wallpaper — objects
   * refract the wallpaper, and windows (drawn later) refract the objects
   * like any scene content.
   */
  private drawObjects(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    blur: GPUTexture,
    dst: GPUTexture,
    objects: GlassObject[],
    scene: FrameScene,
  ): void {
    const scale = scene.viewport.dpr * this.renderScale;
    const pairs: Array<{ o: GlassObject; r: Scissor }> = [];
    for (const o of objects) {
      const r = this.glassScissorObject(o.bounds, scale);
      if (r) pairs.push({ o, r });
    }
    if (!pairs.length) return;
    this.blitFull(encoder, src, dst);

    const pass = encoder.beginRenderPass({
      label: 'objects-pass',
      colorAttachments: [
        { view: dst.createView(), loadOp: 'load', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.pipelines.glassSolid);

    for (const { o, r: scissor } of pairs) {
      const glassBuf = this.glassPool.take(
        packGlassUniforms(
          {
            bounds: o.bounds,
            opacity: o.opacity,
            scale: 1,
            material: o.material,
            shape: { cornerRadius: 0, bevel: 0 }, // unused by the solid shader
            titleBarHeight: 0,
            shadowStrength: o.shadowStrength,
          },
          scene.viewport.width,
          scene.viewport.height,
          scene.viewport.dpr,
          scene.time,
        ),
      );
      const bg = this.device.createBindGroup({
        layout: this.glassBgl,
        entries: [
          { binding: 0, resource: src.createView() },
          { binding: 1, resource: blur.createView() },
          { binding: 2, resource: this.placeholder.createView() },
          { binding: 3, resource: this.sampler },
          { binding: 4, resource: this.contentSampler },
          { binding: 5, resource: { buffer: glassBuf } },
        ],
      });
      pass.setBindGroup(0, bg);
      pass.setScissorRect(scissor[0]!, scissor[1]!, scissor[2]!, scissor[3]!);
      pass.draw(3);
    }
    pass.end();
  }

  /** Object scissor: the contact-shadow ellipse reaches ~0.3·h past the
   * bounds plus an exp falloff tail; refraction only writes inside the
   * sphere silhouette, so no extra refract-overflow margin is needed. */
  private glassScissorObject(
    bounds: { x: number; y: number; width: number; height: number },
    scale: number,
  ): [number, number, number, number] | null {
    const margin = 40 + bounds.height * 0.35;
    const x0 = Math.max(0, Math.floor((bounds.x - margin) * scale));
    const y0 = Math.max(0, Math.floor((bounds.y - margin) * scale));
    const x1 = Math.min(this.targetW, Math.ceil((bounds.x + bounds.width + margin) * scale));
    const y1 = Math.min(this.targetH, Math.ceil((bounds.y + bounds.height + margin) * scale));
    if (x0 >= this.targetW || y0 >= this.targetH || x1 <= x0 || y1 <= y0) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }

  render(scene: FrameScene, swapchain: GPUTexture): void {
    const pixelW = Math.max(1, Math.floor(scene.viewport.width * scene.viewport.dpr * this.renderScale));
    const pixelH = Math.max(1, Math.floor(scene.viewport.height * scene.viewport.dpr * this.renderScale));
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

    // One blur chain per frame, shared by objects, windows, controls and
    // overlays: per-layer rebuilds differed only in the layers composited
    // beneath them — invisible at this kernel size — and the chain (2 full +
    // 2 half-res passes) was by far the largest per-layer pass cost.
    const blur = this.buildBlur(encoder, read);

    const scale = scene.viewport.dpr * this.renderScale;

    if (scene.objects?.length) {
      this.drawObjects(encoder, read, blur, write, scene.objects, scene);
      const tmp = read;
      read = write;
      write = tmp;
    }

    const layers = [...scene.layers]
      .filter((l) => l.visible && l.opacity > 0.001)
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of layers) {
      const main = this.glassScissor(layer.bounds, scale);
      if (main) {
        this.blitFull(encoder, read, write);
        this.glassPass(encoder, read, blur, write, layer, scene, main);
        const tmp = read;
        read = write;
        write = tmp;
      }
      // Controls must sample the pane they sit on: a swap first, so their
      // src is the freshly drawn window — merging both passes into one blit
      // makes the controls refract the pre-pane scene and their mask=0
      // margins erase the pane (shipped that bug once; do not merge).
      if (!layer.controls?.length) continue;
      const ctrl: Array<{ c: ControlGlass; r: Scissor }> = [];
      for (const c of layer.controls) {
        const r = this.glassScissorControl(c.bounds, scale);
        if (r) ctrl.push({ c, r });
      }
      if (!ctrl.length) continue;
      this.blitFull(encoder, read, write);
      this.controlsPass(encoder, read, blur, write, ctrl, scene);
      const tmp = read;
      read = write;
      write = tmp;
    }

    for (const overlay of scene.overlays) {
      if (overlay.opacity <= 0.001) continue;
      const main = this.glassScissor(overlay.bounds, scale);
      if (!main) continue;
      this.blitFull(encoder, read, write);
      this.glassPass(encoder, read, blur, write, overlay, scene, main);
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
    this.lastFrame = read;
  }

  /**
   * Render-on-demand: when the scene is unchanged, skip the whole composite
   * and re-present the cached frame. The canvas has no autoRedraw, so the
   * present blit itself must still run every rAF — it is the only thing that
   * does. No-op until the first full render.
   */
  presentCached(swapchain: GPUTexture): void {
    if (!this.lastFrame) return;
    const bg = this.device.createBindGroup({
      layout: this.blitBgl,
      entries: [
        { binding: 0, resource: this.lastFrame.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: 'present-encoder' });
    this.fullscreenPass(encoder, this.pipelines.blit, bg, swapchain, {
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
