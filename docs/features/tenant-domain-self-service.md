# 租戶自行管理網域

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`05-tenancy.md`](../architecture/05-tenancy.md) §2（網域決定租戶）、§5（`POST|DELETE …/domains` 只在平台端點）、§7（部署與 TLS）、§13.4（租戶不能自行調整的決定）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

網域決定租戶（[`05-tenancy.md`](../architecture/05-tenancy.md) §2）。租戶要用自己的網域（`admin.acme.com`）時，現在要請平台管理者在 apps/platform 新增，
平台管理者也無法確認客戶真的擁有那個網域——登記錯了，等於讓別人的網域指向這個租戶。

> **注意**：這份提案會推翻「租戶管理者不能自行調整平台層設定」的方向（[`05-tenancy.md`](../architecture/05-tenancy.md) §12.4、§13.4 對開關與參數的決定）。
> 網域與開關、參數性質不同（不涉及買了什麼），但進入規劃前要先確認這個方向。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶管理者提出網域，系統給一筆 DNS TXT 紀錄 | 自動申請與更新 TLS 憑證（見開放問題 1） |
| 背景工作定期檢查 TXT，驗證通過才生效 | 一個網域給多個租戶 |
| 平台管理者仍可直接新增（略過驗證）與移除 | |
| 驗證過的網域定期複查，失效時通知 | |

## 使用者故事

**作為租戶管理者，我希望自己加上公司的網域，以便不用等平台人員處理。**

- **Given** 我有 `system:update`（或新權限）
- **When** 我輸入 `admin.acme.com`，照指示加上 TXT 紀錄
- **Then** 驗證通過後網域生效，我收到通知；驗證前打開那個網域仍回「找不到租戶」

## 初步構想

- 資料模型（平台 DB）：`tenant_domains` 加 `verification_token`、`verified_at`、`last_checked_at`；未驗證的不進 `TenantDirectory`。
- 背景工作 `tenant.domainVerify`（平台工作，每 10 分鐘，指數退避）。
- 端點：backstage 的 `GET|POST|DELETE /system/domains`（租戶端）→ 寫平台 DB，平台稽核與租戶稽核各一筆。
- 既有的規則不變：主要網域、最後一個網域不能移除；apps/platform 的網域不能登記。

## 開放問題

1. TLS：自訂網域要憑證。用反向代理的 on-demand TLS（Caddy）還是由客戶上傳憑證？nginx 目前的設定（`deploy/`）要怎麼改？
2. 租戶端寫入平台 DB 的表，是否違反「租戶請求只碰租戶 DB」的慣例？要不要改成「租戶提出、平台背景工作寫入」？
3. 移除網域時，正在用該網域登入的 session 怎麼處理？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/05-tenancy.md`（網域章節與設計決策）
