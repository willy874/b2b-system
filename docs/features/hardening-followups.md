# 安全與容量的後續強化

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`multi-instance.md`](./multi-instance.md)、[`observability.md`](./observability.md)、[`entity-revisions.md`](./entity-revisions.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

2026-09-30 以「企業多租戶、1000 人同時在線」為前提，對效能、資安、邊際操作、使用者體驗做了一次全面檢查，
共 102 項，P0 全部與大部分 P1／P2 已修（merge `b8b634e`，修法寫在各正式文件）。
下面是當時刻意延後的部分：多半需要產品決策、另一個元件，或範圍大到應該單獨一個 branch。
跨實例的項目（共享快取失效、Socket.io adapter、限流共享計數、拆 worker）在 [`multi-instance.md`](./multi-instance.md)；
監控指標在 [`observability.md`](./observability.md)，這裡不重複。

## 範圍

### 資安

| 項目 | 現況 | 為什麼延後 |
| --- | --- | --- |
| 每個租戶各自的 token 簽章金鑰（`kid`、非對稱簽章） | 租戶與平台的 access token 共用一把 HS256 `JWT_SECRET`（production 已拒絕範例值與低熵金鑰），租戶之間靠 `tid` 與網域比對隔離；OIDC 的 ID token 已是 RS256（`OIDC_JWKS`） | 影響 token 格式與所有驗證端，需另開設計（ADR） |
| 使用者上傳檔案改由獨立、不帶 cookie 的網域提供 | `/storage` 與租戶同源，以 `sandbox` CSP、`nosniff`、非白名單一律 attachment 防護 | 需要部署與 DNS 決策 |
| 「帳號 × IP」計數與漸進延遲、每租戶上限、IP 白名單 | 登入以「email＋IP」與 IP 各一個桶，另有帳號鎖定 | 屬速率限制的第二版設計；共享計數見 multi-instance |
| 外部 IdP 的 DNS rebinding | production 對 discovery／token／userinfo／JWKS 先查 DNS 擋私有位址 | 查詢與連線之間仍有空窗，要改成連線時綁定已驗證的 IP；[Webhook](./webhooks.md) 投遞需要同一個 helper |
| 完整的常見密碼清單（top-10k） | `common-passwords.ts` 收錄取自常見清單的字根，以字根、前後綴、替換字元、鍵盤序列判斷 | 需要引入外部資料檔 |
| 註冊表單拿掉密碼欄；審批頁標示「email 尚未驗證」 | 核准後寄啟用信才啟用，申請時的密碼先存著 | apps/auth 與審批頁的 UX 調整 |
| nginx 的 `log_format` 不記 query string | api 的日誌已遮掉 `code`／`state`／`ticket` | 部署設定，與存取日誌的需求一起決定 |

### 容量

| 項目 | 現況 | 為什麼延後 |
| --- | --- | --- |
| 稽核列表 keyset 分頁 | offset 上限 10 000、總數最多數到 10 100 | 前端分頁元件要一起改 |
| 檔案列表無限捲動的 `maxPages` | 推播只重抓相關資料夾，但已載入的頁會全部重抓 | 游標只能往後、列表是虛擬捲動，丟掉前面的頁要有反向游標與捲動錨定 |
| 列表的 304／ETag | 每次重抓都回完整資料 | 需要版本號或內容雜湊 |
| `ensurePersonalFolders` 改批次 SQL 或 lazy 建立 | 在資料夾樹鎖的交易內逐人建立（一人失敗不影響整批） | 檔案模組內部重構 |
| 個人資料夾不出現在別人的資料夾樹 | 依 `rbac/07` §5.1 列出但鎖住，樹的大小隨人數成長 | 產品決策 |
| outbox 清掃只進入有寫入的租戶；relay 移出交易 | 每 10 分鐘進入每個租戶 | 目前頻率下影響已小 |
| 登入端點的 argon2 並行上限 | `UV_THREADPOOL_SIZE=16` | 要搭配限流的第二版一起決定排隊行為 |
| 每個租戶覆寫連線池大小、PgBouncer | 連線預算公式在 `backend/02-database.md` §6.2 | 公式寫明了何時需要 |
| 稽核冷表的保留期限（按月分區、DROP PARTITION） | 冷表無限保留 | 要先訂法規上的保留年限；與 multi-instance 的「稽核日誌分區」一起做 |
| 使用者列表「先分頁再聚合角色」 | 聚合後再分頁 | 目前規模下不必要 |
| 影像處理的記憶體實測 | 原圖串流到暫存檔、逐列解碼、兩個版本依序 render | 需要壓測環境 |

### 邊際操作與體驗

| 項目 | 現況 | 為什麼延後 |
| --- | --- | --- |
| `PATCH /users/:id`、`PATCH /roles/:id` 的版本控制改必填 | R1 已上：`version` 欄、選填的 `version`、前端表單與批次帶版本（`backend/03-api-conventions.md` §11） | 滾動部署期間舊版前端不帶 `version`；R1 的前端部署之後才改必填（[ADR-0025](../adr/0025-entity-revisions.md) D4 的 R1b） |
| 列表「選取全部符合的 N 筆」 | 批次只能選本頁 | 需要後端依條件批次處理的 API |
| 登入被 429 時倒數並停用送出鈕 | 訊息已帶「請在 N 秒後再試」 | 前端表單的小改動 |
| 平台關閉租戶的外部 IdP（`allowExternalIdp`）前顯示受影響的連線數 | 確認對話框已說明影響 | 平台端點要以 `Tenancy.run` 進入那個租戶查連線，是單一租戶的查詢，但目前平台端點都不進租戶 DB |
| session 結束時保留表單草稿 | 未儲存提醒降低損失 | 需要草稿儲存機制 |
| 後端驗證 timezone（`Intl.supportedValuesOf`） | 前端遇到不合法時區退回預設 | 小改動，與偏好設定的後端驗證一起做 |
| `assertUsernameAvailable` 改精確查詢；資料夾名稱 NFC 正規化 | 唯一索引兜底，結果正確 | 小改動 |

## 開放問題

1. super-admin 的名稱與說明能不能改？[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §5 寫不可改，
   但 `RoleService.update` 沒有擋（2026-09-30 確認：只有 `updatePermissions` 以 `ROLE_SUPER_ADMIN_IMMUTABLE` 擋權限變更；
   其他系統角色的顯示名稱可改是既定決定）。
   **結論**：依規格不可改。`RoleService.update` 對 super-admin 回 `403 ROLE_SUPER_ADMIN_IMMUTABLE`（前端本來就不提供編輯）。**已實作**（`b399ef2`）；規格見 `rbac/01-domain-model.md` §5。
2. `identityProvider:*` 要不要只給 super-admin？目前 seed 給 `admin` 全部四個、`auditor` 給 `read`；
   自動連結已限定連線登記的網域，並排除持有 `member` 以外系統角色的帳號。
3. 上傳檔案的獨立網域要用每個租戶一個子網域，還是全平台共用一個？

## 歸檔去向

- 資安項目：`docs/architecture/backend/04-auth.md`、`09-file.md`、`docs/architecture/04-sso.md`
- 容量項目：`docs/architecture/backend/02-database.md`、`09-file.md`、`10-jobs.md`
- 前端項目：`docs/architecture/frontend/` 對應章節
