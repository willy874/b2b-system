# 受控的支援存取

- 優先度：P3
- 狀態：提案（**要先推翻既有決定**，見背景）
- 依賴：—
- 相關：[`05-tenancy.md`](../architecture/05-tenancy.md) §10.4（「平台管理者無法直接協助租戶內的問題」是刻意的代價）、[`04-sso.md`](../architecture/04-sso.md) §1.1（兩份身分）、
  [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)、[`rbac/06-approval.md`](../rbac/06-approval.md)（同意流程可能借用審批）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

身分分成租戶的 `users` 與平台的 `platform_admins`，同一個 email 是兩個帳號（[`04-sso.md`](../architecture/04-sso.md) §1.1）。
[`05-tenancy.md`](../architecture/05-tenancy.md) §10.4 把「平台管理者無法直接協助租戶內的問題」列為 **刻意的代價**：需要時由租戶管理者建立帳號給支援人員，並留下該租戶的稽核。

實務上這個做法的問題：

- 每次支援都要租戶管理者建立帳號、指派角色、事後記得刪除；忘了刪就留下一個長期有效的外部帳號。
- 支援人員拿到的權限通常給得過大（直接給 `admin`），沒有時限。
- 平台稽核看不到「哪個平台人員進過哪個租戶」，只散在各租戶的稽核裡。

這份提案是 **把同一件事做成有時限、有範圍、兩邊都有紀錄的流程**，不是讓平台管理者能直接進入租戶。進入規劃前要先決定是否推翻 §10.4 的方向。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 平台管理者對某個租戶提出支援存取申請：理由、期限（上限例如 24 小時）、要求的角色 | 不經租戶同意的存取（break-glass） |
| 租戶管理者核准後，系統建立一個臨時的租戶帳號（標記為支援帳號）並指派角色 | 以「某個使用者的身分」登入（impersonation） |
| 到期自動停用並刪除；租戶管理者可隨時撤銷 | |
| 支援帳號的每個操作照常寫租戶稽核，畫面上標示「平台支援」 | |
| 平台稽核記錄申請、核准、到期、撤銷 | |

## 使用者故事

**作為租戶管理者，我希望核准平台客服在 4 小時內以稽核人員的權限查看我們的設定，以便他們協助排查，時間到就自動失效。**

- **Given** 平台客服 S 對租戶 acme 申請 4 小時、`auditor` 角色的支援存取
- **When** acme 的 super-admin 核准
- **Then** S 在 apps/platform 看到「進入 acme（支援）」；進入後的帳號只有 `auditor`、頂端顯示支援橫幅；4 小時後帳號停用、session 撤銷，雙方都收到通知

## 初步構想

- 申請在平台 DB（`support_access_grants`：`tenant_id`、`platform_admin_id`、`role_slug`、`reason`、`expires_at`、`status`）；核准在租戶端（backstage 的審批類型 `support.access`）。
- 核准後在租戶 DB 建立 `kind = 'support'` 的使用者（不能登入密碼、只能經 apps/platform 的支援入口），指派角色時受反提權（核准者必須持有該角色的能力）。
- 到期：背景工作停用並刪除帳號、撤銷 session（與停用使用者相同的路徑）。
- 權限：平台 `supportAccess:request`；租戶核准沿用 `approval:review` ＋ handler 要求 `user:create`、`user:assignRole`。

## 開放問題

1. 是否推翻 [`05-tenancy.md`](../architecture/05-tenancy.md) §10.4 的方向？若不推翻，這份提案直接刪除，並把考量寫進該章節的「不做」。
2. 支援帳號能不能有寫入權限，還是一律唯讀？
3. 租戶可以整個關閉這個功能嗎（預設關閉？）
4. 支援帳號在使用者列表、計數（用量、授權人數）裡要不要排除？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/05-tenancy.md`（設計決策）、`docs/rbac/06-approval.md`（新的審批類型）
