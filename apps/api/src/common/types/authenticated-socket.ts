/**
 * handshake 驗證成功後放在 `socket.data` 的身分（docs/architecture/backend/08-realtime.md §3.2）。
 * 放在 `common/` 是因為 `WsAuthGuard`、`PermissionsGuard` 也要讀它，而它們不可 import `modules/`。
 */
export interface AuthenticatedSocketData {
  userId: string;
  email: string;
  /** 最後一次驗過的 token 的 `ver`；與 DB 的 `token_version` 不符即失效。 */
  tokenVersion: number;
  /** 連線的授權期限（epoch ms）= 最後一次驗過的 token 的 `exp`。 */
  expiresAt: number;
  /** 經 SSO 登入時的 IdP session（token 的 `sid`）；單一登出只撤銷這個 session 的連線。 */
  idpSessionUid?: string;
}

/**
 * guard 從 `ctx.switchToWs().getClient()` 拿到的連線：只描述需要的部分，
 * 不綁定 Socket.io 的型別，換傳輸層時 `common/` 不必跟著改。
 */
export interface WsClient {
  readonly id: string;
  readonly data: unknown;
  /** `close`：連底層連線一起關閉，而不只是離開 namespace。 */
  disconnect(close?: boolean): unknown;
}

/** 從連線取出已驗證的身分；handshake 沒走完（理論上不會發生）時回 undefined。 */
export function getSocketIdentity(
  socket: Pick<WsClient, 'data'>,
): AuthenticatedSocketData | undefined {
  const data = socket.data as Partial<AuthenticatedSocketData> | undefined;
  if (
    typeof data?.userId !== 'string' ||
    typeof data.email !== 'string' ||
    typeof data.tokenVersion !== 'number' ||
    typeof data.expiresAt !== 'number'
  ) {
    return undefined;
  }
  return data as AuthenticatedSocketData;
}
