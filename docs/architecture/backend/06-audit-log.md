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
|        | `auth.password_change` / `auth.password_reset`                    |                        |
|        | `auth.account_locked`                                             |                        |
| 授權   | `authz.denied`                                                    | 含所需權限與缺少的權限 |
| 使用者 | `user.create` / `user.update` / `user.delete`                     | 含 before/after        |
|        | `user.assignRole`                                                 | **含前後角色清單**     |
|        | `user.activate` / `user.unlock` / `user.reset_password_requested` |                        |
| 角色   | `role.create` / `role.update` / `role.delete` / `role.duplicate`  |                        |
|        | `role.grantPermission`                                            | **含前後權限清單**     |
| 審批   | `approval.submit`                                                 | 匿名申請（註冊）的 actor 為申請人 email、`actorId = null` |
|        | `approval.approve` / `approval.reject`                            | 含審核意見；核准另記該變更本身（例：`user.create`，`metadata.approvalId`） |
| 系統   | `system.bootstrap`                                                | 初始 super-admin 建立  |
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
    batch?: { size: number }; // 批次端點（ADR-0009 D8）；同一批共用 requestId
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
        ...(ctx?.batch && { batch: ctx.batch }), // runBatch() 執行期間帶入
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
`changes` 為 `null`。審批請求的 `private_payload`（註冊時的密碼雜湊）同樣不進稽核
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

熱 → 冷搬移與保留期滿的清理由一個獨立的維運 role 執行。

---

## 7. 查詢

```
GET /audit-logs?offset=0&limit=50
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

常數在 `modules/audit-log/audit-log.constants.ts`：

| 常數 | 值 | 用途 |
| --- | --- | --- |
| `AUDIT_LOG_MAX_RANGE_DAYS` | 90 | 單次查詢的時間跨度上限；也是沒帶範圍時的預設跨度 |
| `AUDIT_LOG_HOT_RETENTION_DAYS` | 90 | 熱表保留天數；**必須 ≥ 上一列**，預設查詢才只落在熱表（有單元測試守住） |
| `AUDIT_LOG_ARCHIVE_BATCH_SIZE` | 5000 | 熱 → 冷每批搬移筆數 |

`resolveAuditLogRange()` 補齊範圍：

| 帶了什麼 | 實際範圍 |
| --- | --- |
| 都沒帶 | `[now − 90 天, now]` |
| 只帶 `to` | `[to − 90 天, to]` |
| 只帶 `from` | `[from, min(from + 90 天, now)]` |
| 都帶 | 原樣；`from > to` 或跨度超過 90 天 → `400 VALIDATION_FAILED`（`fields.from`） |

範圍一定存在，所以 `count(*)` 與排序的成本有上界，不會隨資料累積無限成長。

**查哪張表**：搬移的 cutoff 只會早於 `now − 保留天數`，所以 `from ≥ now − 90 天`
時資料一定全在熱表，只查熱表；否則熱表與冷表 `UNION ALL`（Postgres 以兩邊的
`(occurred_at, id)` 索引 Merge Append，讀到 `offset + limit` 筆就停），總數是兩邊
`count(*)` 相加。單筆詳情用 `(熱表 WHERE id) UNION ALL (冷表 WHERE id) LIMIT 1`：
一次來回，熱表命中時冷表的掃描不會執行。

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
| 熱 | `audit_logs` | 最近 90 天；所有寫入都進這裡 | 時間、操作者、資源、動作（pattern ops） | 預設查詢、所有寫入 |
| 冷 | `audit_logs_archive` | 90 天以前；`id` 沿用熱表 | 時間、操作者、資源；jsonb 用 lz4 壓縮 | 查詢範圍早於 90 天時 |

搬移：

```bash
pnpm db:archive-audit-logs   # 每天由排程執行一次；用維運 role 的 DATABASE_URL
```

腳本以 `cutoff = now − AUDIT_LOG_HOT_RETENTION_DAYS` 重複呼叫
`archive_audit_logs(cutoff, AUDIT_LOG_ARCHIVE_BATCH_SIZE)`，直到某批不滿為止。每批是一個
短交易（鎖定 → 複製 → 刪除），兩個排程重疊時 `SKIP LOCKED` 讓它們不互搶。
搬移中斷也安全：沒搬完的列還在熱表，查詢規則（§7.2）本來就會把它們算進去。

| 項目         | 決定                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 保留期       | ≥ 365 天（熱表 90 天 ＋ 冷表其餘）                                          |
| 熱表大小     | 固定約 90 天的量，不隨保留期成長                                             |
| 冷表分區時機 | 超過約 1000 萬列時按月分區（[`02-database.md`](./02-database.md) §7）       |
| 清理方式     | 冷表分區化之後用 `DROP TABLE <partition>`；在那之前由維運 role 處理          |
| 估算         | 100 位活躍管理員 × 每天 50 次寫入操作 ≈ 180 萬筆/年 → 熱表約 45 萬筆          |

---

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
