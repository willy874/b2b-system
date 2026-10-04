# 待製作功能（Feature Backlog）

這個資料夾放 **還沒做的功能提案**，一個功能一份文件。
它是暫存區，不是規格：功能做完之後，提案文件要 **刪掉**，內容改寫成正式的設計文件，
歸檔到 `docs/` 的對應分區（見 §4）。

> 為什麼要分開：`architecture/`、`rbac/` 描述的是 **系統現在長什麼樣子**，
> 必須與程式碼同步（[`../README.md`](../README.md) §5）。尚未實作的構想若寫進去，
> 讀者就分不出哪些是事實、哪些是願望。

---

## 1. 待製作清單

依優先度排序。**P0** 會影響之後所有功能的資料模型，要先決定；**P1** 是現有流程已經卡住的缺口；
**P2** 是通用機制，做了之後每個功能都受惠；**P3** 視實際需求再做。

| 優先度 | 功能 | 文件 | 狀態 | 依賴 |
| --- | --- | --- | --- | --- |
| P2 | 匯入／匯出框架 | [`import-export.md`](./import-export.md) | 提案 | [站內通知](../architecture/backend/15-notification.md)（已完成）、[背景工作](../architecture/backend/10-jobs.md)（已完成） |
| P2 | 留言、關注 | [`comments-watches.md`](./comments-watches.md) | 提案 | [站內通知](../architecture/backend/15-notification.md)（已完成）、[標籤](../architecture/backend/18-tag.md)（已完成，同一種登記方式） |
| P2 | 全域搜尋 | [`global-search.md`](./global-search.md) | 提案 | — |
| P2 | 安全與容量的後續強化 | [`hardening-followups.md`](./hardening-followups.md) | 提案 | — |
| P3 | 權限圖（ReBAC）：專案（G5） | [`permission-graph.md`](./permission-graph.md) | 提案（G0～G4b 已上 main 並歸檔；G5 等專案功能） | 專案功能 |
| P3 | MFA | [`mfa.md`](./mfa.md) | 提案 | — |
| P3 | 可觀測性 | [`observability.md`](./observability.md) | 提案 | — |
| P3 | 多實例部署 | [`multi-instance.md`](./multi-instance.md) | 提案 | — |

狀態只有三種：

| 狀態 | 意思 |
| --- | --- |
| 提案 | 只有構想與開放問題，還沒決定要不要做、怎麼做 |
| 規劃中 | 開放問題已有答案，範圍已定；可以開始寫設計決策與實作 |
| 實作中 | 有 branch 在做；文件中寫上 branch 名稱 |

做完的功能 **不留在這張表**：文件刪除時一併刪掉這一列（§3）。

### 1.1 建議的順序

已完成並歸檔（細節見各正式文件與它最後的「設計決策」章節）：

- `announcements`（通知總覽、公告的立即／指定時間／週期／事件點發送、撤回）：[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §9、[`frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)
- `tags`（標籤；原提案「標籤、留言、關注」的標籤部分）：[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7
- `webhooks`（對外事件、訂閱、投遞與重試、簽章、SSRF 綁定位址）：[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §9
- `api-tokens`（服務帳號、API token、對外 API 服務）：[`architecture/06-external-api.md`](../architecture/06-external-api.md) §9、[`backend/04-auth.md`](../architecture/backend/04-auth.md) §8.2
- `permission-graph` G4b（說明：有效權限的來源、資料夾存取的路徑）：[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9.3 D14、[`rbac/09-explain.md`](../rbac/09-explain.md)
- `permission-graph` G4a（群組、反提權一般化）：[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9.3 D10～D16、[`rbac/08-groups.md`](../rbac/08-groups.md)、
  [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1
- `permission-graph` G0～G3b：[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9、[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4、[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.2、§5
- `entity-revisions`：[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9、[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11、[`backend/13-trash.md`](../architecture/backend/13-trash.md)
- `notification-center`：[`backend/15-notification.md`](../architecture/backend/15-notification.md) §12、[`frontend/15-notification.md`](../architecture/frontend/15-notification.md)；
  其他功能要「通知某人」時，照後端 §9 加一種通知類型

接下來：

1. `import-export`（大量匯入使用者、匯出稽核日誌），或資源的協作（`comments-watches`；照標籤的登記方式做）。
2. `permission-graph` G5（專案）等專案功能的提案一起做。
3. `hardening-followups` 裡的小項目可以隨時穿插。

### 1.2 撰寫提案時的架構前提

提案的「初步構想」要符合現在的架構；以下是最常被寫錯的地方：

| 前提 | 出處 |
| --- | --- |
| 業務資料在 **租戶 DB**（每個租戶一個 database）；平台 DB 只有租戶登記、平台管理者、佇列、OIDC 狀態。新表先決定放哪一邊 | [`05-tenancy.md`](../architecture/05-tenancy.md) §1 |
| 身分分兩份：租戶的 `users`（backstage）與 `platform_admins`（apps/platform），同一個 email 是兩個帳號 | [`04-sso.md`](../architecture/04-sso.md) §1.1 |
| 登入在 apps/platform 的 OIDC 登入互動裡，backstage 沒有登入頁；access token 帶 `tid` 或 `realm: 'platform'` | [`04-sso.md`](../architecture/04-sso.md) §3 |
| `DomainEventBus` 是程序內、fire-and-forget，**不保證送達**；要可靠就在交易內 `JobQueue.enqueue(..., { tx })`（走 `job_outbox`） | [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7、[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1 |
| 通用模組不 import 業務模組：業務模組在 `onModuleInit` 把 handler 註冊進去（審批、背景工作、系統設定） | [`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §3.2 |
| 前端 feature 之間不共用元件；共用 UI 放 `components/`、`core/`，或經註冊表注入。註冊在 plugin 同步階段，那時還沒有使用者資料 | [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §3.1、§6 |
| 軟刪除（`deleted_at` ＋ partial unique index）已是慣例；多型關聯用 `resource_type ＋ resource_id` | [`backend/02-database.md`](../architecture/backend/02-database.md) §1、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) |
| 系統設定是租戶層、只存純量覆寫值 | [`backend/12-settings.md`](../architecture/backend/12-settings.md) |
| 可編輯的實體要有 `version` 欄，更新必須帶 `version`（樂觀鎖，衝突 409） | [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 |
| 軟刪除的查詢一律用 `notDeleted()`；要能還原的資源在 `onModuleInit` 註冊 `TrashHandler` 並提供 `POST /<resource>/:id/restore` | [`backend/13-trash.md`](../architecture/backend/13-trash.md) §1、§2 |
| 要版本歷史的實體由擁有者模組在業務交易內呼叫 `RevisionService.record` | [`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §6 |
| 「通知某人」由擁有者模組在業務交易內呼叫 `NotificationService.notify`，不訂閱 `DomainEventBus` | [`backend/15-notification.md`](../architecture/backend/15-notification.md) §9 |

---

## 2. 新增一份提案

1. 複製 [`_template.md`](./_template.md)，檔名用 kebab-case 的功能名稱（`api-tokens.md`），
   **不加編號**。優先度會變，編號不會跟著變。
2. 填好「背景」「範圍」「開放問題」。「初步構想」可以留白，但如果已經有想法，
   要寫清楚它 **會動到哪些既有模組**。
3. 在 §1 的表格加一列，狀態寫「提案」。
4. 提案之間有依賴時，兩邊都要寫：被依賴的文件在「相關」欄列出依賴它的功能。

提案可以直接 commit 到 `main`（`docs: 新增 <功能> 提案`），不需要等實作。

---

## 3. 從提案到歸檔

```
提案 ──回答開放問題──▶ 規劃中 ──開 branch──▶ 實作中 ──合併──▶ 歸檔（刪除提案）
```

### 3.1 進入「規劃中」

- 「開放問題」每一條都要有結論。結論寫在該條下方，不要直接刪掉問題，review 時才看得到當初的考量。
- 如果結論是「有多個方案、選了其中一個」，那就是設計決策：把背景、決定（`D1`、`D2`…）、評估過的方案寫在提案文件的
  「設計決策」一節，review 時看這裡。歸檔時整節搬進正式規格（§3.3）。

### 3.2 實作中

- 開 branch（`feat/<功能>`），在提案文件的標頭填上 branch 名稱，§1 表格的狀態改成「實作中」。
- 照 [`../../CLAUDE.md`](../../CLAUDE.md)「新增一個功能的順序」實作。
- 實作過程中發現提案寫錯，**直接改程式碼、不必回頭改提案**；提案在下一步會被刪掉，
  該記錄的東西寫進正式文件。

### 3.3 歸檔（功能合併時，同一個 PR 內完成）

提案文件不是設計文件，不能直接搬過去。歸檔 = **依實作結果重寫**：

1. **寫正式文件**，依 §4 放到對應分區。內容描述的是 **做出來的樣子**，
   不是提案時的構想。
2. **設計決策** 搬進主要那份規格的最後一章「`## N. 設計決策：<主題>`」（格式見 [`../README.md`](../README.md) §4）：
   提案中被否決的方案、實作時改掉的做法，寫進該章的「評估過的方案」「實作紀錄」；`D` 編號不重排，程式碼註解以 `<文件> §N.x Dn` 引用。
3. **更新索引**：[`../README.md`](../README.md) §3 文件地圖、對應分區的 `README.md`（如 `architecture/backend/README.md`）。
4. **連帶更新**：權限目錄、[`../overview/01-overview.md`](../overview/01-overview.md) 的範圍表、
   [`../overview/03-roadmap.md`](../overview/03-roadmap.md)、[`../../CLAUDE.md`](../../CLAUDE.md)（指令、與文件不同的實作決定）。
5. **刪除提案文件**，並刪掉 §1 表格中的那一列。
6. 若其他提案依賴它，把對方「依賴」欄的連結改成指向正式文件。

檢查：`grep -rn "features/<功能>.md" docs CLAUDE.md` 應為空（沒有殘留連結）。

### 3.4 決定不做

直接刪除提案文件與表格那一列。若「不做」的理由值得留下（例如評估過後認為架構不適合），
寫進最相關的那份規格的「設計決策」章節（標明「不做」與理由）。

---

## 4. 歸檔去向

| 提案的內容 | 歸檔到 |
| --- | --- |
| 為什麼選 A 不選 B | 主要那份規格最後的「設計決策」章節 |
| 後端模組、資料表、API | `docs/architecture/backend/NN-<主題>.md` |
| 前端 feature、元件、狀態 | `docs/architecture/frontend/NN-<主題>.md` |
| 橫跨前後端或部署的系統設計 | `docs/architecture/NN-<主題>.md` |
| 權限、授權、身分的領域規則 | `docs/rbac/NN-<主題>.md` ＋ `02-permission-catalog.md` |
| 寫程式的新規則 | `docs/conventions/` |
| 範圍、里程碑 | `docs/overview/01-overview.md`、`03-roadmap.md` |

一份提案通常會拆成 **一到兩份規格**，設計決策放在其中主要的那份，例如檔案管理器的資料夾授權就是
[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)（決策在 §13）＋ [`backend/09-file.md`](../architecture/backend/09-file.md) §11。
