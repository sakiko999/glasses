import type { PlatformClock } from '../types';

export function createWebClock(): PlatformClock {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
  };
}
