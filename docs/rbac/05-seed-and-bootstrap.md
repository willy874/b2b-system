# RBAC 05 — 種子資料與系統初始化

## 1. 為什麼需要 bootstrap

RBAC 有一個雞生蛋問題：**要建立使用者需要 `user:create` 權限，但第一個使用者
還不存在，所以沒有人有權限。** 解法是一段不經過 API、直接對資料庫操作的初始化
程序。

---

## 2. 執行順序

```
pnpm db:migrate        平台 DB，再依序每個租戶的 DB（含約束、索引、trigger；relation_tuples 的回填與同步 trigger）；登記預設租戶
      │
      ▼
pnpm db:seed           ⓪ 平台管理者（平台 DB；沒有任何管理者時依 PLATFORM_ADMIN_EMAIL 建立，角色 super-admin）
      │                每個 active、disabled 的租戶各跑一次：
      │                ① permissions   （冪等 upsert）
      │                ② roles         （冪等 upsert，is_system = true）
      │                ③ role_permissions（依對照表 upsert）
      │                ④ role.permissionsImplied 稽核（權限依賴樹讓角色多出鍵時，每個角色寫一次；冪等）
      │                ⑤ super-admin 使用者（僅 SEED_TENANT，預設 default；僅當不存在時建立）
      ▼
pnpm dev
```

平台管理者與租戶的 super-admin 是兩份資料（[ADR-0020](../adr/0020-physical-tenant-isolation.md) D5）：
平台管理者登入 apps/auth，看不到任何租戶的內容；租戶的 super-admin 只在自己的租戶。
`SUPER_ADMIN_EMAIL` 只用在 `SEED_TENANT`：之後建立的租戶，第一位 super-admin 由 **佈建** 建立（`pending`，寄啟用信），
營運方共用的帳密不會出現在客戶的租戶（[`../architecture/05-tenancy.md`](../architecture/05-tenancy.md) §5）。

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

**為什麼不自動刪孤兒**：刪一筆 `permissions` 會連帶 cascade 掉
`role_permissions`，等於無聲地撤掉某些角色的授權。這種事必須是明確的 migration。

---

## 4. ② 系統角色

```ts
export const ROLE_SEED = [
  {
    slug: "super-admin",
    name: "超級管理員",
    description: "系統最高權限，繞過所有權限檢查。不可刪除、不可調整權限。",
    isSystem: true,
    permissions: "*", // 隱含全集，不寫入 role_permissions
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
    ],
  },
  {
    slug: "auditor",
    name: "稽核人員",
    description: "唯讀存取使用者、角色與稽核日誌。",
    isSystem: true,
    permissions: [
      "user:read",
      "role:read",
      "permission:read",
      "auditLog:read",
      "system:read",
      "approval:read",
      "file:read",
    ],
  },
  {
    slug: "member",
    name: "一般成員",
    description: "個人頁面，以及被授權的資料夾。未來功能的權限掛載點。",
    isSystem: true,
    // 進得了檔案管理器；範圍由資料夾授權決定（rbac/07-resource-grants.md）
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
| `role_permissions`     | 見下方                                         |

### 4.2 系統角色的權限如何同步

這裡有一個真實的張力：seed 想保證系統角色有正確的權限，但管理員被允許調整
`admin` / `auditor` / `member` 的權限（見
[`01-domain-model.md`](./01-domain-model.md) §5）。若 seed 每次都覆寫，管理員的
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

```ts
const existing = await db.query.users.findFirst({
  where: hasRole("super-admin"),
});
if (existing) {
  logger.info("super-admin 已存在，略過建立");
  return;
}

const email = env.SUPER_ADMIN_EMAIL; // 必填
const password = env.SUPER_ADMIN_PASSWORD ?? generateStrongPassword(24); // 未提供則隨機產生

await db.transaction(async (tx) => {
  const user = await tx
    .insert(users)
    .values({
      email,
      displayName: "Super Admin",
      passwordHash: await argon2.hash(password),
      status: "active",
    })
    .returning();
  await tx.insert(userRoles).values({
    userId: user.id,
    roleId: superAdminRoleId,
    grantedBy: null, // 系統初始化
  });
  await tx.insert(auditLogs).values({
    action: "system.bootstrap",
    actorId: null,
    actorEmail: "system",
    resourceType: "user",
    resourceId: user.id,
    result: "success",
    metadata: { reason: "initial super admin created" },
  });
});

if (!env.SUPER_ADMIN_PASSWORD) {
  // ★ 只印這一次，之後無從取得
  logger.warn(
    `\n=== 初始超級管理員 ===\n  帳號：${email}\n  密碼：${password}\n  請立即登入並變更密碼。\n`,
  );
}
```

### 5.1 安全要求

| 要求                        | 作法                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| 密碼不得寫死在程式碼或 repo | `SUPER_ADMIN_PASSWORD` 來自環境變數，`.env.example` 中留空                       |
| 隨機密碼只出現一次          | 只寫到啟動日誌，不入庫、不回傳                                                   |
| production 強制變更         | `NODE_ENV=production` 且使用隨機密碼時，該帳號建立為 `pending`，必須走啟用信流程 |
| 不可重複建立                | 已存在任何 super-admin 時整段略過                                                |
| 留下痕跡                    | 寫入 `audit_logs`，`actor = system`                                              |

---

## 6. 開發用的假資料（`db:seed:dev`）

**與 `db:seed` 分開的另一個指令**，只在 `NODE_ENV !== 'production'` 可執行。

```
pnpm db:seed:dev
├─ 50 位使用者（狀態分布：active 35 / inactive 8 / pending 5 / locked 2）
├─ 5 個自訂角色（非系統），權限組合各異
├─ 隨機的 user_roles 指派
└─ 300 筆 audit_logs（跨 90 天，涵蓋各種 action 與 result）
```

用途：

- 前端分頁／篩選／排序的真實體驗
- E2E 測試的固定 fixture（使用固定亂數種子，確保可重現）

所有假使用者密碼統一為 `Dev!Password123`，email 網域固定 `@dev.local`，
避免誤寄信。

---

## 7. 災難復原：忘記 super-admin 密碼

不提供「後門 API」。作法是一支需要 DB 存取權的 CLI：

```bash
pnpm --filter @b2b-system/api cli:reset-super-admin --email admin@example.com
```

它會：

1. 確認該帳號存在且持有 `super-admin`
2. 產生一次性重設 token（1 小時），印出連結
3. 寫入 `audit_logs`（`action = 'system.super_admin_reset_requested'`）

**不直接改密碼**，而是走與一般使用者相同的重設流程 —— 少一條需要維護的特例路徑。

---

## 8. 驗收檢查清單

`db:seed` 完成後，以下斷言必須成立（`db/seeds/__tests__/seed.spec.ts`）：

- [ ] `permissions` 表筆數 = `PERMISSION_SEED.length`（25）
- [ ] 每筆 `permissions.key` = `resource || ':' || action`
- [ ] `roles` 中恰有 4 筆 `is_system = true`
- [ ] `super-admin` 在 `role_permissions` 中 **沒有任何列**（隱含全集）
- [ ] `admin` 的權限集合 = `ROLE_SEED` 中宣告的 24 筆
- [ ] 恰有一位使用者持有 `super-admin`
- [ ] 連續執行 `db:seed` 兩次，所有表的筆數不變
- [ ] 權限依賴樹多出鍵的角色各有一筆 `role.permissionsImplied`（預設角色只有 auditor：`file:read ⇒ file:access`），重跑不重複
- [ ] `GET /auth/profile`（以 super-admin 登入）回傳的 `permissions` 長度 = 25

> seed 寫入 `user_roles`、`role_permissions` 時，trigger 在同一個交易裡同步 `relation_tuples`（[`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §2.10），
> 權限解析讀的是後者；super-admin 角色建立時也會自動補上 `tenant:self#superAdmin` 的邊。
