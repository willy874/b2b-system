import { LOGOUT_INCOMPLETE } from '@b2b-system/web-core/auth';
import { z } from 'zod/mini';

export const LoginSearchSchema = z.object({
  redirect: z.catch(z.optional(z.string()), undefined),
  /** 剛登出（或被單一登出）：不自動跳轉到 IdP，讓使用者自己按「再次登入」。 */
  // core/router 的 search 值一律是字串（`?signedOut=true`）；navigate 時傳布林
  signedOut: z.catch(
    // optional：沒帶時這個鍵可以省略（導覽時不必給）
    z.optional(
      z.pipe(
        z.transform((value) => value === true || value === 'true' || undefined),
        z.optional(z.literal(true)),
      ),
    ),
    undefined,
  ),
  /** session 為什麼結束（多半是後端錯誤碼，例：`AUTH_REFRESH_EXPIRED`）；登入頁依它說明。 */
  reason: z.catch(z.optional(z.string().check(z.maxLength(64))), undefined),
  /** 伺服器端的登出沒有完成（docs/architecture/04-sso.md §3.4）：顯示警示與「重試登出」。 */
  logout: z.catch(z.optional(z.literal(LOGOUT_INCOMPLETE)), undefined),
});
export type LoginSearch = z.infer<typeof LoginSearchSchema>;

/** IdP 帶回來的參數（OIDC 授權回應）。 */
export const SsoCallbackSearchSchema = z.object({
  code: z.catch(z.optional(z.string()), undefined),
  state: z.catch(z.optional(z.string()), undefined),
  error: z.catch(z.optional(z.string()), undefined),
});
export type SsoCallbackSearch = z.infer<typeof SsoCallbackSearchSchema>;
