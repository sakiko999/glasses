import type { GpuContext, PlatformHost } from '../types';
import { createWebClock } from './clock';
import { createWebSurface } from './surface';
import { createWebInput } from './input';

export async function createWebHost(canvas: HTMLCanvasElement): Promise<PlatformHost> {
  const clock = createWebClock();
  const surface = createWebSurface(canvas);
  const input = createWebInput(canvas);

  return {
    clock,
    surface,
    input,
    async createGpu(): Promise<GpuContext> {
      if (!navigator.gpu) {
        throw new Error(
          '当前浏览器不支持 WebGPU。请使用较新的 Chrome / Edge / Safari Technology Preview，并确保已启用 WebGPU。',
        );
      }
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) {
        throw new Error('无法获取 GPUAdapter。显卡驱动或浏览器可能限制了 WebGPU。');
      }
      const device = await adapter.requestDevice({
        label: 'glasses-device',
        requiredLimits: {
          maxTextureDimension2D: Math.min(8192, adapter.limits.maxTextureDimension2D),
        },
      });
      device.lost.then((info) => {
        console.error('[Glasses] GPU device lost:', info.message);
      });
      device.addEventListener('uncapturederror', (ev) => {
        console.error('[Glasses] WebGPU uncaptured error:', ev.error);
      });
      const format = navigator.gpu.getPreferredCanvasFormat();
      surface.configure(device, format);
      return { adapter, device, format };
    },
  };
}
