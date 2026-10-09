# 25 — 圖片：讀取與遞送、圖片資產

圖片之後會出現在大多數頁面上（使用者列表、留言、審批的頭像，圖片庫、富文本、email）。這份規定圖片 **存什麼、網址怎麼產生、效期多長、尺寸有哪些**，
所有租戶合計的儲存止水線（§1–§13，決定與理由見 §14），以及 **圖片資產**：與檔案管理器無關的圖片怎麼上傳、從其他來源複製、處理、清理（§15，決定見 §16）。

共用的底層是 `core/storage` 的 `ObjectUrlSigner`、`core/image` 的格式政策與 `ImageUrlService`、`web-core/image` 的 `SignedImage`、
`Avatar` 的圖片插槽、儲存的止水線。第一個使用它們的是圖片資產（`modules/image`，第一個 consumer 是使用者頭像）；選圖的前端在
[`../frontend/23-image-picker.md`](../frontend/23-image-picker.md)。圖片庫見 [`26-gallery.md`](./26-gallery.md)；
CDN 是 `ObjectUrlSigner` 的另一個實作（`CdnUrlSigner`，[`09-file.md`](./09-file.md) §16）。

```
擁有者模組（modules/image；之後的 modules/gallery）
  處理時：ImageProcessor.decode → renderRenditions（尺寸 × 格式，依序）→ putObject(renditionKey(prefix, 名稱, 格式))，只寫一次
  組回應：ImageUrlService.sources(ImageObjectSet, layouts) → ObjectUrlSigner.sign(key) × N → ImageSources（DTO）
瀏覽器：<SignedImage sources variant> → <picture><source …><img …></picture> → 直接讀物件儲存（或 CDN），不經過 api
```

---

## 1. 五條原則

| # | 原則 | 落在哪裡 |
| --- | --- | --- |
| R1 | **存參照，不存網址**：資料庫、富文本、匯出、稽核、對外 API 的使用者存的永遠是 id（`image_asset_id`、`gallery_item_id`），網址只在輸出的當下產生 | consumer 的資料模型；富文本的圖片節點（§7）；[`../../coding-standards/03-backend.md`](../../coding-standards/03-backend.md) §2.5 |
| R2 | **每個物件只寫一次**：主檔、原檔、變體寫完就不再改；要換內容就寫到新的 key（key 帶版本 `r<rev>`） | `renditionKey`（§11）；§16.2 D12 |
| R3 | **網址只由 `ImageUrlService` 產生**：效期、時間窗、簽章方式（presigned 或 CDN）集中在一處 | `core/image`（§3） |
| R4 | **尺寸是具名的 preset**，各附 2x；沒有任意寬度的參數 | 用途的宣告、圖片庫的固定尺寸（§6） |
| R5 | **讀圖的熱路徑不查 DB、不打 api**：回應裡的網址直接指向物件儲存（或 CDN），瀏覽器拿到就讀 | §3 |

---

## 2. 三種圖片的讀取路徑

| 圖片 | 物件 | 網址 | 現況 |
| --- | --- | --- | --- |
| 檔案管理器的圖片 | `files/<id>`、`variants/<id>/…` | 影像 API（HMAC → 查 DB → 302；[`09-file.md`](./09-file.md) §5.4） | 不變（§10）；簽 presigned 網址改經 `ObjectUrlSigner` |
| 圖片資產（頭像等） | `images/<id>/r<rev>/<preset>.<格式>` | `ImageUrlService` 直接簽 | §15 |
| 圖片庫 | `gallery/<id>/original`、`gallery/<id>/r<rev>/<尺寸>.<格式>` | `ImageUrlService` 直接簽；原檔下載另簽帶 `Content-Disposition` 的網址 | [`26-gallery.md`](./26-gallery.md) §6 |

圖片資產與圖片庫的物件是 **處理時一次產生好的**（R2），每個物件的 key、格式、尺寸在 DB 裡都有，組回應時就能算出全部網址；
不像檔案的影像 API 要在請求時查狀態、決定是否轉檔。所以這兩種圖片不需要中間那一跳（D1）。

---

## 3. `ObjectUrlSigner` 與 `ImageUrlService`

**`ObjectUrlSigner`**（`core/storage/object-url-signer.ts`）把物件 key 簽成瀏覽器可以直接讀的網址：

```ts
abstract class ObjectUrlSigner {
  sign(key, { expiresIn, disposition?, fileName?, contentType?, cdn? }): Promise<{ url; expiresAt }>;
}
```

- 實作由 `StorageModule` 全域提供（D6）：沒有 CDN 時是 `PresignedUrlSigner`（包住 `ObjectStorage.presignDownload`，含 `stableSigningDate` 的時間窗；[`09-file.md`](./09-file.md) §7.1）；
  `FILE_CDN_ENABLED=true` 時是 `CdnUrlSigner`（§9、[`09-file.md`](./09-file.md) §16.2）。
- `cdn` 是「這個物件寫入後不再覆寫、可以由 CDN 送出」的資源類型（`CdnResource`：`imageAsset`、`galleryItem`、`fileVariant`）。presigned 的實作忽略它；
  CDN 的實作依 `CdnConfig.servesResource()`（`FILE_CDN_RESOURCES` 的上限 ＋ apps/platform 的執行期設定，[`09-file.md`](./09-file.md) §16.9）決定是否改用 CDN（§9）。
- 讀圖的熱路徑（`ImageUrlService`、檔案的影像 API 的轉址）只認它；上傳、分塊上傳、一般檔案的下載仍直接用 `ObjectStorage`（不會走 CDN）。

**`ImageUrlService`**（`core/image/image-url.service.ts`，`ImageModule` 全域提供）：

```ts
interface ImageObjectSet {
  keyPrefix: string;                                   // 'images/<id>/r3'
  width: number; height: number;                       // 圖片本身（裁切之後）
  formats: readonly ImageFormat[];                     // 主格式在前（deliveryFormatsOf）
  renditions: Record<string, { width; height; sameAs? }>;  // 處理時寫好的尺寸（已含 @2x）
  ttlSeconds: number;                                  // 由用途決定（§4）
  cdn?: CdnResource;
}
type ImageVariantLayout = { density: { '1x': string; '2x'?: string } } | { widths: [string, ...string[]] };

sources(set, layouts: Record<名稱, ImageVariantLayout>): Promise<ImageSources>
densityLayouts(set, ['sm', 'md', 'lg'])              // 依慣例 <名稱> ＋ <名稱>@2x 組出密度版本
```

回應的 DTO 是 `ImageSourcesSchema`（OpenAPI 的 `ImageSources`，前端經 SDK 拿到型別；`null` 代表沒有圖片或還在處理）：

```ts
interface ImageSources {
  width: number; height: number;           // 圖片本身的尺寸，給版面算比例
  expiresAt: string;                       // 這一組網址最早到期的時間
  variants: Record<string, {               // 具名的版本（頭像的 sm／md／lg；圖片庫的 responsive）
    src: string;                           // 主格式、預設尺寸
    srcSet: string;                        // 'url 1x, url 2x' 或 'url 480w, url 1280w'
    sources: Array<{ type: string; srcSet: string }>;   // 其他格式，給 <picture> 的 <source>
    width: number; height: number;
  }>;
}
```

- **一次簽一組**：同一張圖的所有尺寸與格式在同一個時間窗內簽出；同一個物件只簽一次（2x 可能以 `sameAs` 與另一個尺寸共用物件）。
  簽章是純 CPU 運算，一頁 50 張圖的成本可以忽略。
- **不經過 api**（R5）：一頁 50 個頭像就是 50 個（可被快取的）物件請求，api 與 DB 一次都不用。
- 效期超出 5 分鐘到 24 小時、引用不存在的尺寸、沒有格式或版本都拋 `Error`：這些是呼叫端的程式錯誤，不是使用者的輸入。

---

## 4. 效期：由用途決定

| 用途 | `urlTtl` | 理由 |
| --- | --- | --- |
| `user.avatar` | 12 小時 | 低敏感、出現在每一頁；長效期讓頁面開一整天也不破圖 |
| 圖片庫（`gallery`） | 1 小時 | 有 `gallery:read` 才看得到；檢視器可能開很久，配合 §5 的重抓 |
| 之後的附件（審批、留言） | 15 分鐘 | 敏感；與 `FILE_URL_TTL` 預設相同 |

- 範圍 5 分鐘到 24 小時（`IMAGE_URL_TTL_MIN`／`IMAGE_URL_TTL_MAX`）；時間窗是效期的一半（`stableSigningDate`），所以網址剩餘的效期介於 `ttl/2` 與 `ttl` 之間。
- 效期只決定「網址外流之後多久失效」，不影響快取命中：同一個時間窗內網址相同，CDN 的快取 key 也不含簽章。
- presigned 網址的上限是 SigV4 的 7 天，24 小時在範圍內；`FILE_URL_TTL`（≤ 3600）只管檔案，不受影響。

---

## 5. 前端：`SignedImage`

`@b2b-system/web-core/image`：

| 匯出 | 用途 |
| --- | --- |
| `SignedImage` | 顯示 `ImageSources` 的一個具名版本：`<picture>`（其他格式的 `<source>` ＋ `<img src srcSet sizes width height loading="lazy" decoding="async">`） |
| `SignedAvatar` | `Avatar`（`@b2b-system/ui`）的 `image` 插槽填入 `SignedImage`；沒有頭像或失敗時露出名字縮寫 |
| `coalesce(fn)` | 同一個微任務內的多次呼叫只執行一次：同一頁的多張圖共用一個 `onExpired` |
| `ImageSources`、`ImageSourceVariant` | 以結構寫的型別（web-core 不依賴 `api-sdk`）；app 拿到的 SDK 型別可以直接傳進來 |

| 狀況 | 行為 |
| --- | --- |
| 正常 | 渲染 `<picture>`；寬高讓版面不跳動 |
| 載入失敗（多半是網址過期） | 呼叫 `onExpired()` 一次——呼叫端讓擁有這筆資料的查詢失效（`invalidateResources`），重抓後拿到新網址自動重試 |
| 重抓後仍失敗、沒給 `onExpired` | 顯示 `fallback`（頭像退回名字縮寫、圖片庫退回主色色塊） |
| `sources` 是 `null`、沒有那個版本 | 直接顯示 `fallback` |

- 同一個網址只觸發一次 `onExpired`；重抓後載入成功就重新計算，之後再過期可以再重抓一次。多張圖以 `coalesce()` 合併成一次失效（D7）。
- 只在失敗時才反應，不依 `expiresAt` 主動重抓：已經顯示出來的圖不需要新網址。長時間開著而且會繼續載入新圖的頁面
  （圖片庫的無限捲動、檢視器的預先載入）傳 `isLongLived`，在 `expiresAt` 前 60 秒呼叫 `onExpired`，與檔案管理器「失效前 60 秒重抓」相同。
- `Avatar` 的 `image` 插槽接受任何 `ReactNode`，疊在名字縮寫之上；`ui` 不認識 `ImageSources`（下層 package 不 import 上層），組合放在 web-core。

---

## 6. 尺寸：具名 preset 與 2x

| 誰 | 宣告 | 產生的物件 | `srcSet` |
| --- | --- | --- | --- |
| 圖片資產 | 用途的 `presets`，例 `user.avatar`：`{ sm: 32, md: 96, lg: 256 }`（長邊 px） | 每個 preset 一份 1x、一份 2x（`sm`、`sm@2x`…；2x 與另一個尺寸一樣大時以 `sameAs` 共用） | 密度描述：`sm 1x, sm@2x 2x`（`densityLayouts`） |
| 圖片庫 | 固定的四種：`thumb` 480、`medium` 1280、`large` 2560、`original` | 前三種各兩個格式 | 寬度描述：`thumb 480w, medium 1280w`（`{ widths }`），搭配 `sizes` |

- **沒有 `?w=`**（R4）：所有尺寸在處理時就產生；新增一種尺寸是改用途的宣告並補產生，不是開放參數。
- 尺寸不超過主檔：主檔不夠大時 2x 就是主檔的尺寸，不放大（`render` 的 `withoutEnlargement`）。
- 前端以名稱選圖（`<SignedImage sources={user.avatar} variant="sm">`），不寫死像素。

---

## 7. 持久化的內容：只存參照（R1）

| 內容 | 存什麼 | 輸出時 |
| --- | --- | --- |
| consumer 的欄位（頭像） | `avatar_image_id` | 回應帶 `avatar: ImageSources` |
| 富文本的內嵌圖片（第二批） | 圖片節點 `{ type: 'image', attrs: { assetId, alt } }`；`packages/rich-text` 的 schema 不允許節點帶網址 | api 讀取時把節點展開成 `ImageSources`；轉 HTML 時由呼叫端提供網址解析器 |
| email | 不存 | 寄送時產生公開網址（§8，D4）；email 放圖排在第二批 |
| 對外 API | 不存 | 回應帶 `ImageSources` 與 `expiresAt`；文件寫明「網址會過期，要用時重新取得」 |
| 匯入／匯出 | 資產 id | 不輸出網址 |
| 稽核 | 資產 id 與來源 | — |

---

## 8. 公開網址（第二批，只定設計）

登入頁的 Logo、email 裡的圖拿不到新網址，需要 **不過期、可長期快取** 的網址：

```
用途宣告 visibility: 'public'
  → 處理時把變體 額外 寫一份到 public/<tenantId>/<assetId>/r<rev>/<preset>.<格式>
  → 網址：<檔案網域>/storage/<bucket>/public/…（不帶簽章）
  → file-storage／CDN 只對 public/ 前綴允許不帶簽章的 GET
```

- 物件只寫一次（R2）、路徑含 uuid 與 rev，所以可以 `Cache-Control: public, max-age=31536000, immutable`。
- 撤銷 ＝ 刪除那個 rev 的 `public/` 物件，再清理 CDN 快取（公開網址沒有效期，一定要清）。
- 用途上只預留 `visibility`（§16.2 D6），還沒有實作。

---

## 9. CDN 怎麼接上

```
ImageUrlService ──▶ ObjectUrlSigner
                      ├─ PresignedUrlSigner：沒有 CDN（FILE_CDN_ENABLED=false，預設）
                      └─ CdnUrlSigner（NginxCdnUrlSigner）：部署開啟 CDN 時。呼叫端標 { cdn: '<資源類型>' } 且該類型在 FILE_CDN_RESOURCES 內時簽 CDN 網址，
                                                           其他（沒標、attachment、覆寫型別）交給 presigned
```

邊緣、簽章、開關、清理的規格在 [`09-file.md`](./09-file.md) §16（決定在 §17）。

- 圖片資產與圖片庫的物件都符合「只寫一次」，分別標 `{ cdn: 'imageAsset' }`、`{ cdn: 'galleryItem' }`；原檔下載（帶 `Content-Disposition`）不標。
- 檔案的影像 API 簽變體與轉出的格式時已經標 `{ cdn: 'fileVariant' }`；原檔不標。
- CDN 網址的效期用 §4 的 `urlTtl`，再以 `FILE_CDN_MAX_URL_TTL` 封頂（[`09-file.md`](./09-file.md) §17 D2）。沒有 CDN 時行為與 presigned 完全相同。
- 刪掉可能走過 CDN 的物件之後，擁有者模組呼叫 `CdnPurger.schedule(keys)` 排入邊緣快取的清理（`cdn.purge`；[`09-file.md`](./09-file.md) §16.6）。
  圖片資產在 `image.maintenance` 刪除主檔、舊版本與殘留物件之後呼叫；之後的圖片庫同樣在刪除變體之後呼叫。

---

## 10. 檔案管理器的影像 API

**不動**（D5）：它要處理「變體還沒好」「依 `Accept` 協商」「第一次被要求時才轉檔」，請求時查 DB 是合理的；而且只有檔案管理器在用。
主格式的選擇改用 §11 的 `primaryFormatOf`，轉址的 presigned 網址改經 `ObjectUrlSigner`，行為不變。

之後若檔案的圖片也大量出現在其他頁面，可以把 `variant_format` 與 `variant_status` 一起簽進網址，讓 `resolve` 不必查 DB。

---

## 11. 格式政策（`core/image`）

檔案的變體、圖片資產、圖片庫共用（D9）；**尺寸** 由各模組決定（檔案 480／2560、用途的 `presets`、圖片庫的四種）。

| 匯出 | 內容 |
| --- | --- |
| `primaryFormatOf(info)` | 主格式：progressive JPEG（mozjpeg，品質 82）；有透明度的圖改用 WebP（JPEG 沒有透明度） |
| `deliveryFormatsOf(info)` | 處理時產生的格式，主格式在前：主格式 ＋ WebP；主格式已是 WebP 時只有一種（D2） |
| `renderRenditions(decoded, { renditions, formats, extract? })` | 每個尺寸 × 格式 **依序** 輸出（同時只有一份解碼緩衝）；呼叫端負責 `dispose()` |
| `renditionKey(prefix, 名稱, 格式)` | `<prefix>/<名稱>.<副檔名>`，JPEG 用 `.jpg`（`IMAGE_FORMAT_EXTENSION`） |
| `RenderOptions.extract` | 先裁切再縮放；座標以轉正之後的方向為準（使用者在裁切框裡看到的方向）。超出影像或不是正整數拋 `ImageDecodeError` |

一律依 EXIF 轉正並移除中繼資料（GPS 等）、等比縮小不放大（`DecodedImage.render` 的保證，[`09-file.md`](./09-file.md) §5.4）。
EXIF 的讀取（拍攝時間、相機）與原檔的 GPS 移除（`core/image/exif.ts`）、主色與 BlurHash（`DecodedImage.analyze`、`blurhash.ts`）、旋轉（`RenderOptions.rotate`）由圖片庫加入（[`26-gallery.md`](./26-gallery.md) §5）。

---

## 12. 儲存的止水線（平台）

每個租戶的容量（`file.storageQuotaMb`，[`../05-tenancy.md`](../05-tenancy.md) §5.3）保護的是「這個租戶買了多少」，但所有租戶的上限加起來可以遠大於部署實際有的空間（超賣）。
止水線保護的是 **部署本身**（D8）：

```
STORAGE_TOTAL_LIMIT_MB（環境變數，0 = 不啟用）
  storage.totalRollup（平台的背景工作，STORAGE_TOTAL_ROLLUP_CRON，預設每 5 分鐘）
    → 逐一進入 active 的租戶，TenantStorageUsage.used()（讀已用量的計數，單列，O(1)）
    → 覆寫平台 DB 的 tenant_storage_usage（每個租戶一列：used_bytes、measured_at）
    → 越過 80%、100% 時通知能改租戶的平台管理者（storage.totalNearLimit，連到租戶清單）
  上傳（登記）時：StorageCapacity.assertCanStore(size)（在租戶的容量檢查之前）
    → SUM(used_bytes)、MAX(measured_at)（程序內快取 30 秒；同時的請求只查一次）
    → used + size > 上限 → 409 STORAGE_TOTAL_LIMIT_REACHED
```

| 規則 | 理由 |
| --- | --- |
| 合計在平台算，上傳只讀平台 DB 的一個彙總 | 租戶的請求不跨租戶查詢 |
| 量不到的租戶（停用、這一輪失敗）保留上一次的值；已刪除但還沒清除的租戶也算，`db:drop-tenant` 清除時一起刪掉（CASCADE） | 它們的物件仍佔著空間 |
| 只擋新的寫入：讀取、下載、刪除、清空回收桶照常；縮圖、變體這類系統產物不擋也不計（與租戶的容量相同） | 騰出空間要靠刪除 |
| 近似值：兩次彙總之間的上傳不會立刻算進去 | 止水線要設得比實際的空間低一些，預留 5 分鐘的上傳量 |
| 還沒有量測、最近一次量測超過 1 小時、平台 DB 讀不到時 **放行**，記警告（每 30 秒最多一行）並計入指標 | 止水線是保險，不能讓背景工作的故障變成全平台無法上傳 |
| 錯誤用 409、不帶 `details` | 前端不會把 5xx 自動重試；平台的數字不給租戶看 |
| 擁有計數的模組在 `onModuleInit` 向 `core/usage` 的 `TenantStorageUsage` 登記（現在是檔案的 `file_storage_usage`） | `core/` 不認識業務模組；圖片資產與圖片庫維護同一個計數（§16.2 D3），不另外登記 |

- **apps/platform**：租戶清單上方顯示所有租戶的已用量與止水線（`GET /platform/tenants/storage-total`，`tenant:read`）；越過 80% 標成警告，
  到 100% 說明「所有租戶都暫停新的上傳」，量測過舊時說明「止水線暫時不擋」。部署沒有啟用時不顯示。
- **指標**（[`../08-monitoring.md`](../08-monitoring.md) §2.2）：`api_storage_total_used_bytes`、`api_storage_total_limit_bytes`（每個程序回報同一個數字，查詢取 `max`）、
  `api_storage_total_checks_total{result="allowed|blocked|stale"}`。
- **環境變數**：`STORAGE_TOTAL_LIMIT_MB`（預設 0）、`STORAGE_TOTAL_ROLLUP_CRON`（預設 `*/5 * * * *`，空字串停用；停用時止水線在一小時後就不再擋）。

---

## 13. 測試

| 範圍 | 檔案 |
| --- | --- |
| 簽章的包裝 | `core/storage/__tests__/object-url-signer.spec.ts` |
| 格式政策、裁切 | `core/image/__tests__/image-format-policy.spec.ts`、`sharp-image-processor.spec.ts` |
| `ImageSources` 的組成（密度、寬度、`sameAs`、效期範圍、`expiresAt`） | `core/image/__tests__/image-url.service.spec.ts` |
| 止水線的判斷（快取、過舊放行、讀不到放行） | `core/usage/__tests__/storage-capacity.spec.ts` |
| 彙總與通知 | `modules/tenant/__tests__/storage-total.service.spec.ts`；整合 `apps/api/test/storage-total.spec.ts`（真的 SQL、上傳被擋、平台端點、通知） |
| 前端 | `web-core/image/__tests__/SignedImage.test.tsx`（重抓一次、退路、`isLongLived`、`coalesce`、`SignedAvatar`）；`ui` 的 `Avatar.test.tsx`；apps/platform 的租戶清單 |

---

## 14. 設計決策：讀取與遞送、儲存的止水線

### 14.1 背景

三份圖片提案（圖片資產、圖片庫、CDN）原本各自寫了網址怎麼產生，彼此不一致；而且下面四件事三份都沒有處理完：

| # | 問題 | 會在哪裡出事 |
| --- | --- | --- |
| 1 | **簽章網址會過期，卻可能被存下來** | 富文本內嵌的圖、寄出的 email、對外 API 的回應、匯出的檔案：存的是網址，最長一小時後就破圖 |
| 2 | **每張圖都打一次 api、查一次 DB** | 一頁 50 列、每列一個頭像 ＝ 50 次 api 請求 ＋ 50 次 DB 查詢；302 的快取是 `private`，每個使用者第一次都要付 |
| 3 | **效期一刀切** | 頁面開很久、查詢快取裡的舊資料、推播即時插入的留言都會拿到過期網址；每個功能各自處理破圖 |
| 4 | **尺寸沒有規則** | 各功能自己決定尺寸；若開放 `?w=` 任意寬度，會被拿來塞爆轉檔與儲存，快取的組合也會爆增 |

另外，圖片大範圍使用之後儲存量成長得更快，而每個租戶的容量可以超賣，需要一條保護部署本身的上限。

### 14.2 決定

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D0 | **五條原則**（§1）：存參照不存網址、物件只寫一次、網址只由 `ImageUrlService` 產生、具名尺寸附 2x、讀圖不打 api 也不查 DB | 圖片大範圍使用之前先定下引用方式，避免富文本、email、對外 API 存了會過期的網址之後再做資料遷移 | 各功能自己處理網址：三份提案原本就各寫一套，彼此不一致 |
| D1 | **回應直接帶簽好的物件網址**（`ImageSources`），不經過 api 轉址 | 圖片資產與圖片庫的物件都在處理時產生好（R2），組回應時就算得出全部網址；一頁 50 張圖不再是 50 次 api 請求與 DB 查詢 | 自含簽章的 api 端點 ＋ 302：網址短、可協商格式，但每張圖仍打一次 api；沿用檔案的影像 API：每次查 DB |
| D2 | **處理時產生主格式（progressive JPEG／有透明度用 WebP）＋ WebP**，瀏覽器以 `<picture>` 選；不做 AVIF、不依 `Accept` 協商 | WebP 已涵蓋所有現代瀏覽器、節省明顯；AVIF 編碼慢；協商需要請求時的判斷，與 D1 衝突。變體不計容量 | 依需求轉出（檔案的做法）：需要經過 api；預產 AVIF：處理時間倍增 |
| D3 | **效期由用途宣告**：頭像 12 小時、圖片庫 1 小時、附件 15 分鐘；範圍 5 分鐘到 24 小時；時間窗是效期的一半 | 低敏感、到處出現的圖給長效期，敏感的附件維持短效期；時間窗讓網址穩定、快取命中 | 一律 `FILE_URL_TTL`（≤ 1 小時）：頭像在開很久的頁面上頻繁過期 |
| D4 | **email 的圖片用公開網址**（§8），email 放圖排在第二批 | 與登入頁的 Logo 同一套；不必處理 CID 在各郵件軟體的差異 | CID 內嵌：信件變大，部分郵件軟體顯示成附件 |
| D5 | **檔案管理器的影像 API 不動** | 它要處理變體未完成、格式協商、依需求轉檔，請求時查 DB 合理；目前只有檔案管理器在用 | 把 `variant_format` 簽進網址：等檔案的圖片出現在其他頁面時再做 |
| D6 | **`ObjectUrlSigner` 先抽出**（`core/storage`），現在只有 `PresignedUrlSigner`；它是三份圖片提案的第一步 | 圖片資產與圖片庫從一開始就經過它；CDN 只是多一個實作，可以獨立進行、不必回頭改呼叫端 | 等 CDN 時再抽：到時要改所有呼叫端 |
| D7 | **`SignedImage` 只在失敗時重抓**（同一頁以 `coalesce` 合併成一次失效），長時間開著且持續載入新圖的頁面才依 `expiresAt` 主動重抓 | 已經顯示的圖不需要新網址；避免「50 張圖同時過期 → 50 次重抓」 | 一律依 `expiresAt` 定時重抓：多數頁面白白多打請求 |
| D8 | **儲存的止水線由平台計算**：環境變數 `STORAGE_TOTAL_LIMIT_MB`（0 = 不啟用）；平台的背景工作每 5 分鐘量各租戶的已用量，寫平台 DB（每個租戶一列）；登記上傳時讀合計（程序內快取 30 秒），超過回 `409 STORAGE_TOTAL_LIMIT_REACHED`（不帶數字）；只擋新的寫入；量測超過 1 小時沒更新就放行；越過 80%、100% 通知平台管理者。每個租戶仍有自己的容量 | 租戶的容量可以超賣，部署的空間不行；在平台算讓租戶的請求不必跨租戶查詢；門檻是部署的事實（物件儲存有多大），跟著部署設定走 | 每次上傳即時加總所有租戶：每次都要連每個租戶的 DB；放在平台 DB 的設定、畫面上改：門檻跟著實際的硬體走，改它的人是部署的人；沿用每小時的用量快照：最多晚一小時，止水線要預留的空間太大；把容量改成只有全平台一個上限：失去租戶之間的公平 |
| D9 | **格式政策抽到 `core/image`**（主格式的選擇、品質、轉正、移除中繼資料、裁切 `extract`），檔案、圖片資產、圖片庫共用；**尺寸** 由各模組決定（原圖片資產提案的 D2，§16.2 D2） | 三處都要一樣的「progressive JPEG／有透明度用 WebP」；`core/` 不能 import `modules/`，放在 core 三邊都拿得到 | 新增 `modules/image` 提供給檔案用：檔案模組就要 import 一個與它平行的模組，依賴方向變複雜 |

### 14.3 實作紀錄

- **`ImageSources` 改成具名版本的表**：提案的形狀是單一的 `src`／`srcSet`，但頭像在不同大小的地方要用不同的 preset（頂列 `sm`、詳情 `lg`），
  一個欄位要帶得出全部。改成 `variants: Record<名稱, …>`，前端以名稱挑選。
- **2x 共用物件**：提案寫「2x 與另一個 preset 相同時共用」，實作成 `renditions` 的 `sameAs`，簽章時以實際的物件 key 去重。
- **止水線的錯誤碼用 409 不是 507**：web-core 的 fetcher 會自動重試 5xx（`plugins/fetcher/retry.ts`），擋下來的上傳重試也不會成功；409 與租戶容量的 `FILE_STORAGE_QUOTA_EXCEEDED` 一致。
- **止水線存每個租戶一列，不是單一的合計列**：一輪裡有租戶失敗時，單一合計列只能少算或整輪不寫；每個租戶一列讓失敗的租戶保留上一次的值。
- **容量不改名**：圖片資產與圖片庫共用租戶的容量，原本要把參數、計數、錯誤碼改成 `storage.*`；但參數 key 與錯誤碼上線後不改名、改表名是破壞性的 migration，
  而參數在 feature 關閉時本來就照常生效，所以沿用 `file.storageQuotaMb`、`file_storage_usage`、`FILE_STORAGE_QUOTA_EXCEEDED`，只改說明（§16.2 D3）。
- **EXIF 的讀取延後**：只有圖片庫用得到（拍攝時間、相機），沒有使用者之前不加解析的套件。

---

## 15. 圖片資產（`modules/image`）

與檔案管理器無關的圖片（第一個是使用者頭像，之後是租戶 Logo、留言與審批的附件）。所有來源（上傳、檔案管理、最近使用、圖片庫）的結果
都是 **一筆新的圖片資產**；使用圖片的資源（consumer）只存資產的 id（R1），不知道圖片從哪裡來。前端的選圖見 [`../frontend/23-image-picker.md`](../frontend/23-image-picker.md)。

```
consumer（例：modules/user 的頭像）
  │  存 avatar_image_id；儲存時在自己的交易內 claim（認領）／detach（解除）／recrop（重新裁切）；組回應時 sourcesOf()
  ▼
modules/image（通用模組，只依賴 core 與回收桶）
  ├─ ImageUsageRegistry：用途（限制、尺寸、效期）          ← consumer 在 onModuleInit 登記
  ├─ ImageSourceRegistry：「我能提供一張圖片」               ← modules/file 登記 file；內建 recent；之後 modules/gallery 登記 gallery
  ├─ ImageOwnerRegistry：處理好了通知擁有者推自己的變更      ← consumer 登記
  ├─ ImageAssetService：上傳、從來源複製、最近使用、consumer 的 API
  ├─ ImageProcessService：背景工作 image.process（worker）
  └─ ImageMaintenanceService：背景工作 image.maintenance（IMAGE_MAINTENANCE_CRON）
```

- `modules/image` 不 import 任何業務模組；檔案與之後的圖片庫 **彼此不認識**，只認識這裡的介面（[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2）。
- 不屬於任何可關閉的 feature：關掉檔案管理器（`file`），頭像照樣能上傳；「檔案」這個來源回 `404 FEATURE_DISABLED`。

### 15.1 資料模型（租戶 DB）

`image_assets`（migration `0052_image_assets`），不放進 `files`（§16.2 D1）：

| 欄位 | 說明 |
| --- | --- |
| `usage` | 用途 id（`user.avatar`）：決定限制、尺寸與網址的效期 |
| `status`、`failure_reason` | `pending` / `ready` / `failed`；失敗的原因 `notImage`、`typeNotAllowed`、`tooLarge`、`tooSmall`、`missing` |
| `source`、`source_ref_id`、`source_name` | `upload` / `file` / `recent`（之後 `gallery`）、來源那一筆的 id（**不是外鍵**）與原本的名稱 |
| `content_type`、`size` | pending 時是登記的；ready 時是主檔的。`size` 計入租戶的容量 |
| `width`、`height`、`has_alpha`、`master_format` | 主檔（轉正、長邊 ≤ 4096、移除中繼資料）的描述，**未裁切** |
| `content_hash` | 主檔的 SHA-256：「最近使用」以它去除重複 |
| `crop` | 目前的裁切，以 **比例**（0～1）表示（§16.3）；null 是不裁切（有比例的用途則取中央） |
| `rev`、`variant_rev`、`variants` | 要求的版本、已寫好的版本、那個版本的尺寸與格式（組回應不查物件儲存，R5） |
| `queued_at`、`stale_revs_purge_after` | 最後一次排入處理的時間（找卡住的處理）、舊版本的變體可以刪除的時間 |
| `owner_type`、`owner_id`、`detached_at` | 使用它的資源；被換掉或擁有者被永久刪除的時間 |
| `hidden_from_recent_at` | 使用者把它從「最近使用」移除的時間 |

物件：`images/<id>/upload`（處理完就刪）、`images/<id>/master.<格式>`、`images/<id>/r<rev>/<尺寸>.<格式>`；每個物件只寫一次（R2）。
`file.maintenance` 只管 `files/`、`thumbnails/`、`variants/`，`images/` 由 `image.maintenance` 對帳。
不軟刪除：沒被認領或被換掉的資產由清理排程連同物件一起刪除（§15.6）。

`users.avatar_image_id` 不設外鍵：`image_assets.created_by` 參照 `users`，反過來再參照會讓 schema 循環；認領與解除在同一個交易內，清理只刪沒被認領或已解除的資產。

### 15.2 來源介面：`ImageSourceRegistry`

```ts
interface ImageSource {
  id: string;                    // 'file'、'recent'、'gallery'。前端送來的是字串，呼叫端不知道它代表什麼
  feature?: TenantFeature;       // 沒啟用時 404 FEATURE_DISABLED
  resolve(refId, actor, purpose): Promise<ResolvedImage>;   // 以呼叫者的身分讀取；purpose 例：'imageAsset:user.avatar'
}
interface ResolvedImage {
  storageKey; contentType; size; name; width?; height?;
  normalized?: { width; height; hasAlpha; format; contentHash };   // 已經是正規化過的主檔：直接沿用，不重新編碼
}
```

- **呼叫端一律複製**（S3 CopyObject，`ObjectStorage.copyObject`，內容不經過 api）：解析出的物件只在複製的當下被讀一次，之後原物件的命運與它無關。
- 來源的 `resolve` 是唯一的讀取權限檢查（`POST /images/from-source` 只宣告 `@Authenticated()`）。複製時來源寫自己的稽核 `<resource>.copy`，
  `changes.after.purpose` 是呼叫端給的用途字串（§16.2 D5）：管理者看得到「這張圖被誰拿去哪裡用」。
- 來源：

| id | 登記 | 讀取權限 | 解析出的物件 |
| --- | --- | --- | --- |
| `file` | `modules/file` 的 `FileImageSource`（feature `file`） | 看得到所在的資料夾（`FileService.resolveImageForCopy`）；還在上傳中、不是圖片、變體處理失敗的當作不存在；寫 `file.copy` | 原檔 `files/<id>` |
| `recent` | 內建（`ImageRecentSource`） | `created_by = 自己`（§16.2 D10） | 那筆資產的主檔（`normalized`：新的資產直接沿用，內容雜湊相同） |
| `gallery` | `modules/gallery` 的 `GalleryImageSource`（feature `gallery`） | `gallery:read`；只認處理完、沒刪除的圖；寫 `galleryItem.copy` | 原檔 `gallery/<id>/original`（已依設定移除位置資訊）；轉過顯示方向的是 `large` 的變體（[`26-gallery.md`](./26-gallery.md) §9） |

### 15.3 用途（usage）

使用圖片的模組在 `onModuleInit` 以 `ImageAssetService.registerUsage()` 登記；登記錯誤（名稱、效期、尺寸、收 SVG）在啟動時就失敗。
前端以 `GET /images/usages` 取得同一份（§16.2 D8）。

| 屬性 | `user.avatar` |
| --- | --- |
| `maxSize` | 10 MiB（來源的原檔） |
| `contentTypes` | JPEG、PNG、WebP、AVIF、GIF（第一格，§16.2 D9）；不收 SVG |
| `minWidth` / `minHeight` | 128 × 128（裁切之後） |
| `aspectRatio` | `1`：一定裁成正方形，沒給裁切就取中央 |
| `presets` | `{ sm: 32, md: 96, lg: 256 }`；每個另產生 `@2x` |
| `urlTtl` | 12 小時（§4） |
| `visibility` | `signed`（`public` 保留給租戶 Logo，§16.2 D6） |
| `sources` | 省略（全部） |

**只用來過濾的用途**（`filterOnly: true`）：不能建立圖片資產（`POST /images`、`POST /images/from-source` 回 `VALIDATION_FAILED`），只讓來源以 `imageUsage=` 過濾出符合的圖。
目前是圖片庫的 `gallery.item`：「從其他來源加入」時讓檔案管理只列出圖片庫收得下的圖（[`26-gallery.md`](./26-gallery.md) §8、D19）。`GET /images/usages` 照樣列出它（前端的過濾要用）。

### 15.4 建立：上傳與從來源複製

```
上傳：      POST /images { usage, name, contentType, size } → 直傳網址（大小、型別、If-None-Match 簽進網址）
            → 瀏覽器 PUT → POST /images/:id/complete { crop? }（head 確認大小、沒有 Content-Encoding）→ 排入 image.process
其他來源：  POST /images/from-source { usage, source, refId, crop? }
            → ImageSourceRegistry.get(source)（feature 檢查）→ resolve(refId, actor, 'imageAsset:<usage>')
            → 先擋型別、大小、（知道尺寸時）裁切後的最小尺寸 → CopyObject 到 images/<id>/upload（或 master）→ 排入 image.process
```

- 上傳不需要權限（`@Authenticated()`）；濫用的控制：每人處理中（`pending`）最多 `IMAGE_PENDING_PER_USER`（10）張、止水線、租戶的容量、沒被認領的 24 小時後清除。
- 登記時在交易內以條件式 UPDATE 佔用租戶的容量（與檔案共用 `file_storage_usage`，§16.2 D3）；主檔寫好時補上與登記大小的差額。
  `file.maintenance` 對帳時加總 `files` 與以 `StorageSizeSources` 登記的其他合計（`SUM(image_assets.size)`）。
- 複製失敗或登記失敗（容量）時刪掉剛複製的物件；漏掉的由殘留對帳處理。

### 15.5 處理：`image.process`

在 worker 執行（[`../01-system.md`](../01-system.md) §7 D9），重複排入無害：

1. **還沒有主檔**：讀原檔（上限是用途的 `maxSize`）→ 以 **檔頭** 判斷型別（不信任宣告的型別；SVG 在交給解碼器之前就擋掉）→ 解碼、轉正、長邊縮到 4096、
   移除中繼資料 → 寫主檔（主格式：progressive JPEG，有透明度用 WebP，§11）→ 計入容量的大小改成主檔的 → 刪原檔。
2. **要求的版本（`rev`）還沒寫好**：以主檔套用裁切（比例換算成主檔的像素，用途有比例時修正成剛好那個比例）→ 每個 preset 的 1x、2x × 主格式與 WebP，
   寫到 `r<rev>/`。2x 與另一個尺寸一樣大時以 `sameAs` 共用物件（§3）。寫回時要求的版本仍是 `rev` 才生效：處理途中又重新裁切了，剛寫好的版本交給清理。
3. 推給建立者本人（§15.9）；資產已被某個資源使用時，經 `ImageOwnerRegistry` 通知擁有者推它自己的變更（頭像：使用者的 update）。

失敗（不是圖片、太小、型別不符、原檔不見）不會因為重試而成功：還沒有任何版本的資產標成 `failed`；已經有版本的（重新裁切）保留原本的版本。
儲存服務暫時不可用則拋出，交給背景工作重試。

### 15.6 生命週期與清理：`image.maintenance`

| 狀況 | 做法 |
| --- | --- |
| 上傳了但沒按儲存 | `owner_id` 一直是 null；建立超過 24 小時就刪除物件與紀錄、釋出容量 |
| 換了一張新圖 | 舊的設 `detached_at`，保留到回收桶的保留期限（`trash.retentionDays`）；期間仍出現在「最近使用」 |
| 資源被軟刪除 | 不動 |
| 資源被永久刪除 | consumer 的 `TrashHandler.purge` 呼叫 `detachAll`，交給清理排程 |
| 重新裁切 | 新的版本寫好之後，舊版本的變體在用途的網址效期過後刪除（`stale_revs_purge_after`） |
| 處理卡住 | 排入超過 30 分鐘、要求的版本還沒寫好 → 重新排入 |
| 殘留物件 | `images/<id>/…` 查不到資產、而且至少 24 小時前寫入的 → 刪除 |

先刪物件再刪紀錄：紀錄先刪的話，物件刪除失敗就沒人知道它們屬於誰。物件刪除之後把刪掉的 key 交給 `CdnPurger.schedule`，清理邊緣快取（一輪一次排入；[`09-file.md`](./09-file.md) §16.6）。

### 15.7 最近使用

`GET /images/recent?usage=`：**自己** 建立過、`ready`、沒有移除的圖片資產，同一個 `content_hash` 只列最新的一筆，最多 30 張，不分用途；
伺服器以用途過濾型別與大小，尺寸太小的照樣列出（前端停用並說明原因）。選了之後是 `from-source`（`source: 'recent'`），**複製** 成一筆新的資產
（一個資產只屬於一個資源），可以重新裁切。`POST /images/:id/hide-from-recent` 把它（與同一個內容的其他副本）移除，不影響正在使用它的資源。
保留多久跟著資產本身的清理（§16.2 D11）。

### 15.8 consumer：使用者頭像

| 項目 | 做法 |
| --- | --- |
| 資料 | `users.avatar_image_id`（`avatarImageId` 是遞增 `version` 的可編輯欄位） |
| 換自己的 | `PATCH /auth/profile { avatarImageId | null, avatarCrop? }`：不需要權限 |
| 換別人的 | `PATCH /users/:id { avatarImageId, avatarCrop?, version }`：`user:update`（樂觀鎖） |
| 只重新裁切 | 只帶 `avatarCrop`：重新裁切目前那張（寫到新的版本，不必重傳） |
| 規則 | `UserAvatarService.applyInTx`：先鎖住使用者列再讀目前的頭像，解除舊的、認領新的。認領的條件是 **自己建立、還沒被使用、用途相同、沒有失敗**——別人的資產 `404 IMAGE_ASSET_NOT_FOUND`，其餘 `409 IMAGE_ASSET_NOT_USABLE`（`details.reason`：`inUse`、`usageMismatch`、`failed`） |
| 稽核 | `user.update` 的 `changes` 記 `avatarImageId` 的前後值、`avatarSource`、`avatarSourceRefId`、`avatarCrop`（存參照，不存網址） |
| 回應 | `User.avatar`、`Profile.user.avatar`、留言的 `authorAvatar` 是 `ImageSources`（`sm`、`md`、`lg`）；還在處理時是 `null` |
| 推播 | 頭像處理好了：使用者的 update（看得到這個人的畫面與本人的 profile 重抓） |
| 永久刪除 | `UserTrashHandler.purge` 解除他的所有資產 |

使用者沒有版本歷史（只有角色有），所以沒有「還原到舊的頭像」。

### 15.9 推播

`ChangeSource.IMAGE`（`image`，`id` = 資產 id）以 `perRecipient` 只推給建立者本人，不寫稽核（`recordsAudit: false`）：
上傳的對話框、「最近使用」等著它。使用它的資源由擁有者推自己的來源。

### 15.10 檔案作為圖片來源

- `GET /files?imageUsage=<usage>`：只列能當這個用途的圖片——型別在用途的 `contentTypes` 內（排除 SVG）、大小不超過 `maxSize`、變體沒有處理失敗。
  尺寸太小的照樣列出，由前端依 `image.width`／`image.height` 停用。不存在的用途 `400 VALIDATION_FAILED`。
- `FileService.resolveImageForCopy`：看得到所在的資料夾才行（與詳情相同的判斷），寫 `file.copy`。之後原檔被改名、移動、刪除，或資料夾的授權改變，
  複製出去的圖都不受影響，看那張圖的人也看不到原本的資料夾。

### 15.11 端點與錯誤碼

| 端點 | 授權 | 說明 |
| --- | --- | --- |
| `GET /images/usages` | 登入 | 每個用途的限制 |
| `GET /images/recent?usage=` | 登入 | 最近使用 |
| `POST /images` | 登入 | 登記上傳，回直傳網址 |
| `POST /images/:id/complete` | 登入（建立者） | 確認直傳完成，可帶 `crop` |
| `POST /images/from-source` | 登入；來源以呼叫者的身分讀取 | 從其他來源複製 |
| `POST /images/:id/hide-from-recent` | 登入（建立者） | 從最近使用移除 |
| `GET /images/:id` | 登入（建立者） | 處理狀態、各尺寸與主檔的網址 |

錯誤碼：`IMAGE_ASSET_NOT_FOUND`（404）、`IMAGE_TYPE_NOT_ALLOWED`（422）、`IMAGE_TOO_LARGE`（413）、`IMAGE_TOO_SMALL`（422）、`IMAGE_CROP_INVALID`（422）、
`IMAGE_SOURCE_NOT_FOUND`（404）、`IMAGE_ASSET_NOT_USABLE`（409）、`IMAGE_ALREADY_UPLOADED`（409）、`IMAGE_UPLOAD_INCOMPLETE`（409）、`IMAGE_PENDING_LIMIT_REACHED`（409）；
容量沿用 `FILE_STORAGE_QUOTA_EXCEEDED`、`STORAGE_TOTAL_LIMIT_REACHED`。背景工作：`image.process`、`image.maintenance`（`IMAGE_MAINTENANCE_CRON`，預設每小時第 30 分）。

### 15.12 測試

| 範圍 | 檔案 |
| --- | --- |
| 裁切的換算、檔頭判斷、用途的登記 | `modules/image/__tests__/image-crop.spec.ts`、`image-sniff.spec.ts`、`image-usage.registry.spec.ts` |
| 建立、認領、重新裁切、最近使用 | `modules/image/__tests__/image-asset.service.spec.ts` |
| 處理（真的 sharp）：主檔、變體、`sameAs`、失敗、版本的競爭 | `modules/image/__tests__/image-process.service.spec.ts` |
| 清理 | `modules/image/__tests__/image-maintenance.service.spec.ts` |
| 頭像 | `modules/user/__tests__/user-avatar.service.spec.ts` |
| 端到端（真的 Postgres）：上傳 → 處理 → 頭像、不能拿別人的或已被使用的、換掉與重新裁切、從檔案管理複製與 `file.copy`、最近使用、失敗、清理與容量的對帳 | `apps/api/test/images.spec.ts` |

---

## 16. 設計決策：圖片資產與選圖

### 16.1 背景

系統裡能上傳圖片的地方原本只有檔案管理器，但使用者頭像、租戶 Logo、富文本、留言與審批都需要圖片。每個功能各自做上傳會遇到同樣的問題：

1. **檔案管理器的上傳綁在 `file` feature 上**（`@RequireFeature('file')`、`file:create`）：關掉檔案管理器頭像就不能上傳；只為了換頭像也不該需要「上傳檔案」的權限。
2. **檔案管理器裡的檔案是別人的**：直接引用 `files.id`，檔案被改名、移動、刪除或資料夾的授權改變，引用它的頭像就跟著壞掉或外洩。
3. **選圖的介面每處都得做一次**：上傳、從檔案管理挑、裁切、大小與型別的限制。

使用者希望選圖時能挑不同的來源；某個來源的條件不滿足（feature 沒開、沒有權限、沒有內容）就不列出它；只剩上傳時不顯示來源選擇。

### 16.2 決定

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | **圖片資產另開 `image_assets` 表**（租戶 DB），物件放 `images/<id>/`；有自己的清理排程 `image.maintenance` | `files` 的列表、容量、維護排程、推播、回收桶都假設每一列是檔案管理器裡的檔案，且 `folder_id = null` 已經代表根目錄；混在一起每個查詢都要排除 | `files` 加 `purpose` 欄：改動散在檔案模組各處，而且 `file` 被關掉時要另外放行 |
| D2 | **格式政策抽到 `core/image`**：見 §14.2 D9 | — | — |
| D3 | **容量依租戶、檔案、圖片資產與圖片庫共用一個上限，沿用現有的名稱**：`file.storageQuotaMb`、`file_storage_usage`、`FILE_STORAGE_QUOTA_EXCEEDED` 不改名；主檔計入，變體不計；`file` 關掉時照樣計算。所有租戶的合計另由平台計算（§12） | 容量是租戶「買了多少空間」，與用哪個功能無關；參數 key 與錯誤碼上線後不改名 | 改名成 `storage.quotaMb`／`storage_usage`：要搬移覆寫值、新舊錯誤碼並存、表改名拆兩次部署；各自一個上限：平台要分別設定，租戶看不懂哪個滿了 |
| D4 | **從圖片庫選的圖複製成圖片資產**（[`26-gallery.md`](./26-gallery.md) D1） | 所有來源的生命週期一致 | 見圖片庫 D1 |
| D5 | **複製時來源寫稽核 `<resource>.copy`**（`file.copy`，之後 `galleryItem.copy`）：`resolve(refId, actor, purpose)` 的 `purpose` 寫進 `changes.after.purpose`，來源不解讀它 | 複製是把內容帶到原本授權之外的動作，管理者要追得到；`purpose` 讓來源記下去處，又不必認識呼叫端 | 不寫：追不到內容的去向；呼叫端寫：呼叫端要知道來源的 `resourceType` |
| D6 | **用途預留 `visibility`**（`signed` ｜ `public`），這一版只實作 `signed`；公開網址在第二批做租戶 Logo 時決定（§8） | 登入頁要的不過期網址牽涉快取、撤銷、獨立網域，現在決定缺少實際的使用情境 | 現在就做公開資產：沒有第二個需求驗證設計 |
| D7 | **第一個 consumer 是使用者頭像**：`users.avatar_image_id`、`PATCH /users/:id` 與 `PATCH /auth/profile` 的 `avatarImageId`／`avatarCrop`、`Avatar` 接受圖片並保留縮寫當退路 | 同時驗證裁切、多處顯示（頂列、留言、使用者列表）、他人代換（`user:update`） | 租戶 Logo：卡在 D6 的公開網址 |
| D8 | **`GET /images/usages`** 回所有用途的限制，前端快取到頁面重新載入 | 後端是唯一的事實來源，前後端的數字不會漂移 | 前端各自寫常數：會漂移；經 OpenAPI 產生常數：要改產生器 |
| D9 | **GIF 一律取第一格**；之後需要動畫時用途加 `animated` | 頭像不需要動畫；逐格縮放的成本高 | — |
| D10 | **「最近使用」的副本在失去來源的權限之後仍可再用**：`recent` 的 `resolve` 只檢查 `created_by = actor` | 副本是有權限時建立、只有自己看得到；回頭問來源會讓 `modules/image` 依賴來源的存活與開關 | 回頭檢查原本的來源 |
| D11 | **「最近使用」不另外延長保留**：跟著資產的清理 | 沒被使用的多半是放棄的上傳；真正用過的圖本來就會保留很久 | 至少留 7 天：容量多算、清理排程多一個條件 |
| D12 | **所有物件只寫一次**：主檔在處理時寫一次；變體的 key 帶版本（`images/<id>/r<rev>/…`），重新裁切寫到新的版本、回應帶新的網址，舊版本在網址效期過後刪除 | 物件以 id 為 key、從不覆寫，是穩定網址與長期快取（CDN）的前提；覆寫同一個 key 會讓瀏覽器與 CDN 繼續顯示裁切前的圖 | 覆寫同一個 key 並加 `?v=`：CDN 的快取 key 若忽略查詢字串就失效 |

### 16.3 實作紀錄

- **裁切以比例（0～1）表示，不是主檔的像素**：提案寫「以主檔的像素為單位」，但前端在裁切框裡看到的是原檔（上傳）、檔案的全螢幕預覽（縮小版）或主檔（重新裁切），
  三者的像素都不同，前端也不知道伺服器把主檔縮成多大。改成比例，套用時才依主檔換算（`image-crop.ts`），用途有比例時修正成剛好那個比例。
- **版本分成「要求的」與「已寫好的」**（`rev`、`variant_rev`）：重新裁切在 api 的交易內只遞增 `rev` 並排入處理（sharp 不在 api 的 event loop 跑），
  背景工作寫好後在 `rev` 沒變的條件下才寫回 `variant_rev`；處理途中又裁切了一次，剛寫好的那版交給清理。回應一律用已寫好的版本，所以裁切後到處理完之前仍顯示舊的裁切。
- **`queued_at`**：提案沒有。`pending` 同時代表「還沒上傳完」與「處理中」，清理排程要分辨後者是否卡住。
- **已經正規化的來源直接當主檔**（`ResolvedImage.normalized`）：「最近使用」的來源本來就是主檔，再解碼、重新編碼一次會讓畫質一代代變差、內容雜湊也變了（最近使用就去不了重）。
- **容量的計數搬到 `core/usage`**（`reserveStorageUsage`、`addStorageUsage`、`readStorageUsage`、`StorageSizeSources`）：計數那一列原本只有 `FileRepository` 寫；
  圖片資產也要佔用同一列，對帳也要加上它的合計，而 `modules/image` 不能 import 檔案的 repository。
- **頭像的認領先鎖使用者列**（`UserRepository.lockAvatar`）：`PATCH /auth/profile` 沒有樂觀鎖，同一個人並行換兩次頭像時，要以鎖住後讀到的值為準解除舊的那張，否則有一張會永遠被認領卻沒人用。
- **重新裁切只有建立者做得到**：主檔的網址只在 `GET /images/:id` 給建立者；幫別人換頭像的管理者可以換一張，但不能重新裁切別人上傳的那張（前端提示改選一張）。
- **留言的作者帶頭像**（`Comment.authorAvatar`）：提案只列出留言是「之後要放圖片的地方」；作者的頭像是顯示，不是附件，跟著頭像這一批做。
