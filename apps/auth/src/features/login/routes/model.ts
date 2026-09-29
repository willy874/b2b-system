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
});
export type LoginSearch = z.infer<typeof LoginSearchSchema>;

/** IdP 帶回來的參數（OIDC 授權回應）。 */
export const SsoCallbackSearchSchema = z.object({
  code: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});
export type SsoCallbackSearch = z.infer<typeof SsoCallbackSearchSchema>;

/** provider 的協定錯誤（`renderError` 轉過來）。 */
export const SsoErrorSearchSchema = z.object({
  error: z.string().max(64).optional().catch(undefined),
});
export type SsoErrorSearch = z.infer<typeof SsoErrorSearchSchema>;

/** 帳號流程的信中連結（啟用、重設密碼、接受邀請）帶的 token。 */
export const TokenSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
});
export type TokenSearch = z.infer<typeof TokenSearchSchema>;
