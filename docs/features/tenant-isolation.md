# 租戶實體隔離

- 優先度：P0
- 狀態：實作中（branch：`refactor/rename-web-to-backstage`）
- 依賴：—
- 相關：[ADR-0020](../adr/0020-physical-tenant-isolation.md)（本功能的決定，取代 ADR-0018）、[ADR-0019](../adr/0019-sso-identity-platform.md)、
  [`../architecture/04-sso.md`](../architecture/04-sso.md)、[`multi-instance.md`](./multi-instance.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。
> 本檔取代原本的 `workspace.md`（共用資料表的工作區，ADR-0018）。

## 背景

ADR-0018 的工作區是「共用資料表 ＋ `workspace_id`」，帳號跨工作區共用，backstage 以 `/w/:slug` 與切換器呈現工作區。
新的要求是：

- backstage 看不到租戶的切分，仍以「使用者」為核心，沒有成員的設計；要換租戶只能在 `apps/auth`。
- `apps/auth` 的管理者與 backstage 的管理者是兩份資料。
- 在 auth 登入時沒有帶租戶 → 以 auth 管理者的身分登入；以租戶登入 → 完成後自動登入該租戶的 backstage。
- 從 backstage 的登入畫面跳到 auth 時帶上租戶資訊。
- 租戶是實體硬切分：獨立的 database 與網域。

決定與理由見 ADR-0020；這份文件只寫要做的事與順序。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 平台 DB 與租戶 DB 分離，每租戶一個 database 與 DB 角色 | 每租戶一整套部署（ADR-0020 隔離層級 D） |
| 依網域（Host）解析租戶、依租戶路由連線池 | PgBouncer、跨叢集搬移租戶 |
| 平台管理者（apps/auth）與租戶使用者（backstage）兩套帳號與權限 | auth 列出「你屬於哪些租戶」 |
| 租戶的建立（自動佈建 database、bucket、第一位管理員）、停用、標記刪除 | 管理頁一鍵 `DROP DATABASE`（只有腳本） |
| OIDC 帶租戶：`tenant` 參數、帶租戶的 `accountId`、redirect URI 與 BFF 的交叉檢查 | 每租戶一個 issuer |
| auth 的「進入租戶」頁（輸入代碼 → 跳到該租戶的 backstage 登入） | 客戶自訂網域的自動 TLS（先由部署手動處理） |
| 外部 IdP 連線、稽核、背景工作、推播、快取、物件儲存改為租戶感知 | 跨租戶報表 |
| 移除工作區（成員、`scope`、`/w/:slug`、切換器、工作區邀請） | 把既有工作區資料轉成多個租戶 |

## 使用者故事

**作為租戶 Acme 的使用者，我希望打開 Acme 的後台網址就能登入，而且完全不用知道「租戶」這件事。**

- **Given** Acme 的網域是 `acme.backstage.example.com`，我在 Acme 有帳號
- **When** 我打開該網址 → 被帶到 auth 的登入頁（顯示「Acme」）→ 輸入帳密
- **Then** 回到 Acme 的後台並已登入；後台沒有任何工作區／租戶的選單

**作為同時在 Acme 與 Beta 有帳號的人，我希望在 auth 換到 Beta。**

- **Given** 我已登入 Acme
- **When** 我在 auth 的「進入租戶」頁輸入 `beta`
- **Then** 跳到 Beta 的後台登入；因為 Beta 是另一個帳號，要重新輸入 Beta 的帳密；Acme 的分頁仍維持登入

**作為平台管理者，我希望不帶租戶登入 auth 管理租戶，但看不到任何租戶的資料。**

- **Given** 我是平台管理者（平台 DB 的帳號）
- **When** 我直接打開 auth 並登入
- **Then** 看到租戶管理頁；若我用同樣的 email 去登入 Acme，會被當成 Acme 的帳號驗證（不存在就失敗）

**作為平台管理者，我希望建立一個新租戶。**

- **Given** 我持有 `tenant:create`
- **When** 我填入代碼 `beta`、名稱、網域與第一位管理員的 email
- **Then** 租戶狀態從 `provisioning` 變成 `active`；第一位管理員收到啟用信，設定密碼後進入 Beta 的後台，擁有 `admin` 角色

## 初步構想

- **資料模型**
  - 平台 DB（新 migration 線 `apps/api/src/db/platform/`）：`tenants`（`code` 唯一、`name`、`status`、`db_name`、`db_role`、
    `db_password_encrypted`、`storage_bucket`、`schema_version`、軟刪除）、`tenant_domains`（`domain` 主鍵 → `tenant_id`）、
    `platform_admins`、`platform_roles`、`platform_admin_roles`、`platform_permissions`、`platform_role_permissions`、
    `platform_audit_logs`、`platform_refresh_tokens`、`oidc_payloads`（從租戶搬過來）、pg-boss 的 schema。
  - 租戶 DB（既有 migration 線改名為 `apps/api/src/db/tenant/`，重新 baseline）：現有的表，**移除** `workspaces*`、
    `permissions.scope`／`roles.scope`、`file_folders`／`files` 的 `workspace_id`、`oidc_payloads`。
- **後端**
  - `core/tenant`：`TenantContext`（`AsyncLocalStorage`，併入既有的 `core/http/request-context.ts`）、`TenantResolver`（Host → 租戶，快取）、
    `TenantDatabaseRegistry`（每租戶連線池、LRU、閒置關閉）、`TenantDb`（取目前租戶的 `db`，沒有脈絡就拋錯）、`runInTenant()`。
  - `core/database`：`DRIZZLE` 拆成 `PLATFORM_DB` 與 `TenantDb`；`transaction.ts` 兩邊各一份。
  - 全域 middleware：租戶網域的請求解析租戶（找不到 404、停用 503、schema 落後 503）；apps/auth 網域不帶租戶。
  - `modules/tenant`（新，平台）：租戶 CRUD、佈建背景工作（建角色、database、bucket、跑 migration、seed、第一位管理員）、`GET /tenants/lookup`（公開）。
  - `modules/platform-admin`（新，平台）：平台管理者、平台角色、平台稽核。
  - `modules/oidc-provider`：`extraParams: ['tenant']`、`accountId` 前綴、`findAccount` 依前綴查平台或租戶 DB、
    client `backstage` 的 redirect URI 改由 `tenant_domains` 動態比對、租戶不符時強制登入的互動 policy、ID token 的 `tenant` claim。
  - `modules/auth`：互動端點依租戶選 DB；`/auth/sso/callback` 檢查 Host 的租戶 == 授權碼帳號的租戶；平台管理者的 app session（auth origin）。
  - `modules/identity-provider`：搬到租戶範圍；`ExternalLogin` 暫存帶租戶。
  - `core/jobs`：payload 帶 `tenantId`、handler 包在 `runInTenant`；排程工作改為平台排程 → 每租戶展開。
  - `core/cache`、`modules/realtime`：key 與 room 加租戶前綴。`core/storage`：依租戶選 bucket。
  - 移除：`modules/workspace`、`common/` 的 `@WorkspaceScoped`、`WorkspaceScope`、route-audit 的範圍規則、`PermissionSet.canEnter`。
- **前端**
  - backstage：移除 `core/workspace`、`features/workspace`、`apis/workspace/*`、`/w/:workspaceSlug` 路由與切換器；
    `features/file` 等路由回到頂層；`core/auth/sso.ts` 的授權網址帶 `tenant`（從 `window.location.host` 經 `GET /api/tenant/current` 取得代碼）。
    `DashboardLayout` 的 `EXTERNAL_MENU`「工作區」移除，改成「切換租戶」→ auth 的 `/tenant`。
  - apps/auth：新增 `tenant-admin`（建立、佈建狀態、停用、網域）；新增 `platform-admin`（平台管理者與角色）；
    新增「進入租戶」頁 `/tenant`；互動頁顯示租戶名稱；帳號流程（`/setup`、`/reset-password`、`/register`）的連結與請求帶租戶；
    移除 `/invitation`（工作區邀請）。`identity-provider` 頁移到 backstage（租戶管理者管自己的外部 IdP，見開放問題 2）。
- **權限**
  - 平台（新目錄）：`tenant:read／create／update／delete`、`platformAdmin:read／create／update／delete`、`platformRole:*`、`platformAuditLog:read`、`job:read／retry`。
  - 租戶：回到 ADR-0006 的扁平目錄；移除 `workspace:*`、`workspaceMember:*`；`identityProvider:*` 留在租戶。
- **稽核**：平台：`tenant.create／update／disable／delete`、`tenant.provision.success／failure`、`platformAdmin.*`、`auth.login.*`（平台管理者）。租戶：不變。
- **部署**：nginx 以 wildcard `server_name *.backstage.example.com` 服務 backstage，並把 Host 原樣傳給 api；
  compose 新增佈建用的 DB 角色（`CREATEDB`、`CREATEROLE`）；新 env：`PLATFORM_DATABASE_URL`、`TENANT_DB_ADMIN_URL`（佈建用）、
  `TENANT_DB_HOST`、`TENANT_SECRET_KEY`、`TENANT_POOL_MAX`、`TENANT_POOL_LIMIT`。
- **開發環境**：`acme.localhost:5173`、`beta.localhost:5173` 兩個租戶（seed），auth 在 `localhost:5175`；Vite 的 `server.allowedHosts` 與 proxy 保留 Host。

## 進度

- ✅ 第 1 步（移除工作區）：後端 `modules/workspace`、`@WorkspaceScoped`、權限與角色的 `scope`、工作區邀請全部移除，
  檔案模組的路由回到頂層（`/files`、`/file-folders`）；backstage 移除 `/w/:workspaceSlug`、切換器、成員頁；
  apps/auth 移除 `/workspaces` 與 `/invitation`。migration 重新建立基準點（`0000_baseline`、`0001_functions_and_triggers`）。
- ✅ 第 2 步（平台 DB 與租戶 DB 分離）：平台 DB（`tenants`、`tenant_domains`、`oidc_payloads`、pg-boss）與租戶 DB 兩條 migration 線；
  `core/tenant`（`TenantMiddleware` 依網域決定租戶、`Tenancy` 的每租戶連線池、`TENANT_DB` Proxy）；WebSocket 依 handshake 的網域；
  背景工作的信封與 outbox、排程展開到每個租戶；權限／使用者快取與 perm room 帶租戶；access token 帶 `tid`；
  腳本走遍每個租戶，`db:migrate` 從 `DEFAULT_TENANT_*` 登記預設租戶。設計的調整記在 ADR-0020「實作時改掉的做法」。
  整合測試 `test/tenancy.spec.ts`（兩個租戶的帳號、token、資料互不相通；未知網域 404、停用 503、不信任 X-Forwarded-Host）。
  **既有的開發環境要重建**：`.env` 改用 `PLATFORM_DATABASE_URL`、`DEFAULT_TENANT_*`（見 `.env.example`），再 `pnpm db:migrate`，
  預設租戶的 DB 要 `pnpm db:reset && pnpm db:seed`（舊 migration 紀錄對不上新的基準點時，改成刪掉重建 database）。
- ✅ 第 3 步（平台身分與 OIDC 帶租戶）：平台 DB 的 `platform_admins`／`platform_refresh_tokens`／`platform_audit_logs`，
  第一位平台管理者由 `db:seed` 依 `PLATFORM_ADMIN_EMAIL` 建立；apps/auth 不帶租戶的登入對平台 DB 驗證，session 在
  `/platform/auth/*`（refresh 輪替抽成共用的 `rotateRefreshToken`，租戶與平台共用）；access token 依網域決定範圍（`tid`／`realm`）。
  OIDC：authorize 的 `tenant` 參數（redirect URI 必須是該租戶的網域）、帳號 id `t:`／`p:` 前綴、ID token 的 `tenant` claim、
  換身分時強制重新登入並把舊身分從 IdP session 拿掉（`detachIdentity`，見 ADR-0020 實作調整）、兩個 BFF 各自檢查帳號範圍。
  apps/auth 的網域不再屬於任何租戶；帳號流程以 `?tenant=`／`X-Tenant` 指定租戶，完成後以 `GET /tenants/lookup` 回到租戶的登入；
  backstage 以 `GET /tenant/current` 取得代碼。外部 IdP 管理頁搬到 backstage（開放問題 2）。信中連回產品的網址用租戶的主要網域。

### 進入第 4 步之前必須處理

- **物件儲存還是所有租戶共用一個 bucket**（原排在第 5 步，D16）。檔案維護會刪掉「在本租戶 DB 找不到紀錄」的物件：
  一旦有第二個租戶，A 租戶的維護會刪掉 B 租戶的檔案。第 4 步開放建立租戶之前要先完成每租戶一個 bucket。
- **啟動時檢查每個租戶的 migration 版本（D14 後半）** 還沒做：目前只有 `db:migrate` 會逐一套用。
- 平台管理者目前只有登入與個人資料；權限目錄、管理者的新增／停用與租戶管理頁都在第 4 步。

## 交付順序

每一步結束時 `pnpm typecheck && pnpm test` 通過、既有 E2E 在單一租戶 `default` 下通過。

1. **移除工作區**（回到使用者為核心）：刪 `modules/workspace`、`@WorkspaceScoped`、`scope`、`features/workspace`、`/w/:slug`、apps/auth 的 `workspace-admin` 與 `/invitation`；
   檔案模組的路由回到頂層；migration 重新 baseline。單一 database，行為等同 ADR-0018 之前加上 SSO。
2. **平台 DB 與租戶 DB 分離**：兩條 migration 線、`TenantContext`／`TenantDatabaseRegistry`／`TenantDb`、Host 解析、`runInTenant`；
   所有 repository 改用 `TenantDb`；dev 以 seed 建立 `default` 租戶。越權整合測試：A 網域的請求永遠讀不到 B 的 database。
3. **平台身分**：`platform_admins` 與平台 RBAC；auth 不帶租戶時對平台 DB 驗證；OIDC `accountId` 前綴與 `tenant` 參數／claim、
   redirect URI 對租戶網域的檢查、租戶不符強制登入、BFF 的租戶檢查。
4. **租戶佈建與管理**：`modules/tenant`、佈建背景工作、auth 的 `tenant-admin` 頁與「進入租戶」頁、`db:migrate` 跑遍租戶、啟動時的版本檢查。
5. **周邊改為租戶感知**：背景工作（展開與 `runInTenant`）、推播 room、快取 key、物件儲存 bucket、外部 IdP、帳號流程的信件連結、稽核分流。
6. **部署與 E2E**：nginx wildcard、compose、兩個租戶的 E2E（見下）、歸檔文件。

E2E 至少要有：

- `acme` 的使用者登入 → 落在 acme；用同一個 IdP session 打開 `beta` → 要求重新登入。
- 把 acme 的授權碼送到 beta 的 `/auth/sso/callback` → `AUTH_SSO_CODE_INVALID`。
- 竄改 authorize 的 `tenant=beta` 但 `redirect_uri` 是 acme → 協定錯誤頁。
- 平台管理者登入 auth、建立租戶、新租戶的管理者從啟用信進入後台。
- 停用租戶後該網域回 503，既有 session 失效。

## 開放問題

1. 既有的 dev／E2E 資料要保留成 `default` 租戶，還是直接重建？migration 能否重新 baseline（目前沒有正式環境資料）？
   - **結論**（2026-09-29 確認，照建議）：重新 baseline（ADR-0020 D20）。若已有需要保留的環境，改寫一支一次性的搬移腳本，而不是保留舊的 migration 線。
2. 外部 IdP 連線由誰管理：平台管理者在 auth 的租戶詳情頁，還是租戶管理者在自己的 backstage？
   - **結論**（2026-09-29 確認，照建議）：租戶管理者在 backstage（資料在租戶 DB，符合「平台看不到租戶內容」）；平台管理者只能開關「是否允許該租戶設定外部 IdP」。
3. 背景工作監控頁（`job:*`）放在哪？佇列在平台 DB，租戶的後台若要看，只能看到自己租戶的工作。
   - **結論**（2026-09-29 確認，照建議）：監控頁搬到 auth（平台維運）；backstage 只在各功能內顯示自己的工作狀態（例如匯出進度）。
4. 租戶代碼與網域的規則：一律 `{code}.backstage.example.com`，還是允許客戶自訂網域？
   - **結論**（2026-09-29 確認，照建議）：`tenant_domains` 支援多個網域；預設產生 `{code}.<BACKSTAGE_BASE_DOMAIN>`，自訂網域由平台管理者手動加入（TLS 由部署處理）。
5. 平台管理者的 app session 放在 apps/auth 的 origin，沿用 `refresh_tokens` 的結構（平台 DB 另一張表）即可？
   - **結論**（2026-09-29 確認，照建議）：是。
6. `apps/auth` 的帳號流程（啟用、重設密碼、註冊）要帶租戶：放在網址參數 `?tenant=`，還是讓這些頁面也在租戶網域上？
   - **結論**（2026-09-29 確認，照建議）：網址參數；token 本身在租戶 DB，查詢時以參數選 DB，查不到一律視為無效（不洩漏租戶是否存在）。

## 歸檔去向

- `docs/adr/0020-physical-tenant-isolation.md`：狀態改為「採用」；ADR-0018 標註「被取代」，ADR-0019 標註被修改的 D1、D9、D12、D13
- `docs/architecture/05-tenancy.md`：新增（Host 解析、連線池、佈建、migration、部署）
- `docs/architecture/04-sso.md`：更新（租戶參數、帳號前綴、進入租戶、平台管理者）
- `docs/architecture/backend/`：`03`（資料庫存取）、`05-rbac.md`、`06-audit-log.md`、`08-realtime.md`、`09-file.md`、`10-jobs.md`
- `docs/rbac/`：`01-domain-model.md`、`02-permission-catalog.md`（平台目錄另立一節）、`05-seed-and-bootstrap.md`
- `apps/auth/README.md`、`CLAUDE.md`（常用指令、與文件不同的實作決定）
