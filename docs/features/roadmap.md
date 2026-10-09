# 進度與路線

這份文件記錄 **做過什麼、做到哪裡、接下來做什麼**。

- 每項能力的現況與畫面看 [`../guide/introduction/01-overview.md`](../guide/introduction/01-overview.md) §3 與 [`../guide/introduction/03-feature-tour.md`](../guide/introduction/03-feature-tour.md)。
- **接下來要做的功能只有一份清單：[`features/README.md`](./README.md)**。這裡不重複列，避免兩邊不同步。
- 已知問題與技術債在 [`issues/README.md`](../issues/README.md)。

---

## 1. 現況（2026-10-08）

Phase 0（RBAC 骨架）完成後，又加上身分、租戶、資料保護、非同步與溝通四組通用機制。各能力已在 main 上，規格寫在 `docs/architecture/`（身分與權限在 `docs/architecture/iam/`）；
每份規格最後的「設計決策」章節記錄當時的取捨（原本的 `docs/adr/`，2026-10-02 併入）。

還沒做到的部分：

| 項目 | 狀態 |
| --- | --- |
| CI | `.github/workflows/ci.yml` 在 PR 與 push 到 `main` 時跑 typecheck、lint、format、migration 的相容檢查、`pnpm test`、依賴稽核、秘密掃描、bundle 預算、正式映像（[`coding-standards/05-git.md`](../coding-standards/05-git.md) §2.4）。還沒有的：E2E、`openapi.json` 與原始碼一致的檢查（[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §7.2） |
| 前端層級依賴 | 依賴矩陣（[`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md)）只有部分由 lint 與結構測試強制，其餘靠 review |
| 覆蓋率 | Phase 0 訂的目標（前端 75%、後端 80%，`core/permission`、`common/guards` 100%）沒有寫成測試設定的門檻；`test:cov` 只能手動跑，CI 不檢查 |
| 業務功能 | 沒有，這是骨架 |

---

## 2. 時間軸

以合併進 main 的日期為準；細節看各規格的「設計決策」章節與 git 歷史。

| 日期 | 加入的能力 | 規格 |
| --- | --- | --- |
| 09-20 | Phase 0 架構規格書；M0～M5：骨架、資料庫與 RBAC 核心、設計系統、認證、使用者與角色、稽核與個人帳號（§3） | [`iam/`](../architecture/iam/README.md) |
| 09-25 | 審批與註冊申請；深色主題；JsonEditor（CodeMirror 6）；RichTable | [`backend/20-approval.md`](../architecture/backend/20-approval.md)、[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) |
| 09-27 | 表格批次操作（前端逐筆佇列） | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13 |
| 09-29 | 檔案資料夾與授權、背景工作（pg-boss）、寄信；SSO（apps/api 當 OIDC Provider、外部 IdP、單一登出） | [`backend/09-file.md`](../architecture/backend/09-file.md)、[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)、[`04-sso.md`](../architecture/04-sso.md) |
| 09-29～30 | 共用表的工作區隔離被整個移除，改成每個租戶一個 database 與網域；平台管理者、租戶佈建 | [`05-tenancy.md`](../architecture/05-tenancy.md) §10 |
| 09-30 | 系統設定；前端 feature 執行期啟用；feature flag；TreeEditor；權限關係圖 G0～G3b；樂觀鎖、回收桶與版本歷史 | [`backend/12-settings.md`](../architecture/backend/12-settings.md)、[`iam/01-model.md`](../architecture/iam/01-model.md) §9、[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) |
| 10-01 | 站內通知；群組與反提權一般化（G4a）；有效權限的說明（G4b）；事件管理與個人通知設定；服務帳號、API token 與對外 API；可由平台關閉的 feature；依賴大升級（Nest 12、TS 6、Vitest 5） | [`backend/15-notification.md`](../architecture/backend/15-notification.md)、[`iam/07-groups.md`](../architecture/iam/07-groups.md)、[`06-external-api.md`](../architecture/06-external-api.md) |
| 10-02 | Webhook；標籤；公告與排程通知；feature 參數（配額）；ADR 併入各規格 | [`backend/17-webhook.md`](../architecture/backend/17-webhook.md)、[`backend/18-tag.md`](../architecture/backend/18-tag.md)、[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) |
| 10-03 | 平台後台改用 backstage 的外框與頁面，加上個人帳號頁、即時推播與站內通知 | [`apps/platform/README.md`](../../apps/platform/README.md) |
| 10-04 | `apps/auth` 改名 `apps/platform`；功能導覽與截圖劇本 | [`../guide/introduction/03-feature-tour.md`](../guide/introduction/03-feature-tour.md) |
| 10-07 | 命令面板（⌘K）、側欄改由 feature 登記的選單註冊表、全域快捷鍵 | [`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) |
| 10-07 | 前端可觀測性：apps/apm-service（模擬 Sentry API）、錯誤回報與 release、Web Vitals、bundle 預算 | [`frontend/19-observability.md`](../architecture/frontend/19-observability.md) |
| 10-07 | 監控：api 的 Prometheus 指標與 OpenTelemetry tracing、就緒檢查補上背景工作與 event loop；Grafana ＋ Prometheus ＋ Tempo 的部署、儀表板與告警，apm-service 的錯誤數與 issues 接進 Grafana | [`08-monitoring.md`](../architecture/08-monitoring.md) |
| 10-07 | 安全與容量的強化：access token 金鑰環、速率限制第二版、獨立的檔案網域、個人資料夾、稽核冷表按月分區與保留期限、HTTP 快取 | [`backend/04-auth.md`](../architecture/backend/04-auth.md) §11、§12、[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §10 |
| 10-07 | MFA：TOTP、Email 驗證碼、備用碼；登入的第二步、平台兩級開關、租戶政策；系統設定整併 | [`backend/21-mfa.md`](../architecture/backend/21-mfa.md)、[`backend/12-settings.md`](../architecture/backend/12-settings.md) |
| 10-08 | 匯入／匯出：資源登記的欄位定義、CSV／XLSX／SQL 匯出、worker thread 的分析與無狀態驗證、`DataGrid` 預覽、逐列交易的背景套用；第一批是使用者與稽核日誌 | [`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md)、[`frontend/21-data-transfer.md`](../architecture/frontend/21-data-transfer.md) |
| 10-08 | 匯入／匯出的強化：JSON／YAML 匯入匯出與範本、預覽的下拉選單（包成儲存格的 `Select`，可多選）與自動完成、手動指定或撤回比對目標、復原／重做快捷鍵、編輯中的複製貼上、可讀的套用確認框 | [`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md) §13 D32～D39、[`frontend/21-data-transfer.md`](../architecture/frontend/21-data-transfer.md) |
| 10-08 | 匯入／匯出擴充到角色、群組與群組成員、部門與部門成員、標籤（匯入＋匯出）與審批、服務帳號（只匯出）；同一份檔案內的引用（部門的上層） | [`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md) §12、§7.8 |
| 10-08 | 組織管理（部門樹、成員、主管）與多階段審批（依序多關、會簽、條件分流、override、我的審批與撤回）；兩者都可由平台關閉、預設啟用 | [`backend/20-approval.md`](../architecture/backend/20-approval.md) §9、[`backend/23-organization.md`](../architecture/backend/23-organization.md) |
| 10-08 | 租戶用量：每小時的快照（使用者、儲存與配額）、每個程序累計的請求與背景工作數、apps/platform 的清單欄位與排序、詳情的用量分頁、儲存配額越過 80% 的平台通知 | [`05-tenancy.md`](../architecture/05-tenancy.md) §5.4、§14 |
| 10-08 | 留言與關注：擁有者登記的資源類型、@提及、關注的通知（背景工作）、資源頁的面板註冊表；第一批接上使用者 | [`backend/24-comment.md`](../architecture/backend/24-comment.md)、[`frontend/22-comment.md`](../architecture/frontend/22-comment.md) |
| 10-08 | 富文本：`@b2b-system/rich-text`（格式定義、純文字、連結白名單、JSON ⇄ HTML）、Tiptap 編輯器與自製檢視器；第一個用在公告內文 | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.16 |
| 10-09 | 多實例部署與服務拆分：程序角色 `APP_ROLES`（http、realtime、worker，預設單體）與 `DEPLOYMENT_MODE`、平台 DB 的共享速率限制計數、跨裝置中繼跨節點、影像變體改成背景工作、排空與 readiness 503、compose 的多實例與 k8s 的參考部署（Kustomize）、migration 相容檢查 | [`01-system.md`](../architecture/01-system.md) §4.3、§7 |
| 10-09 | MFA 的新方式：WebAuthn（安全金鑰、通行金鑰；租戶的使用者經「重新登入並新增」）、簡訊（Twilio、自訂閘道、國碼白名單）、Telegram、LINE（綁定碼與 Bot 的 webhook）；方式的平台參數（加密存放、儲存時以金鑰呼叫供應商檢查、填齊之前不能開啟）；開發與測試用的模擬供應商 | [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5.1、§7.1、§9.3–§9.5、§15.4 M4 |
| 10-09 | 更多的登入方式：外部 IdP 加上 SAML 2.0（SP 發起、IdP metadata 匯入、SP metadata）與 OIDC 範本（Google Workspace、Microsoft Entra ID、Okta、Keycloak）；帳號的外部身分（檢視與解除）；以通行金鑰取代密碼（建在 MFA 的 WebAuthn 上，平台參數開啟）；開發與測試用的模擬 SAML IdP | [`04-sso.md`](../architecture/04-sso.md) §3.3、§3.6、§12.6 |
| 10-09 | 圖片的讀取與遞送（階段 1）：存參照不存網址、`ObjectUrlSigner`（presigned 實作，之後的 CDN 是另一個實作）、`ImageUrlService` 與 `ImageSources`（具名版本 × 主格式 ＋ WebP、密度與寬度描述）、共用的格式政策與裁切、`web-core/image` 的 `SignedImage`／`SignedAvatar`、`Avatar` 的圖片插槽；所有租戶合計的儲存止水線（平台每 5 分鐘彙總、超過時全部租戶停止新的上傳、apps/platform 的租戶清單顯示） | [`backend/25-image.md`](../architecture/backend/25-image.md) |
| 10-09 | 圖片資產與選圖（階段 2）：`modules/image`（用途與來源的登記、上傳與從其他來源複製、`image.process` 正規化與裁切後的變體、`image.maintenance` 清理、最近使用）、容量與檔案共用；`web-core/image-picker` 的 `ImageField`（來源依 feature、權限與內容取捨，只剩上傳時直接選檔；拖曳與貼上）、`ImageCropper`；第一個 consumer 是使用者頭像（個人資料、使用者詳情、頂列、使用者列表、留言） | [`backend/25-image.md`](../architecture/backend/25-image.md) §15、[`frontend/23-image-picker.md`](../architecture/frontend/23-image-picker.md) |
| 10-09 | 圖片庫（階段 3）：`modules/gallery`（直傳與從其他來源複製、`gallery.process` 讀 EXIF 與拍攝時間、不重新編碼地移除原檔的 GPS、主色與 BlurHash、依顯示方向的變體版本、`gallery.maintenance`）、相簿、標籤與留言、回收桶、可關閉的 feature 與單檔上限參數；`features/gallery`（等高排列與方格、依日期分組與日期捲軸、多選與批次、檢視器）；`@b2b-system/ui` 的 `JustifiedGrid`、`ImageViewer`；檔案管理器的「加入圖片庫」（`core/file` 的 `registerFileAction`）、選圖的「圖片庫」分頁與多選的 `MultiImageSourceDialog` | [`backend/26-gallery.md`](../architecture/backend/26-gallery.md)、[`frontend/24-gallery.md`](../architecture/frontend/24-gallery.md) |
| 10-08 | 功能導覽補上命令面板、MFA、組織、多階段審批、匯入／匯出、留言與關注、租戶用量，並重拍全部截圖（導覽劇本改用 `db:seed:dev` 的部門樹與 Webhook） | [`../guide/introduction/03-feature-tour.md`](../guide/introduction/03-feature-tour.md) |

### 2.1 推翻過的決定

決定被推翻時，原文保留、在同一列註明改成什麼（[`docs/README.md`](../README.md) §4）。五次明確的反轉：

| 反轉 | 內容 | 見 |
| --- | --- | --- |
| 後端批次端點 → 前端逐筆佇列 | 批次端點做完、用過之後全部移除，讓單筆端點成為業務規則的唯一來源 | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13 |
| 自製 JSON 樹狀編輯器 → CodeMirror 6 | 約 1,400 行的自製元件，在還沒有 feature 使用時換掉，因為那時換最便宜 | [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §11 |
| 瀏覽器產生縮圖 → 伺服器產生變體 | canvas 做不出 progressive JPEG | [`backend/09-file.md`](../architecture/backend/09-file.md) |
| 共用表的工作區隔離 → 每個租戶一個 database | 已完成的實作整個丟掉：漏一個 `WHERE` 就跨租戶外洩，schema-per-tenant 與 RLS 也都還是同一個資料庫裡的紀律 | [`05-tenancy.md`](../architecture/05-tenancy.md) §10 |
| WebAuthn 只當第二步 → 也能取代密碼 | MFA 第二版刻意不做無密碼登入（D20）；兩天後依使用者的要求，以方式的選用能力 `passwordless` 加上，資料表與註冊流程不變 | [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) D20、[`04-sso.md`](../architecture/04-sso.md) §12.6 |

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

Phase 0 刻意不做、後來補上的：SSO（09-29）、資源層級授權（檔案資料夾，09-29；之後由權限圖一般化，[`iam/01-model.md`](../architecture/iam/01-model.md) §9）、深色主題（09-25）、服務帳號與 API token（10-01）。
待製作的功能在 [`features/README.md`](README.md)。
