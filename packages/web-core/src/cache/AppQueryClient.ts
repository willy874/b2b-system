import { createChannel } from '@b2b-system/web-shared/channel';
import type { Channel, ChannelOptions } from '@b2b-system/web-shared/channel';
import { QueryClient } from '@tanstack/react-query';
import type { QueryClientConfig } from '@tanstack/react-query';

import { isRealtimeAvailable } from '../realtime';
import type { InvalidationTarget } from './resourceGraph';

export type QueryInvalidateMessages = { invalidate: readonly InvalidationTarget[] };

/** 快取失效的跨分頁頻道：由 `AppQueryClient` 持有。 */
export function createQueryInvalidateChannel(
  options?: ChannelOptions,
): Channel<QueryInvalidateMessages> {
  return createChannel('query-invalidate', options);
}

export interface ApplyInvalidationOptions {
  /**
   * `false`：只標成 stale、不立刻重抓。背景分頁用：回到前景時由 TanStack 的
   * `refetchOnWindowFocus` 重抓，不讓看不見的分頁跟著打 API。預設 `true`。
   */
  refetch?: boolean;
}

export interface AppQueryClientOptions extends QueryClientConfig {
  /** 預設 `createQueryInvalidateChannel()`；交給 client 後由它負責關閉（`dispose()`）。 */
  channel?: Channel<QueryInvalidateMessages>;
  /** 推播是否可用；可用時失效不經本機頻道廣播。預設看目前 app 的推播協調者。 */
  isRealtimeAvailable?: () => boolean;
}

/**
 * 加上跨分頁失效的 `QueryClient`。其餘行為與 TanStack 的 `QueryClient` 相同，
 * 可以直接交給 `QueryClientProvider`。
 *
 * | 方法                    | 本分頁 | 其他分頁                                            |
 * | ----------------------- | ------ | --------------------------------------------------- |
 * | `broadcastInvalidation` | 失效   | 推播不可用時經 `query-invalidate` 頻道通知         |
 * | `applyInvalidation`     | 失效   | 不通知（推播轉來的變更：其他分頁會經 leader 各自收到） |
 * | `revalidateAll`         | 全部失效 | 不通知（推播中斷後由各分頁自己重新驗證）           |
 *
 * 頻道的收訊在 `start()` 到 `stop()` 之間（由 cache plugin 管理）。
 */
export class AppQueryClient extends QueryClient {
  private readonly channel: Channel<QueryInvalidateMessages>;
  private readonly isRealtimeAvailable: () => boolean;
  private offChannel: (() => void) | undefined;

  constructor({
    channel,
    isRealtimeAvailable: realtimeAvailable = isRealtimeAvailable,
    ...config
  }: AppQueryClientOptions = {}) {
    super(config);
    this.channel = channel ?? createQueryInvalidateChannel();
    this.isRealtimeAvailable = realtimeAvailable;
  }

  /** 開始套用其他分頁送來的失效。重複呼叫無作用。 */
  start(): void {
    // 收到的只在本分頁套用、不再廣播，避免迴圈
    this.offChannel ??= this.channel.on('invalidate', (targets) => this.applyInvalidation(targets));
  }

  stop(): void {
    this.offChannel?.();
    this.offChannel = undefined;
  }

  dispose(): void {
    this.stop();
    this.channel.close();
  }

  /** 只在本分頁套用失效，不通知其他分頁。 */
  applyInvalidation(
    targets: readonly InvalidationTarget[],
    { refetch = true }: ApplyInvalidationOptions = {},
  ): void {
    for (const { queryKey, action } of targets) {
      if (action === 'remove') this.removeQueries({ queryKey });
      else void this.invalidateQueries({ queryKey, refetchType: refetch ? 'active' : 'none' });
    }
  }

  /**
   * 本分頁的 mutation 成功：在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。
   *
   * 推播可用時，同瀏覽器的其他分頁會經 leader 分頁收到同一筆變更，不再經本機頻道廣播；
   * 斷線（或推播停用）時才由頻道接手（docs/architecture/frontend/11-realtime.md §4.2）。
   * 兩個分頁連線狀態不同的短暫空窗裡，最壞情況是多失效一次，不會少失效。
   */
  broadcastInvalidation(targets: readonly InvalidationTarget[]): void {
    this.applyInvalidation(targets);
    if (!this.isRealtimeAvailable()) this.channel.post('invalidate', targets);
  }

  /** 整批重新驗證本分頁的 query（推播中斷後可能漏了變更）。 */
  revalidateAll({ refetch = true }: ApplyInvalidationOptions = {}): void {
    void this.invalidateQueries({ refetchType: refetch ? 'active' : 'none' });
  }
}
