import type { ChannelTransportFactory } from './types';

/**
 * 經由伺服器中繼：跨裝置、跨瀏覽器同步（例：同一個帳號在兩台電腦開著編輯器）。
 * 所有頻道共用傳入的這一條連線，以外框的 `channel` 分流。
 *
 * 伺服器端的約定：收到 `isChannelEnvelope()` 的 frame 就原樣轉給「該收的其他連線」
 * （例：同一個使用者）；轉回給發送者也沒關係，會以 `sender` 略過。
 *
 * - 連線由呼叫端建立與關閉（含重連）；頻道 `close()` 只取消訂閱。
 * - 連線中（`CONNECTING`）送出的訊息先排隊，`open` 後依序送出；已關閉時直接丟棄。
 * - payload 必須能 JSON 序列化；非 JSON 的 frame（同一條連線上的其他協定）略過。
 */
export function webSocketTransport(socket: WebSocket): ChannelTransportFactory {
  const pending: string[] = [];
  socket.addEventListener('open', () => {
    for (const frame of pending.splice(0)) socket.send(frame);
  });

  return () => ({
    post(envelope) {
      const frame = JSON.stringify(envelope);
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
      else if (socket.readyState === WebSocket.CONNECTING) pending.push(frame);
    },
    subscribe(listener) {
      const handler = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          listener(JSON.parse(event.data));
        } catch {
          /* 不是 JSON：同一條連線上的其他訊息，不歸頻道管 */
        }
      };
      socket.addEventListener('message', handler);
      return () => socket.removeEventListener('message', handler);
    },
    close() {},
  });
}
