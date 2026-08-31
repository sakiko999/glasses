import type { PlatformClock } from '@/platform/types';

export interface FrameCallbacks {
  onFrame: (dt: number, time: number) => void;
}

export class FrameLoop {
  private readonly clock: PlatformClock;
  private readonly callbacks: FrameCallbacks;
  private running = false;
  private frameId = 0;
  private last = 0;
  private time = 0;

  constructor(clock: PlatformClock, callbacks: FrameCallbacks) {
    this.clock = clock;
    this.callbacks = callbacks;
  }

  get elapsed(): number {
    return this.time;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.clock.now();
    const tick = (t: number) => {
      if (!this.running) return;
      const now = t;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt < 0) dt = 0;
      if (dt > 0.05) dt = 0.05;
      this.time += dt;
      this.callbacks.onFrame(dt, this.time);
      this.frameId = this.clock.requestFrame(tick);
    };
    this.frameId = this.clock.requestFrame(tick);
  }

  stop(): void {
    this.running = false;
    this.clock.cancelFrame(this.frameId);
  }
}
