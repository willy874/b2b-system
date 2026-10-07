# 方案（Plan）：feature、參數的組合範本

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1（`features`）、§5.3（`feature_params`）、§12、§13；[`tenant-usage.md`](./tenant-usage.md)；[`tenant-templates.md`](./tenant-templates.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

租戶「買了什麼」現在逐一設定在每個租戶上：`tenants.features`（完整清單）、`tenants.feature_params`（逐項覆寫）
（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1、§5.3）。租戶一多就會出現：

- 同一個等級的客戶設定不一致（有人漏開 webhook、有人儲存量多給）。
- 調整某個等級的內容（例：標準版的儲存量從 2 GB 改成 5 GB）要逐一改每個租戶。
- 看不出某個租戶「是哪個等級」，也就無法依等級統計。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 平台管理者定義方案：名稱、啟用的 feature、參數值 | 計費、試用期到期自動降級 |
| 租戶指定一個方案；方案的值是租戶的預設，租戶層仍可個別覆寫 | 租戶自助升級 |
| 修改方案時，所有套用它的租戶跟著改（未覆寫的部分） | feature flag 納入方案（flag 是暫時的上線開關，[`05-tenancy.md`](../architecture/05-tenancy.md) §5.2） |
| 建立租戶時選方案 | |
| 租戶列表依方案篩選 | |

## 使用者故事

**作為平台營運，我希望把「標準版」的儲存量改成 5 GB，以便一次套用到所有標準版客戶。**

- **Given** 20 個租戶套用「標準版」，其中 1 個個別覆寫了儲存量 10 GB
- **When** 我把方案的 `file.storageQuotaMb` 改成 5120
- **Then** 19 個租戶的生效值變成 5120；個別覆寫的那 1 個維持 10 GB；修改前畫面列出受影響的租戶數

## 初步構想

- 資料模型（平台 DB）：`plans`：`id`、`code`、`name`、`features text[]`、`feature_params jsonb`、`version`、`deleted_at`；`tenants.plan_id`（可為 null = 沿用現行行為）。
- 生效值：`程式預設 → 方案 → 租戶覆寫`。`TenantDirectory` 載入時合併，`tenantFeatureParam()` 的介面不變。
  `features` 的覆寫需要從「完整清單」改成「方案 ± 增減」，見開放問題 1。
- 修改方案：寫平台稽核 `plan.update`，之後對受影響的租戶 `TenantDirectory.invalidate()`，features 有變時發 `TENANT_FEATURES_CHANGED`（與 §5.1 相同）。
- 關閉 feature 前列出受影響的數量（沿用 §12.5 的做法）。
- 權限（平台）：`plan:read`、`plan:manage`；平台角色 `operator` 只能讀？（見開放問題 3）

## 開放問題

1. `tenants.features` 現在是完整清單；有方案之後，租戶層要改成「相對方案的增減」嗎？還是租戶層一旦設定就完全蓋過方案？
2. 現有租戶的遷移：自動建立一個「預設」方案並套用全部，還是保持 `plan_id = null`？
3. 誰能改方案？改方案影響很多租戶，`operator` 能不能做？
4. 方案要不要有版本（改動排程生效、回溯）？[`05-tenancy.md`](../architecture/05-tenancy.md) §13.4 已決定參數不做歷史版本與排程生效。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/05-tenancy.md`（§5 新增「方案」小節、設計決策新章節）
- 前端：`apps/platform/README.md` 或 `docs/architecture/frontend/` 對應章節
