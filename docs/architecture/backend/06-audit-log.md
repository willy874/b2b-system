# 後端 06 — 稽核日誌

## 1. 目標

稽核日誌要能回答四個問題：

1. **誰** 在 **什麼時候** 對 **什麼** 做了 **什麼**？
2. 變更前後的值分別是什麼？
3. 這個操作是成功還是被拒絕？被拒絕的原因是什麼？
4. 某個人目前的權限是怎麼一步步變成現在這樣的？

第 4 點是 RBAC 系統存在稽核的主要理由。它要求 **每一次授權變更都必須有紀錄，
且紀錄不可被竄改**。

---

## 2. 記錄什麼

### 2.1 必記（Phase 0 全部實作）

| 類別   | action                                                            | 說明                   |
| ------ | ----------------------------------------------------------------- | ---------------------- |
| 認證   | `auth.login.success` / `auth.login.failure`                       | 含 IP、UA              |
|        | `auth.logout`                                                     |                        |
|        | `auth.refresh.reuse_detected`                                     | **高嚴重度**           |
|        | `auth.refresh.replayed`                                           | 寬限期內重送上一張（回應遺失），一般嚴重度 |
|        | `auth.password_change` / `auth.password_reset`                    |                        |
|        | `auth.account_locked`                                             |                        |
| 授權   | `authz.denied`                                                    | 含所需權限與缺少的權限 |
| 使用者 | `user.create` / `user.update` / `user.delete`                     | 含 before/after        |
|        | `user.assignRole`                                                 | **含前後角色清單**     |
|        | `user.activate` / `user.unlock` / `user.reset_password_requested` |                        |
|        | `user.activation_resent`                                          | 管理員對 `pending` 的人重寄啟用信 |
|        | `user.restore`                                                    | 從回收桶還原；`metadata.deletedAt`、`metadata.roles`（[`13-trash.md`](./13-trash.md) §4.1） |
| 回收桶 | `<resource>.purge`（`user.purge`、`role.purge`、`file.purge`、`fileFolder.purge`） | 到期永久刪除；排程執行，`actorId = null`、`actorEmail = 'system'`，`metadata.retentionDays`（[`13-trash.md`](./13-trash.md) §5） |
| 角色   | `role.create` / `role.update` / `role.delete` / `role.duplicate`  | 還原到某一版也記 `role.update`，`metadata.revertedFrom` 帶來源版本、權限鍵變了時 `changes` 帶 `permissions` 的前後（[`14-revisions.md`](./14-revisions.md) §4.3）。版本快照與稽核分開保存（[`backend/14-revisions.md`](14-revisions.md) §9.2 D10） |
|        | `role.grantPermission`                                            | **含前後權限清單**     |
|        | `role.restore`                                                    | 從回收桶還原；`metadata.deletedAt`、`metadata.holdersRestored`（[`13-trash.md`](./13-trash.md) §6.1） |
| 檔案   | `file.upload` / `file.update` / `file.delete` / `file.move`、`fileFolder.create` / `fileFolder.update` / `fileFolder.delete` | 見 [`09-file.md`](./09-file.md) §7；刪除的 `metadata.deletionId` 是這一次刪除的識別 |
|        | `file.restore` / `fileFolder.restore`                             | 從回收桶還原；`metadata.deletedAt`、`metadata.deletionId`，資料夾另有 `folderCount`、`fileCount`、`filesSkipped`（[`13-trash.md`](./13-trash.md) §7.1、§7.2） |
| 審批   | `approval.submit`                                                 | 匿名申請（註冊）的 actor 為申請人 email、`actorId = null` |
|        | `approval.approve` / `approval.reject`                            | 含審核意見；核准另記該變更本身（例：`user.create`，`metadata.approvalId`） |
| 郵件   | `mail.send`                                                       | 寄出的信；只記範本、收件人、jobId、messageId，不記內容與 token（[`11-mail.md`](./11-mail.md) §5） |
| 背景工作 | `job.retry`                                                     | 手動重試失敗的工作；`resourceName` 是工作名稱（[`10-jobs.md`](./10-jobs.md) §6） |
| 系統   | `system.bootstrap`                                                | 初始 super-admin 建立  |
|        | `system.super_admin_reset_requested`                              | 災難復原的 CLI 簽發了 super-admin 的重設（或啟用）連結；`actorEmail = 'system'`，`metadata.purpose`、`metadata.expiresAt`（[`rbac/05-seed-and-bootstrap.md`](../../rbac/05-seed-and-bootstrap.md) §7） |
|        | `system.seed`                                                     | 權限目錄變更           |

### 2.2 不記

- `GET` 請求（讀取）。量大且價值低。
  例外：`GET /users/:id/permissions`（查看他人的有效權限）未來若需要可加。
- 健康檢查與靜態資源。
- 使用者修改自己的偏好（語系、時區）。

---

## 3. 資料形狀

```ts
interface AuditRecord {
  occurredAt: Date;

  actorId: string | null; // 系統操作為 null
  actorEmail: string; // 快照；系統操作填 'system'

  action: string; // 'role.grantPermission'
  resourceType: string; // 'role'
  resourceId: string | null;
  resourceName: string | null; // 快照，例如角色名稱

  result: "success" | "failure";
  errorCode: string | null;

  changes: { before?: unknown; after?: unknown } | null;
  metadata: {
    ip?: string;
    userAgent?: string;
    requestId?: string;
    [k: string]: unknown;
  } | null;
}
```

### 3.1 為什麼快照 `actorEmail` 與 `resourceName`

兩個理由：

1. **使用者或角色之後可能被刪除。** 若只存 ID，稽核清單會變成一堆 UUID，
   或需要 join 一張已經沒有那筆資料的表。
2. **效能。** 稽核列表是「最近 N 筆」的查詢，不需要為了顯示名稱而 join
   `users` 與 `roles`。

代價是反正規化：改名之後舊紀錄仍顯示舊名。**這是正確的行為**——稽核記錄的是
當時的事實。

---

## 4. `AuditService`

```ts
@Injectable()
export class AuditService {
  async record(input: AuditInput, tx?: Transaction): Promise<void> {
    const ctx = getRequestContext(); // AsyncLocalStorage
    const db = tx ?? this.db;
    await db.insert(auditLogs).values({
      occurredAt: new Date(),
      actorId: input.actorId ?? ctx?.user?.id ?? null,
      actorEmail: input.actorEmail ?? ctx?.user?.email ?? "system",
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      resourceName: input.resourceName ?? null,
      result: input.result ?? "success",
      errorCode: input.errorCode ?? null,
      changes: input.changes ?? null,
      metadata: {
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        ...input.metadata,
      },
    });
  }
}
```

### 4.1 交易內 vs 交易外

| 情況                       | 作法                            |
| -------------------------- | ------------------------------- |
| 業務變更成功               | **傳入 `tx`，與變更同一個交易** |
| 授權被拒（`authz.denied`） | 交易外（沒有業務交易）          |
| 登入失敗                   | 交易外                          |

第一項是硬性要求：「角色權限變了但沒有紀錄」或「有紀錄但變更其實 rollback 了」
兩種情況都讓稽核失去意義。

### 4.2 稽核寫入失敗怎麼辦

**讓整個操作失敗。**

```ts
// ❌ 不要這樣
try { await this.audit.record(...); } catch { /* 忽略 */ }
```

如果稽核寫不進去，那個業務操作就不應該生效。這是稽核系統的基本要求：
「無紀錄則無操作」。稽核在同一個交易內時這是自動達成的。

交易外的稽核（登入失敗、授權拒絕）則允許失敗後只記錯誤日誌——那些情況下
業務操作本來就沒有成功。

---

## 5. `changes` 的產生

```ts
// core/audit/diff.ts
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const f of fields) {
    if (f in after && !isEqual(before[f], after[f])) {
      b[f] = before[f];
      a[f] = after[f];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
```

**只記實際改變的欄位。** 把整筆 before/after 塞進去會讓稽核表膨脹，也讓
「這次到底改了什麼」需要人眼比對。

### 5.1 敏感欄位

```ts
const AUDIT_EXCLUDED_FIELDS = new Set(["passwordHash", "tokenHash", "tokenVersion"]);
```

**密碼雜湊絕不進稽核。** 密碼變更只記 `action: 'auth.password_change'`，
`changes` 為 `null`。審批請求的 `private_payload`（只給 handler 用的內容）同樣不進稽核
（[`../../rbac/06-approval.md`](../../rbac/06-approval.md) §2）。

### 5.2 授權變更的 `changes` 形狀

```jsonc
// role.grantPermission
{
  "before": { "permissions": ["user:read", "role:read"] },
  "after":  { "permissions": ["user:read", "role:read", "user:create"] }
}

// user.assignRole
{
  "before": { "roles": ["member"] },
  "after":  { "roles": ["member", "auditor"] }
}
```

用 **完整的前後清單** 而非 `{ added, removed }`：清單可以直接回答
「那時候他有哪些權限」，差異需要從頭重播才能得到答案。

---

## 6. 不可變性

三道防線（實作見 [`02-database.md`](./02-database.md) §3.2）：

1. **DB trigger**：熱表與冷表都擋 `UPDATE`；冷表擋 `DELETE`；熱表只允許刪除
   「冷表已有完全相同副本」的列（熱 → 冷搬移用，見 §8）
2. **DB 權限**：應用程式的 DB role 對熱表只有 `INSERT, SELECT`、對冷表只有 `SELECT`
3. **沒有 API**：不存在 `PATCH /audit-logs/:id` 或 `DELETE /audit-logs/:id`

熱 → 冷搬移經由 `SECURITY DEFINER` 的 `archive_audit_logs()`（§8），應用程式的 role 不需要 DELETE；
保留期滿的清理由一個獨立的維運 role 執行。

---

## 7. 查詢

```
GET /audit-logs?offset=0&limit=50   或 ?cursor=<上一頁的 nextCursor>&limit=50
  &actorId=<uuid>
  &action=role.*                 前綴比對
  &resourceType=role
  &resourceId=<uuid>
  &result=failure
  &from=2026-09-01T00:00:00Z&to=2026-09-30T23:59:59Z
```

排序固定 `occurred_at DESC, id DESC`，不提供其他排序——所有索引都以
`occurred_at DESC` 結尾，換排序就是全表掃描。

**列表只回摘要**（不含 `changes` / `metadata`）。這兩個 jsonb 是一筆紀錄裡最大的部分，
列表不讀它們就省下 detoast 與傳輸；展開明細時才打 `GET /audit-logs/:id` 取完整紀錄。

`GET /audit-logs/:id` 的錯誤：`id` 不是正整數（含空字串）→ `400 VALIDATION_FAILED`（`fields.id`）；
查無（含已過保留期被清除、超出 bigint 範圍）→ `404 AUDIT_LOG_NOT_FOUND`，與其他資源的 `<RESOURCE>_NOT_FOUND` 一致。

### 7.1 `action` 的前綴比對

```ts
const actionFilter = query.action?.endsWith("*")
  ? like(auditLogs.action, `${escapeLike(query.action.slice(0, -1))}%`)
  : eq(auditLogs.action, query.action);
```

`role.*` 會命中 `role.create` / `role.update` / `role.grantPermission`…
這是稽核人員最常用的查詢方式（「給我所有跟角色有關的變更」）。
使用者輸入的 `%` / `_` 會被跳脫，不會變成萬用字元；熱表的 `action` 索引用
`text_pattern_ops`，前綴比對也能走索引（[`02-database.md`](./02-database.md) §2.8）。

### 7.2 時間範圍上限

常數在 `modules/audit-log/audit-log.constants.ts`。熱表保留天數不是常數，是租戶的 feature 參數 `auditLog.hotRetentionDays`
（預設 90 天、7～3650，平台管理者設定；[`architecture/05-tenancy.md`](../05-tenancy.md) §13.3 D7、[`../05-tenancy.md`](../05-tenancy.md) §5.3）：

| 常數 | 值 | 用途 |
| --- | --- | --- |
| `AUDIT_LOG_MAX_RANGE_DAYS` | 90 | 單次查詢的時間跨度上限；也是沒帶範圍時的預設跨度 |
| `AUDIT_LOG_ARCHIVE_BATCH_SIZE` | 5000 | 熱 → 冷每批搬移筆數 |

`resolveAuditLogRange()` 補齊範圍：

| 帶了什麼 | 實際範圍 |
| --- | --- |
| 都沒帶 | `[now − 90 天, now]` |
| 只帶 `to` | `[to − 90 天, to]` |
| 只帶 `from` | `[from, min(from + 90 天, now)]` |
| 都帶 | 原樣；`from > to` 或跨度超過 90 天 → `400 VALIDATION_FAILED`（`fields.from`） |

範圍一定存在，所以 `count(*)` 與排序的成本有上界，不會隨資料累積無限成長。

90 天在 1000 人的租戶仍可能是數百萬列，所以再加兩個上限：

- `offset` 最多 `AUDIT_LOG_MAX_OFFSET`（10,000），超過回 `400 VALIDATION_FAILED`；再往後請縮小範圍或加篩選。
- `total` 最多數到 `AUDIT_LOG_COUNT_CAP`（10,100，剛好涵蓋能翻到的最後一頁）：`count(*)` 包在 `LIMIT` 子查詢裡，
  掃到上限就停。畫面上的總數等於上限時代表「至少這麼多」。

**keyset 分頁**：回應除了 `pagination`，另有 `nextCursor`（上一頁最後一筆的微秒精度 `occurred_at` ＋ id，沒有下一頁是 `null`；多讀一筆判斷）。
帶 `cursor` 時以 `(occurred_at, id) < (…)` 取下一頁，不看 `offset`（兩者同時帶回 `400`），兩張表的 `(occurred_at, id)` 索引都用得上，
翻多深都只讀一頁，也不受 `AUDIT_LOG_MAX_OFFSET` 限制；格式不對的游標回 `400 VALIDATION_FAILED`（`fields.cursor`）。總數不受游標影響。
backstage 的列表頁仍是頁碼：依序按「下一頁」時，用上一頁回應的 `nextCursor` 取（`useAuditLogCursor`），跳頁、重新整理、從網址進來的頁才用 `offset`；
篩選條件或每頁筆數改變時，記下的游標全部作廢。平台的稽核列表資料量小，維持 offset。

**查哪張表**：先讀冷表最新一筆的時間（`max(occurred_at)`，只讀時間索引的第一列）；`from` 晚於它時資料一定全在熱表，
只查熱表；否則熱表與冷表 `UNION ALL`（Postgres 以兩邊的
`(occurred_at, id)` 索引 Merge Append，讀到 `offset + limit` 筆就停），總數是兩邊
`count(*)` 相加。單筆詳情用 `(熱表 WHERE id) UNION ALL (冷表 WHERE id) LIMIT 1`：
一次來回，熱表命中時冷表的掃描不會執行。

不以保留天數推算要不要查冷表：保留天數是租戶的參數，調大之後已經搬到冷表的紀錄不會回到熱表，推算會漏查（[`architecture/05-tenancy.md`](../05-tenancy.md) §13.3 D7）。

### 7.3 前端呈現

- 列表：時間、操作者、動作（已本地化）、資源、結果
- 展開單列：明細顯示在該列正下方（`Table` 的展開列），此時才向 `GET /audit-logs/:id` 取明細（`staleTime: Infinity`，紀錄不可變，取一次即可）；
  `changes` 與 `metadata` 並排：`changes` 以 `JsonDiff` 呈現 `before` → `after` 的逐行差異（新增／刪除上色、未變更的長段收合；
  建立只有 `after` 時整份是新增、刪除只有 `before` 時整份是刪除，`null` 顯示「沒有變更」），`metadata` 以 `JsonViewer` 顯示；
  兩者最高 `16rem` 後在框內捲動、行數多時虛擬捲動（見 [`../frontend/07-ui-system.md`](../frontend/07-ui-system.md) §3.12）
- 列表沒有批次操作，勾選欄預設隱藏（`defaultHidden`），需要時在欄位設定打開
- 日期篩選用 `DateRangePicker` 的 `maxSpanDays`（前端 `AUDIT_LOG_MAX_RANGE_DAYS`，與後端同值），
  選了起日後超過 90 天的日期不可選；未選日期時由後端補成最近 90 天
- 失敗的列以 danger 色標示，並顯示 `errorCode` 對應的訊息
- `auth.refresh.reuse_detected` 特別標記為高風險（不同的圖示與顏色）

---

## 8. 冷熱分層、保留與容量

| 層 | 表 | 內容 | 索引 | 誰會讀 |
| --- | --- | --- | --- | --- |
| 熱 | `audit_logs` | 最近 `auditLog.hotRetentionDays` 天（預設 90）；所有寫入都進這裡 | 時間、操作者、資源、動作（pattern ops） | 預設查詢、所有寫入 |
| 冷 | `audit_logs_archive` | 更早的；`id` 沿用熱表 | 時間、操作者、資源；jsonb 用 lz4 壓縮 | 查詢範圍涵蓋冷表最新的一筆時 |

搬移由背景工作 `auditLog.archive` 依 `AUDIT_LOG_ARCHIVE_CRON`（預設每天 03:30 UTC）執行
（[`10-jobs.md`](./10-jobs.md)），執行結果與失敗原因在背景工作頁看得到。排程出問題時可手動補跑：

```bash
pnpm db:archive-audit-logs   # 與排程工作呼叫同一個函式（modules/audit-log/audit-log.archive.ts）
```

兩者都讀租戶的 `auditLog.hotRetentionDays`（工作在租戶脈絡裡讀 `TenantContext`，腳本讀平台 DB 的登記），以
`cutoff = now − 保留天數` 重複呼叫
`archive_audit_logs(cutoff, AUDIT_LOG_ARCHIVE_BATCH_SIZE)`，直到某批不滿為止。每批是一個
短交易（鎖定 → 複製 → 刪除），兩個排程重疊時 `SKIP LOCKED` 讓它們不互搶。
搬移中斷也安全：沒搬完的列還在熱表，查詢規則（§7.2）本來就會把它們算進去。

`archive_audit_logs()` 是 `SECURITY DEFINER`（migration `0001_functions_and_triggers.sql`，[`backend/10-jobs.md`](10-jobs.md) §9.2 D8）：
以擁有資料表的 role 執行，所以應用程式的 role 不需要 `audit_logs` 的 DELETE 就能搬移；
熱表的刪除 trigger 仍要求冷表有完全相同的副本，函式也做不了別的事。`search_path` 固定為
`public, pg_temp`，避免呼叫端以同名物件劫持。`EXECUTE` 維持預設的 `PUBLIC`（role 名稱依部署而定）；
拆分 role 的部署可自行 `REVOKE … FROM PUBLIC` 後只授給應用程式的 role。

| 項目         | 決定                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 保留期       | ≥ 365 天（熱表預設 90 天 ＋ 冷表其餘）                                      |
| 熱表大小     | 固定約「保留天數」的量，不隨保留期成長                                       |
| 冷表分區時機 | 超過約 1000 萬列時按月分區（[`02-database.md`](./02-database.md) §7）       |
| 清理方式     | 冷表分區化之後用 `DROP TABLE <partition>`；在那之前由維運 role 處理          |
| 估算         | 100 位活躍管理員 × 每天 50 次寫入操作 ≈ 180 萬筆/年 → 熱表約 45 萬筆          |

---

## 8.1 平台稽核（`platform_audit_logs`）

每個租戶一個 database（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D19）：上面描述的 `audit_logs` 是 **租戶** 的稽核，
在各租戶的 DB 裡，只記錄那個租戶裡發生的事。平台管理者（apps/platform）做的事另外寫在平台 DB 的 `platform_audit_logs`：

| 項目 | 租戶的 `audit_logs` | 平台的 `platform_audit_logs` |
| --- | --- | --- |
| 寫入 | `AuditService` | `PlatformAuditService`（`modules/platform-admin`） |
| 內容 | 使用者、角色、檔案、審批… | 平台管理者的登入、租戶的建立／佈建／停用／刪除／清除、平台管理者的管理、平台的背景工作重試、平台端點的 `authz.denied` |
| 欄位 | §3 | 精簡版：`occurred_at`、`actor_*`、`action`、`resource_type`、`resource_id`、`result`、`error_code`、`metadata`（沒有 `changes`，前後值放在 `metadata.before`／`after`） |
| 查詢 | `GET /audit-logs`（`auditLog:read`） | `GET /platform/audit-logs`（`platformAuditLog:read`）：同樣固定 `occurred_at DESC`、最多 90 天、`action` 支援 `x.*` 前綴；筆數少，列表直接帶 `metadata` |
| 冷熱分層 | §8 | 沒有（量小） |

兩邊互相看不到：平台管理者看不到租戶的稽核（要看就得在那個租戶有帳號），租戶也看不到平台做過什麼。
平台稽核同樣 append-only：trigger `platform_audit_logs_immutable` 阻擋 `UPDATE`／`DELETE`（平台 migration 0002）。

## 9. 檢查清單

- [ ] 所有寫入操作都有對應的稽核紀錄
- [ ] 業務變更的稽核與變更在同一個交易內
- [ ] 稽核寫入失敗會讓操作失敗（不吞例外）
- [ ] `authz.denied` 記錄所需權限與缺少的權限
- [ ] `auth.refresh.reuse_detected` 有紀錄且被標為高風險
- [ ] `changes` 只含實際變更的欄位
- [ ] 密碼雜湊、token 雜湊絕不出現在 `changes` 或 `metadata`
- [ ] 授權變更用完整前後清單，不用差異
- [ ] `actorEmail` / `resourceName` 是寫入當下的快照
- [ ] DB trigger 阻擋 `UPDATE` / `DELETE`
- [ ] 應用程式的 DB role 沒有 `audit_logs` 的 `UPDATE` / `DELETE` 權限
- [ ] 不存在修改或刪除稽核的 API
- [ ] `requestId` 出現在每一筆 `metadata` 中，可與應用日誌對照
- [ ] 列表查詢一定帶時間範圍，跨度不超過 `AUDIT_LOG_MAX_RANGE_DAYS`
- [ ] 列表不回 `changes` / `metadata`；明細在展開時才取
- [ ] 範圍在熱表保留期內時不碰冷表
- [ ] 熱表的列只有在冷表有完全相同副本時才能被刪除
