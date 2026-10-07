# 進度與路線

這份文件記錄 **做過什麼、做到哪裡、接下來做什麼**。

- 每項能力的現況與畫面看 [`01-overview.md`](./01-overview.md) §3 與 [`05-feature-tour.md`](./05-feature-tour.md)。
- **接下來要做的功能只有一份清單：[`features/README.md`](../features/README.md)**。這裡不重複列，避免兩邊不同步。
- 已知問題與技術債在 [`issues/README.md`](../issues/README.md)。

---

## 1. 現況（2026-10-04）

Phase 0（RBAC 骨架）完成後，又加上身分、租戶、資料保護、非同步與溝通四組通用機制。各能力已在 main 上，規格寫在 `docs/architecture/`、`docs/rbac/`；
每份規格最後的「設計決策」章節記錄當時的取捨（原本的 `docs/adr/`，2026-10-02 併入）。

還沒做到的部分：

| 項目 | 狀態 |
| --- | --- |
| CI | repo 沒有 CI；pre-commit（lefthook）只跑 oxfmt 與 oxlint，OpenAPI 的 diff 檢查尚未自動化 |
| 前端層級依賴 | 依賴矩陣（[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md)）只有部分由 lint 與結構測試強制，其餘靠 review |
| 覆蓋率 | Phase 0 訂的目標（前端 75%、後端 80%，`core/permission`、`common/guards` 100%）沒有寫成測試設定的門檻，也沒有 CI 檢查 |
| 業務功能 | 沒有，這是骨架 |

---

## 2. 時間軸

以合併進 main 的日期為準；細節看各規格的「設計決策」章節與 git 歷史。

| 日期 | 加入的能力 | 規格 |
| --- | --- | --- |
| 09-20 | Phase 0 架構規格書；M0～M5：骨架、資料庫與 RBAC 核心、設計系統、認證、使用者與角色、稽核與個人帳號（§3） | [`rbac/`](../rbac/01-domain-model.md) |
| 09-25 | 審批與註冊申請；深色主題；JsonEditor（CodeMirror 6）；RichTable | [`rbac/06-approval.md`](../rbac/06-approval.md)、[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) |
| 09-27 | 表格批次操作（前端逐筆佇列） | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13 |
| 09-29 | 檔案資料夾與授權、背景工作（pg-boss）、寄信；SSO（apps/api 當 OIDC Provider、外部 IdP、單一登出） | [`backend/09-file.md`](../architecture/backend/09-file.md)、[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)、[`04-sso.md`](../architecture/04-sso.md) |
| 09-29～30 | 共用表的工作區隔離被整個移除，改成每個租戶一個 database 與網域；平台管理者、租戶佈建 | [`05-tenancy.md`](../architecture/05-tenancy.md) §10 |
| 09-30 | 系統設定；前端 feature 執行期啟用；feature flag；TreeEditor；權限關係圖 G0～G3b；樂觀鎖、回收桶與版本歷史 | [`backend/12-settings.md`](../architecture/backend/12-settings.md)、[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9、[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) |
| 10-01 | 站內通知；群組與反提權一般化（G4a）；有效權限的說明（G4b）；事件管理與個人通知設定；服務帳號、API token 與對外 API；可由平台關閉的 feature；依賴大升級（Nest 12、TS 6、Vitest 5） | [`backend/15-notification.md`](../architecture/backend/15-notification.md)、[`rbac/08-groups.md`](../rbac/08-groups.md)、[`06-external-api.md`](../architecture/06-external-api.md) |
| 10-02 | Webhook；標籤；公告與排程通知；feature 參數（配額）；ADR 併入各規格 | [`backend/17-webhook.md`](../architecture/backend/17-webhook.md)、[`backend/18-tag.md`](../architecture/backend/18-tag.md)、[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) |
| 10-03 | 平台後台改用 backstage 的外框與頁面，加上個人帳號頁、即時推播與站內通知 | [`apps/platform/README.md`](../../apps/platform/README.md) |
| 10-04 | `apps/auth` 改名 `apps/platform`；功能導覽與截圖劇本 | [`05-feature-tour.md`](./05-feature-tour.md) |
| 10-07 | 命令面板（⌘K）、側欄改由 feature 登記的選單註冊表、全域快捷鍵 | [`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) |
| 10-07 | 前端可觀測性：apps/apm-service（模擬 Sentry API）、錯誤回報與 release、Web Vitals、bundle 預算 | [`frontend/19-observability.md`](../architecture/frontend/19-observability.md) |
| 10-07 | 監控：api 的 Prometheus 指標與 OpenTelemetry tracing、就緒檢查補上背景工作與 event loop；Grafana ＋ Prometheus ＋ Tempo 的部署、儀表板與告警，apm-service 的錯誤數與 issues 接進 Grafana | [`08-monitoring.md`](../architecture/08-monitoring.md) |

### 2.1 推翻過的決定

決定被推翻時，原文保留、在同一列註明改成什麼（[`docs/README.md`](../README.md) §4）。四次明確的反轉：

| 反轉 | 內容 | 見 |
| --- | --- | --- |
| 後端批次端點 → 前端逐筆佇列 | 批次端點做完、用過之後全部移除，讓單筆端點成為業務規則的唯一來源 | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13 |
| 自製 JSON 樹狀編輯器 → CodeMirror 6 | 約 1,400 行的自製元件，在還沒有 feature 使用時換掉，因為那時換最便宜 | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §11 |
| 瀏覽器產生縮圖 → 伺服器產生變體 | canvas 做不出 progressive JPEG | [`backend/09-file.md`](../architecture/backend/09-file.md) |
| 共用表的工作區隔離 → 每個租戶一個 database | 已完成的實作整個丟掉：漏一個 `WHERE` 就跨租戶外洩，schema-per-tenant 與 RLS 也都還是同一個資料庫裡的紀律 | [`05-tenancy.md`](../architecture/05-tenancy.md) §10 |

---

## 3. Phase 0：RBAC 骨架（已完成）

Phase 0 的目標是「先把誰能做什麼一次做對」，分六個里程碑，每個都有驗收條件，未通過不進下一個。全部完成於 2026-09-20 前後；
以下保留驗收的重點，作為之後改動時的回歸基準。完整的清單已由對應的測試與規格取代。

| 里程碑 | 內容 | 驗收的重點（現在由誰守住） |
| --- | --- | --- |
| M0 | 專案骨架與工具鏈 | `pnpm dev` 起得來；lint、format、typecheck 通過；pre-commit 擋未格式化的檔案（lefthook） |
| M1 | 資料庫與 RBAC 核心 | seed 冪等；稽核的 trigger 擋 UPDATE／DELETE；沒宣告授權方式的路由讓程序啟動失敗（`common/route-audit.ts`）；權限快取的失效順序（整合測試） |
| M2 | 設計系統 | 每個元件有鍵盤與 disabled 的測試、Storybook story；不寫死色碼、不外洩 Base UI 型別（`design-system.test.ts`）；兩個主題的對比（`contrast.test.ts`） |
| M3 | 認證 | access token 只在記憶體；跨分頁續期不互踢；重放舊 refresh token 撤銷整條 family；錯誤 5 次鎖定；忘記密碼不洩漏帳號是否存在（E2E `auth.spec.ts`） |
| M4 | 使用者與角色 | 建角色 → 指派 → 看到選單；移除權限後下一次請求即 403；auditor 打開 `/user/create` 看到 403；反提權；系統角色保護；最後一位 super-admin（E2E `rbac-lifecycle.spec.ts`、`route-guard.spec.ts`） |
| M5 | 稽核日誌、個人帳號、收尾 | `core/` 不 import `features/`、`modules/`（結構測試）；註解掉任一 feature plugin 仍能啟動；每個錯誤碼與權限鍵都有兩個語系的翻譯（語系測試） |

Phase 0 刻意不做、後來補上的：SSO（09-29）、資源層級授權（檔案資料夾，09-29；之後由權限圖一般化，[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9）、深色主題（09-25）、服務帳號與 API token（10-01）。
仍未做的（MFA、匯入匯出、多實例部署等）在 [`features/README.md`](../features/README.md)。
