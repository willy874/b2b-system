/**
 * Leader 的任期：可比較的物件。`counter` 大者較新；相同時以 `ownerId` 決勝（字典序小者較新），
 * 所有分頁的判定一致。
 */
export interface LeaderTerm {
  counter: number;
  ownerId: string;
}

/** `nextLeaderTerm` 需要的依賴，皆可注入以便測試。 */
export interface LeaderTermDeps {
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  now: () => number;
}

export interface NextLeaderTermResult {
  term: LeaderTerm;
  /** localStorage 不可用（隱私模式、配額）時改用時間當 counter；仍可比較，但跨分頁的單調性較弱。 */
  degraded: boolean;
}

/**
 * 產生下一個任期：`counter = max(看過的最大值, localStorage 的值) + 1` 並寫回。
 * localStorage 讓同時競選的分頁拿到不同的 counter；看過的最大值讓讀不到 storage 時也不會倒退。
 */
export function nextLeaderTerm(
  deps: LeaderTermDeps,
  storageKey: string,
  ownerId: string,
  lastSeenCounter = 0,
): NextLeaderTermResult {
  try {
    const raw = deps.storage.getItem(storageKey);
    const stored = raw === null ? 0 : Number.parseInt(raw, 10);
    const counter = Math.max(Number.isFinite(stored) ? stored : 0, lastSeenCounter) + 1;
    deps.storage.setItem(storageKey, String(counter));
    return { term: { counter, ownerId }, degraded: false };
  } catch {
    return {
      term: { counter: Math.max(deps.now(), lastSeenCounter + 1), ownerId },
      degraded: true,
    };
  }
}

/** `> 0`：a 較新；`< 0`：b 較新；`0`：同一個任期。 */
export function compareLeaderTerm(a: LeaderTerm, b: LeaderTerm): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.ownerId === b.ownerId) return 0;
  return a.ownerId < b.ownerId ? 1 : -1;
}

export function isLeaderTerm(value: unknown): value is LeaderTerm {
  if (typeof value !== 'object' || value === null) return false;
  const term = value as Partial<LeaderTerm>;
  return (
    typeof term.counter === 'number' &&
    Number.isSafeInteger(term.counter) &&
    term.counter >= 0 &&
    typeof term.ownerId === 'string' &&
    term.ownerId.length > 0
  );
}
