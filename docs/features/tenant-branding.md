# 租戶品牌（登入頁與外框的 logo、名稱、主色）

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`04-sso.md`](../architecture/04-sso.md) §3（apps/platform 的登入互動）、[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md)（Design Token、WCAG 對比測試）、
  [`backend/12-settings.md`](../architecture/backend/12-settings.md)（公開設定 `/system/settings/public`）、[`backend/09-file.md`](../architecture/backend/09-file.md)（logo 的儲存）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

所有人都在 apps/platform 的登入互動頁登入（[`04-sso.md`](../architecture/04-sso.md) §3）；這一頁是平台共用的，客戶的員工看到的是平台的名稱與外觀，不是自己公司的。
backstage 的外框也一樣。B2B 客戶（尤其是會把後台給他們自己的客戶或加盟商用的）常要求至少換 logo 與名稱。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶設定：顯示名稱、logo（淺色／深色各一）、favicon、主色 | 自訂 CSS、自訂登入頁版面 |
| 登入互動頁依租戶套用（從 OIDC client 或 `X-Tenant` 得知租戶） | 自訂郵件範本的版面（見開放問題 3） |
| backstage 外框、頁籤標題套用 | 依網域切換不同品牌（一個租戶一組） |
| 主色只覆寫少數幾個 Design Token，存檔前檢查淺色與深色的對比 | |

## 使用者故事

**作為租戶管理者，我希望登入頁顯示我們公司的 logo，以便員工確定自己登入的是公司的系統。**

- **Given** 我有 `system:update`，上傳了 logo、設定主色
- **When** 員工打開公司網域的 backstage，被導到登入頁
- **Then** 登入頁與外框顯示公司的 logo 與名稱，主要按鈕使用公司主色；主色對比不足時存檔被拒絕並說明原因

## 初步構想

- 儲存：系統設定只存純量（[`backend/12-settings.md`](../architecture/backend/12-settings.md)），主色與名稱可以是 `isPublic` 的設定；logo 是檔案，放租戶 bucket 的固定前綴，設定裡存物件 key。
- 讀取：登入前的頁面用 `/system/settings/public`（已支援 apps/platform 帶 `X-Tenant`）。logo 的公開網址要經獨立的檔案網域（[`backend/09-file.md`](../architecture/backend/09-file.md) §13）或另一條公開路徑，見開放問題 1。
- 前端：`web-core/theme` 在執行期覆寫 `--color-brand-*` 等少數 token；`packages/ui` 不變。
- 對比檢查：沿用 `contrast.test.ts` 的計算，前後端都檢查。
- 權限：`system:update`（或新增 `branding:update`）。

## 開放問題

1. logo 的公開讀取：簽章網址會過期、不適合放在登入頁的 `<img>`；要不要開一條不需登入、可快取的公開路徑？
2. 品牌要不要是可由平台關閉的 feature（只有某些方案有）？
3. 郵件（啟用信、重設密碼信）要不要套用 logo 與名稱？
4. 平台管理者能不能代租戶設定？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/frontend/07-ui-system.md`（主題章節）、`docs/architecture/04-sso.md`（登入互動頁）
