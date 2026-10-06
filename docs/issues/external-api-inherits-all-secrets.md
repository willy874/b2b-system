# 對外 API 的容器繼承了 api 全部的秘密，包含佈建角色的連線字串

## 現況

`docker-compose.prod.yml` L164–165：

```yaml
environment:
  <<: *api-environment
```

因此 external-api 拿到 api 的全部變數，其中有它用不到的秘密：

- `TENANT_PROVISIONING_DATABASE_URL`（L92）：佈建角色 `b2b_provisioner` 的連線字串。
  這個角色有 `CREATEDB` 與 `CREATEROLE`；`deploy/postgres/10-roles.sh` L27–30 又以 `createrole_self_grant 'set, inherit'` 讓它繼承每一個它建立的租戶角色。
- `JWT_SECRET`（L106）：用來簽內部 api 的 access token（租戶使用者與平台管理者都是）。
- `OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`（L144–146）：簽 ID token、簽 IdP cookie、解開外部 IdP 的 client secret。
- `MAIL_SMTP_URL`（L134）：可能含 SMTP 帳密。對外程序只入列、不寄信。

對外程序不載入這些功能：

- `src/external-api.module.ts`（L49–89）沒有 import `AuthModule`、OIDC provider，也沒有外部 IdP。
- `JwtModule.register({ global: true })`（L71）不帶金鑰，註解寫明「這個程序從不驗 JWT」。
- `JWT_SECRET` 在這個程序裡只用在兩處：一律拒絕的 JWT 驗證，以及推導影像網址的金鑰（`modules/file/file-image.service.ts` L77）。對外 API 回傳的檔案不帶影像網址。

但目前也拿不掉：

- 兩個程序共用同一份 `env.schema.ts`。它的 production 檢查（L383–421）要求 `JWT_SECRET`（L68：至少 32 字、不能是範例值）、`OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY`。
- `TENANT_PROVISIONING_DATABASE_URL` 則是選填（L55–58）。

[`06-external-api.md`](../architecture/06-external-api.md) §6 寫「沿用 api 的 environment（YAML merge）」，沒有討論秘密的範圍。

## 影響

對外入口是給整合方的程序與網域。它一旦發生 RCE 或環境變數外洩，受影響的範圍會超出它本來需要的權限：

- 它本來就持有平台 DB 的連線與 `TENANT_SECRET_KEY`（要連每個租戶的 DB），所以 DB 的資料本來就在範圍內。
- 多出來的部分：
  - 能簽內部 api 的 access token 與 ID token。
  - 能解開外部 IdP 的 client secret。
  - 能以佈建角色，在整個 postgres 叢集建立、修改角色與 database。

前提是對外程序已經被攻破。這一項是縮小爆炸半徑，不是可以直接利用的漏洞。

## 修正方式

1. 現在就能做：external-api 不再繼承 `TENANT_PROVISIONING_DATABASE_URL`（schema 本來就是選填）。
   YAML merge 不能刪除 key，所以要把共用的部分拆成兩個 anchor：`&common-env` 與 `&api-only-env`。api 合併兩個，external-api 只合併前者。
2. 為對外程序另做一份 schema（例如 `ExternalEnvSchema`），production 時不要求 OIDC、IdP、webhook 的金鑰。
   `JWT_SECRET` 確認不需要之後，可以改給這個程序專用的隨機值（`AccessTokenModule` 仍需要一個 `JwtService`）。
3. 改用 Docker secrets（`*_FILE` 變數）掛載金鑰，避免金鑰出現在 `docker inspect` 與 `/proc/<pid>/environ`。
4. 更新 06-external-api.md §6，寫明對外程序拿到哪些秘密。

## 驗證方式

- `docker compose -f docker-compose.prod.yml config` 的 `external-api` 沒有 `TENANT_PROVISIONING_DATABASE_URL`。做完第 2 步後，也沒有 OIDC 與 IdP 的金鑰。
- `apps/api/test/external-api.spec.ts`、`external-api-v1.spec.ts` 照常通過。
- 若做了 `ExternalEnvSchema`，在 `env.schema.spec.ts` 補案例：
  - 對外程序在 production 缺 OIDC 金鑰時仍可啟動。
  - 缺平台 DB 時啟動失敗。
