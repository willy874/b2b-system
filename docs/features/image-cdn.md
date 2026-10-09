# 圖片的 CDN（本機以 nginx 模擬）

- 優先度：P3
- 狀態：規劃中
- 依賴：[`image-delivery.md`](./image-delivery.md)（`ObjectUrlSigner`：CDN 是它的一個實作；每個物件只寫一次）、
  獨立的檔案網域（[`backend/09-file.md`](../architecture/backend/09-file.md) §3.2、§13）、影像 API（[`backend/09-file.md`](../architecture/backend/09-file.md) §5.4）、
  背景工作（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)；清理快取的 `cdn.purge`）
- 相關：[`image-picker.md`](./image-picker.md)（圖片資產）、[`image-gallery.md`](./image-gallery.md)（圖片最多的頁面）；
  部署（[`01-system.md`](../architecture/01-system.md) §4.3、`deploy/k8s/`）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

圖片之後會出現在大多數頁面上，例如使用者列表、留言、審批的頭像，以及圖片庫（[`image-picker.md`](./image-picker.md)、[`image-gallery.md`](./image-gallery.md)）。
現在每張圖的讀取路徑是：

```
<img src="/api/files/:id/image/:variant?exp&sig">
  → api：驗 HMAC → 查 DB → 簽 presigned 網址 → 302
  → 檔案網域（nginx）→ file-storage：驗 SigV4 → 讀磁碟
```

規模變大後，這條路徑有三個問題：

1. **沒有共用的快取**：302 與物件回應都是 `Cache-Control: private`（`S3ObjectStorage.presignDownload` 的 `ResponseCacheControl`），
   只有單一瀏覽器的快取。100 個使用者看同一張頭像，儲存服務就送 100 次。
2. **presigned 網址不能拿來當快取的 key**：SigV4 的簽章與簽章時間都在 query string 裡。雖然 `stableSigningDate` 讓同一個時間窗內的網址相同，
   但每個時間窗（`FILE_URL_TTL / 2`，預設 450 秒）都會換一次。如果 CDN 把整個網址當 key，每個時間窗都要重新回源抓一次。
3. **現在還不能使用線上的 CDN**：選定 CloudFront、Cloudflare 等服務之前，api 與部署的改動沒有地方驗證。

所以這一版用 nginx **自架 CDN 的邊緣**：本機與 CI 用它驗證行為，單一區域的正式部署也可以直接用它（D7）。
api 端「簽 CDN 網址」與「清理快取」都做成抽象，之後換成真正的 CDN 只換實作與設定；整個功能以環境變數開關，預設關閉。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| `cdn` 容器（nginx ＋ njs）：驗網址簽章、邊緣快取、以內部憑證回源、清理快取的內部端點 | 串接真正的 CDN 服務（CloudFront、Cloudflare）；只留介面 |
| api 的 `CdnUrlSigner`（`ObjectUrlSigner` 的實作，[`image-delivery.md`](./image-delivery.md) §9） | 一般檔案的下載（`url`、`downloadUrl`；D4） |
| api 的 `CdnPurger` 與背景工作 `cdn.purge`：物件永久刪除後清理邊緣快取（§7） | 多個區域、地理分散、延遲的量測 |
| 以環境變數開關（`FILE_CDN_ENABLED`，預設 `false`）與一組參數（§6） | 依租戶開關（D9） |
| file-storage 的回源憑證：只接受 `GET`／`HEAD`，只在內部網路有效 | `files/<id>` 原檔（可能是任何類型，型別政策另外處理） |
| 驗證腳本 `deploy/check-cdn.sh`：命中、簽章、過期、方法限制、清理 | 邊緣命中率進 Grafana（D6） |
| 範圍限於 **只寫一次的物件**：圖片資產（`images/`）、圖片庫（`gallery/` 的變體）、檔案的影像變體（`variants/`） | |

## 使用者故事

**作為維運，我希望在選定 CDN 服務之前，就能在本機驗證「圖片由邊緣快取送出」的整條路徑，以便之後換成真正的 CDN 時只改設定。**

- **Given** 以 `docker-compose.cdn.yml` 疊加啟動，api 設定 `FILE_CDN_ENABLED=true` 與簽章金鑰
- **When** 兩個不同的使用者先後打開同一頁使用者列表
- **Then** 第一個人的頭像回應是 `X-Cache-Status: MISS`，第二個人是 `HIT`，file-storage 只收到一次讀取

**作為租戶管理者，我希望圖片走 CDN 之後，拿不到網址的人仍然讀不到內容。**

- **Given** 一張只有某資料夾成員看得到的圖片
- **When** 有人竄改網址的路徑、拿過期的網址，或拿別的租戶的物件路徑套用同一個簽章
- **Then** 邊緣回 `403`，不會從快取送出內容

**作為租戶管理者，我希望永久刪除的圖片不會繼續留在 CDN 上。**

- **Given** 一張頭像已經被邊緣快取
- **When** 它在回收桶的保留期限後被永久刪除
- **Then** 物件刪除之後，背景工作清掉每一個邊緣節點上的快取；即使有人還留著未過期的網址，也只會拿到 `404`

**作為維運，我希望 CDN 出問題時能立刻關掉，而不必改程式。**

- **Given** CDN 已啟用
- **When** 把 `FILE_CDN_ENABLED` 改成 `false` 並重啟 api
- **Then** 新的回應立刻改回 presigned 網址；已經發出的 CDN 網址在效期內仍然有效（邊緣繼續運作到最長效期過去）

**作為開發者，我希望沒有啟用 CDN 時，本機開發完全不受影響。**

- **Given** 沒有設定 `FILE_CDN_*`
- **When** 照常執行 `pnpm dev`
- **Then** 影像 API 與圖片資產的網址照舊是 presigned，行為與現在相同；清理快取的背景工作不入列

## 初步構想

### 1. 讀取路徑（啟用 CDN 之後）

```
圖片資產、圖片庫（image-delivery.md D1：回應直接帶網址）
  <img src="https://cdn…/storage/<bucket>/images/<id>/r3/sm@2x.webp?exp&kid&sig">
                                                  │
檔案的影像變體（影像 API 不變）                   │
  <img src="/api/files/:id/image/:variant?exp&sig">│
    → api：驗 HMAC → 查 DB → CdnUrlSigner → 302 ──┤
                                                  ▼
  cdn（nginx ＋ njs）：驗 CDN 簽章 → 以路徑查快取
        ├─ HIT  → 直接送出
        └─ MISS → 帶回源憑證向 file-storage 讀取 → 存進快取 → 送出
```

- **前端不改**：影像 API 的契約不變；圖片資產與圖片庫的 `ImageSources` 本來就是完整網址，只是換成 CDN 的網域。
- **格式不在邊緣協商**：圖片資產與圖片庫由 `<picture>` 選格式（[`image-delivery.md`](./image-delivery.md) D2）；檔案的 `format=auto` 由 api 決定之後，
  CDN 網址已經指向某一個格式的物件。所以邊緣的快取 **不必 `Vary: Accept`**。
- **快取的 key 是物件路徑**（`/storage/<bucket>/<key>`），不含簽章。bucket 一個租戶一個（[`backend/09-file.md`](../architecture/backend/09-file.md) §3.1），
  所以不同租戶的物件不會共用快取。

### 2. CDN 網址與簽章

```
<FILE_CDN_ORIGIN>/storage/<bucket>/<key>?exp=<unix 秒>&kid=<金鑰 id>&sig=<base64url(HMAC-SHA256(金鑰, exp + "\n" + 路徑))>
```

- **演算法 HMAC-SHA256，由 njs 驗證**（D1）：與正式 CDN 的強度相當；`secure_link_md5` 不採用。
- **簽的內容**：`exp` 與完整路徑（含 bucket）。換路徑、換 bucket、改 `exp` 都驗不過；`kid` 只用來選金鑰，換掉也驗不過。
- **金鑰環**：`FILE_CDN_SIGNING_KEYS` 的格式與 `JWT_SIGNING_KEYS` 相同（`<kid>:<base64>[,…]`），**第一把簽發，全部都能驗證**。
  輪替：把新金鑰加到第一個 → 重啟 api 與 cdn → 等最長效期（`FILE_CDN_MAX_URL_TTL`）過去 → 移除舊金鑰。
- **效期**：用途的 `urlTtl`（[`image-delivery.md`](./image-delivery.md) D3），以 `FILE_CDN_MAX_URL_TTL` 封頂；檔案的影像變體用 `FILE_URL_TTL`。
  `exp` 取整到效期一半的時間窗，同一個時間窗內網址相同，瀏覽器快取照樣命中；快取的 key 不含簽章，效期長短不影響邊緣的命中率（D2）。
- **`CdnUrlSigner`**（`core/storage`）：`NginxCdnUrlSigner` 是這一版唯一的實作；之後的 `CloudFrontUrlSigner`、`CloudflareUrlSigner` 只是新的實作，呼叫端不變。
- **哪些物件走 CDN**：呼叫端在簽網址時標 `{ cdn: '<資源類型>' }`（`imageAsset`、`galleryItem`、`fileVariant`），
  再由 `FILE_CDN_RESOURCES` 過濾——可以先只開 `fileVariant` 驗證，再逐步打開（D5）。`core/storage` 不認識業務前綴。

### 3. 邊緣：`deploy/nginx.cdn.conf`

| 設定 | 作用 |
| --- | --- |
| `js_import cdn.js` ＋ `js_set $cdn_valid cdn.verify` | 驗 `sig`、`exp`、`kid`；不符或過期一律回 `403`（與影像 API 一致，不另回 `410`） |
| `proxy_cache_path /var/cache/cdn levels=1:2 keys_zone=cdn:50m max_size=${CDN_CACHE_MAX_SIZE} inactive=${CDN_CACHE_INACTIVE} use_temp_path=off` | 快取的位置與上限；`max_size` 滿了以 LRU 淘汰、`inactive` 期間沒被讀過的自動刪除（§7.5） |
| `proxy_cache_key $uri` | 快取的 key 只有路徑（清理時以同一個 key 算出檔案位置，§7.3） |
| `proxy_ignore_headers Cache-Control Expires Set-Cookie` ＋ `proxy_cache_valid 200 ${CDN_CACHE_VALID}` | 源站回 `private` 也照樣快取；物件只寫一次，所以可以放長。`404` 不快取 |
| `proxy_cache_lock on` | 同一個物件同時 MISS 時只回源一次 |
| `add_header X-Cache-Status $upstream_cache_status` | 驗證與觀察命中率 |
| 只開 `GET`／`HEAD`；`sandbox` CSP、`nosniff`、`Cross-Origin-Resource-Policy: cross-origin` | 沿用檔案網域的安全標頭（[`backend/09-file.md`](../architecture/backend/09-file.md) §13 D4、D5），由 `nginx.security-headers.conf` 共用 |
| 回應的 `Cache-Control: public, max-age=<exp − 現在>, immutable` | 由邊緣依網址的剩餘效期決定；不沿用源站的 `private` |
| 回源時清掉 `Cookie`／`Authorization`，帶上 `X-Origin-Auth` | 見 §4 |
| 第二個 `server`（`${CDN_PURGE_PORT}`，只在內部網路）：`/_purge`、`/_purge/all` | 清理快取（§7.3） |

- **本機**：`docker-compose.cdn.yml`。dev 的 file-storage 是主機上的 node 程序（`pnpm dev:storage`，:9000），
  所以 `cdn` 容器以 `host.docker.internal:9000` 回源，對外開 `:9080`、清理端點只綁 `127.0.0.1:8081`；指令 `pnpm cdn:up`／`cdn:down`，與 `monitoring:up` 同一個形式。
- **正式 compose**：疊加在 `docker-compose.prod.yml` 上，快取目錄掛 named volume；backstage 映像的 CSP `img-src` 加上 CDN 的 origin（`CDN_PUBLIC_ORIGIN`）。
  `deploy/smoke-test.sh --cdn` 一併驗證。
- **k8s**：`deploy/k8s` 加 `cdn` 的 Deployment（快取用有大小上限的 `emptyDir`）、對外的 Service，以及給清理用的 **headless Service**（解析到每一個 pod，§7.4）。

### 4. 回源憑證（file-storage）

nginx 無法自己算 SigV4，所以 file-storage 另外接受一種回源請求：

- 新的環境變數 `FILE_STORAGE_ORIGIN_SECRET`（選填）。設定時，帶 `X-Origin-Auth: <secret>` 的 `GET`／`HEAD` **不必** SigV4；
  其他方法即使帶了這個標頭也照舊要 SigV4。
- 比對以常數時間進行；`/storage/` 對外的 nginx（租戶網域、檔案網域）**一律清掉** 這個標頭，所以從外面帶進來無效。
- 換成 S3／MinIO 時改用儲存服務自己的做法（CloudFront 的 OAC、MinIO 的 bucket policy），這個標頭只屬於 apps/file-storage。

### 5. 開關的行為

| 狀態 | api | 邊緣 |
| --- | --- | --- |
| `FILE_CDN_ENABLED=false`（預設） | `ObjectUrlSigner` 用 presigned；`CdnPurger` 是 no-op，`cdn.purge` 不入列；`FILE_CDN_*` 其他變數被忽略（不檢查） | 不需要存在 |
| `true` | `FILE_CDN_RESOURCES` 內的資源改簽 CDN 網址；物件刪除後入列 `cdn.purge` | 必須在服務中 |

- **由關到開**：設定變數 → 確認 `cdn` 容器已啟動（`check-cdn.sh` 通過）→ 重啟 api 的所有角色。
  如果先前開過、關掉的時間 **短於** `FILE_CDN_MAX_URL_TTL`，先執行 `cli:cdn-purge --all`：關掉期間的刪除沒有清理快取（§7.6）。
- **由開到關**：設定 `false` → 重啟 api。新的回應立刻改回 presigned 網址；已發出的 CDN 網址在效期內仍會被使用，
  所以 **邊緣要繼續運作到 `FILE_CDN_MAX_URL_TTL` 過去** 才能停掉。
- **只能整個部署一起開關**，不能依租戶（D9）；開關需要重啟（環境變數在程序啟動時讀取並驗證）。
- api 的就緒檢查 **不** 依賴 CDN：CDN 掛掉時圖片讀不到，但 api 照常服務；以 §8 的指標與告警發現。

### 6. 參數

**api（`env.schema.ts`）**

| 變數 | 預設 | 範圍／格式 | 說明 |
| --- | --- | --- | --- |
| `FILE_CDN_ENABLED` | `false` | 布林 | 總開關（§5） |
| `FILE_CDN_PROVIDER` | `nginx` | `nginx` | 簽章與清理的實作；之後加 `cloudfront`、`cloudflare` |
| `FILE_CDN_ORIGIN` | — | URL；production 必須是 `https` | 瀏覽器看到的 CDN origin（例 `http://localhost:9080`） |
| `FILE_CDN_SIGNING_KEYS` | — | `<kid>:<base64>[,…]`，每把 ≥ 32 bytes | 金鑰環，第一把簽發（§2） |
| `FILE_CDN_RESOURCES` | `imageAsset,galleryItem,fileVariant` | 逗號分隔的資源類型 | 哪些資源走 CDN；用於逐步開放（D5） |
| `FILE_CDN_MAX_URL_TTL` | `86400` | 300–86400 秒 | CDN 網址效期的上限；也是「關掉後邊緣要再運作多久」「金鑰輪替要等多久」的依據 |
| `FILE_CDN_PURGE_ON_DELETE` | `true` | 布林 | 物件永久刪除後是否清理快取（§7）；真正的 CDN 依清理次數計費時可以關掉，改靠網址過期 |
| `FILE_CDN_PURGE_URL` | — | URL（內部網路） | 清理端點，例 `http://cdn-purge:8081`；主機名稱解析到多個位址時逐一呼叫（§7.4）。`PURGE_ON_DELETE=true` 時必填 |
| `FILE_CDN_PURGE_SECRET` | — | base64，≥ 32 bytes | 清理請求的 HMAC 金鑰；`PURGE_ON_DELETE=true` 時必填 |
| `FILE_CDN_PURGE_BATCH_SIZE` | `100` | 1–1000 | 一次清理請求最多幾個路徑；一筆 `cdn.purge` 工作的上限 |
| `FILE_CDN_PURGE_TIMEOUT_MS` | `5000` | 500–60000 | 單一節點的清理請求逾時 |

- `FILE_CDN_ENABLED=true` 時，缺必填、格式不對、金鑰太短 → **程序啟動失敗**（與其他金鑰的檢查相同，`ProductionEnvSchema`）；
  `false` 時不檢查其他 `FILE_CDN_*`，留著舊值也不影響。
- 對外 API 的程序也會簽圖片網址（回應帶 `ImageSources`），所以 `FILE_CDN_ENABLED`、`ORIGIN`、`SIGNING_KEYS`、`RESOURCES`、`MAX_URL_TTL` 兩個程序都要有；
  清理只在 worker 角色執行，`PURGE_*` 只有內部 api 需要。

**邊緣（`cdn` 容器，以 `envsubst` 套進設定與 njs）**

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `CDN_SIGNING_KEYS` | — | 與 api 的 `FILE_CDN_SIGNING_KEYS` 相同的值 |
| `CDN_PURGE_SECRET` | — | 與 `FILE_CDN_PURGE_SECRET` 相同的值 |
| `CDN_ORIGIN_UPSTREAM` | `http://file-storage:9000` | 回源的位址（本機是 `http://host.docker.internal:9000`） |
| `CDN_ORIGIN_SECRET` | — | 與 file-storage 的 `FILE_STORAGE_ORIGIN_SECRET` 相同的值 |
| `CDN_CACHE_MAX_SIZE` | `10g` | 快取的磁碟上限 |
| `CDN_CACHE_INACTIVE` | `30d` | 多久沒被讀取就刪除 |
| `CDN_CACHE_VALID` | `30d` | 快取的有效期（物件只寫一次，所以可以等於 `inactive`） |
| `CDN_LISTEN_PORT` / `CDN_PURGE_PORT` | `9080` / `8081` | 對外與清理的埠；清理埠不得對外開放 |

**其他**：file-storage 的 `FILE_STORAGE_ORIGIN_SECRET`；backstage 映像的 `CDN_PUBLIC_ORIGIN`（CSP 的 `img-src`）。
`.env.example`、`deploy/prod.env.example`、`deploy/fake-prod-env.mjs` 一併更新。

### 7. 清理機制

#### 7.1 什麼時候要清

快取的內容只會在「有人拿著未過期的有效網址」時被送出；物件刪除之後 api 不再簽出它的網址。
所以不清理的話，被刪掉的圖最多在 **網址的剩餘效期內**（頭像最長 12 小時）仍讀得到，而且邊緣的磁碟要等 `inactive` 才釋出。清理是為了把這段時間縮到幾秒：

| 事件 | 清哪些路徑 | 由誰排入 |
| --- | --- | --- |
| 圖片資產被清除（沒被認領、`detached_at` 過期） | 主檔與所有版本的變體 | `image.maintenance` |
| 圖片資產重新裁切後，舊版本的變體被刪除 | 舊 `r<rev>/` 底下的變體 | `image.maintenance` |
| 圖片庫的圖片被永久刪除、舊版本的變體被刪除 | 變體（原檔不走 CDN） | `trash.purge`、`gallery.maintenance` |
| 檔案被永久刪除 | `variants/<id>/` 底下所有格式 | `trash.purge`（`FileObjectsService.deleteAll` 之後） |
| 公開網址被撤銷（第二批，[`image-delivery.md`](./image-delivery.md) §8） | `public/…` 的那個版本 | 擁有者模組；公開網址沒有效期，**必須** 清 |
| 緊急下架（法律要求、誤傳個資） | 指定的路徑或整個快取 | 維運以 `cli:cdn-purge` 手動執行 |

**不清** 的情況：

- **軟刪除（移到回收桶）**：物件保留以便還原，與現在 presigned 網址的語意相同；要立即下架就用 CLI。
- **授權變更**（資料夾中斷繼承、移除角色）：已發出的網址本來就有效到 `exp`，與現在相同。
- **刪除租戶**（`db:drop-tenant`）：bucket 整個刪除，沒有新的網址能簽出，舊網址在最長效期內過期；快取由 `inactive` 淘汰。

#### 7.2 流程：先刪物件，再清快取

```
擁有者模組刪除物件（交易後，既有的流程）
  → CdnPurger.schedule(paths)          ← FILE_CDN_ENABLED=false 或 PURGE_ON_DELETE=false 時直接返回
       依 FILE_CDN_PURGE_BATCH_SIZE 分批，入列 cdn.purge { paths }
  → worker：cdn.purge
       解析 FILE_CDN_PURGE_URL 的所有位址 → 逐一 POST /_purge（各自逾時 FILE_CDN_PURGE_TIMEOUT_MS）
       全部成功 → 完成；任一節點失敗 → 整筆重試（清理是冪等的）
```

- **順序很重要**：一定是物件刪除 **之後** 才清快取。反過來的話，清完到刪除之間若有人用有效網址讀取，邊緣會重新回源、把即將刪除的內容再存一次。
  所以 `schedule` 在物件刪除成功後才呼叫，不在交易內以 outbox 入列（outbox 可能在刪除完成前就被執行）。
- **入列失敗或工作最終失敗**：只記 error 與指標（§8），不影響刪除本身；最壞的情況是內容在剩餘效期內仍可讀，與沒有清理相同。
  公開網址的撤銷例外：撤銷的工作自己依序做「刪物件 → 清快取」，失敗時告警。
- **重試**：`cdn.purge` 的 `retryLimit` 5、指數退避（30 秒起），沿用 `defineJob` 的設定（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）；
  不受租戶的 `job.maxConcurrency` 以外的限制。
- **路徑由擁有者模組列出**：物件只寫一次，擁有者知道每一個物件的完整 key（主檔、每個 preset 的 1x／2x、每種格式），所以清理用 **明確的路徑清單**，
  不需要「依前綴清理」——自架的 nginx 也做不到有效率的前綴清理。

#### 7.3 邊緣的清理端點（njs）

nginx 開源版沒有 `proxy_cache_purge`，但快取檔案的位置可以由 key 算出來：`/var/cache/cdn/<md5 的最後 1 碼>/<倒數第 2–3 碼>/<md5>`（`levels=1:2`）。

| 端點 | 本體 | 行為 |
| --- | --- | --- |
| `POST /_purge` | `{ paths: string[], ts }` | 驗 `X-Purge-Signature`（`HMAC-SHA256(CDN_PURGE_SECRET, ts + "\n" + 本體)`，`ts` 與現在相差 5 分鐘內）→ 對每個路徑算出快取檔位置並刪除（不存在視為成功）→ `200 { purged, missing }` |
| `POST /_purge/all` | `{ ts }` | 同樣驗簽章 → 清空整個快取目錄 → `200` |

- 只在 `CDN_PURGE_PORT` 上提供，對外的 server 沒有這兩個路徑；compose 與 k8s 都不對外開放這個埠。
- `ts` 與簽章防止重放；本體上限 1 MiB（1000 個路徑）。
- 真正的 CDN：`CloudFrontPurger` 呼叫 `CreateInvalidation`、`CloudflarePurger` 呼叫 purge by URL；批次大小與速率限制由實作處理，`schedule` 的呼叫端不變。

#### 7.4 多個邊緣節點

每個 `cdn` 實例各有自己的快取，清理必須送到 **每一個** 實例：

- `FILE_CDN_PURGE_URL` 的主機名稱解析到多個位址時，`cdn.purge` 對每個位址都送一次（帶原本的 `Host`）。
- k8s 用 headless Service（`cdn-purge`）讓 DNS 回傳每個 pod 的位址；compose 的 `deploy.replicas` 以服務名稱解析也會得到全部容器。
- 擴容中新起的實例快取是空的，不需要清；縮容時被移除的實例連同快取一起消失。

#### 7.5 磁碟的清理

與刪除無關、平常就在運作的淘汰：`CDN_CACHE_MAX_SIZE` 滿了由 nginx 的 cache manager 以 LRU 刪除，`CDN_CACHE_INACTIVE` 期間沒被讀過的自動刪除。
快取目錄是 volume（compose）或有上限的 `emptyDir`（k8s），容器重建時快取可以遺失，不影響正確性。

#### 7.6 關掉期間的刪除

`FILE_CDN_ENABLED=false` 時 `CdnPurger` 是 no-op。若之後重新打開，而關掉的時間短於 `FILE_CDN_MAX_URL_TTL`，
關掉前發出的 CDN 網址可能還沒過期，指向的物件卻可能已在關掉期間被刪除——所以重新打開前要 `cli:cdn-purge --all`（§5）。

#### 7.7 手動清理：`cli:cdn-purge`

```bash
pnpm --filter @b2b-system/api cli:cdn-purge --tenant <代碼> --path images/<id>/r3/sm.webp [--path …]
pnpm --filter @b2b-system/api cli:cdn-purge --tenant <代碼> --image-asset <id>    # 由 api 列出該資產的所有路徑
pnpm --filter @b2b-system/api cli:cdn-purge --all [--confirm]
```

- 同步執行（不經佇列），逐節點顯示結果；`--all` 不加 `--confirm` 只顯示會影響哪些節點。
- 寫平台稽核 `cdn.purge`（操作者是執行指令的系統帳號，`changes.after` 帶路徑數或 `all`），與 `cli:reset-super-admin` 相同的模式。

### 8. 指標與告警

- `core/metrics/instruments.ts` 加：`cdn_purge_requests_total{result="ok|error|timeout"}`（每個節點一次）、`cdn_purge_paths_total`、
  `cdn.purge` 工作沿用背景工作的通用指標（[`08-monitoring.md`](../architecture/08-monitoring.md) §2.4）。標籤不帶租戶。
- 告警：`cdn.purge` 最終失敗的比率持續大於 0（清理壞了，刪除的圖會留到過期）。
- 邊緣的命中率：這一版只看 `check-cdn.sh` 與存取紀錄的 `$upstream_cache_status`，不進 Grafana（D6）。

### 9. 驗證：`deploy/check-cdn.sh`

與 `check-nginx.sh` 同一個形式（需要 Docker，CI 的 deploy job 也跑）：

| 案例 | 預期 |
| --- | --- |
| 同一個網址請求兩次 | 第一次 `MISS`、第二次 `HIT`；file-storage 的存取紀錄只有一筆 |
| 同一個物件、不同時間窗的網址 | 第二個網址也是 `HIT`（快取的 key 不含簽章） |
| 竄改路徑、竄改 `exp`、換 bucket、換 `kid` | `403`，不從快取送出 |
| 已過期的網址 | `403`（即使快取裡有） |
| 以第二把金鑰簽的網址（輪替中） | `200` |
| `PUT`／`DELETE`／`POST` 打對外的埠 | `405` |
| 從外面直接帶 `X-Origin-Auth` 打租戶網域的 `/storage/` | 標頭被清掉，照舊要 SigV4 |
| `/_purge` 打對外的埠 | `404` |
| `/_purge` 簽章錯誤、`ts` 超過 5 分鐘 | `403` |
| 刪除物件 → `/_purge` 該路徑 → 再以有效網址請求 | `MISS` 後源站回 `404`，邊緣不快取 `404` |
| 兩個 `cdn` 實例，`cdn.purge` 解析到兩個位址 | 兩邊的快取檔都被刪除 |
| 安全標頭 | `sandbox` CSP、`nosniff` 存在；沒有 `Set-Cookie` |

另外 api 的整合測試涵蓋：`FILE_CDN_ENABLED=false` 時網址是 presigned、`cdn.purge` 不入列；`true` 時網址是 CDN 格式、`FILE_CDN_RESOURCES` 的過濾、刪除後入列的路徑清單。

### 10. 會動到的既有模組

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/core/storage` | `CdnUrlSigner`（`ObjectUrlSigner` 的實作）、`CdnPurger` 與 no-op 實作；`env.schema.ts` 加 `FILE_CDN_*` 與 production 的檢查 |
| `apps/api/src/core/jobs` 或 `modules/file` | 背景工作 `cdn.purge`（`defineJob`；新增工作名稱要重產 openapi，兩個 app 補名稱） |
| `modules/file`、`modules/image`、`modules/gallery` | 簽網址時標 `{ cdn: '<資源類型>' }`；物件刪除後呼叫 `CdnPurger.schedule(paths)` |
| `apps/api/src/cli` | `cli:cdn-purge` |
| `apps/file-storage` | 回源憑證（`config.ts`、`auth/`） |
| `deploy/` | `nginx.cdn.conf`、`cdn.js`（njs：驗簽章、清理）、`docker-compose.cdn.yml`、`check-cdn.sh`、k8s 的 Deployment／Service／headless Service；對外的 nginx 清掉 `X-Origin-Auth`；CSP 加 `CDN_PUBLIC_ORIGIN` |
| `.env.example`、`deploy/prod.env.example`、`deploy/fake-prod-env.mjs` | 新的環境變數 |
| `package.json` | `cdn:up`／`cdn:down` |

- **權限**：不新增權限鍵。能不能拿到網址仍由原本的授權決定（`file:read`、圖片資產跟著擁有它的資源、`gallery:read`）。
- **稽核與推播**：自動的清理不寫稽核（它是刪除的附帶動作，刪除本身已有稽核）；手動清理寫平台稽核 `cdn.purge`。沒有新的領域事件。

## 開放問題

全部已有結論（2026-10-09，照提案的傾向定案；問題 2、5、8 依 [`image-delivery.md`](./image-delivery.md) 的決定）。決定的理由見下方「設計決策」。

1. **簽章演算法：`secure_link_md5` 還是 njs 的 HMAC-SHA256？**
   `secure_link` 內建只有 MD5（`md5(exp + uri + secret)`），設定最簡單，但 MD5 不適合當正式環境的簽章。
   njs 能做 HMAC-SHA256，與正式的 CDN 較接近，代價是多一個 js 模組與它的測試。
   傾向：如果 `cdn` 容器只用於本機與 CI，用 MD5；如果自架 nginx 也要當正式環境的邊緣（問題 7），用 njs。
   - **結論**：njs 的 HMAC-SHA256（問題 7 的結論是可以當正式方案；清理也需要 njs）（D1）。
2. **CDN 網址的效期與時間窗**：快取的 key 不含簽章，所以效期長短不影響命中率，只影響「網址外流之後多久失效」。
   要沿用 `FILE_URL_TTL`（預設 900 秒），還是像 [`image-picker.md`](./image-picker.md) 的用途一樣，由 usage 決定（頭像長、附件短）？
   - **結論**：由用途決定，以 `FILE_CDN_MAX_URL_TTL` 封頂；檔案的影像變體沿用 `FILE_URL_TTL`（D2）。
3. **刪除與立即失效**：物件被刪除之後，邊緣快取在 `proxy_cache_valid` 期間內仍有內容，只是沒有新的網址能讀到它（舊網址到 `exp` 為止仍然有效）。
   這與現在 presigned 網址的語意相同。需不需要「立即清除」？若需要（例如法律要求下架），本機以刪快取檔模擬，
   正式的 CDN 用它的 purge API，`CdnUrlSigner` 旁邊另加一個 `CdnPurger`。
   - **結論**：需要。`CdnPurger` ＋ 背景工作 `cdn.purge`，物件永久刪除後自動清理，另有手動的 `cli:cdn-purge`；以 `FILE_CDN_PURGE_ON_DELETE` 關閉自動清理（D3）。
4. **一般檔案的下載要不要也走 CDN？** `downloadUrl` 依檔名帶 `Content-Disposition`、依型別政策覆寫 `Content-Type`（[`backend/09-file.md`](../architecture/backend/09-file.md) §7.2），
   這些現在是 presigned 網址的 query 參數。走 CDN 的話，要把它們放進簽章並由邊緣設定回應標頭，快取的 key 不能把它們算進去。
   傾向：這一版不做；文件的下載量遠小於圖片。
   - **結論**：不做（D4）。
5. **範圍內的前綴由誰決定？** `core/storage` 不能認識 `images/`、`variants/` 這些業務前綴。
   做法一：擁有者模組在 `onModuleInit` 註冊「這個前綴的物件不可修改、可以走 CDN」；做法二：`presignDownload` 加一個選項 `{ cdn: true }`，由呼叫端決定。
   傾向做法二：比較直接，也不必多一個註冊表。
   - **結論**：做法二，選項帶資源類型（`{ cdn: 'imageAsset' }`），再由 `FILE_CDN_RESOURCES` 過濾（D5）。
6. **命中率要不要進 Grafana？** nginx 開源版沒有內建的快取指標；要嘛解析存取紀錄（例如以 Promtail／Loki，或 `nginx-prometheus-exporter` 加 log 解析），
   要嘛只在驗證腳本裡看。傾向：這一版只看驗證腳本與存取紀錄，接上真正的 CDN 後用它自己的儀表板。
   - **結論**：命中率不進 Grafana；api 端的清理指標要進（D6）。
7. **自架的 nginx 邊緣能不能直接當正式環境的方案？** 單一區域的部署裡，一台有快取的 nginx 已經能拿到「同一張圖只回源一次」的大部分好處。
   若答案是「可以」，問題 1 要選 njs，快取目錄要掛 volume 並設 `max_size`，`deploy/k8s` 也要有對應的 Deployment。
   - **結論**：可以，限單一區域（D7）。
8. **與 [`image-picker.md`](./image-picker.md) 的順序**：CDN 的前提是物件不可修改。現在的影像變體（`variants/`）已經符合，
   所以可以先做、只套用到檔案的變體。要先做來驗證設計，還是等圖片資產做完一起做？
   - **結論**：不必等。[`image-delivery.md`](./image-delivery.md) D6 抽出 `ObjectUrlSigner` 之後就可以進行，先以 `FILE_CDN_RESOURCES=fileVariant` 驗證（D8）。

## 設計決策

背景見「背景」一節。歸檔時整節搬進 `backend/09-file.md` 新的「CDN」一節之後的設計決策章。

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | **簽章用 HMAC-SHA256，邊緣以 njs 驗證**；金鑰環 `<kid>:<base64>`，第一把簽發、全部可驗 | 自架 nginx 要當正式方案（D7），MD5 不夠；清理端點也需要 njs（D3），不多一個依賴；金鑰環讓輪替不必停機 | `secure_link_md5`：只適合本機；單一金鑰：輪替時舊網址全部失效 |
| D2 | **CDN 網址的效期由用途決定**（[`image-delivery.md`](./image-delivery.md) D3），以 `FILE_CDN_MAX_URL_TTL`（預設 24 小時）封頂；檔案的影像變體沿用 `FILE_URL_TTL` | 快取的 key 不含簽章，效期只影響外流後多久失效；上限同時決定關閉後邊緣要運作多久、金鑰輪替要等多久 | 一律 `FILE_URL_TTL` |
| D3 | **物件永久刪除後清理邊緣快取**：`CdnPurger.schedule(paths)` 在物件刪除成功之後分批入列 `cdn.purge`；worker 送到每一個邊緣節點的內部端點；冪等、可重試，失敗不影響刪除。另有 `cli:cdn-purge`（路徑、資產、全部）；`FILE_CDN_PURGE_ON_DELETE=false` 可關閉自動清理 | 不清理時刪掉的圖在剩餘效期內（頭像最長 12 小時）仍讀得到；先刪物件再清快取，避免清完又被回源存回去；明確的路徑清單不需要前綴清理 | 只靠過期：公開網址（第二批）沒有效期，一定要能清；在交易內以 outbox 入列：可能在物件刪除前就執行 |
| D4 | **一般檔案的下載不走 CDN** | 檔名與型別政策在網址參數裡，每次不同；下載量遠小於圖片 | 把 `Content-Disposition` 簽進網址、由邊緣設定 |
| D5 | **呼叫端標資源類型**（`{ cdn: 'imageAsset' \| 'galleryItem' \| 'fileVariant' }`），`FILE_CDN_RESOURCES` 決定哪些真的走 CDN | `core/storage` 不認識業務前綴；資源類型讓維運可以逐步開放、出問題時只關掉一種 | 擁有者在 `onModuleInit` 登記前綴：多一個註冊表；只有布林 `{ cdn: true }`：不能逐步開放 |
| D6 | **邊緣命中率不進 Grafana**；api 端的清理指標與告警要進 `core/metrics` | nginx 開源版沒有快取指標，解析存取紀錄要多一套元件；清理失敗則是 api 自己能量到、而且需要被發現的問題 | `nginx-prometheus-exporter` ＋ log 解析 |
| D7 | **自架 nginx 可以當單一區域的正式方案**：compose 疊加檔掛 volume、k8s 的 Deployment 與 headless Service | 單一區域時一層有快取的 nginx 就拿到「同一張圖只回源一次」的大部分好處；多區域時換真正的 CDN，只換實作 | 只用於本機：正式環境要等選定 CDN 服務才有共用快取 |
| D8 | **不必等圖片資產**：`ObjectUrlSigner` 抽出後即可進行，先以 `FILE_CDN_RESOURCES=fileVariant` 套用到檔案的影像變體 | 檔案的變體已經符合「只寫一次」；早一點在真實流量上驗證邊緣與清理 | 等圖片資產做完一起上 |
| D9 | **以環境變數整個部署一起開關**（`FILE_CDN_ENABLED`，預設 `false`），需要重啟；不提供依租戶開關 | CDN 是部署層的基礎設施，與租戶買了什麼無關；關閉時的行為與現在完全相同，出問題可以立刻退回 | 可關閉的 feature 或 feature flag：讓每個請求都要判斷租戶，而且同一個邊緣快取會同時服務開與關的租戶，語意不清 |
| D10 | **api 的就緒檢查不依賴 CDN** | CDN 掛掉只影響圖片；讓 api 跟著不就緒會擴大成整個服務中斷 | 就緒檢查探測 CDN |

評估過、不採用的方案：

| 方案 | 不採用的理由 |
| --- | --- |
| CDN 直接快取 presigned 網址，key 忽略 query string | 簽章沒被驗證：任何人拿到路徑就能從快取讀到內容 |
| api 直接串流圖片並加上 `Cache-Control: public` | 與「內容不經過 api」的原則相反（[`backend/09-file.md`](../architecture/backend/09-file.md) §13 評估過的方案）；api 的頻寬與 event loop 被佔用 |
| nginx 以 njs 自己算 SigV4 回源 | 要在 nginx 裡實作 SigV4 並保管儲存服務的金鑰；回源憑證只需要「內部網路上的 CDN 能讀」 |
| Varnish 取代 nginx | 多一種要維護的元件；現有的 nginx 設定與安全標頭可以直接沿用；Varnish 的 ban 雖然方便，但 D3 的明確路徑清單不需要它 |
| 第三方模組 `ngx_cache_purge` | 要自己編 nginx；njs 算出快取檔位置後刪除就夠了 |
| 清理時以 `proxy_cache_bypass` 強制回源覆蓋 | 源站回 `404` 時舊的快取不會被取代，清不掉 |

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/09-file.md`：新的一節「CDN」（讀取路徑、簽章與金鑰環、開關與參數、清理機制）與設計決策；§3.2 的檔案網域改成指向它
- `docs/architecture/03-file-storage.md`：回源憑證
- `docs/architecture/01-system.md`：部署形態加上 `cdn` 疊加檔與 k8s 的 Deployment
- `docs/architecture/08-monitoring.md`：清理的指標與告警
- `CLAUDE.md`「常用指令」：`pnpm cdn:up`／`cdn:down`、`sh deploy/check-cdn.sh`、`cli:cdn-purge`
