# API 驗證不一致：平台列表的 offset 沒有上限，VALIDATION_FAILED 的 details 有兩種形狀

## 現況

### 1. 平台的三個列表沒有用 `OffsetSchema`

[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §2 規定：

- `offset` 上限 1 萬，超過回 `400 VALIDATION_FAILED`。
- 自訂 `limit` 範圍的列表也要用 `OffsetSchema`。

`apps/api/src/core/http/pagination.ts`（L3–11）的註解說明，上限也用來擋超出 bigint 的值。下面三個 DTO 自己寫 `offset`，沒有上限：

| 端點 | DTO（`apps/api/src/modules/`） |
| --- | --- |
| `GET /platform/tenants` | `tenant/dto/platform-tenant.dto.ts` 的 `ListPlatformTenantSchema`（L119） |
| `GET /platform/notifications` | `platform-notification/dto/platform-notification.dto.ts` 的 `ListPlatformNotificationSchema`（L6） |
| `GET /platform/audit-logs` | `platform-admin/dto/platform-admin.dto.ts` 的 `ListPlatformAuditLogSchema`（L60） |

```ts
offset: z.coerce.number().int().min(0).default(0),
```

已在拋棄式的 Postgres 17 container 確認：`OFFSET` 收到超出 bigint 的值時，Postgres 回 `value "…" is out of range for type bigint`。`HttpExceptionFilter` 不認得這個錯誤，於是回 `500 INTERNAL_ERROR`。

### 2. `VALIDATION_FAILED` 的 `details` 有 `field` 與 `fields` 兩種形狀

規格與前端只認 `details.fields`：

- [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §1 的表格與 §3.2。
- `packages/web-core/src/errors/AppError.ts` 的 `fieldErrors`（L22–26）；`useServerFieldErrors` 只用它回填欄位。

下面三處送的是單數的 `field`：

- `modules/tenant/platform-tenant.service.ts` 的 `nextBucket()`（L554–561）：`{ field: 'code' }`。建立租戶時，由代碼推導出的 bucket 名稱不合法。
- `modules/platform-admin/platform-admin-management.service.ts` 的 `nextStatus()`（L179–187）：`{ field: 'status' }`。改 `pending` 管理者的狀態時。
- `modules/file/file-folder.service.ts` 的 `assertDepth()`（L617–625）與 `assertMovable()`（L627 起，L649）：`{ field: 'depth', max }`。建立或移動資料夾超過深度上限時。

游標格式不對時的 `{ field: 'cursor' }`（`file.service.ts` L126、`notification.service.ts` L64）是 [`backend/15-notification.md`](../architecture/backend/15-notification.md) §10 明寫的形狀，而且是 query 參數，不在這次的範圍。

## 影響

- 第 1 點：只有平台管理者打得到。
  - `GET /platform/audit-logs?offset=10000000000000000000` 回 500，並記一筆錯誤日誌，而不是規格的 400。
  - 很大但合法的 offset（例：5000000）會讓平台稽核表做深分頁掃描。
- 第 2 點：表單送出後，錯誤不會標在對應的欄位上，只顯示表單層級的訊息。這三種情況本來就少見：代碼格式已經由 DTO 擋下，平台頁面也沒有提供改 `pending` 管理者狀態的操作。

## 修正方式

1. 三個 DTO 的 `offset` 改用 `OffsetSchema`（`@/core/http`）。
2. 表單情境改成 `details.fields`，值放錯誤原因：
   - 例：`{ fields: { code: 'invalid bucket name' } }`、`{ fields: { status: 'pending' } }`。
   - 資料夾深度要標在哪個欄位，依前端的表單決定（建立時是 `name`，移動時是目標資料夾）；`max` 照舊放在 `details`。
3. 在 03-api-conventions §1 註明：單數的 `details.field` 只用在 query 參數。

## 驗證方式

- `apps/api/test/platform-admin.spec.ts`、`apps/api/test/platform-tenant.spec.ts`：`offset=10001` 回 `400 VALIDATION_FAILED`。
- `modules/file/__tests__/file-folder.service.spec.ts` L412 目前斷言 `details: { field: 'depth', max }`，改成斷言 `details.fields`。
- `modules/tenant/__tests__/platform-tenant.service.spec.ts`：補 bucket 名稱不合法的案例，斷言 `details.fields.code`。
