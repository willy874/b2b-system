# 後端架構文件與實作不符：模組相依圖過時，災難復原的 cli:reset-super-admin 不存在

## 現況

### 1. 災難復原的 CLI 不存在

- [`rbac/05-seed-and-bootstrap.md`](../rbac/05-seed-and-bootstrap.md) §7（L273–287）寫：忘記 super-admin 密碼時，執行 `pnpm --filter @b2b-system/api cli:reset-super-admin --email …`。它會產生一次性的重設 token、印出連結，並寫 `system.super_admin_reset_requested` 稽核。
- [`backend/01-architecture.md`](../architecture/backend/01-architecture.md) §2 的目錄（L144–145）列出 `cli/reset-super-admin.ts`。
- 實際上：
  - 沒有 `apps/api/src/cli/`。
  - `apps/api/package.json` 沒有任何 `cli:*` script。
  - 整個 repo 找不到 `super_admin_reset_requested`。
- 現有的 `db:seed`（`apps/api/src/db/seeds/super-admin.ts` 的 `seedSuperAdmin()`）只在租戶裡一位 super-admin 都沒有時才建立，不能拿來重設既有 super-admin 的密碼。

### 2. 01-architecture §4 的模組相依圖過時（L226–237）

- 沒有 `ResourceGrant` 模組，`apps/api/src/modules/` 底下找不到。圖上卻有 `FileModule ──▶ ResourceGrant · Approval`，葉節點清單也列了它。資料夾授權其實在 `modules/file`。
- 葉節點清單裡有兩個其實不是葉節點：
  - `Approval` import 了 `NotificationModule`、`WebhookModule`（`approval.module.ts` L22）。
  - `Role` import 了 `TrashModule`、`RevisionModule`（`role.module.ts` L12）。
- 列出的相依不完整：
  - `UserModule ──▶ Credential · Approval · IdentityProvider`（L232）少了 Trash、Notification、Webhook、Tag、Announcement（`user.module.ts` L28 起）。
  - `FileModule` 實際 import 的是 Approval、Trash、AuthzExplain、Webhook、Tag（`file.module.ts` L42）。
- 這些模組沒有出現在圖上：Group、Webhook、Tag、Announcement、Notification、Trash、Revision、ServiceAccount、ApiToken、AuthzExplain。

### 3. 其他段落

- 01-architecture §4.1（L264–272）寫「單向依賴：`UserModule → RoleModule`」。實際上 `modules/user` 沒有 import `modules/role` 的任何檔案。
- 01-architecture §3.1 的 guard 清單（L203–211）少了排在第一個的 `SurfaceGuard`（`app.module.ts` L131）。
- 01-architecture §3 的第 ⑦ 步 `AuditInterceptor` 不存在，見 [`audit-decorator-without-interceptor.md`](./audit-decorator-without-interceptor.md)。
- [`backend/13-trash.md`](../architecture/backend/13-trash.md) 開頭（L8）與 §3 的 `type`（L80）只列使用者、角色、檔案、資料夾。`TRASH_RESOURCE_TYPES`（`modules/trash/trash.constants.ts` L10–17）還有 `group`、`announcement`。
- [`backend/15-notification.md`](../architecture/backend/15-notification.md) L7「目前的類型」只列三種。同一份文件 §4 的表格是五種，另有 `announcement.published`、`webhook.disabled`。

## 影響

- 第 1 點最實際：維運照 rbac/05 §7 做災難復原時，指令不存在。
  - 前提：super-admin 忘記密碼，而且「忘記密碼」的信寄不到（例：信箱失效、SMTP 不通）。
- 其他是文件誤導。`docs/` 是單一事實來源（[`CLAUDE.md`](../../CLAUDE.md)），新人會照它判斷：
  - 照 §4 的圖找 `ResourceGrant`、判斷誰是葉節點。
  - 照 13、15 的清單新增類型，以為清單是完整的。

## 修正方式

1. CLI 擇一（建議 a）：
   - a. 照 rbac/05 §7 實作：
     - 新增 `apps/api/src/cli/reset-super-admin.ts`：以 `--tenant <代碼>` 選租戶、`--email` 選人。
     - `package.json` 加 `cli:reset-super-admin`。
     - 流程：確認對象持有 super-admin → 用 `AuthTokenService` 同一套規則簽發 `password_reset` token → 印出連結 → 寫稽核。
   - b. 從 rbac/05 §7 與 01-architecture §2 移除，改寫成實際可行的復原步驟。

   平台的 super-admin 目前也沒有復原方式（見 [`platform-last-super-admin-race.md`](./platform-last-super-admin-race.md)），兩者一起決定。
2. 依 `apps/api/src/modules` 現況重畫 §2 的目錄與 §4 的相依圖。圖可以由 `src/__tests__/layer-dependencies.spec.ts` 已經算出的模組相依邊產生，避免再過時。
3. 改寫 §4.1：這個循環現在靠「計數放在 `RoleRepository`」解開，兩個模組之間沒有相依。
4. §3.1 補上 `SurfaceGuard`。13-trash、15-notification 的清單補齊，或改成引用常數（`TRASH_RESOURCE_TYPES`）與 §4 的表格，不在開頭重列。

## 驗證方式

- 文件 review：§4 的每一條邊都要對得上各 `*.module.ts` 的 `imports`。
- 若實作 CLI，補一個整合測試：CLI 產生的 token 能走 `POST /auth/reset-password` 完成重設，並查得到 `system.super_admin_reset_requested` 稽核。
