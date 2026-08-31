/** Create a renderable RGBA16F or RGBA8 texture for offscreen composition. */
export function createColorTarget(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    size: { width: Math.max(1, width), height: Math.max(1, height) },
    format,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
}

export function createUniformBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(256, Math.ceil(size / 256) * 256),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function createLinearSampler(device: GPUDevice, mode: GPUAddressMode = 'clamp-to-edge'): GPUSampler {
  return device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: mode,
    addressModeV: mode,
  });
}

/** 1x1 premultiplied transparent texture */
export function createPlaceholderContent(device: GPUDevice): GPUTexture {
  const tex = device.createTexture({
    label: 'content-placeholder',
    size: { width: 1, height: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.writeTexture(
    { texture: tex },
    new Uint8Array([0, 0, 0, 0]),
    { bytesPerRow: 4 },
    { width: 1, height: 1 },
  );
  return tex;
}

export function writeFloatUniforms(device: GPUDevice, buffer: GPUBuffer, data: Float32Array): void {
  device.queue.writeBuffer(buffer, 0, data);
}
