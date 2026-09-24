import { isRealtimeAvailable } from '@/core/realtime';
import { createChannel } from '@/shared/channel';
import type { Channel } from '@/shared/channel';

import { queryClient } from './queryClient';
import type { InvalidationTarget } from './resourceGraph';

type InvalidateMessages = { invalidate: readonly InvalidationTarget[] };

let channel: Channel<InvalidateMessages> | undefined;

export interface ApplyInvalidationOptions {
  /**
   * `false`：只標成 stale、不立刻重抓。背景分頁用：回到前景時由 TanStack 的
   * `refetchOnWindowFocus` 重抓，不讓看不見的分頁跟著打 API。預設 `true`。
   */
  refetch?: boolean;
}

/**
 * 只在本分頁套用失效，不通知其他分頁。
 * 推播轉來的變更（`apis/resources.ts` 的 `applyResourceChanges`）走這裡：
 * 其他分頁會經 leader 分頁各自收到，再廣播只會讓它們失效兩次。
 */
export function applyInvalidation(
  targets: readonly InvalidationTarget[],
  { refetch = true }: ApplyInvalidationOptions = {},
): void {
  for (const { queryKey, action } of targets) {
    if (action === 'remove') queryClient.removeQueries({ queryKey });
    else void queryClient.invalidateQueries({ queryKey, refetchType: refetch ? 'active' : 'none' });
  }
}

export function initInvalidateChannel(): () => void {
  channel = createChannel<InvalidateMessages>('query-invalidate');
  // 收到的不再廣播，避免迴圈
  channel.on('invalidate', applyInvalidation);
  return () => {
    channel?.close();
    channel = undefined;
  };
}

/**
 * 本分頁的 mutation 成功：在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。
 *
 * 推播可用時，同瀏覽器的其他分頁會經 leader 分頁收到同一筆變更，不再經本機頻道廣播；
 * 斷線（或推播停用）時才由 BroadcastChannel 接手（docs/architecture/frontend/11-realtime.md §4.2）。
 * 兩個分頁連線狀態不同的短暫空窗裡，最壞情況是多失效一次，不會少失效。
 */
export function broadcastInvalidate(targets: readonly InvalidationTarget[]): void {
  applyInvalidation(targets);
  if (!isRealtimeAvailable()) channel?.post('invalidate', targets);
}
