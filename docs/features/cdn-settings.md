# CDN 設定管理

- 優先度：P3
- 狀態：規劃中
- 依賴：[`backend/09-file.md`](../architecture/backend/09-file.md) §16（`CdnUrlSigner`、`CdnPurger`、`CdnConfig`、`cdn.purge`、`FILE_CDN_*`、邊緣的 njs）；
  跨程序的快取同步（[`01-system.md`](../architecture/01-system.md) §4.4 的 `BroadcastService`）；
  平台的權限目錄與稽核（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）
- 相關：MFA 的平台參數（[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5、§5.1：同一種「平台 DB 的設定 ＋ 開啟前的檢查 ＋ 廣播」做法）；
  [`backend/25-image.md`](../architecture/backend/25-image.md)（`ObjectUrlSigner` 依這裡的生效值選擇簽章方式）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

[`backend/09-file.md`](../architecture/backend/09-file.md) §16 把 CDN 的開關與參數都放在環境變數（§16.4、§16.5、§17 D9），改任何一項都要重啟 api 的所有角色與對外 API 的程序。實際維運時會卡在：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 邊緣故障，要立刻改回 presigned 網址 | 改 `FILE_CDN_ENABLED`、重新部署 | 事故當下要動部署設定、等所有程序重啟；多實例時每個程序切換的時間不同 |
| 逐步開放（先 `fileVariant`，再 `imageAsset`、`galleryItem`） | 每一步改 `FILE_CDN_RESOURCES` 並重啟 | 每一步都是一次部署 |
| 調整網址效期、是否自動清理 | 改環境變數並重啟 | 同上 |
| 確認邊緣是否正常（每個節點連得到嗎？金鑰輪替後兩邊的 kid 一致嗎？清理有沒有失敗？） | 看 log、跑 `check-cdn.sh` | 沒有一個地方看得到整體狀態；金鑰不一致時，api 簽出的網址全部被邊緣拒絕，卻沒有人先發現 |
| 法律要求立刻下架某張圖 | 在伺服器上跑 `cli:cdn-purge` | 要有主機的 shell；平台管理者無法自己處理 |

但 **不是每一項都該搬到畫面上**：簽章金鑰、清理的密鑰、CDN 的網址、回源位址必須與邊緣容器的設定一致，是部署的一部分，改了也必須同時改邊緣——放在畫面上只會製造不一致。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 兩層設定：部署層（環境變數，能力與上限）＋ 執行期（平台 DB，不必重啟）；生效值的解析（§2） | 在畫面上管理簽章金鑰、清理密鑰、CDN 網址（D1） |
| 執行期的開關、資源類型、效期上限、自動清理、批次大小；樂觀鎖；跨程序廣播 | 依租戶開關（D6，沿用 [`backend/09-file.md`](../architecture/backend/09-file.md) §17 D9） |
| 開啟前的檢查：每個邊緣節點連得到、清理密鑰正確、kid 一致（§5） | 真正 CDN 服務（CloudFront、Cloudflare）的憑證管理；留到接上它們時，比照 MFA 的加密參數（D1） |
| 邊緣的狀態端點與定期檢查 `cdn.healthCheck`、指標與告警（§6） | 邊緣的命中率（[`backend/09-file.md`](../architecture/backend/09-file.md) §17 D6） |
| apps/platform 的 CDN 頁面：部署資訊、設定、邊緣節點、手動清理（§8） | 清理的歷史另開一張表（用平台的背景工作列表，§7） |
| 手動清理：路徑、圖片資產、圖片庫的圖片、檔案、整個快取；`CdnPathResolver` 讓擁有者模組列出路徑（§7） | |
| 平台權限 `cdn:read`／`cdn:update`／`cdn:purge`／`cdn:purgeAll`、平台稽核（§9、§10） | |

## 使用者故事

**作為值班的平台管理者，我希望邊緣故障時在畫面上按一下就改回 presigned 網址，以便不必在事故當下重新部署。**

- **Given** CDN 已啟用，邊緣節點回應逾時，圖片大量破圖
- **When** 我在 CDN 頁面把「啟用」關掉
- **Then** 所有程序在幾秒內（最晚 `TENANT_CACHE_TTL`）改簽 presigned 網址；使用者重新整理或 `SignedImage` 重抓之後圖片恢復；平台稽核記下是誰、何時關掉

**作為平台管理者，我希望逐步開放資源類型，以便先用檔案的縮放圖驗證，再開放頭像與圖片庫。**

- **Given** 部署允許三種資源（`FILE_CDN_RESOURCES` 的預設）
- **When** 我在設定裡只勾「檔案的縮放圖」，一週後再勾「圖片資產」
- **Then** 兩次都不必重啟；沒勾的資源照舊用 presigned 網址

**作為平台管理者，我希望輪替金鑰之後馬上知道邊緣有沒有跟上，以便在使用者看到破圖之前發現。**

- **Given** api 的 `FILE_CDN_SIGNING_KEYS` 第一把換成新的 kid，但其中一個邊緣節點還沒更新
- **When** 定期檢查執行，或我按「執行檢查」
- **Then** 頁面在那個節點標出「缺少簽發中的金鑰 k2」，告警觸發；在它恢復之前，「啟用」不能從關切換成開

**作為平台管理者，我希望接到下架要求時自己清掉某張圖的快取，以便不必找有主機權限的人。**

- **Given** 某租戶的一張頭像必須立刻下架，它的物件已經在回收桶並由租戶永久刪除
- **When** 我在「清理」選擇租戶、輸入圖片資產的 id，送出
- **Then** api 列出那張圖所有的變體路徑，排入 `cdn.purge`；我在背景工作列表看得到每個節點的結果；平台稽核記下這次清理

**作為部署沒有 CDN 的平台管理者，我希望頁面清楚說明 CDN 沒有部署，而不是給我一堆不能用的開關。**

- **Given** `FILE_CDN_ENABLED=false`
- **When** 我打開 CDN 頁面
- **Then** 只顯示「這個部署沒有提供 CDN」與啟用的方式（文件連結）；設定與清理都不出現

## 初步構想

### 1. 哪些設定放哪一層

| 設定 | 層 | 理由 |
| --- | --- | --- |
| `FILE_CDN_ENABLED` | 環境變數（**部署層的能力**） | 代表「這個部署有沒有邊緣」；沒有邊緣時畫面上的任何設定都沒有意義 |
| `FILE_CDN_PROVIDER`、`FILE_CDN_ORIGIN` | 環境變數 | 決定網址的形式，必須與邊緣、CSP（`CDN_PUBLIC_ORIGIN`）一致 |
| `FILE_CDN_SIGNING_KEYS`、`FILE_CDN_PURGE_SECRET` | 環境變數 | 機密，且必須與邊緣容器的 `CDN_SIGNING_KEYS`、`CDN_PURGE_SECRET` 相同（D1） |
| `FILE_CDN_PURGE_URL`、`FILE_CDN_PURGE_TIMEOUT_MS` | 環境變數 | 內部網路的拓樸 |
| `FILE_CDN_RESOURCES` | 環境變數 → **上限** | 部署允許哪些資源；執行期只能從中選 |
| `FILE_CDN_MAX_URL_TTL` | 環境變數 → **上限** | 它也是「關閉後邊緣要再運作多久」「金鑰輪替要等多久」的依據，所以執行期只能調低，不能超過 |
| `FILE_CDN_PURGE_ON_DELETE`、`FILE_CDN_PURGE_BATCH_SIZE` | 環境變數 → **預設值** | 執行期沒設定時用它 |
| 啟用（`state`） | **平台 DB** | 事故時要能立刻關掉 |
| 資源類型（`resources`） | **平台 DB**（⊆ 環境變數的上限） | 逐步開放 |
| 效期上限（`urlTtlCap`） | **平台 DB**（300 秒 ≤ 值 ≤ `FILE_CDN_MAX_URL_TTL`） | 依情況收緊 |
| 自動清理（`purgeOnDelete`）、批次大小（`purgeBatchSize`） | **平台 DB** | 真正的 CDN 依清理次數計費時要能調整 |

### 2. 生效值的解析

```
FILE_CDN_ENABLED = false
  → 簽章：presigned；清理：no-op；頁面唯讀（「這個部署沒有提供 CDN」）

FILE_CDN_ENABLED = true
  簽章用的 CDN   = (row?.state ?? 'on') === 'on'
  資源類型       = row?.resources ? row.resources ∩ FILE_CDN_RESOURCES : FILE_CDN_RESOURCES
  效期上限       = min(row?.urlTtlCap ?? FILE_CDN_MAX_URL_TTL, FILE_CDN_MAX_URL_TTL)
  自動清理       = row?.purgeOnDelete ?? FILE_CDN_PURGE_ON_DELETE
  批次大小       = row?.purgeBatchSize ?? FILE_CDN_PURGE_BATCH_SIZE
  清理是否執行   = 自動清理（與 state 無關，D3）
```

- **沒有列時與 [`backend/09-file.md`](../architecture/backend/09-file.md) §16 的行為完全相同**：環境變數開了就開，參數用環境變數的值。這個功能上線不改變任何現有部署（D2）。
- **執行期關閉時清理照常執行**（D3）：環境變數開著代表邊緣還在，已發出的 CDN 網址在效期內仍會被使用；繼續清理就不會有「關掉期間刪除的物件還留在快取」的問題，
  所以由執行期關閉再打開時 **不需要** `cli:cdn-purge --all`（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.4 只剩環境變數層的關閉需要它）。
- 環境變數縮小上限之後（例如拿掉一種資源、調低 `FILE_CDN_MAX_URL_TTL`），DB 裡超出的值 **讀取時被裁切**，不改寫 DB；頁面標示「超過部署的上限，生效值是 …」。

### 3. 資料模型（平台 DB）

`cdn_settings`：只有一列（`id = 'default'`，`CHECK (id = 'default')`）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `state` | `cdn_state`（`on` ｜ `off`），可為 null | null = 沒有覆寫（跟著環境變數，等於 `on`） |
| `resources` | `text[]`，可為 null | null = 用環境變數的上限 |
| `url_ttl_cap` | integer，可為 null | 秒 |
| `purge_on_delete` | boolean，可為 null | |
| `purge_batch_size` | integer，可為 null | 1–1000 |
| `state_changed_at`、`state_changed_by` | | 頁面顯示「誰在何時關掉」；關掉之後「已發出的網址最晚何時過期」由它與效期上限算出 |
| `last_check_at`、`last_check` | timestamptz、jsonb | 最近一次檢查的結果（§6），頁面直接顯示 |
| `version` | integer | 樂觀鎖 |
| `updated_by`、`updated_at` | | |

- 沒有列 ＝ 全部沒有覆寫。第一次 `PUT` 建立它（`version` 從 1 起），與 MFA 政策「沒有列時 `version = 1`」的做法相同。
- 允許的資源類型以 `CDN_RESOURCE_TYPES`（`core/storage`）驗證；DB 裡出現不認得的值（程式移除了某種資源）讀取時忽略。

### 4. 快取與跨程序同步

- `CdnSettings`（`core/storage`）：啟動時載入，同步讀取（每次簽網址都要判斷，不能查 DB）。
  寫入後本機重讀，並以 `BroadcastService.channel('cdn_settings')` 通知其他程序（內部 api 的各角色、對外 API 的程序），
  另有 `TENANT_CACHE_TTL` 兜底（[`01-system.md`](../architecture/01-system.md) §4.4：廣播不保證送達）。
- **切換是最終一致的，但不會出錯**：兩種網址在各自的效期內都有效，所以短暫的不一致只是有的回應帶 presigned、有的帶 CDN 網址。
- 前端不需要知道設定：網址由 api 決定，`SignedImage` 只負責顯示與過期重抓。backstage 的 CSP 在環境變數開著時就已經允許 CDN 的 origin。

### 5. 切換的行為與開啟前的檢查

| 動作 | 檢查 | 效果 |
| --- | --- | --- |
| 關閉（`state: off`） | 不檢查，任何時候都能關 | 新的回應改回 presigned；已發出的 CDN 網址在效期內仍會打到邊緣（頁面顯示「最晚於 … 過期」）；清理照常（D3） |
| 開啟（`off → on`、`null → on`） | 必須通過 §6 的「節點檢查」 | 新的回應改簽 CDN 網址 |
| 加入資源類型 | 同上 | 那種資源改簽 CDN 網址 |
| 移除資源類型、調低效期 | 不檢查 | 只影響新的網址 |
| 調高效期 | 不超過環境變數的上限 | 只影響新的網址 |
| 關閉自動清理 | 確認框說明「刪除的圖會留在邊緣到網址過期」 | 之後的刪除不入列 `cdn.purge` |

- 檢查沒通過時回 `409 CDN_NOT_READY`，`details.nodes` 列出每個節點的問題；不提供「強制開啟」（D4）——緊急情況需要的是關閉，不是在邊緣有問題時開啟。
- 寫入要帶 `version`，不符回 `409 CDN_SETTINGS_VERSION_CONFLICT`；環境變數沒開時 `PUT` 回 `409 CDN_NOT_DEPLOYED`。
- 環境變數層的開關照舊需要重啟，程序與 [`backend/09-file.md`](../architecture/backend/09-file.md) §16.4 相同。

### 6. 邊緣的狀態與檢查

**邊緣新增 `GET /_status`**（只在清理埠，簽章方式與 `/_purge` 相同，[`backend/09-file.md`](../architecture/backend/09-file.md) §16.6）：

```json
{ "kids": ["k2", "k1"], "cache": { "maxSize": "10g", "inactive": "30d", "valid": "30d" }, "build": "<映像的版本>", "startedAt": "…" }
```

只回 kid，不回金鑰；簽章驗證通過本身就證明清理密鑰一致。

**檢查的項目**（`CdnHealthService`，手動與定期共用）：

| # | 項目 | 做法 | 失敗的意思 | 開啟前必須通過 |
| --- | --- | --- | --- | --- |
| 1 | 每個節點連得到 | 解析 `FILE_CDN_PURGE_URL` 的所有位址，逐一 `GET /_status`（逾時 `FILE_CDN_PURGE_TIMEOUT_MS`） | 節點掛了或網路不通：清理會失敗 | ✅ |
| 2 | 清理密鑰一致 | 同上，`/_status` 的簽章被接受 | 清理會全部被拒 | ✅ |
| 3 | 金鑰環一致 | 節點的 `kids` 包含 api 簽發中的 kid（`FILE_CDN_SIGNING_KEYS` 的第一把）；api 其他 kid 不在節點上時只警告 | api 簽出的網址會被這個節點拒絕（`403`） | ✅ |
| 4 | 對外網址可用 | 以 api 的身分簽一個 **不存在** 的路徑（`/storage/__cdn-check/<uuid>`）向 `FILE_CDN_ORIGIN` 請求：預期源站的 `404` | `403` 且帶 `X-CDN-Reject`：簽章不被接受；不帶：回源憑證不對；`502`／`504`：邊緣連不到源站；連不上：api 所在的網路到不了對外網址（只警告） | 只警告 |
| 5 | 竄改的簽章會被拒 | 同上但改掉 `sig`：預期 `403` 與 `X-CDN-Reject: signature` | 邊緣沒有驗簽章——**嚴重**，任何人都能從快取讀到內容 | 只警告，但告警等級最高 |

- 項目 4、5 用不存在的路徑，所以不需要任何租戶的物件，也不會在快取裡留下內容（`404` 不快取）。邊緣對自己拒絕的請求加上 `X-CDN-Reject: signature | expired | method`，用來與源站的回應區分。
- **手動**：`POST /platform/cdn/check`（`cdn:read`），結果寫進 `cdn_settings.last_check`；同一時間只跑一個，10 秒內重複呼叫回上一次的結果。
- **定期**：平台背景工作 `cdn.healthCheck`，每 5 分鐘（`FILE_CDN_HEALTH_CHECK_CRON`，環境變數沒開時不排程）；結果同樣寫入 `last_check`。
- **指標**：`cdn_edge_up{node}`（1／0）、`cdn_edge_kid_mismatch{node}`、`cdn_check_failures_total{item}`；`node` 是位址，數量就是邊緣的實例數。
  告警：任一節點 `cdn_edge_up = 0` 持續 10 分鐘、`kid_mismatch = 1`、項目 5 失敗（立即）。

### 7. 手動清理

`POST /platform/cdn/purge`（`cdn:purge`；`all` 另要 `cdn:purgeAll`）：

| `target.type` | 參數 | 路徑怎麼來 |
| --- | --- | --- |
| `paths` | `tenantId`、`paths`（≤ 1000） | 直接使用；路徑必須在那個租戶的 bucket 底下 |
| `imageAsset`、`galleryItem`、`fileVariant` | `tenantId`、`id` | `CdnPathResolver`：擁有者模組在 `onModuleInit` 登記，以 `Tenancy.runForMaintenance` 進入租戶，列出那筆資源 **曾經有過** 的所有物件路徑（含已刪除、舊版本的變體；擁有者記得 key 的規則，不需要物件還在） |
| `all` | — | 整個快取（`/_purge/all`） |

- 回 `202 { jobIds }`：排入 `cdn.purge`（`manual: true`、`requestedBy`），每個節點的結果在平台的背景工作列表（`platformJob:read`）看得到；頁面直接連過去。
- 環境變數沒開時回 `409 CDN_NOT_DEPLOYED`；執行期關閉時照樣可以清理（D3）。
- `all` 的確認框列出節點數，並提醒「之後一段時間所有圖片都會回源，源站的負載會升高」；同一時間只能有一筆尚未完成的 `all`（`409 CDN_PURGE_IN_PROGRESS`）。
- 找不到那筆資源回 `404 CDN_PURGE_TARGET_NOT_FOUND`；資源類型沒登記解析器時同樣 404（例：圖片庫接上 CDN 之前，[`backend/26-gallery.md`](../architecture/backend/26-gallery.md) D21）。
- `cli:cdn-purge`（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.7）改用同一個 `CdnPathResolver`，兩邊列出的路徑一致。

### 8. apps/platform：CDN 頁面

`features/cdn`（route `/cdn`，側欄放在「平台管理」群組；頁面權限 `cdn:read`）：

| 區塊 | 內容 | 誰能操作 |
| --- | --- | --- |
| 部署 | 環境變數的唯讀資訊：是否提供、供應商、CDN 網址、簽發中與可驗證的 kid、資源類型與效期的上限、是否設定清理 | — |
| 設定 | 啟用開關（顯示誰在何時切換）、資源類型的勾選框（部署沒開放的停用並註明）、效期上限（顯示可設定的範圍）、自動清理、批次大小；「超過部署的上限」的提示 | `cdn:update` |
| 邊緣節點 | 每個節點：位址、連線、kid、快取設定、映像版本；最近一次檢查的時間與五個項目的結果；「執行檢查」 | 檢查：`cdn:read` |
| 清理 | 目標類型、租戶（下拉）、路徑或 id；最近 20 筆 `cdn.purge`（手動與自動）的狀態，連到背景工作的詳情 | `cdn:purge`；整個快取另要 `cdn:purgeAll` |

- 環境變數沒開時只顯示「部署」區塊與說明。
- 開啟時若檢查沒通過，開關旁顯示 409 帶回的節點問題，不用另開對話框。
- 關閉時的確認框：「新的圖片網址立刻改回 presigned；已發出的 CDN 網址最晚於 〈時間〉 過期，在那之前邊緣仍要運作」。
- 語系鍵放 `features/cdn/locales`；權限名稱放 apps/platform 兩個語系檔的 `permission.cdn.*`。

### 9. 權限（平台的目錄）

| 權限鍵 | 顯示名稱 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | --- | :-: | :-: | :-: |
| `cdn:read` | 檢視 CDN | 頁面、部署資訊、生效設定、邊緣狀態、執行檢查 | ✅ | ✅ | ✅ |
| `cdn:update` | 管理 CDN 設定 | 執行期的開關與參數；寫平台稽核 `cdn.update` | ✅ | ✅ | |
| `cdn:purge` | 清理 CDN 快取 | 依路徑或資源清理；寫平台稽核 `cdn.purge` | ✅ | ✅ | |
| `cdn:purgeAll` | 清空 CDN 快取 | 清空整個快取 | ✅ | | |

`operator` 能關閉 CDN 與清理：值班的人要能處理事故（D5）。清空整個快取會讓所有圖片回源，影響整個平台，只給 `super-admin`。

### 10. 稽核（平台稽核）

| 動作 | 內容 | `severity` |
| --- | --- | --- |
| `cdn.update` | 有變的欄位的 `before`／`after`（存放值，不是生效值） | `state` 有變時 `high`，其他 `normal` |
| `cdn.purge` | `tenantId`、目標類型與 id、路徑數；`all` 時 `{ all: true }` | `all` 時 `high` |

檢查不寫稽核（唯讀）；自動的清理也不寫（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.6：它是刪除的附帶動作）。

### 11. API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/platform/cdn` | `cdn:read` | `{ deployment, settings（存放值與 version）, effective, lastCheck }` |
| PUT | `/platform/cdn/settings` | `cdn:update` | 只帶要改的欄位與 `version`；`null` 回到「跟著環境變數」 |
| POST | `/platform/cdn/check` | `cdn:read` | 執行檢查，回結果 |
| POST | `/platform/cdn/purge` | `cdn:purge`（`all` 另要 `cdn:purgeAll`） | `202 { jobIds }` |

錯誤碼（`packages/error-codes` ＋ `web-core` 的 `ERROR_MESSAGE_KEY` 與語系檔）：`CDN_NOT_DEPLOYED`、`CDN_NOT_READY`、`CDN_SETTINGS_VERSION_CONFLICT`、
`CDN_PURGE_TARGET_NOT_FOUND`、`CDN_PURGE_IN_PROGRESS`。租戶網域上一律 `404 PLATFORM_ONLY`。

### 12. 會動到的既有模組

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/core/storage` | `CdnSettings`（載入、生效值、廣播）；`ObjectUrlSigner` 的選擇改讀生效值；`CdnPurger` 改讀生效的清理設定；`CdnPathResolver` 註冊表 |
| `apps/api/src/modules/platform-cdn`（新） | controller、`CdnSettingsService`（寫入、樂觀鎖、開啟前檢查）、`CdnHealthService`、手動清理、平台工作 `cdn.healthCheck` |
| `modules/file`、`modules/image`、`modules/gallery` | 登記 `CdnPathResolver` |
| `apps/api/src/db/platform` | `cdn_settings` 與 `cdn_state` enum（下一個平台 migration） |
| `apps/api/src/core/config/env.schema.ts` | `FILE_CDN_PURGE_ON_DELETE`、`FILE_CDN_PURGE_BATCH_SIZE` 改稱「預設值」；新增 `FILE_CDN_HEALTH_CHECK_CRON` |
| `deploy/cdn.js`、`nginx.cdn.conf` | `/_status`；拒絕時加 `X-CDN-Reject` |
| `deploy/check-cdn.sh` | `/_status` 的簽章與內容、`X-CDN-Reject` |
| `apps/platform/src/features/cdn`（新） | 頁面、hooks、權限、語系；`main.tsx` 加 plugin |
| `apps/api/src/db/seeds/platform-permissions.ts`、`docs/architecture/iam/02-permission-catalog.md` §8 | 四個權限鍵 |
| `docs/architecture/01-system.md` §4.4 | 廣播頻道 `cdn_settings` |
| `core/metrics/instruments.ts` | §6 的指標；`deploy/monitoring` 的告警規則 |

### 13. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 | 生效值的解析（沒有列、各欄位覆寫、超過上限被裁切、環境變數沒開）；開啟前檢查的判斷；`CdnPathResolver` 的登記與 404 |
| api 整合 | `PUT` 的樂觀鎖、`CDN_NOT_DEPLOYED`、開啟時檢查不過回 `CDN_NOT_READY`（以假的邊緣：不回應、密鑰錯、缺 kid）；關閉後簽出 presigned、清理照常入列；廣播讓另一個程序切換；稽核內容與 severity；四個權限鍵的拒絕 |
| 部署 | `check-cdn.sh` 加 `/_status` 與 `X-CDN-Reject` 的案例 |
| 前端 | CDN 頁面的三個權限案例（auditor 唯讀、operator 不能清空、super-admin 全部）、環境變數沒開時只有部署區塊、409 節點問題的顯示、版本衝突 |

## 開放問題

全部已有結論（2026-10-09，照提案的傾向定案）；決定的理由與評估過的方案見下方「設計決策」。

1. **簽章金鑰、清理密鑰要不要也能在畫面上管理？** 好處是輪替不必改部署；代價是邊緣要向 api 取金鑰（njs 定期抓、或啟動時抓），api 一掛邊緣就無法啟動，
   而且金鑰經過網路傳遞。傾向不要（D1）：金鑰屬於部署，畫面只顯示 kid 與一致性。之後接 CloudFront、Cloudflare 時，它們的 API 憑證才比照 MFA 的加密平台參數。
   - **結論**：不要，留在環境變數；畫面只顯示 kid 與一致性（D1）。
2. **沒有列時的 `state` 是開還是關？** 傾向開（跟著環境變數，D2）：上線這個功能不改變任何部署的行為。
   另一個選項是預設關，讓平台管理者通過檢查後手動打開，比較保守，但已經以環境變數開啟 CDN 的部署升版後會突然改回 presigned。
   - **結論**：開，跟著環境變數（D2）。
3. **執行期關閉時要不要也停止清理？** 傾向繼續清理（D3）：邊緣還在、舊網址還有效；停止的話，再打開前就要清空整個快取。
   - **結論**：不停止，繼續清理（D3）。
4. **開啟前的檢查要不要允許強制略過？** 傾向不允許（D4）：檢查只要求節點連得到、密鑰與 kid 一致，這些不成立時開啟必定破圖。
   - **結論**：不允許（D4）。
5. **`operator` 能不能關閉 CDN 與清理？** 傾向可以（D5）：值班的人通常是 `operator`；清空整個快取另外只給 `super-admin`。
   - **結論**：可以；`cdn:purgeAll` 只給 `super-admin`（D5）。
6. **要不要依租戶開關？** 傾向不要，維持 [`backend/09-file.md`](../architecture/backend/09-file.md) §17 D9（D6）。需要先對某個租戶試行時，可以用資源類型逐步開放代替；真的需要時再加 `tenants.cdn_state`，比照 MFA 方式的兩級覆寫。
   - **結論**：不要（D6）。
7. **定期檢查的頻率**：5 分鐘一次、`cdn_edge_up = 0` 持續 10 分鐘告警，可以嗎？
   - **結論**：可以（D8）。

## 設計決策

開放問題的結論若是「多個方案選一個」，寫在這裡：背景、決定（`D1`、`D2`…）、評估過的方案。歸檔時整節搬進正式規格。

背景見「背景」一節。歸檔時整節搬進 `backend/09-file.md`「CDN」一節的設計決策章。

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | 金鑰、密鑰、CDN 網址、回源位址留在環境變數；畫面只顯示 kid 與一致性 | 必須與邊緣容器一致；放進 DB 會製造「api 改了、邊緣沒改」的不一致，邊緣也要多依賴 api | 畫面管理金鑰、邊緣向 api 取金鑰 |
| D2 | 兩層：環境變數是能力、上限與預設值；平台 DB 是執行期覆寫。沒有列時行為與現在相同 | 上線不改變行為；事故時不必重新部署 | 全部搬進 DB：部署層的能力無法表達；維持全部環境變數：事故時要重啟 |
| D3 | 執行期關閉不停止清理；清理只看環境變數層與自動清理的設定 | 邊緣還在、舊網址還有效；持續清理讓再次開啟不需要清空快取 | 關閉時一併停止清理 |
| D4 | 開啟與加入資源類型前必須通過節點檢查（連線、清理密鑰、kid），不提供強制略過；關閉不檢查 | 這三項不成立時開啟必定破圖；緊急情況需要的是關閉 | 允許強制開啟 |
| D5 | `operator` 有 `cdn:update`、`cdn:purge`；`cdn:purgeAll` 只給 `super-admin` | 值班要能處理事故；清空快取影響整個平台 | 全部只給 `super-admin` |
| D6 | 不做依租戶開關 | 同 [`backend/09-file.md`](../architecture/backend/09-file.md) §17 D9；資源類型已足以逐步開放 | 比照 MFA 的兩級覆寫 |
| D7 | 檢查用不存在的路徑，靠邊緣的 `X-CDN-Reject` 區分邊緣拒絕與源站回應 | 不需要任何租戶的物件，也不在快取留下內容 | 在某個 bucket 放一個檢查用的物件：要選一個租戶、維護那個物件 |
| D8 | 定期檢查 `cdn.healthCheck` 每 5 分鐘（`FILE_CDN_HEALTH_CHECK_CRON`）；任一節點 `cdn_edge_up = 0` 持續 10 分鐘、kid 不一致時告警，竄改的簽章沒被拒絕時立即告警 | 金鑰輪替與節點故障要在使用者看到破圖之前發現；10 分鐘避開節點重啟的短暫中斷 | 只靠手動檢查：故障要等有人回報；每分鐘檢查：多數情況下沒有差別，徒增請求與紀錄 |

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/09-file.md` 的「CDN」一節：新增「設定的兩層與生效值」「狀態與檢查」「手動清理」，設計決策併入該節的決策章
- `docs/architecture/frontend/` 不另開一份：apps/platform 的頁面寫進 [`apps/platform/README.md`](../../apps/platform/README.md) 的頁面清單
- `docs/architecture/iam/02-permission-catalog.md` §8：`cdn:*`
- `docs/architecture/01-system.md` §4.4：廣播頻道 `cdn_settings`
- `docs/architecture/08-monitoring.md`：邊緣的指標與告警
