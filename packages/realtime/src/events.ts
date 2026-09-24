import type { ChannelEnvelopeWire } from './channel.js';
import type { ResourceChanged } from './resource.js';

/** 伺服器 → 客戶端的事件名稱（docs/architecture/backend/08-realtime.md §9）。 */
export const ServerEvent = {
  RESOURCE_CHANGED: 'resource.changed',
  SESSION_EXPIRED: 'session.expired',
  SESSION_REVOKED: 'session.revoked',
  CHANNEL_RELAY: 'channel.relay',
} as const;

export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent];

/** 客戶端 → 伺服器的事件名稱。 */
export const ClientEvent = {
  SESSION_RENEW: 'session.renew',
  CHANNEL_RELAY: 'channel.relay',
} as const;

export type ClientEvent = (typeof ClientEvent)[keyof typeof ClientEvent];

/** 撤銷原因沿用 HTTP 的錯誤碼，前端用同一套處理。 */
export const SessionRevokedReason = {
  TOKEN_STALE: 'AUTH_TOKEN_STALE',
  ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
} as const;

export type SessionRevokedReason = (typeof SessionRevokedReason)[keyof typeof SessionRevokedReason];

export interface SessionRevoked {
  reason: SessionRevokedReason;
}

export interface SessionRenewRequest {
  token: string;
}

export type SessionRenewResult = { ok: true } | { ok: false; code: string };

/** handshake 被拒時 `connect_error` 的 `err.data`。 */
export interface RealtimeConnectErrorData {
  code: string;
}

export interface ServerToClientEvents {
  'resource.changed': (payload: ResourceChanged) => void;
  'session.expired': () => void;
  'session.revoked': (payload: SessionRevoked) => void;
  'channel.relay': (envelope: ChannelEnvelopeWire) => void;
}

export interface ClientToServerEvents {
  'session.renew': (
    payload: SessionRenewRequest,
    ack: (result: SessionRenewResult) => void,
  ) => void;
  'channel.relay': (envelope: ChannelEnvelopeWire) => void;
}
