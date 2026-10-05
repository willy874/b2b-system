/** 用來辨識「這是頻道訊息」的標記：同一條 WebSocket / Service Worker 上可能還有別的訊息。 */
export const CHANNEL_ENVELOPE_TAG = 'ge-channel';

/**
 * 在各種傳輸層上流動的訊息外框。
 * 伺服器（WebSocket）與 worker 中繼只需要認得這個形狀，不需要知道 payload 的內容。
 */
export interface ChannelEnvelope {
  tag: typeof CHANNEL_ENVELOPE_TAG;
  /** 完整頻道名稱（含 `ge:` 前綴）。共用連線（WebSocket、worker）靠它分流。 */
  channel: string;
  type: string;
  payload: unknown;
  /** 發送端實例的 id：自己送出的訊息被中繼回來時靠它略過。 */
  sender: string;
  /** `<sender>:<序號>`：同一則訊息從多個傳輸層送達時靠它去重。 */
  id: string;
}

export function isChannelEnvelope(value: unknown): value is ChannelEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as Partial<ChannelEnvelope>;
  return (
    envelope.tag === CHANNEL_ENVELOPE_TAG &&
    typeof envelope.channel === 'string' &&
    typeof envelope.type === 'string' &&
    typeof envelope.sender === 'string' &&
    typeof envelope.id === 'string'
  );
}

/** `crypto.randomUUID` 只在 secure context 可用（非 localhost 的 http 沒有），退回亂數即可：只用來區分實例。 */
export function createInstanceId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}
