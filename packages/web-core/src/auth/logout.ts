import { sessionStore } from './SessionStore';
import type { SessionStore } from './SessionStore';

/**
 * 撤銷後端 session 的請求（app 的 `apis/auth/logout`）：有 access token 時以 bearer 認人；
 * 沒有時以 refresh cookie 認人，要帶 `x-refresh-request: 1`（docs/architecture/04-sso.md §3.4）。
 */
export interface RevokeSessionRequest {
  accessToken?: string;
}

/** 登入頁的 `?logout=` 值：伺服器端的登出沒有完成（撤銷失敗或沒送出），登入頁顯示警示與「重試登出」。 */
export const LOGOUT_INCOMPLETE = 'incomplete';

export interface SignOutOptions {
  /** 結束前端 session 的原因（各 app 的 `LOGOUT_REASON`）。 */
  reason: string;
  /** 通知後端撤銷整條 refresh 家族、結束 IdP session。 */
  revoke: (request: RevokeSessionRequest) => Promise<unknown>;
  /** 預設主後端的 session。 */
  session?: SessionStore;
}

/**
 * 登出（docs/architecture/frontend/09-state-and-storage.md §5.2）。順序很重要（先結束前端、再撤銷後端）：
 *
 * 1. 等手上的續期結束，取得目前的 token（不這樣做，晚回來的續期會把登出的頁面救活）
 * 2. 結束前端 session：中止帶身分的請求、清掉 token、通知其他分頁、導回登入頁
 * 3. 通知後端撤銷：有第 1 步的 token 就帶 bearer；續期失敗（離線、5xx、429）拿不到 token 時改以 refresh cookie
 *
 * 回傳後端是否完成撤銷。失敗時前端仍然登出（使用者按了登出就是要離開），但 IdP session 可能還在——
 * 下一個人打開產品會被它直接登入——呼叫端要讓使用者知道並提供重試（`LOGOUT_INCOMPLETE`）。
 */
export async function signOut({
  reason,
  revoke,
  session = sessionStore,
}: SignOutOptions): Promise<boolean> {
  const accessToken = await session.ensureAccessToken().catch(() => undefined);
  session.endSession(reason);
  try {
    await revoke(accessToken ? { accessToken } : {});
    return true;
  } catch {
    // 不往外拋：前端已經登出，失敗轉成回傳值，由呼叫端標記「登出未完成」
    return false;
  }
}
