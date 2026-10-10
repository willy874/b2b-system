# 稽核日誌的「資源」篩選只寫死 11 種，後端實際寫入的類型多出十幾種

## 現況

- `apps/backstage/src/features/audit-log/pages/AuditLogList/useAuditLogFilters.ts` 第 32–56 行 `RESOURCE_OPTIONS`：`user`、`role`、`approval`、`file`、`auth`、`authz`、`serviceAccount`、`apiToken`、`webhook`、`tag`、`dataTransfer`。
- 租戶的稽核（`AuditService.record`）實際寫入的 `resourceType`（grep `apps/api/src/modules` 的 `audit.record` 呼叫；常數在 `apps/api/src/core/resource/resource-types.ts` 第 8–25 行）另外還有：
  - `group`（`modules/group`）、`orgUnit`（`modules/organization`）、`fileFolder`（`modules/file`）
  - `announcement`（`modules/announcement`）、`approvalFlow`（`modules/approval`）、`comment`（`modules/comment`）
  - `galleryItem`、`galleryAlbum`（`modules/gallery`）
  - `identityProvider`（`modules/identity-provider`）、`mfaPolicy`（`modules/mfa`；`mfaMethod` 寫在平台的稽核，不算）
  - `notificationPolicy`（`modules/notification`）、`setting`（`modules/system`）、`job`（`modules/job`，手動重試）
- 規格 `docs/architecture/backend/06-audit-log.md` 第 241 行的 `resourceType` 列舉也已經過時（`user / role / auth / permission / approval / file / fileFolder`，其中 `permission` 實際寫的是 `authz`）。
- 篩選的值直接進網址與 `GET /audit-logs?resourceType=`，後端接受任何字串，所以手改網址可以查；只是面板上選不到。

## 影響

管理者要查「誰改了組織」「誰刪了群組」「誰改了 MFA 政策」「誰改了系統設定」時，資源篩選沒有這些選項，只能用動作關鍵字（`orgUnit.`）繞過，且不知道該打什麼。每次後端加一種資源，前端都要記得來補，目前已經落後 13 種。

嚴重度中：篩選與實際資料不一致；查詢結果本身是正確的。

## 修正方式

擇一：

1. **後端提供清單**（建議）：`GET /audit-logs/resource-types` 回 `{ type, feature }[]`，來源是後端登記的資源類型（`RESOURCE_TYPE` 加上非實體的 `auth`、`authz`、`setting`、`mfaPolicy`、`notificationPolicy`、`identityProvider`、`job`、`dataTransfer` 集中成一份 `AUDIT_RESOURCE_TYPES`，每種標註所屬的 feature），平台停用的 feature 不列。前端只負責翻譯：`auditLog.resource.<type>`，沒有翻譯時顯示原字串。
2. **共用常數**：把稽核的資源類型做成 openapi 的 enum（`resourceType` 參數的 schema），SDK 產生聯集型別，前端的 `RESOURCE_OPTIONS` 以 `satisfies Record<AuditResourceType, …>` 列舉，後端新增時前端編譯失敗。

不論哪一種，同步更新 `06-audit-log.md` §7 的表，並在後端加一個測試：所有 `audit.record` 用到的 `resourceType` 都在清單裡（可在 `AuditService.record` 以型別限制 `resourceType: AuditResourceType`，讓 TypeScript 檢查）。

## 驗證方式

- 單元（api）：`AuditService.record` 的 `resourceType` 型別是聯集；新增一個不在清單的值時 typecheck 失敗。
- 整合：`GET /audit-logs/resource-types`（若採方案 1）依 feature 開關增減。
- 前端 hook 測試（`useAuditLogFilters`）：選項涵蓋清單的每一種；未啟用的 feature 的類型不出現；兩個語系檔都有每一種的翻譯。

（2026-10-10 backstage 各功能的優化分析發現。）
