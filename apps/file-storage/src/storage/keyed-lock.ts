/**
 * 以字串為鍵的非同步互斥：同一個鍵的工作依序執行，不同鍵互不影響。
 * 用來保證「內容檔改名 → 中繼資料落地 → 記憶體索引更新」這一串對同一個物件是原子的。
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
