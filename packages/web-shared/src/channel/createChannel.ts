import { EventEmitter } from '../EventEmitter';
import { CHANNEL_ENVELOPE_TAG, createInstanceId, isChannelEnvelope } from './envelope';
import type { ChannelEnvelope } from './envelope';
import { broadcastChannelTransport } from './transports/broadcastChannel';
import type { ChannelTransportFactory } from './transports/types';

const NAMESPACE_PREFIX = 'ge:';
/** 去重只需要記得「可能從另一條路晚到」的近期訊息。 */
const RECENT_ID_LIMIT = 256;

/**
 * 訊息型別 → payload 的對照表。
 * 以 `type` 宣告：`interface` 沒有隱含的索引簽章，無法滿足這個約束。
 *
 * payload 要能被所選傳輸層傳遞：`BroadcastChannel` / worker 用 structured clone（不能有函式），
 * localStorage / WebSocket 用 JSON（連 `Set`、`Map`、`Date` 都不行）。要換傳輸層時寫成純 JSON 最保險。
 */
export type ChannelMessageDict = Record<string, unknown>;

export interface ChannelOptions {
  /** 預設 `broadcastChannelTransport()`：只在本機同源分頁之間，不經過儲存或伺服器。 */
  transport?: ChannelTransportFactory;
}

export interface Channel<Messages extends ChannelMessageDict> {
  /** 送給其他參與者；**自己不會收到**。送不出去（不支援、分頁關閉中、斷線）時靜默略過。 */
  post<K extends keyof Messages & string>(type: K, payload: Messages[K]): void;
  on<K extends keyof Messages & string>(
    type: K,
    listener: (payload: Messages[K]) => void,
  ): () => void;
  close(): void;
}

/**
 * 型別化的同步頻道。傳輸層可替換（`BroadcastChannel`、localStorage、WebSocket、
 * SharedWorker、Service Worker，或組合），使用端的 `post` / `on` 寫法不變。
 *
 * 不論哪種傳輸層都保證同樣的語意：
 * - 名稱自動加上 `ge:` 前綴，同名的頻道彼此收發；共用連線上以名稱分流。
 * - 自己送出的訊息不會交給自己（即使被伺服器或 worker 轉回來）。
 * - 同一則訊息從多條路送達只處理一次（`combineTransports`）。
 * - 不是頻道外框、或不認得的 `type`（新舊版本並存）直接略過。
 * - 傳輸層不支援時退化成只在本實例運作，不拋例外。
 */
export function createChannel<Messages extends ChannelMessageDict>(
  name: string,
  options: ChannelOptions = {},
): Channel<Messages> {
  const channelName = NAMESPACE_PREFIX + name;
  const sender = createInstanceId();
  let sequence = 0;
  const recentIds = new Set<string>();
  const events = new EventEmitter<{ [K in keyof Messages]: (payload: Messages[K]) => void }>();
  const transport = (options.transport ?? broadcastChannelTransport())(channelName);

  const unsubscribe = transport?.subscribe((message) => {
    if (!isChannelEnvelope(message)) return;
    if (message.channel !== channelName || message.sender === sender) return;
    if (recentIds.has(message.id)) return;
    recentIds.add(message.id);
    // Set 依插入順序迭代：第一個就是最舊的
    if (recentIds.size > RECENT_ID_LIMIT)
      recentIds.delete(recentIds.values().next().value as string);
    // 對方送來的 payload 無法在執行期驗證型別；同一份原始碼的參與者共用同一張對照表
    (events.emit as (type: string, payload: unknown) => void)(message.type, message.payload);
  });

  let isClosed = false;

  return {
    post(type, payload) {
      if (isClosed) return;
      sequence += 1;
      const envelope: ChannelEnvelope = {
        tag: CHANNEL_ENVELOPE_TAG,
        channel: channelName,
        type,
        payload,
        sender,
        id: `${sender}:${sequence}`,
      };
      try {
        transport?.post(envelope);
      } catch {
        /* 分頁關閉中、連線中斷、payload 無法序列化：訊息送不到，與「沒有其他參與者」同樣處理 */
      }
    },
    on(type, listener) {
      return events.on(type, listener);
    },
    close() {
      if (isClosed) return;
      isClosed = true;
      unsubscribe?.();
      transport?.close();
      events.clear();
    },
  };
}
