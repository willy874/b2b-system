/**
 * 一個頻道底下的傳輸層：只負責把外框送出去、把收到的東西交上來。
 * 驗證外框、分流頻道、略過自己、去重都由 `createChannel` 統一處理，傳輸層不必各做一次。
 */
export interface ChannelTransport {
  /** 送出失敗可以直接拋出，`createChannel` 會吞掉。 */
  post(envelope: unknown): void;
  /** 收到的原始資料原封不動交上來（可能不是外框、可能屬於別的頻道）。 */
  subscribe(listener: (message: unknown) => void): () => void;
  /** 釋放這個頻道佔用的資源；共用連線（WebSocket、worker）只取消訂閱，不關連線。 */
  close(): void;
}

/**
 * 依完整頻道名稱建立傳輸層；目前環境不支援時回 `undefined`，
 * 讓 `fallbackTransport` 改用下一個、`createChannel` 退化成只在本分頁運作。
 */
export type ChannelTransportFactory = (channelName: string) => ChannelTransport | undefined;
