# 組織圖裡部門詳情的上層路徑會跳回清單

## 現況

- `apps/backstage/src/features/organization/pages/Organization/page.tsx` 第 30–33 行的 `searchOf(unitId, view)` 在換部門時保留 `view=chart`，`select`、`changeView` 都用它。
- 同一個 `OrgUnitDetailPanel` 也出現在組織圖（第 182 行把 `detail` 傳給 `OrgChartPanel`）。
- `pages/Organization/components/OrgUnitDetailPanel.tsx` 第 71–77 行的上層路徑連結只帶 `search={{ unitId: item.id }}`，沒有 `view`。

在組織圖點詳情上方的上層部門，網址的 `view` 被拿掉，畫面切回清單。

## 影響

使用者在組織圖裡沿著路徑往上看時被帶離組織圖，要再切回去。

嚴重度低：導覽體驗。

## 修正方式

連結改用 `search={(prev) => ({ ...prev, unitId: item.id })}`（保留目前的 `view`），或把 `searchOf` 移到 feature 共用處（例如 `routes/`）讓 panel 也用它。

## 驗證方式

- `OrganizationPage` 測試補：`view=chart&unitId=<子部門>` 時點上層路徑，網址仍帶 `view=chart`、`unitId` 換成上層。

（2026-10-10 backstage 各功能的優化分析發現。）
