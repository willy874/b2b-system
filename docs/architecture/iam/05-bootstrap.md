# 身分與存取 05 — 種子資料與系統初始化

## 1. 為什麼需要 bootstrap

RBAC 有一個雞生蛋問題：**要建立使用者需要 `user:create` 權限，但第一個使用者
還不存在，所以沒有人有權限。** 解法是一段不經過 API、直接對資料庫操作的初始化
程序。

---

## 2. 執行順序

```
pnpm db:migrate        平台 DB，再依序每個租戶的 DB（含約束、索引、trigger；relation_tuples 的回填、authz_revision）；登記預設租戶
      │
      ▼
pnpm db:seed           ⓪ 平台管理者（平台 DB；沒有任何管理者時依 PLATFORM_ADMIN_EMAIL 建立，角色 super-admin）
      │                每個 active、disabled 的租戶各跑一次：
      │                ① permissions   （冪等 upsert）
      │                ② roles         （冪等 upsert，is_system = true；super-admin 補上 tenant:self#superAdmin 的邊，冪等）
      │                ③ 角色的權限鍵（relation_tuples 的 tenant:self#<key>@role:<id>#holder，僅新建立的角色）
      │                ④ role.permissionsImplied 稽核（權限依賴樹讓角色多出鍵時，每個角色寫一次；冪等）
      │                ⑤ super-admin 使用者（僅 SEED_TENANT，預設 default；僅當不存在時建立）
      ▼
pnpm dev
```

平台管理者與租戶的 super-admin 是兩份資料（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D5）：
平台管理者登入 apps/platform，看不到任何租戶的內容；租戶的 super-admin 只在自己的租戶。
`SUPER_ADMIN_EMAIL` 只用在 `SEED_TENANT`：之後建立的租戶，第一位 super-admin 由 **佈建** 建立（`pending`，寄啟用信），
營運方共用的帳密不會出現在客戶的租戶（[`05-tenancy.md`](../05-tenancy.md) §5）。

`db:seed` 設計為 **完全冪等**：重複執行不會產生重複資料、不會覆寫使用者已調整
的非系統角色權限。

---

## 3. ① 權限目錄

來源：`apps/api/src/db/seeds/permissions.ts`（內容見
[`02-permission-catalog.md`](./02-permission-catalog.md) §6）。

```ts
// 邏輯摘要
for (const [resource, action, nameI18nKey, sortOrder] of PERMISSION_SEED) {
  await db
    .insert(permissions)
    .values({ key: `${resource}:${action}`, resource, action, nameI18nKey, sortOrder })
    .onConflictDoUpdate({
      target: permissions.key,
      set: { resource, action, nameI18nKey, sortOrder },
    });
}

// 偵測孤兒：DB 有但 seed 沒有的權限 → 只警告，不刪除
const orphans = await findOrphanPermissions(PERMISSION_SEED);
if (orphans.length) {
  logger.warn({ orphans }, "資料庫中存在 seed 未定義的權限，請以 migration 明確處理");
}
```

**為什麼不自動刪孤兒**：角色的權限鍵是 `relation_tuples` 上以鍵為關係的邊（沒有外鍵），刪一筆 `permissions`
等於無聲地撤掉某些角色的授權，還會留下指向不存在的鍵的邊。這種事必須是明確的 migration（一併刪掉那些邊）。

---

## 4. ② 系統角色

```ts
export const ROLE_SEED = [
  {
    slug: "super-admin",
    name: "超級管理員",
    description: "系統最高權限，繞過所有權限檢查。不可刪除、不可調整權限。",
    isSystem: true,
    permissions: "*", // 隱含全集：只寫 tenant:self#superAdmin 的邊，沒有任何權限鍵的邊
  },
  {
    slug: "admin",
    name: "系統管理員",
    description: "管理使用者、角色與權限。",
    isSystem: true,
    permissions: [
      "user:create",
      "user:read",
      "user:update",
      "user:delete",
      "user:assignRole",
      "user:resetPassword",
      "user:resetMfa",
      "role:create",
      "role:read",
      "role:update",
      "role:delete",
      "role:grantPermission",
      "permission:read",
      "auditLog:read",
      "system:read",
      "approval:read",
      "approval:review",
      "file:create",
      "file:read",
      "file:update",
      "file:delete",
      "file:share",
      "file:access", // 指派 member 受反提權限制
      "job:read",
      "job:retry",
      "identityProvider:create",
      "identityProvider:read",
      "identityProvider:update",
      "identityProvider:delete",
      "group:create",
      "group:read",
      "group:update",
      "group:delete",
      "group:assignRole",
      "authz:explain",
    ],
  },
  {
    slug: "auditor",
    name: "稽核人員",
    description: "唯讀存取使用者、角色、群組、外部 IdP 連線與稽核日誌。",
    isSystem: true,
    permissions: [
      "user:read",
      "role:read",
      "permission:read",
      "auditLog:read",
      "system:read",
      "approval:read",
      "file:read",
      "job:read",
      "identityProvider:read",
      "group:read",
      "authz:explain",
    ],
  },
  {
    slug: "member",
    name: "一般成員",
    description: "個人頁面，以及被授權的資料夾。未來功能的權限掛載點。",
    isSystem: true,
    // 進得了檔案管理器；範圍由資料夾授權決定（iam/06-resource-grants.md）
    permissions: ["file:access"],
  },
] as const;
```

### 4.1 冪等策略

| 欄位                   | 重複執行時                                     |
| ---------------------- | ---------------------------------------------- |
| `slug`                 | 作為 upsert 的 conflict target，永不變更       |
| `name` / `description` | **不覆寫**（管理員可能已在 UI 中改過顯示名稱） |
| `is_system`            | 強制設為 `true`（防止被誤改）                  |
| 權限鍵的邊             | 見下方                                         |

### 4.2 系統角色的權限如何同步

這裡有一個真實的張力：seed 想保證系統角色有正確的權限，但管理員被允許調整
`admin` / `auditor` / `member` 的權限（見
[`01-model.md`](./01-model.md) §5）。若 seed 每次都覆寫，管理員的
調整會在下次部署時被抹掉。

**決定：seed 只在角色是「新建立」時寫入權限。**

```ts
const { created } = await upsertRole(roleSeed);
if (created) {
  await grantPermissions(role.id, roleSeed.permissions);
} else {
  // 既有角色：只補「seed 有、但 DB 中該權限根本不存在於任何角色」的新權限
  // → 這是新版本引入新權限時的遷移路徑，由明確的 migration 檔負責，不在 seed
  logger.info({ slug }, "系統角色已存在，略過權限同步");
}
```

**新版本引入新權限時**（例如加了 `system:update`），要把它加進 `admin` 的作法是
寫一支 migration：

```ts
// db/migrations/0003_grant_system_update_to_admin.ts
await grantIfMissing("admin", ["system:update"]);
```

這讓「授權變更」永遠是版控中可追溯的一次動作，而不是 seed 的副作用。

---

## 5. ③ super-admin 使用者

實作在 `apps/api/src/db/seeds/super-admin.ts`（`seedSuperAdmin(db, tenantCode)`，只在 `SEED_TENANT` 執行）：

1. 已有任何未刪除的 super-admin 持有者 → 略過。例外：production、只有一位、還是 `pending`、email 等於 `SUPER_ADMIN_EMAIL`
   （第一位還沒啟用）→ 換發新的啟用連結，舊的作廢。
2. 否則在同一個交易建立帳號、指派 super-admin、寫 `system.bootstrap` 稽核：

| `SUPER_ADMIN_PASSWORD` | 環境 | 狀態 | 日誌 |
| --- | --- | --- | --- |
| 有（符合密碼政策） | 任何 | `active` | 只印「已建立」 |
| 沒有 | 非 production | `active`，隨機密碼 | 印出隨機密碼一次（開發用） |
| 沒有 | production | `pending`，密碼是沒有人知道的隨機值 | **不印密碼**；印出 apps/platform 的 `/setup?token=…&tenant=<代碼>`（1 小時有效、用過即失效） |

啟用連結與寄信的啟用連結是同一種 token（`issueAuthToken`，`purpose = activation`），走同一個 `POST /auth/setup`。
連結過期又不方便重新部署時，用 §7 的 `cli:reset-super-admin`（對 `pending` 的帳號簽發啟用連結）。

### 5.1 安全要求

| 要求                        | 作法                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| 密碼不得寫死在程式碼或 repo | `SUPER_ADMIN_PASSWORD` 來自環境變數，`.env.example` 中留空                       |
| 隨機密碼只出現一次          | 只有非 production 會印出，只寫到 seed 的日誌，不入庫、不回傳                     |
| production 不落地密碼       | `NODE_ENV=production` 且沒有提供密碼時，帳號建成 `pending`、**不印密碼**，改印一次性的啟用連結；還沒啟用時下一次 `db:seed` 換發新的連結 |
| 平台管理者同樣不落地密碼    | 第一位平台管理者（`PLATFORM_ADMIN_PASSWORD` 留空）在 production 建成 `pending`、**不印密碼**，改印一次性的設定連結（apps/platform 的 `/setup`，1 小時有效、用過即失效）；它還是唯一一位而且還沒設定密碼時，下一次 `db:seed`（重新部署）換發新的連結、舊的作廢 |
| 提供的密碼要合格            | `SUPER_ADMIN_PASSWORD`、`PLATFORM_ADMIN_PASSWORD` 有值時套用與登入相同的密碼政策（≥ 12 字元、不是常見密碼、不含 email 的片段）；不合格就讓 seed 失敗，不靜默換成隨機密碼 |
| 不可重複建立                | 已存在任何 super-admin 時整段略過                                                |
| 留下痕跡                    | 寫入 `audit_logs`，`actor = system`                                              |

---

## 6. 開發用的假資料（`db:seed:dev`）

**與 `db:seed` 分開的另一個指令**，只在 `NODE_ENV !== 'production'` 可執行。

```
pnpm db:seed:dev
├─ 50 位使用者（顯示的狀態分布：active 35 / inactive 8 / pending 5 / locked 2；
│    locked 是 status = active ＋ 15 分鐘後到期的 locked_until，到期後恢復 active）
├─ 5 個自訂角色（非系統），權限組合各異
├─ 隨機的角色指派（role:<id>#holder@user:<id>）
├─ 9 個群組（含巢狀與持有角色）
├─ 300 筆 audit_logs（跨 90 天，涵蓋各種 action 與 result）
├─ 持有系統角色的固定帳號：dev-admin（admin）、dev-auditor（auditor）、dev-member（member），@dev.local
├─ apps/platform 的平台管理者（平台 DB）：dev-platform-operator（operator）、dev-platform-auditor（auditor），@dev.local
└─ dev-fixtures/：讓下面幾頁有資料可看
   ├─ 回收桶：已刪除的使用者 3、角色 2、群組 2、資料夾 1（內含子資料夾與 4 個檔案）、個別刪除的檔案 3、公告 1
   │    （刪除時間 1～12 天前，在預設 30 天的保留期內）
   ├─ 標籤：使用者組 6 個、檔案組 4 個，貼在 dev 使用者與 3 個未刪除的資料夾上
   ├─ Webhook：5 個訂閱（啟用 3、手動停用 1、連續失敗自動停用 1；其中一個有 2 個網址），
   │    近 9 天的 27 個對外事件與約 75 筆投遞紀錄（成功、HTTP 錯誤、逾時、重試）
   ├─ 公告：9 則——已完成 3（其中 1 則的發送已撤回）、排程中 3（指定時間、每週週期、事件點 user.activated）、
   │    暫停 1、草稿 1、已刪除 1；已發出的有發送紀錄與收件人的 announcement.published 通知
   ├─ 其他站內通知：user.rolesChanged、approval.pending／result、webhook.disabled 共約 19 則（已讀未讀混合）
   │
   │  以下三項要寫物件儲存（file-storage 連不上就略過，其他照常）：
   ├─ 檔案管理：資料夾「設計素材」與底下的「產品照片」「活動照片 2026」，加上「對外簡報」裡一張；
   │    17 個檔案混放照片（JPEG、PNG、WebP，部分帶 EXIF 與 GPS）、PDF、SVG（驗證「加入圖片庫」略過非點陣圖）
   ├─ 圖片庫（backend/26-gallery.md）：42 張，直式、橫式、正方形、全景；拍攝時間跨 14 個月；
   │    多數帶 EXIF（相機、鏡頭、曝光），14 張帶 GPS（處理後原檔的位置被移除）、6 張是沒有 EXIF 的 PNG（以加入時間排序）、
   │    1 張與另一張內容相同（重複的提示）、2 張在回收桶；5 個相簿（其中「年度精選」與分類相簿重疊、「待整理」是空的）、
   │    圖片庫標籤 4 個、留言 8 則（作者自動關注）
   └─ 頭像（backend/25-image.md §15.8）：dev01～06、13、14、21、22、30 的頭像是圖片資產（user.avatar），正方形與長方形都有
```

圖片與檔案都在 seed 裡以 sharp 產生（漸層、色塊加文字，固定的規格與日期，同一份規格產生同一份位元組；`dev-fixtures/images.ts`），
不下載、也不放進 repo。物件寫進目標租戶的 bucket（`FILE_STORAGE_*`），資料列寫成「已上傳、等處理」的狀態，
並在同一個交易寫入 `job_outbox`（`gallery.process`、`image.process`、`file.imageVariants`）：**變體由正在跑的 api worker 產生**，
seed 不自己處理。api 的定期清掃（`JOBS_OUTBOX_SWEEP_CRON`，預設每 10 分鐘）把它們搬進佇列，處理完圖片才出現在圖片庫、
頭像與檔案的預覽才出來；api 沒在跑時，下次啟動後的清掃也會補上。

假資料以固定 id（`fixtureId(key)`）寫入、`ON CONFLICT DO NOTHING`：重跑不重複，已存在的列（含在畫面上改過的）不覆寫；
過了保留期被清掉的（回收桶、通知、投遞紀錄）重跑時再補回來。幾點要知道：

- 排程中的公告是真的排程：api 的每日維護會補上延遲工作，時間到了會真的發給 dev 使用者。
- 回收桶裡的檔案（`trash.ts`）只有資料列，物件儲存裡沒有內容：還原後下載會失敗。檔案管理、圖片庫、頭像的假資料（`files.ts`、`gallery.ts`、`avatars.ts`）有真的物件。
- 已經有頭像的 dev 使用者不換；相簿與標籤只指派給這次新建的圖片，之後在畫面上移出相簿、拿掉標籤的不會被補回來。
- 平台管理者與持有系統角色的帳號已存在時不動（不重設密碼與角色）。
- Webhook 的網址都是 `example.com`／`example.org`；啟用中的訂閱之後收到真的事件時，api 會真的投遞（會失敗、重試）。
- 審批的通知沒有連結：seed 不建立審批申請。
- 名稱避開導覽截圖以 API 建立的示範資料（`apps/e2e/tour/demo-data.ts`），兩者可以先後執行。

用途：

- 前端分頁／篩選／排序的真實體驗
- E2E 測試的固定 fixture（使用固定亂數種子，確保可重現）

所有假使用者密碼統一為 `Dev!Password123`（含平台管理者與 dev-admin／auditor／member），email 網域固定 `@dev.local`，
避免誤寄信。

---

## 7. 災難復原：忘記 super-admin 密碼

前提：super-admin 忘記密碼，而且「忘記密碼」的信寄不到（信箱失效、SMTP 不通）；還有其他 super-admin 時請他在後台重設，不必用這支指令。

不提供「後門 API」。作法是一支需要資料庫存取權的 CLI（`apps/api/src/cli/reset-super-admin.ts`）：

```bash
# 租戶的 super-admin（--tenant 是租戶代碼）
pnpm --filter @b2b-system/api cli:reset-super-admin --tenant default --email admin@example.com
# 平台管理者（apps/platform 的帳號）
pnpm --filter @b2b-system/api cli:reset-super-admin --platform --email ops@example.com
# 正式環境：與 migrate 共用映像與環境變數，跑編譯過的版本
docker compose -f docker-compose.prod.yml run --rm migrate \
  node dist/src/cli/reset-super-admin.js --tenant <代碼> --email <email>
```

它會：

1. 防呆：平台 DB 或租戶 DB 有任何一個不在本機（`localhost`、`127.0.0.1`、`[::1]`、compose 的 `postgres`）時，要加
   `--confirm <平台 database 名稱>`（`db/script-guard.ts` 的 `remoteRejection`；例：從維運機經 tunnel 連正式環境）。
   它本來就是給正式環境用的，所以不像 `db:reset` 那樣拒絕 production。
2. 確認對象：租戶要是 `active`；帳號存在、未刪除、**直接持有** `super-admin`（群組不能持有 super-admin）；平台管理者的角色是 `super-admin`。
   停用中的帳號拒絕（重設了也不能登入，先由其他 super-admin 啟用）。
3. 簽發一次性 token（1 小時；同一個人同用途還沒用掉的先作廢），規則與寄信相同（`issueAuthToken()`／`issuePlatformAuthToken()`）：
   - 一般情況是重設密碼：`<PLATFORM_APP_URL>/reset-password?token=…&tenant=<代碼>`（平台管理者不帶 `tenant`）。
   - 還沒啟用（`pending`，例：第一位管理員的啟用信沒寄到）改簽啟用連結：`<PLATFORM_APP_URL>/setup?token=…`。
4. 在同一個交易寫稽核 `system.super_admin_reset_requested`（`actor = system`；租戶寫 `audit_logs`、平台寫 `platform_audit_logs`；
   `metadata` 有 `purpose` 與到期時間，不含 token）。
5. 印出連結。交給本人在瀏覽器開啟、設定新密碼；過期或遺失時重新執行，舊的連結隨之作廢。

**不直接改密碼**，而是走與一般使用者相同的重設流程 —— 少一條需要維護的特例路徑，密碼也不會出現在終端機與 shell 歷史裡。

---

## 8. 驗收檢查清單

`db:seed` 完成後，以下斷言必須成立（`db/seeds/__tests__/seed.spec.ts`）：

- [ ] `permissions` 表筆數 = `PERMISSION_SEED.length`（與 [`02-permission-catalog.md`](02-permission-catalog.md) §2 的項數相同）
- [ ] 每筆 `permissions.key` = `resource || ':' || action`
- [ ] `roles` 中恰有 4 筆 `is_system = true`
- [ ] `super-admin` 只有 `tenant:self#superAdmin` 一條邊，**沒有任何權限鍵的邊**（隱含全集）
- [ ] `admin` 的權限集合 = `ROLE_SEED` 中宣告的 24 筆
- [ ] 恰有一位使用者持有 `super-admin`
- [ ] 連續執行 `db:seed` 兩次，所有表的筆數不變
- [ ] 權限依賴樹多出鍵的角色各有一筆 `role.permissionsImplied`（預設角色只有 auditor：`file:read ⇒ file:access`），重跑不重複
- [ ] `GET /auth/profile`（以 super-admin 登入）回傳的 `permissions` 長度 = `PERMISSION_SEED.length`

> seed 直接寫 `relation_tuples`（邊的形狀在 `db/schema/relation-tuples.ts`，[`backend/02-database.md`](../backend/02-database.md) §2.10），
> super-admin 的 `tenant:self#superAdmin` 邊由 `seedRoles` → `ensureSuperAdminTuple`
> 明確寫入（冪等；角色已存在時也補一次）。seed 在另一個程序執行、不送失效廣播，執行中的 api 以權限快取的 TTL 反映。
