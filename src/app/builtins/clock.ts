import type { AppModule } from '../types';

export const clockApp: AppModule = {
  manifest: {
    id: 'builtin.clock',
    name: '时钟',
    icon: '🕒',
    defaultSize: { width: 340, height: 260 },
    singleton: true,
  },
  create(ctx) {
    let pulse = 0;
    return {
      onMount() {
        ctx.window.setTitle('时钟');
        ctx.content.invalidate();
      },
      onUpdate(dt) {
        pulse += dt;
        ctx.content.invalidate();
      },
      onRender(surface) {
        const c = surface.get2D();
        const w = surface.width;
        const h = surface.height;
        c.clearRect(0, 0, w, h);

        // Title area already composited by shell chrome painter — only content region is this surface
        // Soft vignette
        const g = c.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.55);
        g.addColorStop(0, 'rgba(125, 211, 252, 0.08)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);

        const now = new Date();
        const time = now.toLocaleTimeString('zh-CN', { hour12: false });
        const date = now.toLocaleDateString('zh-CN', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        c.fillStyle = ctx.theme.text;
        c.font = `600 44px ${ctx.theme.fontUi}`;
        c.textAlign = 'center';
        c.fillText(time, w * 0.5, h * 0.48);

        c.fillStyle = ctx.theme.textMuted;
        c.font = `14px ${ctx.theme.fontUi}`;
        c.fillText(date, w * 0.5, h * 0.62);

        // Seconds arc
        const sec = now.getSeconds() + now.getMilliseconds() / 1000;
        const r = Math.min(w, h) * 0.32;
        c.strokeStyle = 'rgba(45, 80, 200, 0.42)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(w * 0.5, h * 0.45, r, -Math.PI / 2, -Math.PI / 2 + (sec / 60) * Math.PI * 2);
        c.stroke();

        c.fillStyle = 'rgba(24, 26, 32, 0.45)';
        c.font = `11px ${ctx.theme.fontMono}`;
        c.fillText('liquid glass · content film', w * 0.5, h - 18 + Math.sin(pulse * 2) * 0);

        c.textAlign = 'left';
      },
      onDispose() {},
    };
  },
};
