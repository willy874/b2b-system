# 圖片的讀取與遞送

- 優先度：P2
- 狀態：規劃中
- 依賴：影像變體與影像 API（[`backend/09-file.md`](../architecture/backend/09-file.md) §5.4、§7.1、§13）、`core/storage`
- 相關：[`image-picker.md`](./image-picker.md)（圖片資產）、[`image-gallery.md`](./image-gallery.md)（圖片庫）、[`image-cdn.md`](./image-cdn.md)（CDN）——
  三份都依這份決定「存什麼、網址怎麼產生、效期多長、尺寸有哪些」

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。
>
> 這份整合了「檔案管理的圖片讀取 API」那一輪討論（2026-10-09）的結論：底層機制保留，
> 但圖片要大範圍使用之前，必須先定下引用方式、網址的產生與效期、尺寸的規則。

## 背景

### 現在的讀取路徑

```
<img src="/api/files/:id/image/:variant?exp&sig">
  → api：驗 HMAC → 查 DB（FileImageService.resolve）→ 簽 presigned 網址 → 302
  → 檔案網域（nginx）→ file-storage：驗 SigV4 → 讀磁碟
```

這套機制對檔案管理器是對的（[`09-file.md`](../architecture/backend/09-file.md) §5.4）：`<img>` 帶不了 access token、內容不經過 api、
簽章綁定租戶、網址在時間窗內固定讓瀏覽器快取命中、其他格式第一次被要求時才轉出。

### 圖片大範圍使用之後會出的問題

圖片之後會出現在使用者列表、留言、審批的每一列，還有圖片庫、富文本、email。三份提案（圖片資產、圖片庫、CDN）原本各自寫了網址怎麼產生，
彼此不一致；而且下面四件事三份都沒有處理完（這份統一處理，三份改成引用這裡）：

| # | 問題 | 會在哪裡出事 |
| --- | --- | --- |
| 1 | **簽章網址會過期，卻可能被存下來** | 富文本內嵌的圖、寄出的 email、對外 API 的回應、匯出的檔案：存的是網址，最長一小時（`FILE_URL_TTL` ≤ 3600）後就破圖 |
| 2 | **每張圖都打一次 api、查一次 DB** | 一頁 50 列、每列一個頭像 ＝ 50 次 api 請求 ＋ 50 次 DB 查詢；302 的快取是 `private`，每個使用者第一次都要付 |
| 3 | **效期一刀切** | 頁面開很久、查詢快取裡的舊資料、推播即時插入的留言都會拿到過期網址；每個功能各自處理破圖 |
| 4 | **尺寸沒有規則** | 各功能自己決定尺寸；若開放 `?w=` 任意寬度，會被拿來塞爆轉檔與儲存，快取的組合也會爆增 |

CDN（[`image-cdn.md`](./image-cdn.md)）能解決「沒有共用快取」，但它的前提是物件不可修改、網址由 api 簽成 CDN 的格式——
這兩件事也要在這一層先定好，CDN 之後才能直接接上。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 五條原則（§1）：存參照不存網址、物件只寫一次、網址在輸出時產生、具名尺寸、熱路徑不查 DB | 改動檔案管理器的影像 API（§10，D5） |
| `core/image` 的 `ImageUrlService`：由物件 key 直接簽出可用的網址集合（`ImageSources`），不經過 api 轉址 | 公開網址的實作（第二批，§8 只定設計） |
| 圖片資產與圖片庫都用它；api 的回應帶 `ImageSources`，前端以 `<picture>` 顯示 | AVIF（D2） |
| 效期由用途宣告（§4） | 串接 CDN（[`image-cdn.md`](./image-cdn.md)；這一層只留接口） |
| 具名尺寸與 2x（§6） | |
| 前端 `web-core` 的 `SignedImage`：`<picture>`、過期重抓、退路（§5） | |
| `core/storage` 的 `ObjectUrlSigner` 抽象：這一版只有 presigned 的實作，CDN 之後加一個實作 | |

## 初步構想

### 1. 五條原則

| # | 原則 | 落在哪裡 |
| --- | --- | --- |
| R1 | **存參照，不存網址**：資料庫、富文本、匯出、稽核、對外 API 的使用者存的永遠是 id（`image_asset_id`、`gallery_item_id`），網址只在輸出的當下產生 | consumer 的資料模型；富文本的圖片節點（§7） |
| R2 | **每個物件只寫一次**：主檔、原檔、變體寫完就不再改；要換內容就寫到新的 key | [`image-picker.md`](./image-picker.md) D12、[`image-gallery.md`](./image-gallery.md) D14 |
| R3 | **網址只由 `ImageUrlService` 產生**：效期、時間窗、簽章方式（presigned 或 CDN）集中在一處 | `core/image`（§3） |
| R4 | **尺寸是具名的 preset**，各附 2x；沒有任意寬度的參數 | 用途的宣告、圖片庫的固定尺寸（§6） |
| R5 | **讀圖的熱路徑不查 DB、不打 api**：回應裡的網址直接指向物件儲存（或 CDN），瀏覽器拿到就讀 | §3 |

### 2. 三種圖片的讀取路徑

| 圖片 | 物件 | 網址 | 這一版 |
| --- | --- | --- | --- |
| 檔案管理器的圖片 | `files/<id>`、`variants/<id>/…` | 影像 API（HMAC → 查 DB → 302） | **不變**（§10） |
| 圖片資產（頭像等） | `images/<id>/master.*`、`images/<id>/r<rev>/<preset>.<格式>` | `ImageUrlService` 直接簽 | 新 |
| 圖片庫 | `gallery/<id>/original`、`gallery/<id>/r<rev>/<尺寸>.<格式>` | `ImageUrlService` 直接簽；原檔下載另簽帶 `Content-Disposition` 的網址 | 新 |

圖片資產與圖片庫的物件是 **處理時一次產生好的**（R2），每個物件的 key、格式、尺寸在 DB 裡都有，組回應時就能算出全部網址；
不像檔案的影像 API 要在請求時查狀態、決定是否轉檔。所以這兩種圖片不需要中間那一跳。

### 3. `ImageUrlService` 與 `ImageSources`

```ts
// core/image/image-url.service.ts（示意）
interface ImageObjectSet {
  keyPrefix: string;                       // 'images/<id>/r3'、'gallery/<id>/r1'
  presets: Record<string, { width: number; height: number }>;   // 這一組有哪些尺寸（已含 @2x）
  formats: ImageFormat[];                  // 主格式在前，例 ['jpeg', 'webp']
  ttlSeconds: number;                      // 由用途決定（§4）
}

interface ImageSources {                   // 回應的 DTO，前端直接用
  src: string;                             // 主格式、預設尺寸
  srcSet: string;                          // 'url 1x, url 2x' 或 'url 480w, url 1280w'
  sources: Array<{ type: string; srcSet: string }>;   // 其他格式，給 <picture>
  width: number;
  height: number;
  expiresAt: string;                       // 最早到期的那個網址
}
```

- **簽章方式**：`core/storage` 新增抽象 `ObjectUrlSigner`；這一版只有 `PresignedUrlSigner`（現在的 `presignDownload`，含 `stableSigningDate` 的時間窗）。
  [`image-cdn.md`](./image-cdn.md) 的 `CdnUrlSigner` 是它的另一個實作，`ImageUrlService` 依設定選擇——呼叫端不必改。
- **一次簽一組**：同一張圖的所有尺寸與格式在同一個時間窗內簽出，`expiresAt` 一致；HMAC／SigV4 的簽章是純 CPU 運算，一頁 50 張圖的成本可以忽略。
- **不經過 api**（R5）：瀏覽器拿到的網址直接指向檔案網域；一頁 50 個頭像就是 50 個（可被快取的）物件請求，api 與 DB 一次都不用。
- **格式在處理時就產生**：主格式（progressive JPEG，有透明度用 WebP）＋ WebP 兩種；瀏覽器以 `<picture>` 自己選。
  不必依 `Accept` 協商，也不需要「第一次被要求時才轉」的路徑（D2）。
- 回應的 DTO 用同一個 zod schema `ImageSourcesSchema`，經 OpenAPI 產生前端型別；`null` 代表沒有圖片或還在處理。

### 4. 效期：由用途決定

| 用途 | `urlTtl` | 理由 |
| --- | --- | --- |
| `user.avatar` | 12 小時 | 低敏感、出現在每一頁；長效期讓頁面開一整天也不破圖 |
| 圖片庫（`gallery`） | 1 小時 | 有 `gallery:read` 才看得到；檢視器可能開很久，配合 §5 的重抓 |
| 之後的附件（審批、留言） | 15 分鐘 | 敏感；與 `FILE_URL_TTL` 預設相同 |

- 範圍 5 分鐘到 24 小時；時間窗是效期的一半（與 `stableSigningDate` 相同的做法），所以網址剩餘的效期介於 `ttl/2` 與 `ttl` 之間。
- 效期只決定「網址外流之後多久失效」，不影響快取命中：同一個時間窗內網址相同，CDN 的快取 key 也不含簽章（[`image-cdn.md`](./image-cdn.md) D2 依這張表，並以 `FILE_CDN_MAX_URL_TTL` 封頂）。
- presigned 網址的上限是 SigV4 的 7 天，24 小時在範圍內；`FILE_URL_TTL`（≤ 3600）只管檔案，不受影響。

### 5. 前端：`SignedImage`

`@b2b-system/web-core/image` 的 `SignedImage`，所有顯示 `ImageSources` 的地方都用它：

| 狀況 | 行為 |
| --- | --- |
| 正常 | 渲染 `<picture>`（`sources` ＋ `<img src srcSet sizes width height loading="lazy" decoding="async">`）；寬高讓版面不跳動 |
| 載入失敗（多半是網址過期） | 呼叫 `onExpired()` 一次——預設是讓擁有這筆資料的查詢失效（`invalidateResources`），重抓後拿到新網址自動重試 |
| 重抓後仍失敗 | 顯示退路：`fallback` prop（頭像退回名字縮寫、圖片庫退回主色色塊） |
| `sources` 是 `null` | 直接顯示退路（沒有圖片、或還在處理） |

- 同一個網址只觸發一次 `onExpired`，同一個查詢的多張圖合併成一次失效（微任務內去重），不會因為 50 張圖同時過期而重抓 50 次。
- 只在失敗時才反應，不依 `expiresAt` 主動重抓：已經顯示出來的圖不需要新網址。長時間開著而且會繼續載入新圖的頁面
  （圖片庫的無限捲動、檢視器的預先載入）才依 `expiresAt` 在到期前重抓，與檔案管理器「失效前 60 秒重抓」相同。
- `Avatar`（`@b2b-system/ui`）加 `image` 插槽，web-core 以 `SignedImage` 填入；`ui` 不認識 `ImageSources`（下層 package 不 import 上層）。

### 6. 尺寸：具名 preset 與 2x

| 誰 | 宣告 | 產生的物件 | `srcSet` |
| --- | --- | --- | --- |
| 圖片資產 | 用途的 `presets`，例 `user.avatar`：`{ sm: 32, md: 96, lg: 256 }`（長邊 px） | 每個 preset 一份 1x、一份 2x（`sm`、`sm@2x`…；2x 與另一個 preset 相同時共用） | 密度描述：`sm 1x, sm@2x 2x` |
| 圖片庫 | 固定的四種：`thumb` 480、`medium` 1280、`large` 2560、`original` | 前三種各兩個格式 | 寬度描述：`thumb 480w, medium 1280w`，搭配 `sizes` |

- **沒有 `?w=`**（R4）：所有尺寸在處理時就產生；新增一種尺寸是改用途的宣告並補產生，不是開放參數。
- 尺寸不超過主檔：主檔不夠大時 2x 就是主檔的尺寸，不放大。
- 前端以 preset 名稱選圖（`<SignedImage sources={user.avatar} preset="sm">`），不寫死像素。

### 7. 持久化的內容：只存參照（R1）

| 內容 | 存什麼 | 輸出時 |
| --- | --- | --- |
| consumer 的欄位（頭像） | `avatar_image_id` | 回應帶 `avatar: ImageSources` |
| 富文本的內嵌圖片（第二批） | 圖片節點 `{ type: 'image', attrs: { assetId, alt } }`；`packages/rich-text` 的 schema 不允許節點帶網址 | api 讀取時把節點展開成 `ImageSources`；轉 HTML 時由呼叫端提供網址解析器 |
| email | 不存 | 寄送時產生公開網址（§8，D4）；email 放圖排在第二批 |
| 對外 API | 不存 | 回應帶 `ImageSources` 與 `expiresAt`；文件寫明「網址會過期，要用時重新取得」 |
| 匯入／匯出 | 資產 id | 不輸出網址 |
| 稽核 | 資產 id 與來源 | — |

### 8. 公開網址（第二批，這裡先定設計）

登入頁的 Logo、email 裡的圖拿不到新網址，需要 **不過期、可長期快取** 的網址。建議做法：

```
用途宣告 visibility: 'public'
  → 處理時把變體 額外 寫一份到 public/<tenantId>/<assetId>/r<rev>/<preset>.<格式>
  → 網址：<檔案網域>/storage/<bucket>/public/…（不帶簽章）
  → file-storage／CDN 只對 public/ 前綴允許不帶簽章的 GET
```

- 物件只寫一次（R2）、路徑含 uuid 與 rev，所以可以 `Cache-Control: public, max-age=31536000, immutable`。
- 撤銷 ＝ 刪除那個 rev 的 `public/` 物件，再清理 CDN 快取（公開網址沒有效期，一定要清；[`image-cdn.md`](./image-cdn.md) §7.1）。
- 這一版只在用途上留 `visibility`（[`image-picker.md`](./image-picker.md) D6），不實作。

### 9. CDN 怎麼接上

```
ImageUrlService ──▶ ObjectUrlSigner
                      ├─ PresignedUrlSigner（這一版）
                      └─ CdnUrlSigner（image-cdn.md）：FILE_CDN_ENABLED=true、呼叫端標 { cdn: '<資源類型>' } 且該類型在 FILE_CDN_RESOURCES 內時使用
```

- 圖片資產與圖片庫的物件都符合「只寫一次」，分別標 `{ cdn: 'imageAsset' }`、`{ cdn: 'galleryItem' }`；原檔下載（帶 `Content-Disposition`）不標（[`image-cdn.md`](./image-cdn.md) D4、D5）。
- CDN 網址的效期用 §4 的 `urlTtl`（再以 `FILE_CDN_MAX_URL_TTL` 封頂）。
- 開關與參數、刪除時的快取清理（`CdnPurger`）都在 [`image-cdn.md`](./image-cdn.md) §6、§7；`FILE_CDN_ENABLED=false`（預設）時這一層的行為與沒有 CDN 完全相同。
- 回應直接帶 CDN 網址，所以 [`image-cdn.md`](./image-cdn.md) §1 的「影像 API 302 到 CDN」只剩檔案管理器的圖片會用到。

### 10. 檔案管理器的影像 API

這一版 **不動**：它要處理「變體還沒好」「依 `Accept` 協商」「第一次被要求時才轉檔」，請求時查 DB 是合理的；而且只有檔案管理器在用。

之後若檔案的圖片也大量出現在其他頁面，可以把 `variant_format` 與 `variant_status` 一起簽進網址，讓 `resolve` 不必查 DB（D5）。
CDN 啟用時，影像 API 的 302 改成轉到 CDN 網址（`{ cdn: 'fileVariant' }`，[`image-cdn.md`](./image-cdn.md) §1）。

### 11. 會動到的既有模組

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/core/storage` | 抽出 `ObjectUrlSigner`；`PresignedUrlSigner` 包住現在的 `presignDownload` 與時間窗 |
| `apps/api/src/core/image` | `ImageUrlService`、`ImageSourcesSchema`；變體產生改成「主格式 ＋ WebP」 |
| `modules/image`、`modules/gallery`（新） | 組回應時呼叫 `ImageUrlService`；用途宣告 `urlTtl`、`presets`；刪除物件後呼叫 `CdnPurger.schedule`（[`image-cdn.md`](./image-cdn.md) §7） |
| `packages/web-core` | `image/SignedImage`；`Avatar` 的圖片插槽 |
| `packages/ui` | `Avatar` 加 `image` 插槽 |
| `packages/rich-text`（第二批） | 圖片節點只允許 `assetId` |

## 開放問題

全部已有結論（2026-10-09，照提案的傾向定案）；決定的理由與評估過的方案見下方「設計決策」。

1. **回應直接帶物件網址，還是統一經過一支 api 端點（自含簽章的 token，驗完 302）？**
   傾向直接帶：沒有中間那一跳，api 與 DB 都不參與讀圖；代價是回應的 JSON 變大（一張圖約 4–8 個網址），以及網址的格式綁定儲存服務（換 CDN 時由 `ObjectUrlSigner` 吸收）。
   經 api 的好處是網址短、可以在請求時協商格式，但每張圖仍有一次 api 請求。
   - **結論**：直接帶（D1）。
2. **處理時產生「主格式 ＋ WebP」，不做 AVIF？** WebP 已經比 JPEG 小約 25–35%，所有現代瀏覽器都支援；AVIF 再小一些，但編碼慢很多（[`09-file.md`](../architecture/backend/09-file.md) §5.4 就是因此改成依需求轉出）。
   傾向這一版只做 WebP；變體不計入容量，多一份 WebP 的成本只在物件儲存。
   - **結論**：主格式 ＋ WebP，不做 AVIF（D2）。
3. **各用途的效期**：頭像 12 小時、圖片庫 1 小時、附件 15 分鐘，範圍 5 分鐘到 24 小時，可以嗎？
   - **結論**：可以（D3）。
4. **email 的圖片用公開網址還是 CID 內嵌？** 公開網址需要 §8 先做；CID 內嵌不必公開，但信件變大、部分郵件軟體顯示成附件。
   傾向公開網址（與登入頁的 Logo 同一套），所以 email 放圖要等 §8。
   - **結論**：公開網址；email 放圖排在第二批（D4）。
5. **檔案管理器的影像 API 要不要也改成不查 DB？** 傾向這一版不動，等檔案的圖片出現在其他頁面時再做。
   - **結論**：這一版不動（D5）。
6. **`ObjectUrlSigner` 現在就抽出來嗎？** 傾向現在抽（只有 presigned 一個實作），圖片資產與圖片庫一開始就經過它；
   這樣 [`image-cdn.md`](./image-cdn.md) 不必等圖片資產做完，也不必回頭改呼叫端（它的開放問題 8）。
   - **結論**：現在抽，作為三份圖片提案的第一步（D6）。

## 設計決策

背景見「背景」一節。歸檔時整節搬進 `backend/25-image.md` 的最後一章。

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D0 | **五條原則**（§1）：存參照不存網址、物件只寫一次、網址只由 `ImageUrlService` 產生、具名尺寸附 2x、讀圖不打 api 也不查 DB | 圖片大範圍使用之前先定下引用方式，避免富文本、email、對外 API 存了會過期的網址之後再做資料遷移 | 各功能自己處理網址：三份提案原本就各寫一套，彼此不一致 |
| D1 | **回應直接帶簽好的物件網址**（`ImageSources`），不經過 api 轉址 | 圖片資產與圖片庫的物件都在處理時產生好（R2），組回應時就算得出全部網址；一頁 50 張圖不再是 50 次 api 請求與 DB 查詢 | 自含簽章的 api 端點 ＋ 302：網址短、可協商格式，但每張圖仍打一次 api；沿用檔案的影像 API：每次查 DB |
| D2 | **處理時產生主格式（progressive JPEG／有透明度用 WebP）＋ WebP**，瀏覽器以 `<picture>` 選；不做 AVIF、不依 `Accept` 協商 | WebP 已涵蓋所有現代瀏覽器、節省明顯；AVIF 編碼慢；協商需要請求時的判斷，與 D1 衝突。變體不計容量 | 依需求轉出（檔案的做法）：需要經過 api；預產 AVIF：處理時間倍增 |
| D3 | **效期由用途宣告**：頭像 12 小時、圖片庫 1 小時、附件 15 分鐘；範圍 5 分鐘到 24 小時；時間窗是效期的一半 | 低敏感、到處出現的圖給長效期，敏感的附件維持短效期；時間窗讓網址穩定、快取命中 | 一律 `FILE_URL_TTL`（≤ 1 小時）：頭像在開很久的頁面上頻繁過期 |
| D4 | **email 的圖片用公開網址**（§8），email 放圖排在第二批 | 與登入頁的 Logo 同一套；不必處理 CID 在各郵件軟體的差異 | CID 內嵌：信件變大，部分郵件軟體顯示成附件 |
| D5 | **檔案管理器的影像 API 這一版不動** | 它要處理變體未完成、格式協商、依需求轉檔，請求時查 DB 合理；目前只有檔案管理器在用 | 把 `variant_format` 簽進網址：等檔案的圖片出現在其他頁面時再做 |
| D6 | **`ObjectUrlSigner` 現在就抽出**（`core/storage`），這一版只有 `PresignedUrlSigner`；它是三份圖片提案的第一步 | 圖片資產與圖片庫從一開始就經過它；CDN 只是多一個實作，可以獨立進行、不必回頭改呼叫端 | 等 CDN 時再抽：到時要改所有呼叫端 |
| D7 | **`SignedImage` 只在失敗時重抓**（同一個查詢合併成一次失效），長時間開著且持續載入新圖的頁面才依 `expiresAt` 主動重抓 | 已經顯示的圖不需要新網址；避免「50 張圖同時過期 → 50 次重抓」 | 一律依 `expiresAt` 定時重抓：多數頁面白白多打請求 |

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/25-image.md`（與圖片資產同一份）：新的一章「讀取與遞送」——五條原則、`ImageUrlService`、效期、尺寸、公開網址；設計決策併進該份的最後一章
- `docs/architecture/backend/09-file.md`：§5.4 註明檔案的影像 API 與圖片資產的讀取路徑不同；§7.1 的時間窗改成指向 `ObjectUrlSigner`
- `docs/architecture/frontend/07-ui-system.md`：`Avatar` 的圖片插槽；`web-core` 的 `SignedImage`
- `docs/coding-standards/`：「存參照，不存網址」寫成規範
