# 待製作功能（Feature Backlog）

這個資料夾放 **還沒做的功能提案**，一個功能一份文件。
它是暫存區，不是規格：功能做完之後，提案文件要 **刪掉**，內容改寫成正式的設計文件，
歸檔到 `docs/` 的對應分區（見 §4）。

> 為什麼要分開：`architecture/` 描述的是 **系統現在長什麼樣子**，
> 必須與程式碼同步（[`../README.md`](../README.md) §5）。尚未實作的構想若寫進去，
> 讀者就分不出哪些是事實、哪些是願望。

---

## 1. 待製作清單

依優先度排序。**P0** 會影響之後所有功能的資料模型，要先決定；**P1** 是現有流程已經卡住的缺口；
**P2** 是通用機制，做了之後每個功能都受惠；**P3** 視實際需求再做。

| 優先度 | 功能 | 文件 | 狀態 | 依賴 |
| --- | --- | --- | --- | --- |
| P2 | 留言、關注 | [`comments-watches.md`](./comments-watches.md) | 提案 | [站內通知](../architecture/backend/15-notification.md)（已完成）、[標籤](../architecture/backend/18-tag.md)（已完成，同一種登記方式） |
| P2 | 組織管理（部門樹、成員、主管；平台可關閉） | [`organization.md`](./organization.md) | 規劃中 | — |
| P2 | 多階段審批鏈（依序多關、會簽、條件分流；平台可關閉） | [`approval-chains.md`](./approval-chains.md) | 規劃中 | [審批](../architecture/backend/20-approval.md)（已完成）、[`organization.md`](./organization.md)（軟依賴：審核者「主管」） |
| P2 | 租戶用量總覽 | [`tenant-usage.md`](./tenant-usage.md) | 提案 | — |
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

- `import-export`（匯入／匯出框架：資源登記、CSV／XLSX／SQL 匯出、後端分析＋前端預覽的匯入、逐列交易的套用；第一批是使用者與稽核日誌）：[`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md) §12、[`frontend/21-data-transfer.md`](../architecture/frontend/21-data-transfer.md)
- `mfa`（可擴充的驗證方式：TOTP、Email 驗證碼、備用碼；登入互動的第二步、平台兩級開關、租戶政策）：[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §15
- `observability`（後端的指標與 tracing、就緒檢查、Grafana ＋ Prometheus ＋ Tempo 的部署與告警，apm-service 接進 Grafana）：[`architecture/08-monitoring.md`](../architecture/08-monitoring.md) §9
- `hardening-followups`（安全與容量的後續強化）：access token 金鑰環 [`backend/04-auth.md`](../architecture/backend/04-auth.md) §11、
  速率限制第二版與 argon2 上限 §12、獨立的檔案網域 [`backend/09-file.md`](../architecture/backend/09-file.md) §13、個人資料夾 [`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md) §12.1、
  稽核冷表分區與保留期限 [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §10、HTTP 快取 [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §13、
  選取全部符合 [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.7、表單草稿 [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.4、
  檔案列表的 `maxPages` [`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §5；連線池與 PgBouncer 的觸發條件在 [`backend/02-database.md`](../architecture/backend/02-database.md) §6.2
- `frontend-observability`（apps/apm-service 模擬 Sentry API、錯誤回報與 release、Web Vitals、bundle 預算）：[`frontend/19-observability.md`](../architecture/frontend/19-observability.md) §9、[`07-apm-service.md`](../architecture/07-apm-service.md)
- `global-search`（命令面板 ⌘K、選單註冊表、全域快捷鍵）：[`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) §7
- `announcements`（通知總覽、公告的立即／指定時間／週期／事件點發送、撤回）：[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §9、[`frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)
- `tags`（標籤；原提案「標籤、留言、關注」的標籤部分）：[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7
- `webhooks`（對外事件、訂閱、投遞與重試、簽章、SSRF 綁定位址）：[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §9
- `api-tokens`（服務帳號、API token、對外 API 服務）：[`architecture/06-external-api.md`](../architecture/06-external-api.md) §9、[`backend/04-auth.md`](../architecture/backend/04-auth.md) §8.2
- `permission-graph` G4b（說明：有效權限的來源、資料夾存取的路徑）：[`iam/01-model.md`](../architecture/iam/01-model.md) §9.3 D14、[`iam/08-explain.md`](../architecture/iam/08-explain.md)
- `permission-graph` G4a（群組、反提權一般化）：[`iam/01-model.md`](../architecture/iam/01-model.md) §9.3 D10～D16、[`iam/07-groups.md`](../architecture/iam/07-groups.md)、
  [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1
- `permission-graph` G0～G3b：[`iam/01-model.md`](../architecture/iam/01-model.md) §9、[`iam/01-model.md`](../architecture/iam/01-model.md) §6.4、[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.2、§5
- `entity-revisions`：[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9、[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11、[`backend/13-trash.md`](../architecture/backend/13-trash.md)
- `notification-center`：[`backend/15-notification.md`](../architecture/backend/15-notification.md) §12、[`frontend/15-notification.md`](../architecture/frontend/15-notification.md)；
  其他功能要「通知某人」時，照後端 §9 加一種通知類型

接下來：

1. 資源的協作（`comments-watches`；照標籤的登記方式做）。
2. `organization` ＋ `approval-chains`（組織管理與多階段審批鏈）：兩者以審核者規則的登記解耦，依 [`approval-chains.md`](./approval-chains.md) §18 的切分並行做（O1 ∥ C1 → C2 → O2 ∥ C3 → C4）；`tenant-usage`（租戶用量總覽）與它們互不依賴。

### 1.2 撰寫提案時的架構前提

提案的「初步構想」要符合現在的架構；以下是最常被寫錯的地方：

| 前提 | 出處 |
| --- | --- |
| 業務資料在 **租戶 DB**（每個租戶一個 database）；平台 DB 只有租戶登記、平台管理者、佇列、OIDC 狀態。新表先決定放哪一邊 | [`05-tenancy.md`](../architecture/05-tenancy.md) §1 |
| 身分分兩份：租戶的 `users`（backstage）與 `platform_admins`（apps/platform），同一個 email 是兩個帳號 | [`04-sso.md`](../architecture/04-sso.md) §1.1 |
| 登入在 apps/platform 的 OIDC 登入互動裡，backstage 沒有登入頁；access token 帶 `tid` 或 `realm: 'platform'` | [`04-sso.md`](../architecture/04-sso.md) §3 |
| `DomainEventBus` 是程序內、fire-and-forget，**不保證送達**；要可靠就在交易內 `JobQueue.enqueue(..., { tx })`（走 `job_outbox`） | [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7、[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1 |
| 通用模組不 import 業務模組：業務模組在 `onModuleInit` 把 handler 註冊進去（審批、背景工作、系統設定） | [`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §3.2 |
| 前端 feature 之間不共用元件；共用 UI 放 `@b2b-system/ui`、`core/`，或經註冊表注入。註冊在 plugin 同步階段，那時還沒有使用者資料 | [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §3.1、§6 |
| 軟刪除（`deleted_at` ＋ partial unique index）已是慣例；多型關聯用 `resource_type ＋ resource_id` | [`backend/02-database.md`](../architecture/backend/02-database.md) §1、[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md) |
| 系統設定是租戶層、只存純量覆寫值 | [`backend/12-settings.md`](../architecture/backend/12-settings.md) |
| 可編輯的實體要有 `version` 欄，更新必須帶 `version`（樂觀鎖，衝突 409） | [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 |
| 軟刪除的查詢一律用 `notDeleted()`；要能還原的資源在 `onModuleInit` 註冊 `TrashHandler` 並提供 `POST /<resource>/:id/restore` | [`backend/13-trash.md`](../architecture/backend/13-trash.md) §1、§2 |
| 要版本歷史的實體由擁有者模組在業務交易內呼叫 `RevisionService.record` | [`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §6 |
| 「通知某人」由擁有者模組在業務交易內呼叫 `NotificationService.notify`，不訂閱 `DomainEventBus` | [`backend/15-notification.md`](../architecture/backend/15-notification.md) §9 |
| 要觀測的量（新的佇列、外部呼叫、快取、並行上限）在 `core/metrics/instruments.ts` 加指標；標籤不帶租戶，依租戶看用 trace 的 `b2b.tenant` | [`08-monitoring.md`](../architecture/08-monitoring.md) §2.3、§2.4 |

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
| 權限、授權、身分的規則 | `docs/architecture/iam/NN-<主題>.md` ＋ `iam/02-permission-catalog.md` |
| 寫程式的新規則 | `docs/coding-standards/` |
| 範圍、里程碑 | `docs/overview/01-overview.md`、`03-roadmap.md` |

一份提案通常會拆成 **一到兩份規格**，設計決策放在其中主要的那份，例如檔案管理器的資料夾授權就是
[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md)（決策在 §13）＋ [`backend/09-file.md`](../architecture/backend/09-file.md) §11。
