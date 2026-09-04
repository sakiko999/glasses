export type UpdateFn = (dt: number) => void;
export type PaintFn = () => void;

interface UpdateEntry {
  id: string;
  fn: UpdateFn;
  priority: number;
}

/**
 * Cooperative single-threaded scheduler.
 * Updates run by priority desc, then id asc for stability.
 */
export class Scheduler {
  private readonly updates = new Map<string, UpdateEntry>();
  private readonly dirtyPaints = new Map<string, PaintFn>();

  addUpdate(id: string, fn: UpdateFn, priority = 0): void {
    this.updates.set(id, { id, fn, priority });
  }

  removeUpdate(id: string): void {
    this.updates.delete(id);
  }

  requestContentPaint(id: string, paint: PaintFn): void {
    this.dirtyPaints.set(id, paint);
  }

  cancelContentPaint(id: string): void {
    this.dirtyPaints.delete(id);
  }

  runUpdate(dt: number): void {
    const list = [...this.updates.values()].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });
    for (const entry of list) {
      try {
        entry.fn(dt);
      } catch (err) {
        console.error(`[Scheduler] update ${entry.id} failed:`, err);
      }
    }
  }

  /** Executes pending paints; returns how many ran (0 = nothing repainted). */
  runContentPaints(): number {
    const paints = [...this.dirtyPaints.entries()];
    this.dirtyPaints.clear();
    for (const [id, paint] of paints) {
      try {
        paint();
      } catch (err) {
        console.error(`[Scheduler] paint ${id} failed:`, err);
      }
    }
    return paints.length;
  }
}
