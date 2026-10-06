# 平台端點的網域限制只比對小寫路徑，大小寫不同的路徑在未登記的網域上照樣進得去

## 現況

`apps/api/src/core/tenant/tenant.middleware.ts`（L19、L47–49）以區分大小寫的 regex 判斷平台端點：

```ts
const PLATFORM_PATH = /^\/platform(\/|$)/;
// …
if (host !== this.authHost && PLATFORM_PATH.test(req.originalUrl.split('?')[0] ?? '')) {
  throw new AppException('PLATFORM_ONLY');
}
```

Express 的路由預設不分大小寫。以 express 5.2.1（Nest 12.1.2）實測：

- `/PLATFORM/tenants`、`/Platform/tenants` 都會進到 `@Controller('platform/tenants')` 的 handler。
- 上面的 regex 對這兩個路徑都不匹配。

未登記的網域、直接以 IP 連線時沒有租戶脈絡。之後的檢查都只看「有沒有租戶」，不看是不是 apps/platform 的網域：

- `apps/api/src/common/guards/jwt-auth.guard.ts`（L37–42）：只有 `currentTenant()` 存在時才回 `PLATFORM_ONLY`。
- `apps/api/src/common/auth/access-token.verifier.ts` 的 `verifyClaims()`（L93–97）：沒有租戶時接受 `realm: 'platform'` 的 token。
- `apps/api/src/common/guards/permissions.guard.ts` 的 `checkPlatform()`（L102）：同樣只看 `currentTenant()`。
- `apps/api/src/modules/auth/platform-auth.service.ts` 的 `assertPlatformHost()`（L237–239）：同上。`ssoCallback`、`refresh`、`getProfile`、`setup` 等都只靠它。

三份 nginx 設定都是 `server_name _`（`deploy/nginx.conf` L15、`deploy/nginx.platform.conf` L16、`deploy/nginx.external-api.conf` L14），任何 Host 都會轉給後端。
租戶的預設網域另有 wildcard DNS（[`05-tenancy.md`](../architecture/05-tenancy.md) §7），所以 `nobody.<TENANT_BASE_DOMAIN>` 這種未登記的網域也連得到。

重現（Host 是未登記的網域；經反向代理時路徑前面多一段 `/api`）：

1. `GET /Platform/tenants`，帶平台管理者的 access token → 200。小寫的 `/platform/tenants` 回 `404 PLATFORM_ONLY`。
2. `GET /Platform/auth/profile`，同一個 token → 200。

只知道平台管理者的密碼、又碰不到 apps/platform 的網域時，也能登入：

1. `/oidc/*` 在任何網域都由 provider 處理（`oidc-provider.module.ts` L39）。provider 以 `OIDC_ISSUER` 覆寫 Host（`oidc-provider.service.ts` L267），`/oidc-interaction/*` 也沒有網域限制。
2. 腳本在未登記的網域跑完 client `auth` 的登入互動，從 resume 的跳轉取得授權碼。
3. 打 `POST /Platform/auth/sso/callback`，換到平台的 session。

## 影響

- [`05-tenancy.md`](../architecture/05-tenancy.md) §2 承諾：平台端點在 apps/platform 以外的網域一律 `404 PLATFORM_ONLY`，WAF 與 IP 白名單只要套在一個網域上。[`overview/04-introduction.md`](../overview/04-introduction.md) 也這樣介紹。這個承諾不成立。
- 前提：
  - 攻擊者已經拿到平台管理者的 access token、refresh token 或密碼（目前沒有 MFA）。
  - 部署靠 apps/platform 網域上的 IP 白名單或 WAF 擋外部存取。
- 部署沒有這類網路控制時，影響只剩「平台端點在每個網域上都能用」。
- 平台端點能建立、停用、刪除租戶，也能管理平台管理者。

## 修正方式

1. 立即：`PLATFORM_PATH` 加上 `i`（`/^\/platform(\/|$)/i`），與 Express 的比對方式一致。
2. 根本（建議一起做）：不要以「沒有租戶」代替「是 apps/platform 的網域」。
   - `TenantMiddleware` 把「這個請求是不是 authHost」放進請求脈絡。
   - `JwtAuthGuard`、`PermissionsGuard.checkPlatform()`、`assertPlatformHost()` 改看它：平台端點只在 authHost 上通過，不依賴路徑字串。
3. 加固：`/oidc/*` 與 `/oidc-interaction/*` 也只在 authHost 上提供。issuer 本來就在 apps/platform 的 origin（[`04-sso.md`](../architecture/04-sso.md) §2）。

## 驗證方式

- `apps/api/test/platform-admin.spec.ts` 已經對 `unknown.example.test`、`10.0.0.5` 測了小寫路徑（L178–194）。在同一個迴圈補：
  - `GET /PLATFORM/tenants`，帶平台 token → `404 PLATFORM_ONLY`。
  - `GET /Platform/auth/profile`，帶平台 token → `404 PLATFORM_ONLY`。
- 做了第 3 點時，再補一個案例：非 authHost 的 `GET /oidc/.well-known/openid-configuration` 回 404。
