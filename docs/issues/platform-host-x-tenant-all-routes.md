# apps/platform 網域上的 X-Tenant 對所有路由生效，租戶的 access token 在平台網域上也能用

## 現況

`apps/api/src/core/tenant/tenant.middleware.ts` 的 `resolve()`（L58–66）：在 apps/platform 的網域上，只要帶 `X-Tenant` 就進入那個租戶，不分路由。

```ts
if (host === this.authHost) {
  const code = req.header(TENANT_HEADER)?.trim();
  return code ? this.directory.findByCode(code) : undefined;
}
```

`AccessTokenVerifier.verifyClaims()`（`apps/api/src/common/auth/access-token.verifier.ts` L93–97）只比對 `tid` 與目前的租戶，不知道租戶是由網域還是由標頭決定的。所以：

1. 在 apps/platform 的網域送 `GET /users`，帶 `X-Tenant: acme` 與 acme 的 access token → 200。
2. 租戶的其他端點也都能經由平台網域呼叫，包括 `/auth/login`、`/auth/sso/callback`、`/auth/refresh`。

規格只把這個標頭給帳號流程用（[`05-tenancy.md`](../architecture/05-tenancy.md) §2、§10.2 D26）。
apps/platform 實際帶它的只有六個公開端點（`apps/platform/src/apis/auth/tenant.ts` 的 `tenantHeaders()`）：

- `POST /auth/setup`、`GET /auth/setup/verify`
- `POST /auth/register`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /system/settings/public`

`apps/api/test/sso.spec.ts` 的「apps/platform 的帳號流程以 X-Tenant 指定租戶」（L604）只測了 `forgot-password`。

## 影響

- 與 [`04-sso.md`](../architecture/04-sso.md) §1.1 不一致：租戶的 access token「只在那個租戶的網域有效」。
- 不會跨租戶：`tid` 仍要等於標頭指定的租戶。平台管理者的 token 在有租戶的脈絡裡也一樣被拒。
- 只套在某個租戶網域上的網路控制（例：客戶要求的 IP 白名單），可以經由 apps/platform 的網域繞過。
- apps/platform 網域的存取日誌與 WAF 規則，會混進租戶的 API 流量。

## 修正方式

擇一：

1. （建議）`TenantMiddleware` 只對上面六個帳號流程的端點採用 `X-Tenant`；其他路由在 apps/platform 上維持沒有租戶。這符合 D26 的範圍。
   - 路徑比對不分大小寫。
   - 比對不上時一律不採用標頭：沒有租戶是安全的方向。
2. 在請求脈絡記下租戶的來源（網域或標頭）。來源是標頭時，`AccessTokenVerifier` 一律拒絕 access token。
   - 公開端點照常可用，包括 `/auth/login`、`/auth/sso/callback`。

## 驗證方式

在 `apps/api/test/sso.spec.ts` 的 X-Tenant 案例（L604）補：

- apps/platform 的網域 ＋ `X-Tenant` ＋ 該租戶的 access token 打 `GET /users`。
  - 方案 1：`404 TENANT_NOT_FOUND`。
  - 方案 2：`401 AUTH_TOKEN_INVALID`。
- 六個帳號流程的端點照常可用。
