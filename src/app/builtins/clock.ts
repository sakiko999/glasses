import type { AppModule } from '../types';

/**
 * Ink-on-glass clock: a hairline dial with 60 ticks, large tabular digits,
 * a second hand that eases one tick per second. Deliberately quiet — the
 * glass is the material, this surface only draws ink.
 *
 * Render-on-demand citizen: invalidates once per second plus a 260ms easing
 * window after each tick, then rests (~75% idle at any refresh rate).
 */
export const clockApp: AppModule = {
  manifest: {
    id: 'builtin.clock',
    name: '时钟',
    icon: '🕒',
    defaultSize: { width: 340, height: 260 },
    singleton: true,
  },
  create(ctx) {
    let lastSec = -1;
    const ink = (a: number): string => `rgba(24, 26, 32, ${a})`;
    const blue = (a: number): string => `rgba(24, 40, 96, ${a})`;

    return {
      onMount() {
        ctx.window.setTitle('时钟');
        ctx.content.invalidate();
      },
      onUpdate() {
        const now = new Date();
        if (now.getSeconds() !== lastSec || now.getMilliseconds() < 260) {
          ctx.content.invalidate();
          lastSec = now.getSeconds();
        }
      },
      onRender(surface) {
        const c = surface.get2D();
        const w = surface.width;
        const h = surface.height;
        c.clearRect(0, 0, w, h);

        const now = new Date();
        const sec = now.getSeconds();
        // One eased sweep per second: the arc advances during the first
        // 260ms after each tick, then the app goes idle.
        const ease = 1 - Math.pow(1 - Math.min(1, now.getMilliseconds() / 260), 3);
        const sweep = ((sec === 0 ? 60 : sec) - 1 + ease) / 60;

        const cx = w * 0.5;
        const cy = h * 0.5 - 2;
        const R = Math.min(w, h) * 0.42;

        // Soft center glow
        const g = c.createRadialGradient(cx, cy, 8, cx, cy, R * 1.15);
        g.addColorStop(0, 'rgba(125, 211, 252, 0.07)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);

        // Dial: hairline circle + 60 ticks, every 5th emphasized
        c.strokeStyle = ink(0.14);
        c.lineWidth = 1;
        c.beginPath();
        c.arc(cx, cy, R, 0, Math.PI * 2);
        c.stroke();
        for (let i = 0; i < 60; i++) {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const major = i % 5 === 0;
          const r1 = R - (major ? 9 : 5);
          c.strokeStyle = ink(major ? 0.32 : 0.13);
          c.lineWidth = major ? 1.5 : 1;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          c.lineTo(cx + Math.cos(a) * (R - 1.5), cy + Math.sin(a) * (R - 1.5));
          c.stroke();
        }

        // Second hand: accent arc along the dial + tip dot
        const endA = sweep * Math.PI * 2 - Math.PI / 2;
        c.strokeStyle = blue(0.5);
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cx, cy, R - 1.5, -Math.PI / 2, endA);
        c.stroke();
        c.fillStyle = blue(0.9);
        c.beginPath();
        c.arc(cx + Math.cos(endA) * (R - 1.5), cy + Math.sin(endA) * (R - 1.5), 3, 0, Math.PI * 2);
        c.fill();

        // Time: HH:MM large, colon pulses on each tick
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        c.font = `600 46px ${ctx.theme.fontMono}`;
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        const wHH = c.measureText(hh).width;
        const wColon = c.measureText(':').width;
        const wMM = c.measureText(mm).width;
        let x = cx - (wHH + wColon + wMM) / 2;
        const ty = cy - 12;
        c.fillStyle = ctx.theme.text;
        c.fillText(hh, x, ty);
        x += wHH;
        c.globalAlpha = 1 - ease * 0.6;
        c.fillText(':', x, ty);
        c.globalAlpha = 1;
        x += wColon;
        c.fillText(mm, x, ty);

        // Seconds, date, year — stacked under the digits
        c.textAlign = 'center';
        c.fillStyle = blue(0.75);
        c.font = `600 13px ${ctx.theme.fontMono}`;
        c.fillText(String(sec).padStart(2, '0'), cx, cy + 22);
        c.fillStyle = ctx.theme.textMuted;
        c.font = `12.5px ${ctx.theme.fontUi}`;
        c.fillText(
          now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
          cx,
          cy + 44,
        );
        c.fillStyle = ink(0.5);
        c.font = `10px ${ctx.theme.fontMono}`;
        c.fillText(String(now.getFullYear()), cx, cy + 62);

        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
      },
      onDispose() {},
    };
  },
};
