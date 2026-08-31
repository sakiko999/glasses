import type { WindowState } from './window-manager';
import type { ThemeTokens } from '@/app/types';

/**
 * Paints window chrome (title + close) into the same content surface above
 * the app's content region (full window texture including title bar).
 *
 * The title bar draws no background band — the glass body itself is the
 * chrome. Only the title text and a macOS-style translucent close orb sit on
 * the glass, so both stay tinted by whatever is refracted behind them.
 */
export function paintWindowChrome(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  win: WindowState,
  theme: ThemeTokens,
  appPaint: () => void,
): void {
  const w = win.bounds.width;
  const h = win.bounds.height;
  const th = win.titleBarHeight;

  ctx.clearRect(0, 0, w, h);

  // Title — ink text directly on the glass, dimmed when unfocused
  ctx.fillStyle = win.focused ? 'rgba(24, 26, 32, 0.88)' : 'rgba(24, 26, 32, 0.5)';
  ctx.font = `600 13px ${theme.fontUi}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(win.title, 18, th * 0.5);

  drawCloseOrb(ctx, w - 28, th * 0.5, win.focused);

  // Clip content area and translate for app paint
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, th, w, Math.max(0, h - th));
  ctx.clip();
  ctx.translate(0, th);

  appPaint();

  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

/** macOS-style close orb: translucent, gradient-lit, so the glass shows through. */
function drawCloseOrb(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  focused: boolean,
): void {
  const r = 7;

  if (focused) {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 150, 140, 0.95)');
    g.addColorStop(0.45, 'rgba(255, 95, 87, 0.88)');
    g.addColorStop(1, 'rgba(214, 62, 52, 0.82)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Specular top edge + thin rim — keeps it reading as a glass bead
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.2, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(130, 30, 22, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.4, 0, Math.PI * 2);
    ctx.stroke();
    // Cross
    ctx.strokeStyle = 'rgba(105, 15, 10, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    const o = 2.8;
    ctx.beginPath();
    ctx.moveTo(cx - o, cy - o);
    ctx.lineTo(cx + o, cy + o);
    ctx.moveTo(cx + o, cy - o);
    ctx.lineTo(cx - o, cy + o);
    ctx.stroke();
  } else {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
    g.addColorStop(0, 'rgba(214, 220, 230, 0.7)');
    g.addColorStop(1, 'rgba(158, 166, 178, 0.55)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 96, 108, 0.3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(70, 76, 88, 0.45)';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    const o = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - o, cy - o);
    ctx.lineTo(cx + o, cy + o);
    ctx.moveTo(cx + o, cy - o);
    ctx.lineTo(cx - o, cy + o);
    ctx.stroke();
  }
}
