import { z } from 'zod';

export const LoginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
  /** 剛登出（或被單一登出）：不自動跳轉到 IdP，讓使用者自己按「再次登入」。 */
  // core/router 的 search 值一律是字串（`?signedOut=true`）；navigate 時傳布林
  signedOut: z
    .preprocess(
      (value) => value === true || value === 'true' || undefined,
      z.literal(true).optional(),
    )
    .catch(undefined),
  /** session 為什麼結束（多半是後端錯誤碼，例：`AUTH_REFRESH_EXPIRED`）；登入頁依它說明。 */
  reason: z.string().max(64).optional().catch(undefined),
});
export type LoginSearch = z.infer<typeof LoginSearchSchema>;

/** IdP 帶回來的參數（OIDC 授權回應）。 */
export const SsoCallbackSearchSchema = z.object({
  code: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});
export type SsoCallbackSearch = z.infer<typeof SsoCallbackSearchSchema>;
