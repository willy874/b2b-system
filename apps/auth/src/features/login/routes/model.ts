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
  /** session 為什麼結束（多半是後端錯誤碼，例：`AUTH_REFRESH_EXPIRED`）；登入頁依它說明（UX-12）。 */
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

/** provider 的協定錯誤（`renderError` 轉過來）。 */
export const SsoErrorSearchSchema = z.object({
  error: z.string().max(64).optional().catch(undefined),
});
export type SsoErrorSearch = z.infer<typeof SsoErrorSearchSchema>;

/**
 * 帳號流程是哪個租戶的帳號（docs/adr/0020-physical-tenant-isolation.md D26）：
 * 信中連結與登入互動頁的連結帶 `?tenant=<代碼>`。
 */
export const TenantSearchSchema = z.object({
  tenant: z.string().max(63).optional().catch(undefined),
});
export type TenantSearch = z.infer<typeof TenantSearchSchema>;

/** 帳號流程的信中連結（啟用、重設密碼）帶的 token 與租戶。 */
export const TokenSearchSchema = TenantSearchSchema.extend({
  token: z.string().optional().catch(undefined),
});
export type TokenSearch = z.infer<typeof TokenSearchSchema>;
