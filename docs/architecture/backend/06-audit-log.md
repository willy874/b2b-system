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
`changes` 為 `null`。

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

1. **DB trigger**：`BEFORE UPDATE OR DELETE ON audit_logs` → `RAISE EXCEPTION`
2. **DB 權限**：應用程式的 DB role 只有 `INSERT, SELECT`
3. **沒有 API**：不存在 `PATCH /audit-logs/:id` 或 `DELETE /audit-logs/:id`

保留期滿的清理由一個獨立的維運 role 執行（或改用分區表 `DROP PARTITION`）。

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

排序固定 `occurred_at DESC`，不提供其他排序——所有索引都以
`occurred_at DESC` 結尾，換排序就是全表掃描。

### 7.1 `action` 的前綴比對

```ts
const actionFilter = query.action?.endsWith("*")
  ? like(auditLogs.action, `${query.action.slice(0, -1)}%`)
  : eq(auditLogs.action, query.action);
```

`role.*` 會命中 `role.create` / `role.update` / `role.grantPermission`…
這是稽核人員最常用的查詢方式（「給我所有跟角色有關的變更」）。

### 7.2 前端呈現

- 列表：時間、操作者、動作（已本地化）、資源、結果
- 展開單列：`changes` 以 before/after 並排差異顯示；`metadata` 以鍵值表顯示
- 失敗的列以 danger 色標示，並顯示 `errorCode` 對應的訊息
- `auth.refresh.reuse_detected` 特別標記為高風險（不同的圖示與顏色）

---

## 8. 保留與容量

| 項目         | 決定                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 保留期       | ≥ 365 天                                                                   |
| Phase 0 儲存 | 單一表                                                                     |
| 分區時機     | 超過約 1000 萬列                                                           |
| 清理方式     | 分區化之後用 `DROP TABLE <partition>`；在那之前用維運 role 批次 `DELETE`   |
| 估算         | 100 位活躍管理員 × 每天 50 次寫入操作 ≈ 180 萬筆/年 → Phase 0 單表綽綽有餘 |

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
