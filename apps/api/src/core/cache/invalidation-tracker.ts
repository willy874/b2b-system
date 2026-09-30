/**
 * 「讀 DB → 寫快取」與失效之間的競態防護：
 *
 * 載入在撤銷交易提交前讀到舊資料、卻在 `invalidate()` 之後才 `set()`，舊值就會被寫回並活到 TTL。
 * 所以載入前先取一張票（目前的世代），寫入時若這個 key 在取票之後被失效過，就不寫。
 *
 * 記錄「每個 key 最後一次失效的世代」的表有上限；被擠掉的 key 以 `floor`（被擠掉的最大世代）保守估計：
 * 票比它舊的載入一律不寫，只是少一次快取命中。
 */
export class InvalidationTracker {
  private generation = 0;
  private floor = 0;
  private readonly invalidatedAt = new Map<string, number>();
  /** 整組（例：一個租戶的所有使用者）最後一次失效的世代；組數很少（租戶數），不設上限。 */
  private readonly groupInvalidatedAt = new Map<string, number>();

  constructor(private readonly maxEntries: number) {}

  /** 開始從 DB 載入前呼叫。 */
  ticket(): number {
    return this.generation;
  }

  /** 以 `ticket` 那一刻開始的載入結果，現在還能不能寫進快取；`group` 是 key 所屬的組。 */
  isFresh(key: string, ticket: number, group?: string): boolean {
    const groupAt = group === undefined ? 0 : (this.groupInvalidatedAt.get(group) ?? 0);
    return Math.max(this.invalidatedAt.get(key) ?? this.floor, groupAt) <= ticket;
  }

  invalidate(key: string): void {
    this.generation += 1;
    // 刪掉再設：Map 依插入順序，最近失效的排在最後，擠掉的是最久沒失效的
    this.invalidatedAt.delete(key);
    this.invalidatedAt.set(key, this.generation);
    if (this.invalidatedAt.size > this.maxEntries) {
      const oldest = this.invalidatedAt.entries().next();
      if (!oldest.done) {
        const [evicted, at] = oldest.value;
        this.floor = Math.max(this.floor, at);
        this.invalidatedAt.delete(evicted);
      }
    }
  }

  /** 整組失效：取票在這之前的載入，只要 key 屬於這一組就不寫。 */
  invalidateGroup(group: string): void {
    this.generation += 1;
    this.groupInvalidatedAt.set(group, this.generation);
  }

  invalidateAll(): void {
    this.generation += 1;
    this.floor = this.generation;
    this.invalidatedAt.clear();
  }
}
