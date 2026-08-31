type Handler = (payload: unknown) => void;

export class EventBus {
  private readonly map = new Map<string, Set<Handler>>();

  on(event: string, cb: Handler): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  emit(event: string, payload?: unknown): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[EventBus] handler error on ${event}:`, err);
      }
    }
  }
}
