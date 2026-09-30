# 後端 12 — 系統設定（執行期可調）

會隨營運調整、不必重新部署就能改的值：帳號政策、上傳上限、預設時區。
每個租戶各自一份（設定表在租戶 DB），由有 `system:update` 的人在 backstage 的「系統設定」頁修改。

## 1. 分層

```
core/settings/                     機制：不認識任何模組
├── setting-definition.ts          defineSetting()、SettingCategory、env 相依的 schema／預設值
├── setting.repository.ts          system_settings 的查詢（目前租戶）
├── setting.service.ts             ★ SettingService：登記、讀取（每租戶快取）、寫入、失效
└── settings.module.ts             @Global

modules/<name>/<name>.settings.ts  各模組定義自己的設定，在自己的 *.module.ts 建構時 register()
modules/system/                    設定頁的 API：驗證、稽核、推播（system-setting.service.ts）
```

- **定義在程式碼，資料庫只存覆寫值**。定義包含 key、分類、Zod schema（允許的範圍）、預設值、是否公開。
  `system_settings` 沒有列的 key 就是預設值；還原預設 = 刪掉那一列。
- **各模組登記自己的設定**：`CredentialModule`、`FileModule`、`SystemModule`、`TrashModule` 的 constructor 呼叫
  `settings.register([...])`。重複的 key、預設值不符合自己的 schema 都讓程序啟動失敗。
  帳號政策登記在 `CredentialModule` 而不是 `AuthModule`：`UserModule` 只匯入前者，也要讀得到。
- **讀取**：`await settings.get(LOGIN_MAX_ATTEMPTS_SETTING)`，型別由定義推導。
  第一次讀取時把整張表（一個 key 最多一列）載入快取，key 是租戶 id（與權限快取一樣帶租戶，ADR-0020 D17）。
- **存的值不合目前的 schema**（例如之後收緊了範圍）時退回預設值並記 warn，不讓請求失敗。
- **快取**：寫入的交易提交後 `invalidate()` 目前租戶；另有 30 秒 TTL 當保險。
  多實例部署之前，其他執行個體最慢 30 秒後看到新值（[`../../features/multi-instance.md`](../../features/multi-instance.md)）。

### 1.1 資料表

```sql
CREATE TABLE system_settings (
  key         text PRIMARY KEY,              -- '<分類>.<名稱>'，已發布的 key 不改名
  value       jsonb NOT NULL,                -- 純量：string / number / boolean
  updated_at  timestamptz NOT NULL DEFAULT now(),   -- trigger set_updated_at
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
```

值只允許純量：表單、稽核的前後差異與 OpenAPI 都不必處理巢狀結構。

## 2. env 與設定的分工

| 放哪裡 | 什麼值 | 例 |
| --- | --- | --- |
| env | 部署相關：連線字串、密鑰、以整台主機為單位的值 | `ARGON2_*`、`TENANT_POOL_MAX`、`TRUST_PROXY`、所有 `*_CRON` |
| env | 在解析出租戶之前就要生效的值 | 速率限制（`*_RATE_LIMIT`；`RateLimitGuard` 在驗證 access token 之前執行，依主體、IP 或「email＋IP」計數；未登記的網域與未登入的請求也要擋，不能依賴租戶的設定） |
| env | 安全邊界、平台管理者也共用的值 | `JWT_ACCESS_TTL`、`REFRESH_TOKEN_TTL` |
| env ＋ 設定 | 與基礎設施有關、但租戶可以調小的值：**env 是上限與預設值** | `FILE_UPLOAD_MAX_SIZE` → `file.uploadMaxSize` |
| 設定 | 租戶的業務政策 | 鎖定次數、密碼長度、是否開放註冊 |
| 程式常數 | 協定或技術限制 | S3 的 `MAX_PART_COUNT`、`REALTIME_MAX_FRAME_BYTES`、授權碼 60 秒 |

env 相依的定義把 `schema`、`defaultValue` 寫成函式，`SettingService` 啟動時以 `ConfigService` 算一次：

```ts
export const FILE_UPLOAD_MAX_SIZE_SETTING = defineSetting({
  key: 'file.uploadMaxSize',
  category: SettingCategory.FILE,
  schema: (env) => z.number().int().min(Math.min(MIB, env('FILE_UPLOAD_MAX_SIZE'))).max(env('FILE_UPLOAD_MAX_SIZE')),
  defaultValue: (env) => env('FILE_UPLOAD_MAX_SIZE'),
  isPublic: false,
});
```

## 3. 設定清單

| key | 範圍 | 預設 | 公開 | 讀取的地方 |
| --- | --- | --- | --- | --- |
| `general.defaultTimezone` | IANA 時區 | `Asia/Taipei` | 是 | 目前只提供給前端（見 §5.3） |
| `auth.loginMaxAttempts` | 3–20 | 5 | 否 | `AuthService`：租戶使用者登入失敗的鎖定 |
| `auth.loginLockoutSeconds` | 60–86400 | 900 | 否 | 同上 |
| `auth.passwordMinLength` | 12–64 | 12 | 是 | `AuthService`：設定密碼、重設、變更、註冊 |
| `auth.registrationEnabled` | boolean | `true` | 是 | `AuthService.register`：關閉時 `404 AUTH_REGISTRATION_DISABLED` |
| `auth.activationTtlHours` | 1–168 | 24 | 否 | `AuthTokenService.issue`：啟用連結的到期時間與信裡寫的時數 |
| `auth.passwordResetTtlHours` | 1–24 | 1 | 否 | 同上，重設密碼連結 |
| `file.uploadMaxSize` | 1 MiB – env 上限（位元組） | env 值 | 否 | `FileService`：`createUpload` 的檢查與 `GET /files/upload-policy` |
| `trash.retentionDays` | 1–365（天） | 30 | 否 | `TrashService`：`trash.purge` 永久刪除的期限、回收桶列表的 `purgeAt`（[`13-trash.md`](./13-trash.md) §5）。調小後下一次排程就依新的天數清除 |
| `revision.keepVersions` | 1–1000（版） | 50 | 否 | `RevisionService.prune`：每個資源至少保留最新的這麼多版（[`14-revisions.md`](./14-revisions.md) §5） |
| `revision.keepDays` | 1–3650（天） | 90 | 否 | 同上：這麼多天內的版本一律保留；兩者之外的由 `revision.prune` 刪除 |
| `notification.retentionDays` | 1–365（天） | 30 | 否 | `NotificationService.cleanup`：已讀超過這麼多天的通知由 `notification.cleanup` 刪除；未讀的不受影響（[`15-notification.md`](./15-notification.md) §8） |
| `notification.maxPerUser` | 10–5000（則） | 500 | 否 | 同上：每人超過這個數量時刪除最舊的通知（不論已讀與否） |

- **範圍寫在 schema 上**：下限擋住會削弱安全性的值（鎖定次數不能是 0、密碼不能短於 12），
  上限擋住超出部署能力的值。存得進去的值都安全，所以修改只寫稽核、不走審批。
- **密碼長度**：DTO 的 `PasswordSchema` 仍以 12 擋（平台管理者也用它），service 再依租戶的設定檢查；
  太短時回 `VALIDATION_FAILED`，`details.fields.<欄位> = 'AUTH_PASSWORD_WEAK'`、`details.minLength`，與 DTO 驗證同一個形狀。
- **連結有效期以小時為單位**：信裡寫「N 小時內有效」，到期時間與信裡的數字出自同一個值。
- **平台管理者不讀這些設定**：登入鎖定仍讀 env `LOGIN_*`，啟用與重設連結用 `platform-admin.constants.ts`。
- **不搬進來的值**：
  - session 長度（`REFRESH_TOKEN_TTL`、`OIDC_TTL.Session`）：ADR-0004 要求兩者一致，而 IdP 屬於平台、
    所有租戶共用；要讓每個租戶各自設定，得把 OIDC provider 的 TTL 改成依請求計算。
  - 稽核日誌的保留天數：`AUDIT_LOG_HOT_RETENTION_DAYS` 必須 ≥ `AUDIT_LOG_MAX_RANGE_DAYS`，而且封存由平台排程執行。

## 4. API

| 端點 | 授權 | 說明 |
| --- | --- | --- |
| `GET /system/settings` | `system:read` | 所有設定：`key`、`category`、`type`、生效值、預設值、`isOverridden`、`isPublic`、`minimum`／`maximum`、`updatedAt` |
| `PATCH /system/settings` | `system:update` | `{ values: { <key>: <值> \| null } }`；`null` = 還原預設；一次最多 50 個 key。回傳同 `GET` |
| `GET /system/settings/public` | `@Public()` | `{ values: { <key>: <生效值> } }`，只有 `isPublic` 的設定。需要租戶脈絡：租戶網域，或 apps/auth 帶 `X-Tenant` |

`PATCH` 的規則（`SystemSettingService.update`）：

1. 每個 key 先驗證，全部通過才寫入：沒有登記的 key → `404 SETTING_NOT_FOUND`（`details.key`）；
   不合 schema → `400 VALIDATION_FAILED`，`details.fields['values.<key>']`（與 `ZodValidationPipe` 同一個形狀）。
2. 與生效值相同的 key 略過（沒有覆寫時等於預設值，存一列只會讓之後調整預設值時這個租戶跟不上）；
   還原一個沒有覆寫的 key 也略過。全部都沒變就不寫稽核、不推播。
3. 一個交易內寫入所有 key，並寫 **一筆** 稽核：`setting.update`、`resourceType: 'setting'`、
   `resourceName` 是改到的 key，`changes.before` / `changes.after` 是這些 key 的生效值。
4. 交易後失效快取，再發佈 `resource.changed`：每個 key 一筆 `{ resource: 'setting', kind: 'update', id: <key> }`，
   推給 `system:read` 的人（[`08-realtime.md`](./08-realtime.md) §6.1）。公開設定不即時推給所有人，下次載入時生效。

## 5. 前端

### 5.1 backstage：系統設定頁

`features/system`，路由 `/system/settings`，頁面權限 `SETTING_PAGE`（`system:read`），側邊選單「系統管理 › 系統設定」。

- 依分類（一般、帳號與登入、檔案、回收桶、版本紀錄、通知）各一張表單；只送出改過的 key，一個分類一次儲存。
- 數值依 `minimum`／`maximum` 先擋；位元組以 MiB 顯示（`constants.ts` 的 `SETTING_FIELD` 定義標籤、說明與單位）。
  後端新增了前端沒有的 key 時，以 key 本身當標籤顯示，不會壞掉。
- 有覆寫的設定顯示「已修改」與「恢復預設」；沒有 `system:update` 時整頁唯讀。

### 5.2 apps/auth：帳號流程

`features/login/hooks/useAccountPolicy.ts` 以 `X-Tenant` 讀租戶的公開設定：

- 登入互動頁：`auth.registrationEnabled` 為 `false` 時不顯示「申請帳號」；註冊頁顯示「目前不開放註冊申請」。
- 註冊、啟用、重設密碼：密碼長度的提示與前端檢查用 `auth.passwordMinLength`。
- 平台管理者（沒有租戶）與讀不到設定時用基準值 12；後端仍會再檢查一次。

### 5.3 預設時區

`general.defaultTimezone` 由 `GET /system/settings/public` 提供，但 backstage 目前的日期格式化（`shared/date`）
一律用常數 `Asia/Taipei`，連使用者的時區偏好也沒有套用。把偏好與租戶預設接進日期顯示是另一件工作。

## 6. 新增一個設定

1. 在擁有它的模組的 `<name>.settings.ts` 加一個 `defineSetting({...})`，放進該模組的 `*_SETTINGS` 陣列
   （模組還沒有登記過設定時，在它的 `*.module.ts` constructor 呼叫 `settings.register(...)`）。
2. 讀取的地方注入 `SettingService`，`await settings.get(XXX_SETTING)`。
3. 前端 `features/system/constants.ts` 的 `SETTING_FIELD` 加標籤、說明、單位；兩個語系檔的 `setting.field.<名稱>`。
   公開設定若有前端要用，在對應的地方讀 `GET /system/settings/public`。
4. 更新本文件 §3 的清單。
5. 新增分類時：`SettingCategory`、DTO 的 `category` enum、前端的 `SETTING_CATEGORIES` 與 `SETTING_CATEGORY_LABEL_KEY`。

## 7. 測試

| 對象 | 檔案 |
| --- | --- |
| 登記、預設值、覆寫、不合 schema 時退回、快取與租戶隔離 | `core/settings/__tests__/setting.service.spec.ts` |
| 修改的驗證、略過沒有變化的 key、稽核、推播、公開設定 | `modules/system/__tests__/system-setting.service.spec.ts` |
| HTTP：權限、驗證錯誤、還原預設、公開端點、關閉註冊、密碼長度、鎖定次數 | `test/system-settings.spec.ts` |
| 設定頁的三個權限案例、草稿、adapter | `apps/backstage/src/features/system/**/__tests__` |
| 帳號流程讀租戶設定 | `apps/auth/src/features/login/hooks/__tests__/useAccountPolicy.test.tsx`、`InteractionPage.test.tsx` |
