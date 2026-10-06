// eslint-disable-next-line
export type ListenerDict = Record<string, (...args: never[]) => void>;

/** 極簡型別安全事件匯流排。plugin 的 eventBus、SessionStore 與請求的中止廣播都用它。 */
export class EventEmitter<Events extends ListenerDict> {
  private readonly listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    const off = this.on(event, ((...args: never[]) => {
      off();
      (listener as (...a: never[]) => void)(...args);
    }) as Events[K]);
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Events[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    // 複製一份：listener 在處理過程中可能會 off 自己（例如 once）
    for (const listener of Array.from(listeners)) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
