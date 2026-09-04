import { createWebHost } from '@/platform/web/host';
import { Desktop } from '@/shell/desktop';
import { clockApp } from '@/app/builtins/clock';
import { createGlassLabApp } from '@/app/builtins/glass-lab';

function showError(message: string): void {
  const el = document.getElementById('boot-error');
  const msg = document.getElementById('boot-error-msg');
  if (el && msg) {
    el.style.display = 'block';
    msg.innerHTML = message;
  }
  console.error(message);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('gpu-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    showError('找不到 <code>#gpu-canvas</code>。');
    return;
  }

  try {
    const host = await createWebHost(canvas);
    const gpu = await host.createGpu();
    const desktop = new Desktop(host, gpu);
    // Dev FPS overlay — composition root owns the DOM mount point.
    desktop.debugStats.attach(gpu.device, document.body);

    desktop.registerApp(createGlassLabApp(desktop.glassBridge));
    desktop.registerApp(clockApp);
    desktop.start();

    // Expose for debugging in console
    (window as unknown as { __glasses: Desktop }).__glasses = desktop;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : '未知错误';
    showError(
      `${message}<br/><br/>请确认使用支持 WebGPU 的浏览器，并在 <code>chrome://flags</code> 中启用相关选项（如需要）。`,
    );
  }
}

void main();
