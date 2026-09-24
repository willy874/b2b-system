import { createChannel } from '@/shared/channel';
import type { Channel } from '@/shared/channel';

import { queryClient } from './queryClient';
import type { InvalidationTarget } from './resourceGraph';

type InvalidateMessages = { invalidate: readonly InvalidationTarget[] };

let channel: Channel<InvalidateMessages> | undefined;

function apply(targets: readonly InvalidationTarget[]): void {
  for (const { queryKey, action } of targets) {
    if (action === 'remove') queryClient.removeQueries({ queryKey });
    else void queryClient.invalidateQueries({ queryKey });
  }
}

export function initInvalidateChannel(): () => void {
  channel = createChannel<InvalidateMessages>('query-invalidate');
  // 收到的不再廣播，避免迴圈
  channel.on('invalidate', apply);
  return () => {
    channel?.close();
    channel = undefined;
  };
}

/** 在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。 */
export function broadcastInvalidate(targets: readonly InvalidationTarget[]): void {
  apply(targets);
  channel?.post('invalidate', targets);
}
