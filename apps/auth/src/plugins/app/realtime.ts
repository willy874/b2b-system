import type { AppPluginFactory } from '@/core/app';
import { getSessionStore } from '@/core/auth';
import { queryClient } from '@/core/cache';
import {
  CLIENT_ID,
  createRealtimeControlChannel,
  RealtimeClient,
  RealtimeCoordinator,
  setActiveRealtimeClient,
  socketIoRealtimeTransport,
} from '@/core/realtime';
import type { ApplyOptions, CreateRealtimeTransport } from '@/core/realtime';
import { browserLeaderAdapters, createLeaderElection } from '@/shared/channel';
import type { ChannelTransportFactory, LeaderElectionAdapters } from '@/shared/channel';
import type { ResourceChangeWire } from '@/shared/websocket-sdk';

export interface RealtimePluginOptions {
  /** 推播來自哪個後端；用它的 session 做 handshake 與續期，選舉與頻道也以它區隔。 */
  backend: string;
  /**
   * 推播轉來的來源變更 → 依賴圖換算 → 本分頁失效。
   * 由 `main.tsx` 注入 `applyResourceChanges`：plugin 不能 import `apis/`。
   */
  onResourceChanged: (changes: readonly ResourceChangeWire[], options: ApplyOptions) => void;
  /** 連線的實作；預設 Socket.io，測試注入假的。 */
  createTransport?: CreateRealtimeTransport;
  /** 測試注入假的選舉環境（頻道、計時、可見性）。 */
  leaderAdapters?: LeaderElectionAdapters;
  /** 測試注入 control channel 的傳輸層；預設 BroadcastChannel。 */
  controlTransport?: ChannelTransportFactory;
}

/**
 * 即時推播（docs/architecture/frontend/11-realtime.md §3）：同源的所有分頁共用 **一條** 連線。
 *
 * | 時機                 | 動作                                                              |
 * | -------------------- | ----------------------------------------------------------------- |
 * | `use()`（同步）      | 建立連線物件（不連線）、選舉、control channel、協調者              |
 * | `onInit`             | 開始選舉；當選的分頁才依 session 連線，其他分頁經 control channel 收轉發 |
 * | `pagehide` / `pageshow` | 分頁關閉或進 bfcache 時讓位；從 bfcache 回來時重新參與           |
 * | `onDestroy`          | 讓位、斷線、關閉頻道                                               |
 *
 * 必須註冊在 `httpContextPlugin` 之後：要用它建立的 session（含 refreshFn）。
 * Mock 模式不註冊（MSW 不處理推播連線），行為等同推播停用。
 */
export function realtimePlugin(options: RealtimePluginOptions): AppPluginFactory {
  return () => {
    const { backend } = options;
    // 在同步階段就建立：`realtime.relay` 讓頻道可以在啟動時就綁上 `serverRelayTransport`
    const realtime = new RealtimeClient({
      session: getSessionStore(backend),
      createTransport: options.createTransport ?? socketIoRealtimeTransport(),
    });
    const adapters = options.leaderAdapters ?? browserLeaderAdapters(`realtime:${backend}`);
    const election = createLeaderElection(adapters, {
      counterKey: `b2b-system:leader:realtime:${backend}:counter`,
    });
    const coordinator = new RealtimeCoordinator({
      client: realtime,
      election,
      channel: createRealtimeControlChannel(backend, { transport: options.controlTransport }),
      clientId: CLIENT_ID,
      applyChanges: options.onResourceChanged,
      resync: (applyOptions) => queryClient.revalidateAll(applyOptions),
      visibility: adapters.visibility,
    });
    setActiveRealtimeClient(realtime, coordinator);

    // 關閉分頁時主動讓位，其他分頁不必等心跳逾時；進 bfcache 的分頁回來時重新參與
    const onPageHide = () => coordinator.stop();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) coordinator.start();
    };

    return {
      name: 'realtime',
      attrs: { realtime, realtimeCoordinator: coordinator },
      onInit: () => {
        // 先由協調者交出擁有權，再接上 session：選出 leader 之前不連線
        coordinator.start();
        realtime.start();
        globalThis.addEventListener?.('pagehide', onPageHide);
        globalThis.addEventListener?.('pageshow', onPageShow);
      },
      onDestroy: () => {
        globalThis.removeEventListener?.('pagehide', onPageHide);
        globalThis.removeEventListener?.('pageshow', onPageShow);
        coordinator.dispose();
        realtime.destroy();
        setActiveRealtimeClient(undefined);
      },
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    /** Mock 模式不註冊 plugin，這時沒有連線。 */
    realtime?: RealtimeClient;
    realtimeCoordinator?: RealtimeCoordinator;
  }
}
