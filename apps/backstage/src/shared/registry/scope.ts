let active: Array<() => void> | undefined;

/**
 * 在 `fn` 執行期間（同步部分）收集所有註冊表登記的反註冊函式，回傳一次撤回全部的函式。
 * plugin 容器以它包住 factory：feature 照舊呼叫 `registerXxx()`，不必自己保存回傳值，卸載時就能撤得乾淨
 * （docs/adr/0021-runtime-feature-activation.md D4）。
 *
 * `fn` 丟例外時先撤回它已經登記的，再把例外往外拋：登記到一半的 plugin 不留殘骸。
 * 可以巢狀：內層收到的也會算進外層。
 */
export function collectRegistrations<T>(fn: () => T): { result: T; dispose: () => void } {
  const outer = active;
  const collected: Array<() => void> = [];
  // 逆序撤回：後登記的可能依賴先登記的
  const dispose = () => {
    for (const entry of collected.toReversed()) entry();
  };

  active = collected;
  let result: T;
  try {
    result = fn();
  } catch (error) {
    active = outer;
    dispose();
    throw error;
  }
  active = outer;
  outer?.push(...collected);
  return { result, dispose };
}

/** 註冊表登記後呼叫；不在任何收集範圍內時什麼都不做（常駐的登記不會被撤回）。 */
export function trackRegistration(dispose: () => void): void {
  active?.push(dispose);
}
