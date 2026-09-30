# 後端 03 — API 慣例

## 1. 回應信封

所有回應都被 `TransformInterceptor` 包成統一形狀。

### 成功

```jsonc
{ "data": {/* … */} }
```

分頁：

```jsonc
{
  "data": {
    "items": [/* … */],
    "pagination": { "offset": 0, "limit": 20, "total": 137 },
  },
}
```

### 失敗

```jsonc
{
  "error": {
    "code": "ROLE_NAME_DUPLICATE",
    "message": "Role name already exists",
    "details": { "field": "name", "value": "系統管理員" },
    "requestId": "01JB2K...",
  },
}
```

| 欄位        | 說明                                                        |
| ----------- | ----------------------------------------------------------- |
| `code`      | **穩定的** SCREAMING_SNAKE 字串。前端據此決定行為與顯示訊息 |
| `message`   | 英文，給開發者看的。**前端不直接顯示給使用者**              |
| `details`   | 結構化補充資料。欄位錯誤放 `details.fields`                 |
| `requestId` | 對應日誌與稽核紀錄                                          |

> `message` 不做 i18n。後端不知道使用者的語系偏好（那是 UI 決定），也不該
> 為了錯誤訊息而載入語系包。前端用 `t('error.' + code)` 顯示。

---

## 2. 分頁

```ts
// core/http/pagination.ts
export const MAX_OFFSET = 10_000;
export const OffsetSchema = z.coerce.number().int().min(0).max(MAX_OFFSET).default(0);
export const PaginationSchema = z.object({
  offset: OffsetSchema,
  limit: z.coerce.number().int().min(1).max(200).default(20),
});
```

`offset` 上限 1 萬：offset 分頁要先掃過前面每一列，極大的 offset 等於全表掃描；超過時回 `400 VALIDATION_FAILED`，
該用篩選條件縮小範圍。自訂 `limit` 範圍的列表（背景工作…）也用 `OffsetSchema`。

關鍵字搜尋（`ILIKE`／`LIKE`）的使用者輸入一律經過 `core/database` 的 `containsPattern()`／`prefixPattern()`
（`escapeLike()` 跳脫 `%`、`_`、`\`）：否則搜尋 `_` 會匹配所有列。

**offset/limit 而非 cursor**：管理後台需要「跳到第 5 頁」與「共 137 筆」，
cursor 分頁做不到。資料規模（使用者、角色）也遠不到 offset 分頁會變慢的量級。

`audit_logs` 是唯一可能很大的表，它的 `limit` 上限是 100，且排序固定為
`occurred_at DESC`（確保索引命中）。日後若需要深分頁，改用
`WHERE occurred_at < :cursor` 的 keyset 分頁。

### 2.1 排序

多欄排序：查詢參數 `sort=<欄位>`（升冪）或 `sort=-<欄位>`（降冪），可重複，**出現順序就是優先順序**。

```http
GET /users?sort=displayName&sort=-createdAt
```

```ts
// core/http/pagination.ts —— 解析成 SortEntry[]（資料結構同前端 shared/constants/sort.ts）
export const SortSchema = <const T extends readonly [string, ...string[]]>(fields: T) =>
  z.object({
    sort: z.preprocess(
      parseSortTokens, // "name" → { sort: "name", order: "asc" }；"-name" → { sort: "name", order: "desc" }
      z
        .array(z.object({ sort: z.enum(fields), order: z.enum(["asc", "desc"]) }))
        .min(1)
        .max(fields.length)
        .refine(noDuplicateField)
        .default([{ sort: fields[0], order: "desc" }]),
    ),
  });

// repository：依序 orderBy，最後以 id 收尾讓分頁順序穩定
.orderBy(...query.sort.map(({ sort, order }) => (order === "asc" ? asc : desc)(SORT_COLUMNS[sort])), desc(users.id))
```

**欄位必須是白名單 enum**，不接受任意欄位名——那是 SQL injection 的入口，
也會讓沒有索引的欄位被拿來排序。同一欄位出現兩次（即使方向不同）、欄位名不在白名單（含舊格式 `name:asc`、`--name`）都回 400。
前端網址用同一個格式（見 [`frontend/04-routing.md`](../frontend/04-routing.md) §3）。

---

## 3. 驗證

### 3.1 DTO = Zod schema + 推導型別

```ts
// modules/role/dto/create-role.dto.ts
import { z } from "zod";

export const CreateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    description: z.string().trim().max(500).optional(),
    permissionKeys: z.array(z.string()).max(100).default([]),
  })
  .openapi({ ref: "CreateRoleRequest" });

export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;
```

一份宣告同時是：執行期驗證、TypeScript 型別、OpenAPI schema。

### 3.2 `ZodValidationPipe`

```ts
@Post()
@RequirePermissions(PERMISSION.ROLE_CREATE)
async create(
  @Body(new ZodValidationPipe(CreateRoleSchema)) dto: CreateRoleDto,
  @CurrentUser() actor: AuthUser,
) {
  return this.roleService.create(dto, actor);
}
```

Zod 失敗時拋 `ZodError`，由 `HttpExceptionFilter` 轉成：

```jsonc
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": { "fields": { "name": "String must contain at least 1 character(s)" } },
  },
}
```

`details.fields` 的形狀是前端表單回填欄位錯誤的契約（見
[`../frontend/05-data-layer.md`](../frontend/05-data-layer.md) §7）。

---

## 4. HTTP 方法語意

| 方法     | 語意              | 本專案的用法                                                     |
| -------- | ----------------- | ---------------------------------------------------------------- |
| `GET`    | 讀取，冪等        | 全部讀取端點                                                     |
| `POST`   | 建立 / 非冪等動作 | `/roles`、`/auth/login`、`/users/:id/unlock`                     |
| `PATCH`  | 部分更新          | `/users/:id`、`/roles/:id`、`/roles/:id/permissions`（差異語意） |
| `PUT`    | **整體取代**      | `/users/:id/roles`（整批取代角色清單）                           |
| `DELETE` | 刪除              | `/roles/:id`、`/users/:id`                                       |

### 4.1 `PUT /users/:id/roles` vs `PATCH /roles/:id/permissions`

兩個看似相似的操作，語意刻意不同：

|              | 語意                       | 理由                                                                                        |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------- |
| 使用者的角色 | `PUT`，整批取代            | UI 是一個多選器，送出的是「最終狀態」。數量少（通常 1–3 個）                                |
| 角色的權限   | `PATCH`，`{ add, remove }` | UI 是一個 15 項的勾選清單。整批取代在兩人同時編輯時會互相覆寫；差異語意只影響實際被動的項目 |

---

## 5. 錯誤碼

`core/errors/error-code.ts` 是 **唯一定義處**：

```ts
export const ErrorCode = {
  // ── 驗證 ──
  VALIDATION_FAILED: { status: 400 },

  // ── 認證 ──
  AUTH_INVALID_CREDENTIALS: { status: 401 },
  AUTH_ACCOUNT_PENDING: { status: 401 },
  AUTH_ACCOUNT_DISABLED: { status: 403 },
  AUTH_ACCOUNT_LOCKED: { status: 403 },
  AUTH_TOKEN_INVALID: { status: 401 },
  AUTH_TOKEN_STALE: { status: 401 },
  AUTH_REFRESH_INVALID: { status: 401 },
  AUTH_REFRESH_EXPIRED: { status: 401 },
  AUTH_REFRESH_REVOKED: { status: 401 },
  AUTH_REFRESH_REUSED: { status: 401 },
  AUTH_PASSWORD_MISMATCH: { status: 400 },
  AUTH_PASSWORD_WEAK: { status: 400 },
  AUTH_SETUP_TOKEN_INVALID: { status: 400 },

  // ── 授權 ──
  AUTHZ_FORBIDDEN: { status: 403 },
  AUTHZ_ESCALATION: { status: 403 },
  AUTHZ_SELF_MODIFY: { status: 403 },
  ROUTE_PERMISSION_NOT_DECLARED: { status: 500 },

  // ── 使用者 ──
  USER_NOT_FOUND: { status: 404 },
  USER_EMAIL_DUPLICATE: { status: 409 },
  USER_USERNAME_DUPLICATE: { status: 409 },
  USER_NOT_LOCKED: { status: 409 },

  // ── 角色 ──
  ROLE_NOT_FOUND: { status: 404 },
  ROLE_NAME_DUPLICATE: { status: 409 },
  ROLE_SYSTEM_PROTECTED: { status: 403 },
  ROLE_SUPER_ADMIN_IMMUTABLE: { status: 403 },
  ROLE_IN_USE: { status: 409 },
  LAST_SUPER_ADMIN: { status: 403 },
  ROLE_SELF_LOCKOUT: { status: 403 },

  // ── 權限 ──
  PERMISSION_UNKNOWN: { status: 400 },

  // ── 審批 ──
  APPROVAL_NOT_FOUND: { status: 404 },
  APPROVAL_ALREADY_REVIEWED: { status: 409 },
  APPROVAL_SELF_REVIEW: { status: 403 },

  // ── 通用 ──
  NOT_FOUND: { status: 404 },   // 框架層的 404（路徑不存在）
  CONFLICT: { status: 409 },    // 沒有對應業務錯誤碼的唯一鍵衝突
  RATE_LIMITED: { status: 429 },
  INTERNAL_ERROR: { status: 500 },
} as const;

export type ErrorCode = keyof typeof ErrorCode;
```

### 5.1 新增錯誤碼的流程

1. 加進上面的表
2. 在 `apps/backstage/src/app/locales/{en_US,zh_TW}.json` 加 `error.<CODE>`
3. CI 檢查會驗證每個 code 都有兩個語系的翻譯

### 5.2 `AppException`

```ts
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? code);
  }
}

// 使用
throw new AppException(ErrorCode.ROLE_NAME_DUPLICATE, { field: "name", value: dto.name });
```

Service 層一律拋這個，**不拋 `HttpException`**。狀態碼的對應是
`HttpExceptionFilter` 的事，service 不該知道 HTTP。

---

## 6. 錯誤過濾器

```ts
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const requestId = getRequestId();

    if (exception instanceof AppException) {
      const { status } = ErrorCode[exception.code];
      return res.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          requestId,
        },
      });
    }

    if (exception instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          details: { fields: flattenZodError(exception) },
          requestId,
        },
      });
    }

    // Postgres 唯一鍵衝突：競態下 service 的預檢查沒擋住
    if (isUniqueViolation(exception)) {
      return res.status(409).json({
        error: {
          code: mapConstraintToCode(exception.constraint_name),
          message: "Conflict",
          requestId,
        },
      });
    }

    // 未知錯誤：記完整堆疊到日誌，只回 requestId 給客戶端
    this.logger.error({ err: exception, requestId }, "Unhandled exception");
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId },
    });
  }
}
```

**唯一鍵衝突的處理不是多餘的**：service 的「名稱是否重複」預檢查與實際 INSERT
之間有時間差，兩個同時的請求會有一個撞到 DB 約束。把它對應回正確的
`*_DUPLICATE` 錯誤碼，使用者看到的仍是「名稱重複」而不是 500。

沒有登記在 `CONSTRAINT_TO_CODE` 的約束回通用的 `409 CONFLICT`（並記一筆 warn 日誌），不是 500：
衝突是請求與現有資料的問題，不是伺服器壞了。

框架內建的 `HttpException`（`ParseUUIDPipe`、找不到路由、guard 回 false）依狀態碼對應錯誤碼：
400 → `VALIDATION_FAILED`、401 → `AUTH_TOKEN_INVALID`、403 → `AUTHZ_FORBIDDEN`、404 → `NOT_FOUND`、
409 → `CONFLICT`、429 → `RATE_LIMITED`；其餘 4xx 視為 `VALIDATION_FAILED`，5xx 為 `INTERNAL_ERROR`（`codeOfHttpStatus`）。

陣列欄位的 id 清單以 `uniqueItems()`（`core/validation`）禁止重複，在入口就回 `VALIDATION_FAILED`。

---

## 7. OpenAPI

```ts
// main.ts
const config = new DocumentBuilder()
  .setTitle("B2B System API")
  .setVersion(pkg.version)
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, config);
if (env.NODE_ENV !== "production") SwaggerModule.setup("docs", app, document);
// 永遠輸出檔案，供 SDK 產生
writeFileSync("openapi.json", JSON.stringify(document, null, 2));
```

### 7.1 `PermissionKey` 必須出現在 spec 裡

這是前後端共用權限鍵的關鍵。定義一個 schema 讓它被產生為 enum：

```ts
export const PermissionKeySchema = z
  .enum(ALL_PERMISSION_KEYS) // 從 PERMISSION_SEED 推導
  .openapi({ ref: "PermissionKey" });
```

任何回傳權限鍵的端點（`/auth/profile`、`/permissions`、`/roles/:id/permissions`）
都引用它，於是 `packages/api-sdk` 會產生：

```ts
export const PermissionKey = {
  UserCreate: "user:create",
  UserRead: "user:read",
  // …
} as const;
```

前端的 `core/permission/enums.ts` 直接 re-export 它。
**權限鍵只在後端定義一次。**

### 7.2 SDK 產生

```bash
pnpm sdk:generate
# 讀進版控的 apps/api/openapi.json
# → packages/api-sdk/codegen（自製產生器）
# → packages/api-sdk/src/generated/（TS 型別 ＋ zod schema ＋ fetch 函式）
```

CI 會檢查 `openapi.json` 與原始碼一致（重新產生後 `git diff` 必須為空），
避免有人改了 controller 卻忘記重新產生 SDK。

---

## 8. 速率限制

```ts
// app.module.ts —— 只註冊「一個」全域桶
ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => [
    { name: "default", ttl: 60_000, limit: config.get("DEFAULT_RATE_LIMIT") }, // 120
  ],
});
```

```ts
@Post('login')
@Public()
@Throttle({ default: AUTH_THROTTLE })   // 10 次 / 分，覆寫全域桶
async login(...) {}
```

> **為什麼不用具名的 `auth` throttler**：`@nestjs/throttler` 會把 **每一個**
> 具名 throttler 都套到 **所有** 路由上，因此多加一個 limit=10 的桶等於把整個
> API 限制成 10 次/分。正確作法是單一全域桶 ＋ 敏感端點以 `@Throttle()` 覆寫。
> 限制值由 `AUTH_RATE_LIMIT` / `DEFAULT_RATE_LIMIT` 設定（E2E 會調高）。

| 端點                    | 限制                                       |
| ----------------------- | ------------------------------------------ |
| `/auth/login`           | 10 次 / 分 / IP（另有同帳號 5 次失敗鎖定） |
| `/auth/forgot-password` | 3 次 / 分 / IP                             |
| `/auth/refresh`         | 30 次 / 分 / IP                            |
| 其餘                    | 120 次 / 分 / IP                           |

超過回 `429` ＋ `Retry-After` 標頭。

---

## 9. 其他約定

| 項目         | 約定                                                                |
| ------------ | ------------------------------------------------------------------- |
| 時間格式     | ISO 8601 UTC，帶 `Z`（`2026-09-19T02:10:00.000Z`）                  |
| ID           | uuid v4 字串                                                        |
| 布林查詢參數 | `?active=true`（字串），由 `z.coerce.boolean()` 轉型                |
| 陣列查詢參數 | 重複 key：`?status=active&status=locked`                            |
| 空值         | 用 `null` 表示「沒有值」，不用空字串                                |
| 欄位命名     | 回應一律 camelCase（Drizzle 已做 snake ↔ camel 轉換）               |
| 版本         | Phase 0 不加 `/v1` 前綴。需要時用標頭協商或新增前綴，不破壞既有路徑 |
| CORS         | 同源部署，不啟用。開發時由 Vite proxy 處理                          |

---

## 10. 批次操作

後端不提供批次端點。列表勾選多筆後的操作由前端逐筆呼叫單筆 API，見 [ADR-0012](../../adr/0012-batch-queue-worker.md)。
