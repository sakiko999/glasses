/**
 * Debug overlay (FPS / CPU ms) backed by stats-gl. Lazily imported so it
 * never lands in the production bundle graph unless a build opts in; all
 * calls are no-ops until the dynamic import resolves.
 *
 * trackGPU stays off for now — real GPU timing needs the device's
 * 'timestamp-query' feature and per-pass timestampWrites plumbing in the
 * compositor; flip it on there if GPU ms is ever needed.
 */
type StatsLike = {
  dom: HTMLDivElement;
  init(device: GPUDevice): Promise<void>;
  begin(): void;
  end(): void;
  update(): void;
};

export class DebugStats {
  private stats: StatsLike | null = null;
  private loading = false;

  /** Fire-and-forget; safe to call from a sync constructor. */
  attach(device: GPUDevice, parent: HTMLElement): void {
    if (this.stats || this.loading) return;
    this.loading = true;
    void import('stats-gl')
      .then(async ({ default: Stats }) => {
        const stats = new Stats({ trackFPS: true, trackGPU: false });
        parent.appendChild(stats.dom);
        this.stats = stats;
        this.loading = false;
        await stats.init(device);
      })
      .catch((err) => console.warn('[Glasses] debug stats unavailable', err));
  }

  toggle(): void {
    const dom = this.stats?.dom;
    if (!dom) return;
    dom.style.display = dom.style.display === 'none' ? 'block' : 'none';
  }

  begin(): void {
    this.stats?.begin();
  }

  /** Ends CPU timing and refreshes the panel display. */
  end(): void {
    if (!this.stats) return;
    this.stats.end();
    this.stats.update();
  }
}
