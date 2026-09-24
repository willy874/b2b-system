import { queryClient } from './queryClient';
import type { InvalidationTarget } from './resourceGraph';

const CHANNEL_NAME = 'ge:query-invalidate';

let channel: BroadcastChannel | undefined;

function apply(targets: readonly InvalidationTarget[]): void {
  for (const { queryKey, action } of targets) {
    if (action === 'remove') queryClient.removeQueries({ queryKey });
    else void queryClient.invalidateQueries({ queryKey });
  }
}

export function initInvalidateChannel(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<{ targets: readonly InvalidationTarget[] }>) => {
    // 不再廣播，避免迴圈
    apply(event.data.targets);
  };
  return () => {
    channel?.close();
    channel = undefined;
  };
}

/** 在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。 */
export function broadcastInvalidate(targets: readonly InvalidationTarget[]): void {
  apply(targets);
  try {
    channel?.postMessage({ targets });
  } catch {
    /* 分頁關閉中：忽略 */
  }
}
