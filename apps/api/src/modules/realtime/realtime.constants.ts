import type { Env } from '@/core/config';

/** 單一 frame 上限；超過時 Socket.io 直接斷線（docs/architecture/backend/08-realtime.md §11）。 */
export const REALTIME_MAX_FRAME_BYTES = 16 * 1024;

export const REALTIME_LIMITS = Symbol('REALTIME_LIMITS');

/**
 * 排空時把本節點的連線分成幾批斷開、攤在排空期的前幾成（docs/architecture/01-system.md §7 D13）：
 * 上千條連線不在同一秒重連到其他節點，最後一段留給最後一批完成重連。
 */
export const REALTIME_DRAIN_BATCHES = 10;
export const REALTIME_DRAIN_SPREAD = 0.8;

/** §11 的防濫用上限。以 provider 注入，整合測試可以覆寫成較小的值。 */
export interface RealtimeLimits {
  /** 每個 IP 在 `handshakeWindowMs` 內可建立的 handshake 數。 */
  handshakesPerIp: number;
  handshakeWindowMs: number;
  /** 每條連線在 `messageWindowMs` 內可送的訊息數；超過略過，超過兩倍斷線。 */
  messagesPerSocket: number;
  messageWindowMs: number;
  /** 每個使用者同時的連線數（所有裝置、所有分頁）。 */
  connectionsPerUser: number;
}

/**
 * 預設值。每 IP 的 handshake 按「整間公司共用一個 NAT 出口 IP、重新部署後同時重連」估算；
 * 部署時以 `REALTIME_HANDSHAKES_PER_IP`、`REALTIME_CONNECTIONS_PER_USER` 調整（`realtimeLimitsOf`）。
 */
export const DEFAULT_REALTIME_LIMITS: RealtimeLimits = {
  handshakesPerIp: 1200,
  handshakeWindowMs: 60_000,
  messagesPerSocket: 30,
  messageWindowMs: 10_000,
  connectionsPerUser: 20,
};

/** 環境變數 → 上限（其餘沿用預設值）。 */
export function realtimeLimitsOf(
  env: Pick<Env, 'REALTIME_HANDSHAKES_PER_IP' | 'REALTIME_CONNECTIONS_PER_USER'>,
): RealtimeLimits {
  return {
    ...DEFAULT_REALTIME_LIMITS,
    handshakesPerIp: env.REALTIME_HANDSHAKES_PER_IP,
    connectionsPerUser: env.REALTIME_CONNECTIONS_PER_USER,
  };
}
