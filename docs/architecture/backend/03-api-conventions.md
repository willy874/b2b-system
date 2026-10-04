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

  // ── 租戶（節錄；完整清單見程式） ──
  TENANT_NOT_FOUND: { status: 404 },
  TENANT_UNAVAILABLE: { status: 503 },
  PLATFORM_ONLY: { status: 404 },     // 平台端點在租戶網域上等同不存在
  FEATURE_DISABLED: { status: 404 },  // 端點屬於租戶沒有啟用的 feature（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9.2 D11）；不暴露功能存在

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
  USER_ROLES_CONFLICT: { status: 409 },
  USER_VERSION_CONFLICT: { status: 409 },   // 樂觀鎖（§11）
  USER_NOT_DELETED: { status: 409 },        // 還原沒有被刪除的使用者（13-trash.md §4.1）

  // ── 角色 ──
  ROLE_NOT_FOUND: { status: 404 },
  ROLE_NAME_DUPLICATE: { status: 409 },
  ROLE_SYSTEM_PROTECTED: { status: 403 },
  ROLE_SUPER_ADMIN_IMMUTABLE: { status: 403 },
  ROLE_IN_USE: { status: 409 },
  LAST_SUPER_ADMIN: { status: 403 },
  ROLE_SELF_LOCKOUT: { status: 403 },
  ROLE_VERSION_CONFLICT: { status: 409 },   // 樂觀鎖（§11）
  ROLE_NOT_DELETED: { status: 409 },        // 還原沒有被刪除的角色（13-trash.md §6.1）

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
2. 在 `apps/backstage/src/app/locales/{en_US,zh_TW}.json`、`apps/platform/src/app/locales/{en_US,zh_TW}.json` 加 `error.<CODE>`，
   並加進兩個 app 的 `core/errors/errorMessageKey.ts`
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

前提是 B2B：一間公司的上千人常經由同一個 NAT 出口 IP 連線，所以 **已登入的請求以使用者（含租戶）計，
只有未登入的請求以 IP 計**。實作是 `common/guards/rate-limit.guard.ts`（全域 guard，在 `JwtAuthGuard` 之前）：
它自己驗 access token 的簽章取出使用者（不查 DB），規則與桶的組合在 `common/rate-limit.ts`（純函式，單元測試）。

```ts
@Post('login')
@Public()
@RateLimit('auth')        // 端點類別；數值由環境變數決定
async login(...) {}
```

| 端點                                   | 計數對象（每分鐘）                                       | 環境變數（預設）                                   |
| -------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| 一般端點，已登入                       | 每個使用者，所有端點合計                                 | `DEFAULT_RATE_LIMIT`（600）                        |
| 一般端點，未登入（或 token 無效）      | 每個 IP，所有未登入請求合計                              | `ANONYMOUS_RATE_LIMIT`（3000）                     |
| `@RateLimit('auth')`：登入、SSO 回呼、啟用／重設、外部 IdP、租戶代碼查詢 | 每個「email ＋ IP」（body 有 `email` 時）＋ 每個 IP | `AUTH_RATE_LIMIT`（10）、`AUTH_IP_RATE_LIMIT`（300） |
| `@RateLimit('authMail')`：忘記密碼、註冊 | 每個「email ＋ IP」＋ 每個 IP                            | 上一列的 1/3（至少 3）、1/10                       |
| `@RateLimit('refresh')`：`/auth/refresh`、`/platform/auth/refresh` | 每個 refresh session（cookie 的雜湊）＋ 每個 IP | `REFRESH_RATE_LIMIT`（30）、`REFRESH_IP_RATE_LIMIT`（2000） |
| `@SkipThrottle()`（影像 API）           | 不計                                                     | —                                                  |

- **數值的估算**（1000 人在同一個出口 IP）：access token 5 分鐘 → 續期約 200 次/分（重啟後會集中，IP 桶留 10 倍）；
  早上登入尖峰約 100 次/分 → 登入 IP 桶 300；每人平均每 10 秒一個請求，推播後集體重抓 → 每人 600/分。
  帳號層級的暴力破解另有帳號鎖定（連續失敗 N 次）；「帳號 ＋ IP」桶讓攻擊者無法用大量請求鎖住整間公司的 IP。
- IP 桶不會比帳號桶嚴格（`AUTH_IP_RATE_LIMIT` 小於 `AUTH_RATE_LIMIT` 時取後者），E2E 只要調高 `AUTH_RATE_LIMIT`。
- 超過回 `429 RATE_LIMITED`，帶 `Retry-After` 標頭與 `details.retryAfterSeconds`（前端顯示「請在 N 秒後再試」）。
- 計數在程序記憶體（`@nestjs/throttler` 的 storage）：單一執行個體的假設；多實例要換共享儲存（[`../../features/multi-instance.md`](../../features/multi-instance.md)）。
- 客戶端 IP 依 `TRUST_PROXY` 判定（見 [`../01-system.md`](../01-system.md) §4.2）；IPv6 以 /64 子網路計。
- WebSocket 不經過這個 guard：handshake 每 IP 與每使用者連線數見 [`08-realtime.md`](./08-realtime.md) §11。

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

後端不提供批次端點。列表勾選多筆後的操作由前端逐筆呼叫單筆 API，見 [`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13。
會改動實體欄位的批次（例：使用者的批次啟用／停用）帶 **列表那一列的 `version`**（§11）：列表資料過時的那幾筆以
`<RESOURCE>_VERSION_CONFLICT` 逐筆失敗、列在結果對話框（[`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13.6），不會蓋掉別人的變更。
`version` 必填：批次拿不到列的版本時那一筆失敗，不改成先讀最新的版本（那等於後寫者勝）。

---

## 11. 樂觀鎖（`version`）

「兩個人同時編輯同一筆，後送出的默默蓋掉先送出的」以 `version` 欄防止（[`backend/14-revisions.md`](14-revisions.md) §9.2 D3、D4）。
目前套用在 `users`、`roles`、`files`（[`09-file.md`](./09-file.md) §6.2）。

| 項目 | 約定 |
| ---- | ---- |
| 欄位 | `version integer NOT NULL DEFAULT 1`；詳情與列表的回應都帶 `version` |
| 請求 | 更新的請求本體帶 `version`（**必填**，編輯 **開始時** 看到的版本；不帶 → `400 VALIDATION_FAILED`）。不用 `ETag`／`If-Match`、不用 `updated_at` 比對（毫秒精度經 JSON 來回後對不上） |
| 寫入 | 讀到時先比對；寫入是條件式 `UPDATE … SET version = version + 1 WHERE id = $id AND version = $v AND deleted_at IS NULL`，比對與寫入在同一條語句 |
| 衝突 | `409 <RESOURCE>_VERSION_CONFLICT`，`details: { current }`。「讀到時就不同」與「UPDATE 沒命中而列仍存在」**兩條路徑都帶** `current`：沒命中時在同一個交易內重讀一次 |
| 已刪除 | UPDATE 沒命中而列已刪除 → 既有的 `404 <RESOURCE>_NOT_FOUND`，不是衝突 |
| 批次、腳本 | 批次以列表那一列的 `version` 逐筆送出，衝突逐筆失敗（[`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13.6）。沒有「不帶就後寫者勝」的路徑；腳本要後寫者勝就先讀一次目前的版本再送出（[`backend/14-revisions.md`](14-revisions.md) §9.2 D4） |
| 遞增時機 | **實體自己的可編輯欄位** 被寫入時遞增（包括不收 `version` 的端點，例如解鎖、個人資料）；關聯的寫入不遞增（見下表） |

哪些寫入遞增 `version`：

| 實體 | 遞增 | 不遞增 |
| ---- | ---- | ------ |
| `users` | `PATCH /users/:id`、解鎖、個人資料（`PATCH /auth/profile`）、啟用（`pending` → `active`）、重設密碼順帶解除 `locked` 狀態——即 `username`、`displayName`、`status`、`locale`、`timezone`（`USER_VERSIONED_FIELDS`） | 登入（`last_login_at`、失敗計數、`locked_until`）、改密碼、`token_version`、刪除；角色指派（`PUT /users/:id/roles`，關聯，沿用必填的 `expectedRoleIds`） |
| `roles` | `PATCH /roles/:id`（名稱、說明）、還原到某一版（`POST /roles/:id/revisions/:version/revert`，當成一次更新；[`14-revisions.md`](./14-revisions.md) §4.3） | 權限鍵（`PATCH /roles/:id/permissions`，差異語意）、持有者、刪除 |
| `files` | 改名（`PATCH /files/:id`） | 上傳流程的狀態、變體、移動（見 09 §6.2） |

帳號的運作狀態不遞增：否則每次有人登入，別人開著的編輯表單就會衝突。

版本歷史（[`14-revisions.md`](./14-revisions.md)）的版本號是另一個號碼：每個資源自己的流水號，關聯的寫入（權限鍵）也會產生新的一版，但不遞增這裡的 `version`。

前端：編輯表單在 **開始編輯時** 記下 `version` 並在送出時帶上（編輯途中推播讓資料重抓，也不能換成最新的版本，
否則等於默默覆寫）。收到 `*_VERSION_CONFLICT`（`isVersionConflict(error)`）時 mutation hook 失效該資源、不彈 toast，
表單以 `VersionConflictAlert`（`core/components`）說明並提供「重新載入」：重抓最新的內容與版本、放棄這次的修改。

---

## 12. 設計決策：前端 SDK 由後端 OpenAPI 產生

> 原 ADR-0007，2026-09-19 決定；2026-09-24 修訂為以自製產生器取代 orval（§12.6）。

### 12.1 背景

前後端需要共用型別，特別是 **權限鍵（`PermissionKey`）**。
如果兩邊各自維護一份清單，遲早會分歧——而權限鍵分歧的後果是
「前端顯示了按鈕但後端拒絕」或更糟的「前端隱藏了使用者其實有權限的功能」。

### 12.2 決定

```
apps/api  ──(@nestjs/swagger + zod-openapi)──▶  openapi.json
                                                     │
                                                     ▼ (packages/api-sdk/codegen)
                                          packages/api-sdk
                                                     │
                                                     ▼
                                    apps/backstage/src/shared/api-sdk (re-export)
```

- **後端是唯一事實來源**
- 權限鍵透過一個 `z.enum(ALL_PERMISSION_KEYS).openapi({ ref: 'PermissionKey' })`
  出現在 spec 裡，於是 SDK 會產生對應的 const 物件（§7.1）
- 前端的 `core/permission/enums.ts` 只做一層 re-export
- `apps/backstage/src/shared/api-sdk/index.ts` 是整個前端對 SDK 的 **唯一** 引用點
- CI 檢查：重新產生 `openapi.json` 後 `git diff` 必須為空（§7.2）

### 12.3 理由

1. **權限鍵只定義一次。** 後端的 `PERMISSION_SEED` 是唯一來源，
   前端拿到的是它的投影。
2. **型別不會過期。** 後端改了回應形狀，重新產生 SDK 後前端會編譯失敗——
   在 CI 就發現，而不是上線後。
3. **`shared/api-sdk` 的收斂點** 讓「換產生器」或「對某個型別做本地修補」
   只需要改一個檔案。
4. **NestJS 的 Swagger 整合幾乎零成本**，因為 Zod schema 已經用
   `.openapi({ ref })` 標註好了。

### 12.4 代價

| 代價 | 緩解 |
| --- | --- |
| 多一個產生步驟，忘記跑會不一致 | CI 檢查 `openapi.json` 的 diff；`pnpm build` 會先跑 `sdk:generate` |
| 產生的程式碼可讀性不如手寫 | 它不需要被讀，只需要被用；`shared/api-sdk` 隔離了它 |
| 後端未啟動時無法產生 | 從版控中的 `openapi.json` 產生即可，不需要跑起 server |
| 產生器的 API 風格未必符合喜好 | 前端不直接用產生的 client，而是在 `apis/*/fetcher.ts` 包一層 |

### 12.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 手寫共用 `packages/contracts` | 要靠人維護同步，就是要避免的問題 |
| tRPC | 要求前後端在同一個 TypeScript 專案並共用型別。與 NestJS 的 controller/DTO 模型不合，也放棄了 OpenAPI 帶來的可文件化 |
| GraphQL | schema 確實是單一來源，但為了一個 CRUD 管理後台引入 GraphQL 的複雜度不成比例 |
| 只共用權限鍵，其餘手寫型別 | 那就要維護兩套同步機制 |

### 12.6 實作紀錄：以自製產生器取代 orval（2026-09-24）

`packages/api-sdk/codegen/` 是專案自己的產生器，取代原本的 orval。

**產出**（`src/generated/`，整個目錄由產生器擁有）：

| 檔案 | 內容 |
| --- | --- |
| `models.ts` | `components.schemas` 的 TS 型別；字串 enum 另外輸出同名 `as const` 物件（`PermissionKey` 靠它） |
| `schemas.ts` | 同一批 component 的 zod schema（`UserSchema`…），以 `satisfies z.ZodType<User>` 和 `models.ts` 對齊 |
| `endpoints/<tag>.ts` | 每個 operation 的 `XxxInput` / `XxxResponses` / `XxxResult` 型別、`XxxSchemas`（path / query / headers / body / responses 的 zod）、URL builder `getXxxUrl(path?, query?)`、以及 fetch 函式 `xxx(input, options)` |
| `runtime.ts` | 由 `codegen/runtime.ts` 原樣複製：`request()`、`buildUrl()`、`ApiError`、`configureSdk()` |

**為什麼換掉 orval**

1. **只要 fetch、不要 middleware。** 攔截器（token、續期、重試、錯誤轉換）已經在
   `apps/backstage/src/core/client` 的 `HttpContext` 實作；SDK 再帶一套 mutator / interceptor 只會重疊。
   新產生器的執行期只有 `fetch`，需要客製傳輸時以 `options.fetch` 注入，不提供攔截器鏈。
2. **同時產出 zod schema。** 表單驗證與（可選的）回應驗證可以直接用 spec 產生的 schema，
   不必手寫一份「長得一樣」的 zod。
3. **每份 SDK 自給自足。** `runtime.ts` 複製進輸出目錄，多個後端各自產生 SDK 時設定互不干擾。
4. **命名可預測。** 巢狀的匿名物件不再被拆成 `XxxController200Data` 這類型別；
   需要內層型別時用索引存取（`UserControllerListResponse['data']`）。

**開源套件**：只用 `openapi-types`（spec 的型別定義）與 `tsx`（執行 TS 寫成的 CLI）；
zod 與 TS 的輸出由產生器自己寫，才能掌握 `$ref` → 具名 schema、循環引用（`z.lazy`）與宣告順序。

**支援範圍**：OpenAPI 3.0 / 3.1 的 JSON spec，只接受文件內的 `$ref`（外部檔案請先 bundle）。
cookie 參數不產生；`prefixItems`（tuple）以一般陣列表示——這些情況 CLI 會印出警告。
