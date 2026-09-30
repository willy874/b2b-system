/**
 * 有上限、有期限的快取（LRU）：超過上限時淘汰最久沒用到的項目，過期的項目在讀到時刪除。
 * 租戶登記的 key 來自請求（Host、`X-Tenant`），不設上限的話送大量不同的值就能讓記憶體一直長
 */
export class BoundedCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.store.size;
  }

  /** 沒有或已過期時回 `undefined`；命中的項目移到最新（Map 依插入順序）。 */
  get(key: K): { value: V } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    this.store.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.store.set(key, entry);
    return { value: entry.value };
  }

  set(key: K, value: V, ttlMs: number): void {
    this.store.delete(key);
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
