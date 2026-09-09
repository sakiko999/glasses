export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** ease-out cubic */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

/** ease-in-out cubic */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * ease-out back — overshoots to ~1.10 at t≈0.7 before settling on 1.
 * Drives the open/close "jelly" settle of the window scale.
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp(t, 0, 1) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
