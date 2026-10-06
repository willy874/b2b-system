# 已知問題（Known Issues）

這個資料夾放 **已經存在、但還沒修的問題**：程式與文件不一致、測試環境的脆弱點、遷移後留下的過渡程式碼。
一個問題一份文件。它和 [`../features/`](../features/README.md) 的差別：

| | `features/` | `issues/` |
| --- | --- | --- |
| 內容 | 還沒做的 **新功能** | 現有程式 **已經存在的問題** |
| 做完之後 | 提案刪除，改寫成正式文件歸檔 | 文件刪除；修正若改變了行為，同步更新對應的正式文件 |

> 和 `features/` 一樣，這裡的內容不是規格。正式文件（`architecture/`、`conventions/`）描述的是「應該怎樣」；
> 程式碼沒做到時，在這裡記一筆，而不是把正式文件改成配合錯誤的現況。

---

## 1. 清單

| 嚴重度 | 問題 | 文件 | 發現於 |
| --- | --- | --- | --- |
| 中 | 請求日誌的 query 仍記下 code／state／ticket 原文 | [`request-log-query-not-redacted.md`](./request-log-query-not-redacted.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | DB 錯誤把查詢參數寫進日誌與背景工作 output | [`db-error-log-leaks-params.md`](./db-error-log-leaks-params.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | SSRF 封鎖清單漏了內嵌 IPv4 的 IPv6 前綴 | [`ssrf-blocklist-misses-ipv6-embedded-ipv4.md`](./ssrf-blocklist-misses-ipv6-embedded-ipv4.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 登出的後端撤銷失敗被吞掉，IdP session 仍有效 | [`logout-failure-leaves-sessions.md`](./logout-failure-leaves-sessions.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 登出後批次佇列仍保留前一人的項目與上傳暫存 | [`batch-queue-survives-logout.md`](./batch-queue-survives-logout.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 釘選列把整筆伺服器資料存進 localStorage，登出不清 | [`pinned-rows-persist-server-data.md`](./pinned-rows-persist-server-data.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 沒有 CI，main 未保護，檢查只靠人 | [`no-ci-pipeline.md`](./no-ci-pipeline.md) | 2026-10-06（全面檢測：流程資安） |
| 中 | nginx 映像釘在停止更新的 1.27，基底映像未釘 digest | [`nginx-image-eol.md`](./nginx-image-eol.md) | 2026-10-06（全面檢測：部署） |
| 中 | XFF 信任鏈依賴前置 LB，每 IP 限流可能失效 | [`trust-proxy-depends-on-load-balancer.md`](./trust-proxy-depends-on-load-balancer.md) | 2026-10-06（全面檢測：部署） |
| 中 | prod compose 公開網址預設 localhost 且不檢查 | [`prod-compose-localhost-defaults.md`](./prod-compose-localhost-defaults.md) | 2026-10-06（全面檢測：部署） |
| 中 | 每筆租戶背景工作開始前都全表掃描 pgboss.job | [`job-active-ahead-full-scan.md`](./job-active-ahead-full-scan.md) | 2026-10-06（全面檢測：效能） |
| 中 | outbox 最舊 100 列都未註冊時 relayOutbox 無窮迴圈 | [`outbox-relay-infinite-loop.md`](./outbox-relay-infinite-loop.md) | 2026-10-06（全面檢測：效能） |
| 中 | 批次逐筆失效重抓且不處理 429，大批次可能用光限流額度 | [`batch-invalidation-and-rate-limit.md`](./batch-invalidation-and-rate-limit.md) | 2026-10-06（全面檢測：效能） |
| 中 | 批次進度計算為 O(n²)，大量上傳時每個快照都重算造成卡頓 | [`batch-progress-quadratic.md`](./batch-progress-quadratic.md) | 2026-10-06（全面檢測：效能） |
| 中 | api-sdk 無法 tree-shake，兩個前端首屏帶著全部 zod schema | [`api-sdk-not-tree-shakable.md`](./api-sdk-not-tree-shakable.md) | 2026-10-06（全面檢測：效能） |
| 中 | backstage 首屏帶進頁面專用程式，約多 50 KB gzip | [`backstage-entry-bundle-bloat.md`](./backstage-entry-bundle-bloat.md) | 2026-10-06（全面檢測：效能） |
| 中 | 租戶登記、設定、事件政策的快取可能寫回失效前的舊值 | [`caches-missing-invalidation-ticket.md`](./caches-missing-invalidation-ticket.md) | 2026-10-06（全面檢測：架構） |
| 中 | Service 層的四處權限拒絕不寫 authz.denied 稽核 | [`service-authz-denied-not-audited.md`](./service-authz-denied-not-audited.md) | 2026-10-06（全面檢測：架構） |
| 中 | @Audit() 沒有對應的 interceptor，標上去不會寫稽核 | [`audit-decorator-without-interceptor.md`](./audit-decorator-without-interceptor.md) | 2026-10-06（全面檢測：架構） |
| 中 | 放在 Field 裡的 Select 沒有連上欄位標籤與錯誤訊息 | [`select-not-linked-to-field-label.md`](./select-not-linked-to-field-label.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 登入頁等表單的送出錯誤沒有 role="alert"，報讀器不會念出 | [`form-errors-missing-alert-role.md`](./form-errors-missing-alert-role.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 帳號存的語系與時區沒被套用，偏好頁時區只有 4 個 | [`account-preferences-not-applied.md`](./account-preferences-not-applied.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 日期選擇器、TreeEditor、Spinner 的預設文案沒跟著語系 | [`ui-component-default-labels-not-localized.md`](./ui-component-default-labels-not-localized.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 警告色與成功色按鈕的白字對比不足，測試只要求 3:1 | [`button-color-contrast.md`](./button-color-contrast.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 平台 session 結束時被未儲存提醒擋下（改密碼必現） | [`platform-session-end-blocked-by-guard.md`](./platform-session-end-blocked-by-guard.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | safeReturnTo 遇到 ./.. 路徑段會回傳 //外站 | [`safe-return-to-dot-segments.md`](./safe-return-to-dot-segments.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | 頁面權限守衛分大小寫，/USER 等路徑繞過 403 頁 | [`route-guard-case-sensitivity.md`](./route-guard-case-sensitivity.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | 映像帶開發腳本與 CLI 依賴，.dockerignore 不全 | [`docker-image-and-context-hygiene.md`](./docker-image-and-context-hygiene.md) | 2026-10-06（全面檢測：部署） |
| 低 | 對外 API 容器繼承 api 全部秘密 | [`external-api-inherits-all-secrets.md`](./external-api-inherits-all-secrets.md) | 2026-10-06（全面檢測：部署） |
| 低 | production 只檢查部分秘密的強度 | [`weak-production-secret-checks.md`](./weak-production-secret-checks.md) | 2026-10-06（全面檢測：部署） |
| 低 | 開發 compose 的 postgres、Mailpit 綁所有介面 | [`dev-compose-binds-all-interfaces.md`](./dev-compose-binds-all-interfaces.md) | 2026-10-06（全面檢測：部署） |
| 低 | 沒有備份、還原程序與日誌輪替 | [`no-backup-or-log-rotation.md`](./no-backup-or-log-rotation.md) | 2026-10-06（全面檢測：部署） |
| 低 | 同一交易入列 N 筆工作，提交後跑 N 次 outbox 搬移 | [`outbox-relay-per-enqueue.md`](./outbox-relay-per-enqueue.md) | 2026-10-06（全面檢測：效能） |
| 低 | 站內通知每位收件人一個事件，逐一經 NOTIFY 轉送 | [`notification-event-per-recipient.md`](./notification-event-per-recipient.md) | 2026-10-06（全面檢測：效能） |
| 低 | user.activated 事件點每個人都解析整個公告受眾 | [`announcement-activation-resolves-audience.md`](./announcement-activation-resolves-audience.md) | 2026-10-06（全面檢測：效能） |
| 低 | 持有資料夾樹鎖的交易內另取連線查權限，池滿時卡到逾時 | [`permission-load-outside-tree-lock-tx.md`](./permission-load-outside-tree-lock-tx.md) | 2026-10-06（全面檢測：效能） |
| 低 | usePermission 每次回傳新物件，權限相關的 memo 全部失效 | [`use-permission-unstable-reference.md`](./use-permission-unstable-reference.md) | 2026-10-06（全面檢測：效能） |
| 低 | useTranslation 在任何語系包載入時都讓所有元件重繪 | [`use-translation-extra-rerenders.md`](./use-translation-extra-rerenders.md) | 2026-10-06（全面檢測：效能） |
| 低 | 平台列表 offset 無上限、驗證錯誤的 details 有兩種形狀 | [`api-validation-inconsistencies.md`](./api-validation-inconsistencies.md) | 2026-10-06（全面檢測：架構） |
| 低 | 英文介面：html lang 固定中文、沒有複數形、寫死全形標點 | [`i18n-english-polish.md`](./i18n-english-polish.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | 資料夾授權到期日與公告的「今天」用瀏覽器時區 | [`dates-use-browser-timezone.md`](./dates-use-browser-timezone.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | 頂列的即時連線狀態只靠顏色區分 | [`realtime-status-color-only.md`](./realtime-status-color-only.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | 設定與腳本殘留（未用變數、錯的 start 指令等） | [`config-and-script-leftovers.md`](./config-and-script-leftovers.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 架構文件過時；記載的 cli:reset-super-admin 不存在 | [`backend-architecture-docs-drift.md`](./backend-architecture-docs-drift.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 服務帳號樂觀鎖未命中時回舊版本／409，判斷複製七份 | [`optimistic-lock-miss-path-duplicated.md`](./optimistic-lock-miss-path-duplicated.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 後端殘留：租戶 locked 分支、工具複本、沒人用的匯出 | [`backend-dead-code-and-duplicates.md`](./backend-dead-code-and-duplicates.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 七個後端檔案超過 600 行，UserService 職責過多 | [`oversized-backend-services.md`](./oversized-backend-services.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | api 單元與整合測試共用設定，跑單元測試也要起 container | [`api-vitest-unit-integration-split.md`](./api-vitest-unit-integration-split.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 兩個前端仍有大量複製的程式，且已開始分岔 | [`duplicated-code-between-apps.md`](./duplicated-code-between-apps.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 前端架構文件與實作不符（分層強制、匯出約定、不存在的項目） | [`frontend-docs-drift.md`](./frontend-docs-drift.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 前端的死碼與過時的註解 | [`frontend-dead-code-and-stale-comments.md`](./frontend-dead-code-and-stale-comments.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 超過 400 行的元件與超過 200 行的 page.tsx | [`oversized-frontend-components.md`](./oversized-frontend-components.md) | 2026-10-06（全面檢測：可讀性） |

嚴重度：

| 嚴重度 | 意思 |
| --- | --- |
| 高 | 影響正確性或安全，要優先處理 |
| 中 | 行為與規格不一致，但目前不造成錯誤結果 |
| 低 | 開發體驗或程式整潔，可以穿插處理 |

---

## 2. 新增一筆

1. 新增 `<kebab-case>.md`，結構：**現況 → 影響 → 修正方式 → 驗證方式**。
   現況要寫到檔案與行號層級，讓處理的人不必重新調查。
2. 在上方 §1 的表格加一列（表格只剩「目前沒有已知問題」時取代它）。

## 3. 處理完之後

1. 刪除該問題的文件，以及 §1 表格的那一列。
2. 修正改變了行為或設定時，同步更新正式文件（例如 `architecture/`、`conventions/`）。
3. commit message 的內文提到問題的檔名，方便日後從 git 歷史找回脈絡。
