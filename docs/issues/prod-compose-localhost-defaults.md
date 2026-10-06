# prod compose 的公開網址預設是 localhost，production 檢查不會擋，文件卻寫必填

## 現況

`docker-compose.prod.yml` 給公開網址的都是 localhost 預設值：

```yaml
DEFAULT_TENANT_DOMAINS: ${DEFAULT_TENANT_DOMAINS:-localhost:8080}        # L67（migrate）
REALTIME_ALLOWED_ORIGINS: ${PUBLIC_ORIGIN:-http://localhost:8080}       # L123
APP_PUBLIC_URL: ${PUBLIC_ORIGIN:-http://localhost:8080}                 # L139
PLATFORM_APP_URL: ${PLATFORM_PUBLIC_ORIGIN:-http://localhost:8081}      # L142
OIDC_ISSUER: ${PLATFORM_PUBLIC_ORIGIN:-http://localhost:8081}/api/oidc  # L143
```

- 兩個前端的 build arg 也一樣（L236–237、L261–262）。
- `TENANT_BASE_DOMAIN` 預設是空字串（L105）；沒設時取 `APP_PUBLIC_URL` 的 host。

production 檢查不看這些值：`apps/api/src/core/config/env.schema.ts` 的 `APP_PUBLIC_URL`、`PLATFORM_APP_URL`、`OIDC_ISSUER`（L256–274）只檢查格式是網址，`ProductionEnvSchema`（L383–421）不檢查協定與主機。

文件的說法不一致：

- [`04-sso.md`](../architecture/04-sso.md) §7 的表格（L248–249、L252）寫這些是必填。
- [README](../../README.md) 的必填清單（L148–151）與 `.env.example` 都沒有 `PUBLIC_ORIGIN`、`PLATFORM_PUBLIC_ORIGIN`。

開發與部署共用同一份 `.env`：

- README 叫開發者 `cp .env.example .env`（L59），部署也在同一個目錄執行 `docker compose -f docker-compose.prod.yml up --build`（L154）。
- compose 用根目錄的 `.env` 替換 `${…}`，所以開發 `.env` 裡的同名變數（例如 `SUPER_ADMIN_PASSWORD`、`DEFAULT_TENANT_DOMAINS`）會流進 production。

用到這些值的地方：

- 信件連結：`core/mail/mail.service.ts` 的 `link()`（L40–46）以 `APP_PUBLIC_URL` 的協定組網址；帳號流程的連結以 `PLATFORM_APP_URL` 開頭。
- presigned 網址：`core/storage/s3-object-storage.ts` 的 `presigner()`（L123–138）同樣以 `APP_PUBLIC_URL` 的協定組網址。
- 登入：
  - `modules/oidc-provider/tenant-redirect.ts` 的 `isTenantRedirectAllowed()`（L19–20）在 production 只接受 `https:` 的 redirect URI。
  - backstage 以 `location.origin` 組 redirect URI（`packages/web-core/src/auth/sso.ts` L59–61）。

## 影響

忘了設這些變數時，啟動不會失敗，而是以半壞的狀態上線：

- 完全使用預設值（瀏覽器開 `http://localhost:8080`）：redirect URI 是 `http://…`，production 不接受，所以無法登入。
- 設了網域、但忘了 `PUBLIC_ORIGIN`：
  - presigned 網址是 `http://<租戶網域>/storage/…`，在 https 的頁面上會被當成混合內容擋下，上傳與預覽都會失敗。
  - 信件裡的產品連結是 http；帳號流程（啟用、重設密碼）的連結指向 `http://localhost:8081`。
  - 新租戶的預設網域變成 `{code}.localhost:8080`。
- 前提是維運沒有設 `PUBLIC_ORIGIN` 或 `PLATFORM_PUBLIC_ORIGIN`。README 的必填清單沒有列出它們，很容易漏。

## 修正方式

1. compose 改成必填：`${PUBLIC_ORIGIN:?required}`、`${PLATFORM_PUBLIC_ORIGIN:?required}`、`${DEFAULT_TENANT_DOMAINS:?required}`（build arg 也一起改）。
2. `ProductionEnvSchema` 加檢查：
   - `APP_PUBLIC_URL`、`PLATFORM_APP_URL`、`OIDC_ISSUER` 必須是 `https:`，主機不能是 `localhost`、`127.0.0.1` 或 `*.localhost`。
   - `OIDC_ISSUER` 的 origin 必須等於 `PLATFORM_APP_URL`。
3. README 的必填清單補上 `PUBLIC_ORIGIN`、`PLATFORM_PUBLIC_ORIGIN`。
4. production 改用獨立的 env 檔，例如 `docker compose --env-file deploy/prod.env -f docker-compose.prod.yml …`。
   附一份 `deploy/prod.env.example` 列出 compose 用到的變數，並在 README 寫明不要沿用開發的 `.env`。

## 驗證方式

- 沒設這些變數時，`docker compose -f docker-compose.prod.yml config` 會失敗，並指出缺的是哪一個。
- 在 `apps/api/src/core/config/__tests__/env.schema.spec.ts` 補案例（都是 production）：
  - `APP_PUBLIC_URL=http://example.com` → 拋錯。
  - `PLATFORM_APP_URL=https://localhost` → 拋錯。
  - `OIDC_ISSUER` 與 `PLATFORM_APP_URL` 不同源 → 拋錯。
