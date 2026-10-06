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
| 高 | 外部 IdP 自動連結漏看經由群組持有的 admin／auditor | [`external-idp-autolink-ignores-group-roles.md`](./external-idp-autolink-ignores-group-roles.md) | 2026-10-06（全面檢測：程式資安） |
| 高 | 平台端點的網域限制可用大小寫不同的路徑繞過 | [`platform-path-case-insensitive-bypass.md`](./platform-path-case-insensitive-bypass.md) | 2026-10-06（全面檢測：程式資安） |
| 高 | 外部 IdP 登入的 state／ticket 沒綁定瀏覽器，可被接管成別人的 session | [`external-idp-state-not-bound-to-browser.md`](./external-idp-state-not-bound-to-browser.md) | 2026-10-06（全面檢測：流程資安） |
| 高 | 鎖定期間登入仍洩漏密碼對錯，且密碼正確但不可登入時不寫稽核 | [`login-lockout-reveals-correct-password.md`](./login-lockout-reveals-correct-password.md) | 2026-10-06（全面檢測：流程資安） |
| 高 | 平台管理者改密碼、重設或停用後，IdP session 不會結束 | [`platform-admin-idp-session-survives-credential-change.md`](./platform-admin-idp-session-survives-credential-change.md) | 2026-10-06（全面檢測：流程資安） |
| 高 | db:seed:e2e 在防呆前建立已知密碼的平台管理者 | [`e2e-seed-creates-platform-admin-before-guard.md`](./e2e-seed-creates-platform-admin-before-guard.md) | 2026-10-06（全面檢測：流程資安） |
| 高 | prod compose 缺 WEBHOOK_SECRET_KEY 無法啟動 | [`prod-compose-missing-webhook-secret-key.md`](./prod-compose-missing-webhook-secret-key.md) | 2026-10-06（全面檢測：部署） |
| 高 | 一個租戶 migrate 失敗就讓 api 無法啟動 | [`tenant-migrate-failure-blocks-startup.md`](./tenant-migrate-failure-blocks-startup.md) | 2026-10-06（全面檢測：部署） |
| 高 | 刪除預設租戶後每次部署 migrate 都失敗 | [`deleted-default-tenant-reregistered.md`](./deleted-default-tenant-reregistered.md) | 2026-10-06（全面檢測：部署） |
| 高 | 編輯中的草稿以即時資料為基準，會蓋掉別人同時做的變更 | [`edit-drafts-use-live-baseline.md`](./edit-drafts-use-live-baseline.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 還原使用者時反提權漏看他的群組成員資格 | [`user-restore-revives-group-roles.md`](./user-restore-revives-group-roles.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 恢復資料夾繼承沒有反提權，可流入高於自己能授予的等級 | [`folder-inheritance-restore-escalation.md`](./folder-inheritance-restore-escalation.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | /auth/sso/callback 可被跨站表單送出（登入 CSRF） | [`sso-callback-login-csrf.md`](./sso-callback-login-csrf.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 請求日誌的 query 仍記下 code／state／ticket 原文 | [`request-log-query-not-redacted.md`](./request-log-query-not-redacted.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | DB 錯誤把查詢參數寫進日誌與背景工作 output | [`db-error-log-leaks-params.md`](./db-error-log-leaks-params.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | SSRF 封鎖清單漏了內嵌 IPv4 的 IPv6 前綴 | [`ssrf-blocklist-misses-ipv6-embedded-ipv4.md`](./ssrf-blocklist-misses-ipv6-embedded-ipv4.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 登出的後端撤銷失敗被吞掉，IdP session 仍有效 | [`logout-failure-leaves-sessions.md`](./logout-failure-leaves-sessions.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 登出後批次佇列仍保留前一人的項目與上傳暫存 | [`batch-queue-survives-logout.md`](./batch-queue-survives-logout.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | 釘選列把整筆伺服器資料存進 localStorage，登出不清 | [`pinned-rows-persist-server-data.md`](./pinned-rows-persist-server-data.md) | 2026-10-06（全面檢測：程式資安） |
| 中 | pending 帳號能直接改成 active，略過 email 驗證 | [`user-pending-to-active-via-patch.md`](./user-pending-to-active-via-patch.md) | 2026-10-06（全面檢測：流程資安） |
| 中 | 平台管理者被登入鎖定時改寫 status，任何人可踢人下線 | [`platform-admin-lockout-revokes-sessions.md`](./platform-admin-lockout-revokes-sessions.md) | 2026-10-06（全面檢測：流程資安） |
| 中 | 密碼步驟已完成的互動，改密碼後仍可 resume 換到有效 session | [`interaction-resume-after-password-change.md`](./interaction-resume-after-password-change.md) | 2026-10-06（全面檢測：流程資安） |
| 中 | 平台「最後一位 super-admin」檢查在交易外，可被並行繞過 | [`platform-last-super-admin-race.md`](./platform-last-super-admin-race.md) | 2026-10-06（全面檢測：流程資安） |
| 中 | 平台管理者帳號流程沒有交易：稽核在提交後寫、token 可重複使用 | [`platform-account-flows-not-transactional.md`](./platform-account-flows-not-transactional.md) | 2026-10-06（全面檢測：流程資安） |
| 中 | 初始平台管理者密碼明文寫進部署日誌 | [`platform-admin-bootstrap-password-logged.md`](./platform-admin-bootstrap-password-logged.md) | 2026-10-06（全面檢測：流程資安） |
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
| 中 | 角色的自我鎖定、使用中與推播只看直接持有者 | [`role-checks-ignore-group-holders.md`](./role-checks-ignore-group-holders.md) | 2026-10-06（全面檢測：架構） |
| 中 | 租戶登記、設定、事件政策的快取可能寫回失效前的舊值 | [`caches-missing-invalidation-ticket.md`](./caches-missing-invalidation-ticket.md) | 2026-10-06（全面檢測：架構） |
| 中 | 推播超過 100 筆變更時前端整則丟棄（還原角色） | [`realtime-changes-exceed-event-limit.md`](./realtime-changes-exceed-event-limit.md) | 2026-10-06（全面檢測：架構） |
| 中 | Service 層的四處權限拒絕不寫 authz.denied 稽核 | [`service-authz-denied-not-audited.md`](./service-authz-denied-not-audited.md) | 2026-10-06（全面檢測：架構） |
| 中 | @Audit() 沒有對應的 interceptor，標上去不會寫稽核 | [`audit-decorator-without-interceptor.md`](./audit-decorator-without-interceptor.md) | 2026-10-06（全面檢測：架構） |
| 中 | 建立 Webhook、建立與編輯公告時，取消或 Esc 不會觸發未儲存提醒 | [`route-dialogs-bypass-unsaved-guard.md`](./route-dialogs-bypass-unsaved-guard.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 查詢失敗時多個頁面顯示成「沒有資料」、空白或一直轉圈 | [`query-errors-shown-as-empty.md`](./query-errors-shown-as-empty.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 一次性的 token／Webhook 密鑰可被 Esc 或點遮罩關掉 | [`one-time-secrets-dismissible.md`](./one-time-secrets-dismissible.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 非路由的表單對話框與頁內草稿沒有未儲存提醒 | [`stateful-dialogs-no-unsaved-guard.md`](./stateful-dialogs-no-unsaved-guard.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 放在 Field 裡的 Select 沒有連上欄位標籤與錯誤訊息 | [`select-not-linked-to-field-label.md`](./select-not-linked-to-field-label.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 登入頁等表單的送出錯誤沒有 role="alert"，報讀器不會念出 | [`form-errors-missing-alert-role.md`](./form-errors-missing-alert-role.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 帳號存的語系與時區沒被套用，偏好頁時區只有 4 個 | [`account-preferences-not-applied.md`](./account-preferences-not-applied.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 日期選擇器、TreeEditor、Spinner 的預設文案沒跟著語系 | [`ui-component-default-labels-not-localized.md`](./ui-component-default-labels-not-localized.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 系統角色看不到「管理權限」入口，且入口用錯權限判斷 | [`system-role-permission-entry-hidden.md`](./system-role-permission-entry-hidden.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 移除群組成員、資料夾授權、駁回審批、停用平台管理者沒有確認 | [`destructive-actions-without-confirm.md`](./destructive-actions-without-confirm.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 編輯標籤遇到版本衝突時沒有「重新載入」，重送一直 409 | [`tag-edit-conflict-no-reload.md`](./tag-edit-conflict-no-reload.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 警告色與成功色按鈕的白字對比不足，測試只要求 3:1 | [`button-color-contrast.md`](./button-color-contrast.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 平台 session 結束時被未儲存提醒擋下（改密碼必現） | [`platform-session-end-blocked-by-guard.md`](./platform-session-end-blocked-by-guard.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 檔案管理器切換排列方式或他分頁改偏好時清空選取 | [`file-manager-selection-cleared-by-preference.md`](./file-manager-selection-cleared-by-preference.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | apps/platform 上的 X-Tenant 對所有路由生效 | [`platform-host-x-tenant-all-routes.md`](./platform-host-x-tenant-all-routes.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | 游標日期或數值不合格式時回 500 而非 400 | [`cursor-invalid-date-returns-500.md`](./cursor-invalid-date-returns-500.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | 啟用連結檢查與改密碼端點缺少登入類限流 | [`auth-endpoints-missing-rate-limit.md`](./auth-endpoints-missing-rate-limit.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | safeReturnTo 遇到 ./.. 路徑段會回傳 //外站 | [`safe-return-to-dot-segments.md`](./safe-return-to-dot-segments.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | 頁面權限守衛分大小寫，/USER 等路徑繞過 403 頁 | [`route-guard-case-sensitivity.md`](./route-guard-case-sensitivity.md) | 2026-10-06（全面檢測：程式資安） |
| 低 | 破壞性 DB 腳本只看 NODE_ENV 防呆 | [`destructive-db-scripts-env-guard.md`](./destructive-db-scripts-env-guard.md) | 2026-10-06（全面檢測：流程資安） |
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
| 低 | 租戶佈建在執行期 import seed 腳本，違反層級規則 | [`provisioner-imports-seed-scripts.md`](./provisioner-imports-seed-scripts.md) | 2026-10-06（全面檢測：架構） |
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
| 低 | 角色權限選取以 as never 繞過 PermissionKey 型別檢查 | [`permission-key-type-escapes.md`](./permission-key-type-escapes.md) | 2026-10-06（全面檢測：可讀性） |
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
