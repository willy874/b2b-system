import { queryClient } from './queryClient';

const CHANNEL_NAME = 'ge:query-invalidate';

let channel: BroadcastChannel | undefined;

export function initInvalidateChannel(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<{ queryKey: readonly unknown[] }>) => {
    // 不再廣播，避免迴圈
    void queryClient.invalidateQueries({ queryKey: event.data.queryKey });
  };
  return () => {
    channel?.close();
    channel = undefined;
  };
}

/** 在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。 */
export function broadcastInvalidate(queryKey: readonly unknown[]): void {
  void queryClient.invalidateQueries({ queryKey });
  try {
    channel?.postMessage({ queryKey });
  } catch {
    /* 分頁關閉中：忽略 */
  }
}
