import { EventEmitter } from '@/shared/EventEmitter';

const NAMESPACE_PREFIX = 'ge:';

/**
 * 訊息型別 → payload 的對照表。payload 必須可被 structured clone（不能有函式、DOM 節點）。
 * 以 `type` 宣告：`interface` 沒有隱含的索引簽章，無法滿足這個約束。
 */
export type TabMessageDict = Record<string, unknown>;

interface Envelope {
  type: string;
  payload: unknown;
}

export interface TabChannel<Messages extends TabMessageDict> {
  /** 送給同源的其他分頁；**自己不會收到**。分頁關閉中或瀏覽器不支援時靜默略過。 */
  post<K extends keyof Messages & string>(type: K, payload: Messages[K]): void;
  on<K extends keyof Messages & string>(
    type: K,
    listener: (payload: Messages[K]) => void,
  ): () => void;
  close(): void;
}

/**
 * 型別化的跨分頁頻道，包住 `BroadcastChannel`。
 *
 * - 名稱自動加上 `ge:` 前綴（同 `dictStorage` 的命名空間），同名的頻道彼此收發。
 * - 一個頻道可以有多種訊息，依 `type` 分派；收到未知的 `type` 直接略過，
 *   新舊版本的分頁同時開著時不會出錯。
 * - 不支援 `BroadcastChannel` 的環境（舊瀏覽器、部分測試環境）退化成只在本分頁運作。
 */
export function createTabChannel<Messages extends TabMessageDict>(
  name: string,
): TabChannel<Messages> {
  // 以 payload 為唯一參數的事件表：EventEmitter 的 listener 形狀
  const events = new EventEmitter<{ [K in keyof Messages]: (payload: Messages[K]) => void }>();
  let channel =
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : new BroadcastChannel(NAMESPACE_PREFIX + name);

  channel?.addEventListener('message', (event: MessageEvent<Envelope>) => {
    const { type, payload } = event.data ?? {};
    if (typeof type !== 'string') return;
    // 對方送來的 payload 無法在執行期驗證型別；同一份原始碼的分頁共用同一張對照表
    (events.emit as (type: string, payload: unknown) => void)(type, payload);
  });

  return {
    post(type, payload) {
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel 沒有 targetOrigin，只會送到同源
        channel?.postMessage({ type, payload } satisfies Envelope);
      } catch {
        /* 分頁關閉中、或頻道已關閉：訊息本來就沒人收，忽略 */
      }
    },
    on(type, listener) {
      return events.on(type, listener);
    },
    close() {
      channel?.close();
      channel = undefined;
      events.clear();
    },
  };
}
