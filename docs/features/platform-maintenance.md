# 平台維護公告與租戶唯讀模式

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`backend/19-announcement.md`](../architecture/backend/19-announcement.md)（租戶內的公告）、`modules/platform-notification`（只給平台管理者）、
  [`05-tenancy.md`](../architecture/05-tenancy.md) §5（停用的租戶回 503）、[`backend/08-realtime.md`](../architecture/backend/08-realtime.md)、[`multi-instance.md`](./multi-instance.md)（滾動部署）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

平台要升級資料庫、跑租戶 migration、搬機器時，沒有辦法事先告訴所有租戶的使用者：

- 公告是 **租戶內** 的功能，由租戶自己的管理者發（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md)）。
- `platform-notification` 的收件人只有平台管理者。
- 租戶只有 `active` 與 `disabled` 兩種可用狀態；要「暫停寫入但還能查詢」（搬資料、匯入大量資料、調查事故）只能整個停用（503）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 平台管理者發布維護公告：期間、內容（兩個語系）、對象（全部或指定租戶） | 寄信通知（之後可以接寄信工作） |
| backstage 與 apps/platform 頂端顯示橫幅；開始前預告、期間中顯示「維護中」 | 對外 API 的維護回應格式以外的變更 |
| 單一租戶的唯讀模式：所有寫入回 `503 TENANT_READ_ONLY`，讀取照常 | 全平台一次唯讀（見開放問題 2） |
| 橫幅隨推播即時出現與消失 | |

## 使用者故事

**作為租戶的使用者，我希望事先知道系統哪天幾點要維護，以便避開那段時間做重要操作。**

- **Given** 平台管理者發布「10/12 02:00–04:00 維護」
- **When** 我在 10/11 打開 backstage
- **Then** 頂端看到預告橫幅（以我的時區顯示時間），可以關掉；維護期間再出現一次且不能關

**作為平台管理者，我希望把一個租戶設成唯讀，以便在搬資料時客戶仍能查詢。**

- **Given** 租戶 acme 是 `active`
- **When** 我開啟唯讀模式
- **Then** acme 的使用者看到「唯讀中」橫幅，所有寫入按鈕停用；直接打 API 回 503；背景工作見開放問題 3

## 初步構想

- 資料模型（平台 DB）：`platform_maintenance_notices`：`id`、`starts_at`、`ends_at`、`notice_from`、`message`（jsonb，依語系）、`tenant_ids uuid[]`（null = 全部）、`version`。
  `tenants.read_only boolean`。
- 後端：
  - 公告：平台端點 CRUD；租戶端 `GET /system/maintenance`（`@Public()`，登入前的頁面也看得到）或併入 `/auth/profile`。
  - 唯讀：全域 guard（排在 `FeatureGuard` 附近）對非 GET 的租戶請求回 503；`TenantContext` 帶 `readOnly`。允許清單：登出、續期。
  - 推播：變更時對受影響的 `t:{tenantId}` room 推 `resource.changed`（新的 `ChangeSource`）。
- 前端：`web-core/layout` 加橫幅區；唯讀時 `useCan()` 對寫入類權限一律回 false（或另一個 hook，見開放問題 4）。
- 權限（平台）：`maintenance:manage`；唯讀開關屬於 `tenant:update`。
- 稽核：平台稽核 `maintenance.create`／`update`／`delete`、`tenant.update`（`readOnly`）。

## 開放問題

1. 維護公告與租戶內的公告要共用元件嗎？（前者在平台 DB、後者在租戶 DB）
2. 要不要全平台唯讀（例：跑全部租戶的 migration 時）？
3. 唯讀時背景工作怎麼辦：暫停租戶的工作、還是照跑（工作也會寫入）？
4. 前端的寫入按鈕停用，用權限機制（把寫入權限暫時拿掉）還是獨立的狀態？前者最省事，但說明文字會變成「沒有權限」。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/05-tenancy.md`（唯讀模式、生命週期）
- `docs/architecture/frontend/` 外框的橫幅章節
