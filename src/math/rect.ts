import type { Rect, Vec2, Size } from './types';

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 };
}

export function rectFromCenter(center: Vec2, size: Size): Rect {
  return {
    x: center.x - size.width * 0.5,
    y: center.y - size.height * 0.5,
    width: size.width,
    height: size.height,
  };
}

export function clampRectToKeepPointVisible(
  r: Rect,
  viewport: Size,
  margin = 40,
): Rect {
  const maxX = Math.max(margin, viewport.width - margin);
  const maxY = Math.max(margin, viewport.height - margin);
  const minX = margin - r.width;
  const minY = margin - r.height;
  return {
    ...r,
    x: Math.min(maxX, Math.max(minX, r.x)),
    y: Math.min(maxY, Math.max(minY, r.y)),
  };
}

export function insetRect(r: Rect, dx: number, dy: number): Rect {
  return {
    x: r.x + dx,
    y: r.y + dy,
    width: Math.max(0, r.width - dx * 2),
    height: Math.max(0, r.height - dy * 2),
  };
}
