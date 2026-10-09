# 圖片庫

- 優先度：P2
- 狀態：規劃中
- 依賴：[`backend/25-image.md`](../architecture/backend/25-image.md) §15（後端的來源介面 `ImageSourceRegistry`、前端的來源註冊表）、
  [`backend/25-image.md`](../architecture/backend/25-image.md)（`ImageUrlService`、`SignedImage`、效期與尺寸）、
  可關閉的 feature（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1、[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §7）、
  影像處理（[`backend/09-file.md`](../architecture/backend/09-file.md) §5.4 的 `core/image`）、標籤（[`backend/18-tag.md`](../architecture/backend/18-tag.md)）、
  留言（[`backend/24-comment.md`](../architecture/backend/24-comment.md)）
- 相關：[`backend/25-image.md`](../architecture/backend/25-image.md) §15（圖片庫是它的來源之一）；檔案管理（平行的功能，互不認識，§2）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

檔案管理器能存圖片，也有伺服器產生的變體與 LightBox，但它是 **檔案** 的工具：

| 檔案管理器的設計 | 對「看圖」的影響 |
| --- | --- |
| 一個檔案只在一個資料夾裡（[`09-file.md`](../architecture/backend/09-file.md) §4.2） | 同一張產品照要出現在「新品」與「2026 春季」兩處，只能放兩份 |
| 排序只有檔名、大小、上傳時間 | 照片最自然的順序是 **拍攝時間**，檔案管理器不讀 EXIF |
| 固定尺寸的卡片（[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §3） | 直式與橫式的照片都被裁成同樣的方塊 |
| LightBox 只在目前載入的項目之間切換，沒有縮放與平移（§6.1） | 看細節要另外下載原圖；看完一頁要關掉 LightBox 再捲動 |
| 資料夾授權、存取申請、上傳資料夾 | 對「一個租戶共用的素材庫」來說太重 |

租戶需要的是另一種工具：集中存放品牌素材、產品照、活動照片，**以看圖為主**，並能讓其他功能（頭像、公告、之後的業務功能）挑圖使用。

使用者的要求：

- 圖片庫與檔案管理 **平行**：兩者互不認識（不 import 對方），只能透過事件、API、feature、註冊表等解耦的方式互相呼叫。
- 圖片庫可以自己上傳，也可以由檔案管理 **加入**。
- 大部分設計參照檔案管理的圖片設計，但更關注閱覽的能力。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 可關閉的 feature `gallery`；後端 `modules/gallery`、前端 `features/gallery` | 相簿層級的授權（像資料夾那樣的 ACL；D4） |
| 自行上傳：直傳物件儲存、全域批次佇列、拖曳與貼上 | 巢狀相簿 |
| 由檔案管理加入：檔案管理器的選取列多一個「加入圖片庫」，以及圖片庫裡的「從其他來源加入」（§9） | 圖片編輯（裁切、濾鏡、調色）；旋轉只做「顯示的方向」（§5） |
| 拍攝時間等 EXIF 資訊、色塊佔位、多種尺寸的變體（§5）；原檔的位置資訊依系統設定移除（D5） | HEIC／RAW（D6） |
| 閱覽：等高排列（justified）與方格兩種排版、依日期分組的時間軸與快速捲動（§6） | 人臉辨識、相似圖片、以顏色搜尋 |
| 檢視器：縮放與平移、跨越整個結果的上一張與下一張、底片列、幻燈片、全螢幕、資訊面板（§7） | 打包下載多張（ZIP；第二批，D8） |
| 相簿（一張圖可以在多個相簿）、標籤、搜尋與篩選、批次操作（§8） | 對外分享連結（不登入就能看；D9） |
| 作為圖片選取的來源（§10） | 版本歷史（D10） |
| 回收桶、稽核、推播、容量（§12） | 匯入匯出；檔案管理器的預覽改用新的檢視器（D12）；圖片庫存到檔案管理（D13） |

## 使用者故事

**作為行銷人員，我希望把活動照片傳上去之後，依拍攝時間瀏覽、放大看細節，以便挑出要用在公告的那幾張。**

- **Given** 我有 `gallery:create`
- **When** 我把 200 張照片拖進圖片庫
- **Then** 上傳進入全域批次佇列；處理完的照片依拍攝時間排進時間軸，直式橫式各自保持比例；
  點開任一張可以滾輪縮放、拖曳平移，← / → 一路看到最後一張，不必關掉檢視器

**作為設計師，我希望把檔案管理器裡已經整理好的素材加入圖片庫，以便其他同事在選圖時直接找得到。**

- **Given** 租戶同時啟用了 `file` 與 `gallery`，我讀得到 `/設計/Logo` 資料夾、也有 `gallery:create`
- **When** 我在檔案管理器框選 12 個檔案，按「加入圖片庫」，選擇相簿「品牌素材」
- **Then** 其中 10 張圖片加入；1 個 PDF 與 1 張 SVG 被略過，結果說明原因；之後刪除或搬移原檔，圖片庫的那 10 張不受影響

**作為租戶管理者，我希望關掉圖片庫之後，檔案管理器裡不再出現「加入圖片庫」，選圖時也不再出現「圖片庫」分頁。**

- **Given** 平台管理者把租戶的 `gallery` 關掉
- **When** 使用者打開檔案管理器、或在頭像按「更換」
- **Then** 「加入圖片庫」與「圖片庫」分頁都消失；只剩上傳時直接打開選檔視窗（[`frontend/23-image-picker.md`](../architecture/frontend/23-image-picker.md) §2）

**作為一般成員，我希望在圖片庫依相簿、標籤與拍攝日期找圖，以便不用問人圖放在哪裡。**

- **Given** 我有 `gallery:read`
- **When** 我選擇相簿「產品照」、標籤「2026 春季」、拍攝日期 3 月
- **Then** 結果以時間軸顯示，右側的日期捲軸可以直接跳到某一天

## 初步構想

### 1. 與檔案管理的差異

| | 檔案管理 | 圖片庫 |
| --- | --- | --- |
| 內容 | 任何檔案 | 只有伺服器能處理的圖片 |
| 組織 | 資料夾樹，一個檔案一個位置 | 相簿（多對多）＋ 標籤；沒有「位置」 |
| 授權 | RBAC 閘門 ＋ 資料夾 ACL（[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md)） | 只有 RBAC（這一版） |
| 預設排序 | 上傳時間 | 拍攝時間（沒有 EXIF 時用上傳時間） |
| 排版 | 固定尺寸的卡片、列表 | 等高排列、方格；依日期分組 |
| 檢視 | LightBox：預覽與原始大小兩段、目前載入的項目之間切換 | 檢視器：連續縮放與平移、整個結果之間切換、幻燈片、資訊面板 |
| 中繼資料 | 檔名、大小、上傳者 | 標題、說明（替代文字）、EXIF（拍攝時間、相機、鏡頭、光圈…）、主色 |
| 上傳 | 任何大小（分塊）、資料夾結構 | 單檔上限（例：50 MiB）、單次 PUT；拖進資料夾只取裡面的圖片、不保留結構 |

### 2. 與檔案管理的關係：平行、互不認識

```
                    ┌──────────────── 通用層（兩邊都認識） ────────────────┐
後端                │ modules/image：ImageSourceRegistry                    │
                    │ core/image：ImageProcessor、變體的格式政策（共用）     │
                    │ core/tenant：可關閉的 feature                          │
                    └───────────────────────────────────────────────────────┘
                         ▲ 登記來源 'file'              ▲ 登記來源 'gallery'、
                         │                              │ 以 resolve(source, refId) 讀其他來源
                    modules/file                    modules/gallery
                    （不知道 gallery）               （不知道 file）

                    ┌──────────────── 通用層（兩邊都認識） ────────────────┐
前端                │ core/file：registerFileAction（新的擴充點，§9.2）      │
                    │ web-core/image-picker：registerImageSource             │
                    │ core/upload：直傳、暫存、拖曳展開（從 features/file 抽出，§13） │
                    └───────────────────────────────────────────────────────┘
                         ▲ 註冊來源 'file'               ▲ 註冊「加入圖片庫」動作、來源 'gallery'
                    features/file                    features/gallery
```

| 互動 | 走哪一種解耦 | 誰登記、誰呼叫 |
| --- | --- | --- |
| 檔案管理 → 加入圖片庫（前端） | **註冊表**：`core/file` 的 `registerFileAction` | 圖片庫登記動作；檔案管理器渲染選取列時列出已登記的動作。圖片庫沒安裝就沒有這個動作 |
| 加入圖片庫（後端） | **API ＋ 註冊表**：`POST /gallery/items/from-source { source, refIds }` → `ImageSourceRegistry.resolve` | 檔案登記來源 `'file'`；圖片庫解析後 `CopyObject`。圖片庫不知道 `'file'` 是什麼，只是把前端給的字串交給註冊表 |
| 圖片庫裡「從其他來源加入」 | **註冊表**：`web-core/image-picker` 的來源對話框，多選模式 | 檔案管理登記來源 `'file'`（[`frontend/23-image-picker.md`](../architecture/frontend/23-image-picker.md) §2）；圖片庫打開對話框，不知道裡面有哪些來源 |
| 選圖時挑圖片庫的圖 | **註冊表**：同上 | 圖片庫登記來源 `'gallery'`（§10） |
| 任一邊被關掉 | **feature**：plugin 卸載 → 註冊的動作與來源消失；後端的來源回 `404 FEATURE_DISABLED` | 不需要任何一邊處理另一邊的開關 |
| 原檔之後被刪除、移動 | **不需要事件**：加入時就 **複製**（§9.1） | 圖片庫不訂閱檔案的事件，兩邊的資料從此無關 |

- 不使用 `DomainEventBus` 同步兩邊的資料：它是程序內、fire-and-forget、不保證送達（[`README.md`](./README.md) §1.2），
  而且複製之後本來就沒有需要同步的狀態。
- 前端「feature 之間只能經由 route id、`apis/`、eventBus」（CLAUDE.md 前端規則 2）：圖片庫的動作呼叫的是 `apis/gallery/*`，
  檔案管理器只看到 `core/file` 的介面，兩個 feature 之間沒有 import。

### 3. 資料模型（租戶 DB）

**`gallery_items`**

| 欄位 | 說明 |
| --- | --- |
| `id` | uuid |
| `title` | 顯示名稱；預設是去掉副檔名的檔名，≤ 255，規則同檔名（[`09-file.md`](../architecture/backend/09-file.md) §4 的 `name`） |
| `description` | 說明，同時當作 **替代文字**（`alt`）；≤ 1000 |
| `status` | `pending`（上傳中）/ `processing`（變體產生中）/ `ready` / `failed` |
| `content_type`、`size`、`storage_key` | 原檔：`gallery/<id>/original`；上傳先寫到 `gallery/<id>/upload`，處理時（依 D5 移除位置資訊後）寫成 `original` 一次，之後不再改 |
| `width`、`height` | 套用 EXIF 方向之後的尺寸；`processing` 時是瀏覽器量的暫定值（§4） |
| `display_rotation` | 0 / 90 / 180 / 270：使用者調整的顯示方向（EXIF 錯誤時用），變體依它重新產生 |
| `variant_rev` | 變體的版本，每次調整顯示方向遞增；變體的 key 是 `gallery/<id>/r<rev>/<變體>.<格式>`（D14） |
| `variant_format` | 變體的主格式（同檔案：progressive JPEG，有透明度用 WebP） |
| `dominant_color` | 主色 `#rrggbb`，載入前的背景色；前端只當資料以 inline style 套用（D11） |
| `placeholder` | 約 30 字元的 BlurHash，載入前的模糊預覽 |
| `taken_at` | EXIF `DateTimeOriginal`（含時區偏移時換算成 UTC；沒有偏移時以租戶的 `general.defaultTimezone` 解讀） |
| `sort_at` | `coalesce(taken_at, created_at)`，產生欄位；時間軸與預設排序都用它 |
| `exif` | jsonb：相機、鏡頭、焦距、光圈、快門、ISO、閃光燈；**不存 GPS**（D5） |
| `location_stripped` | 原檔的位置資訊是否已依系統設定移除（D5） |
| `content_hash` | 原檔的 SHA-256，偵測重複（§4） |
| `source`、`source_ref_id`、`source_name` | `upload`，或加入時的來源與那一筆的 id、名稱（**不是外鍵**） |
| `version` | 樂觀鎖（標題、說明、顯示方向、相簿的變更） |
| `deletion_id`、`created_*` / `updated_*` / `deleted_at` | 慣例欄位；刪除是軟刪除（回收桶） |

索引（都只涵蓋 `deleted_at IS NULL AND status = 'ready'`）：`(sort_at, id)`（時間軸的 keyset）、`(created_at, id)`、
`(title, id)`、`title` 的 trigram（部分比對）、`(content_hash)`、`(source, source_ref_id)`（判斷「已經加入過」）。

**`gallery_albums`**：`id`、`name`（同層唯一、不分大小寫）、`description`、`cover_item_id`（null 時用最新的一張）、`item_count`（反正規化，列表不必 COUNT）、
`version`、慣例欄位、軟刪除。

**`gallery_album_items`**：`(album_id, item_id)` 主鍵、`added_by`、`added_at`。相簿或圖片永久刪除時一起刪。

### 4. 自行上傳

沿用檔案的直傳模型，差在 **只收圖片**、**不需要分塊**：

```
選檔／拖曳（含資料夾：只取圖片、不保留結構）／貼上
  → 驗證：core/file 的檔頭簽章 ＋ 型別在 GALLERY_CONTENT_TYPES ＋ ≤ 單檔上限
  → createImageBitmap 量出尺寸（暫定值，給時間軸先排版）
  → 全域批次佇列的 gallery.upload 操作（web-core/batch；進度、取消、跨分頁接手）
       POST /gallery/items { title, contentType, size, width, height, albumId? } → 直傳網址 → PUT
       POST /gallery/items/:id/complete → status = processing，交易內排入 gallery.process（outbox）
  → worker：解碼 → 讀 EXIF、轉正後的真實尺寸 → 變體、主色、BlurHash、SHA-256 → status = ready → 推播 create
```

- **型別**：`GALLERY_CONTENT_TYPES` = JPEG、PNG、WebP、GIF（第一格）、AVIF、TIFF（與 `IMAGE_VARIANT_SOURCE_TYPES` 相同）。
  不收 SVG（理由同 [`09-file.md`](../architecture/backend/09-file.md) §5.4）。解碼失敗就 `failed`，上傳者的結果彈窗列出原因，紀錄由維護排程清除。
- **HEIC 不支援**（D6）：前端的驗證器認得 `image/heic`、`image/heif` 與 `.heic`／`.heif`，選檔時就擋下並提示「請在相簿 App 匯出成 JPEG 再上傳」；
  後端照樣以型別白名單擋。
- **原檔的位置資訊**（D5）：系統設定 `gallery.stripOriginalLocation`（布林，預設 `true`）開著時，`gallery.process` 在產生變體之前
  以 **不重新編碼像素** 的方式移除原檔的 GPS（改寫 JPEG 的 APP1、PNG 的 `eXIf`、WebP 的 `EXIF` 區塊；AVIF、TIFF 做不到只移除 GPS 時整段移除 EXIF），
  結果寫成 `gallery/<id>/original`（`upload` 隨後刪除）、重新計算 `size` 與 `content_hash`，設 `location_stripped = true`。設定只影響之後的上傳，不回頭處理既有的圖片。
- **列表只出現 `ready` 的圖片**：時間軸要可信的拍攝時間與尺寸才排得對；上傳者在批次佇列與頁首的「處理中 N 張」看到進度。
  與檔案管理器「先推 `create`、變體好了再推 `update`」不同，因為檔案在變體好之前仍可下載，圖片庫的項目在那之前什麼都不能做。
- **單次 PUT、不分塊**：單檔上限 50 MiB（feature 參數 `gallery.maxItemSizeMb`）；照片很少超過，分塊的續傳與網址續期都省掉。
- **重複**：處理完發現 `content_hash` 已經存在時 **仍然保留**，但在上傳結果與資訊面板標示「與『XXX』相同」，讓使用者自己決定刪不刪（D7）。
- **上傳的程式從檔案管理抽出共用**：直傳（`uploadFile` 的單次 PUT 部分）、`uploadSources`（IndexedDB 暫存、跨分頁接手）、
  `collectEntries`（展開拖放的資料夾）目前在 `features/file`，圖片庫不能 import，要先搬到 `core/upload`（§13）。

### 5. 圖片處理：變體、EXIF、佔位

| 變體 | 長邊 | 用途 |
| --- | --- | --- |
| `thumb` | 480 px | 方格、等高排列的小尺寸（列高 ≤ 240 px 的 2x） |
| `medium` | 1280 px | 等高排列的大尺寸、底片列以外的預覽、選圖對話框 |
| `large` | 2560 px | 檢視器的全螢幕 |
| `original` | — | 原檔；檢視器放大超過 `large` 時、下載 |

- **網址**依 [`backend/25-image.md`](../architecture/backend/25-image.md)：回應帶 `ImageSources`，由 `ImageUrlService` 直接簽出物件網址（不經過 api 轉址、不查 DB），
  前端以 `SignedImage` 顯示。列表用寬度描述的 `srcSet`（`thumb 480w, medium 1280w`）＋ `sizes`，讓瀏覽器依列高與螢幕密度選。
  效期 1 小時；無限捲動與檢視器依 `expiresAt` 在到期前重抓（[`backend/25-image.md`](../architecture/backend/25-image.md) §5）。
- **格式**：`thumb`、`medium`、`large` 在處理時各產生主格式與 WebP 兩份，瀏覽器以 `<picture>` 自己選；不依 `Accept` 協商、不做 AVIF（[`backend/25-image.md`](../architecture/backend/25-image.md) D2）。
- **原檔有兩種網址**：檢視器放大超過 `large` 時用的 **inline** 網址（`ImageUrlService` 一併簽出，走 CDN，`<img>` 用）；
  「下載」按鈕另簽帶 `Content-Disposition: attachment` 與檔名的網址，**不走 CDN**（檔名每次不同，[`backend/09-file.md`](../architecture/backend/09-file.md) §17 D4）。
- **佔位**：`dominant_color` 當背景色、`placeholder`（BlurHash）在可視範圍內才解碼成模糊圖；真正的圖片載入後淡入。
  捲動很快時只看得到色塊，不會整片空白。
- **顯示方向**：EXIF 方向寫錯的照片可以「向左轉／向右轉」，存 `display_rotation`、`variant_rev + 1` 並把變體產生到新的版本底下；**不改原檔、不覆寫舊變體**（D14）。
- 處理沿用 `core/image` 的 `ImageProcessor`，格式政策與檔案、圖片資產共用（[`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D2）。
  要新增：讀 EXIF 欄位、算主色與 BlurHash。

### 6. 閱覽

| 能力 | 做法 |
| --- | --- |
| **等高排列**（預設） | 每一列的高度相同、寬度依比例分配，填滿容器寬度（justified layout）；尺寸在 DB 裡，版面不必等圖片載入就算得出來 |
| **方格** | 正方形裁切（`object-fit: cover`），適合快速掃過大量相似的圖 |
| **縮放級別** | 工具列的滑桿（或 ⌘＋／⌘−）調整列高：120／180／240／320 px；記在偏好（localStorage） |
| **依日期分組** | 以 `sort_at` 分成「日」或「月」的區段，區段標題黏在上方；可以關掉分組 |
| **快速捲動** | 右側的日期捲軸：`GET /gallery/items/timeline?<篩選>` 回每個月的數量，依數量與列高估算位置；拖到某個月就以 `sort_at < 月底` 為游標載入 |
| **虛擬捲動** | 只渲染可視範圍上下各一屏的列；版面計算在主執行緒以列為單位增量進行（一次只算新載入的那一頁） |
| **無限捲動** | keyset 分頁（`(sort_at, id)`），一頁 100 張；捲動中有人新增或刪除也不重複、不漏 |
| **多選** | 點選框、Shift 連續選取、框選（沿用檔案管理的 `useMarqueeSelection` 的作法，抽到 `core/` 後共用，§13）；以「日」為單位全選 |
| **RWD** | 窄螢幕預設方格、列高最小 120 px；觸控時長按進入多選 |

- 版面元件放 `@b2b-system/ui`：`JustifiedGrid`（輸入每一項的寬高比，輸出列與位置；不含業務名詞），與虛擬捲動整合。
- 相簿頁、標籤篩選、搜尋結果都是同一個列表元件，只是篩選條件不同。

### 7. 檢視器

| 能力 | 做法 |
| --- | --- |
| **開啟** | 點一下（非多選模式時）、Enter；網址帶 `?item=<id>`，可以直接分享（頁面權限之外不額外授權） |
| **縮放與平移** | 滾輪與觸控板雙指縮放（以游標為中心）、拖曳平移、雙擊在「符合視窗」與「100%」之間切換；觸控用雙指縮放 |
| **漸進載入** | 先顯示已經在快取裡的 `medium`，再換成 `large`；放大超過 `large` 的解析度時才載入 `original` |
| **上一張／下一張** | ← / →、按鈕、觸控左右滑；範圍是 **整個結果**：到了已載入的最後一張就載入下一頁。從分享的網址直接打開時，以 `GET /gallery/items/:id/neighbors?<篩選>` 取前後的 id |
| **預先載入** | 前後各兩張的 `large` 先抓進快取 |
| **底片列** | 下方一列小圖，標出目前的位置，可以點選跳轉；窄螢幕隱藏 |
| **幻燈片** | 空白鍵開始／暫停，間隔 3／5／10 秒；換圖時淡入淡出；尊重 `prefers-reduced-motion`（不做轉場） |
| **全螢幕** | F 鍵或按鈕，Fullscreen API |
| **資訊面板** | I 鍵開關：標題與說明（可以直接編輯）、拍攝時間、相機與鏡頭、曝光參數、尺寸與大小、上傳者、來源（「從檔案管理加入：設計/Logo/a.png」，只是文字，不連回檔案）、所在的相簿、標籤、重複的提示 |
| **留言** | 資訊面板下方放 `<ResourcePanels resourceType="galleryItem">`（[`frontend/22-comment.md`](../architecture/frontend/22-comment.md) §2） |
| **動作** | 下載（原檔／`large`）、加入相簿、編輯標籤、旋轉顯示方向、刪除；依權限顯示 |
| **已被刪除** | 推播或查詢發現目前這張被刪除時顯示「圖片已被刪除」，自動前往下一張 |

- 快捷鍵經全域快捷鍵的註冊表登記，只在檢視器開著時有效（[`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md)）。
- 縮放與平移的元件放 `@b2b-system/ui`：`ImageViewer`（輸入多個解析度的來源，處理手勢與漸進載入）。
  檔案管理器的 `ImagePreview` 之後可以改用它，但不在這一版的範圍（不動檔案管理器的行為）。

### 8. 整理與搜尋

- **相簿**：一張圖可以在多個相簿；相簿不巢狀。相簿列表顯示封面、名稱、張數；相簿頁就是套了 `albumId` 篩選的列表。
  刪除相簿不刪圖片，只刪關聯（相簿本身進回收桶，還原時關聯一起回來）。
- **標籤**：登記標籤組 `gallery`、資源類型 `galleryItem`（[`18-tag.md`](../architecture/backend/18-tag.md) §1.1）。
- **搜尋與篩選**：標題與說明的部分比對、相簿、標籤、拍攝日期範圍、方向（橫式／直式／正方形，由寬高算）、上傳者、來源（自行上傳／加入）。
- **排序**：拍攝時間（預設）、加入時間、標題；方向可反轉。
- **批次操作**（全域批次佇列）：加入相簿、移出相簿、貼標籤、刪除、下載（逐張觸發下載，不打包；D8）。

### 9. 從其他來源加入（含檔案管理）

#### 9.1 後端

```
POST /gallery/items/from-source { source, refIds: string[] (≤ 100), albumId? }
  → 逐筆：ImageSourceRegistry.get(source).resolve(refId, actor, 'gallery')   ← 讀取權限由來源判斷
        → 型別、大小不符合圖片庫 → 略過，結果帶原因
        → 同一個 (source, refId) 已經在圖片庫 → 略過，結果帶 existingItemId
        → CopyObject 到 gallery/<id>/upload → INSERT（status = processing）→ 排入 gallery.process
          （之後與自行上傳相同：處理時依 D5 移除位置資訊、寫成 original 一次）
  ← 200 { results: [{ refId, status: 'added' | 'skipped', itemId?, reason? }] }
```

- **複製，不引用**：加入之後原檔改名、移動、刪除、資料夾授權改變都與圖片庫無關；圖片庫的授權（只有 RBAC）也不必回頭問檔案的資料夾授權。
  代價是同一張圖存兩份，容量多算一次（D2）。
- `CopyObject` 在物件儲存內完成，不經過 api 的記憶體；100 張也只是 100 次短請求，所以同步完成，變體才交給背景工作。
- 路由要 `gallery:create`；來源的 `feature` 沒啟用時那幾筆回 `FEATURE_DISABLED`（整批都是同一個來源，所以實際上是整批失敗）。
- 稽核：每筆一個 `galleryItem.create`（`changes.after` 帶 `source`、`sourceRefId`、`sourceName`）；
  來源那一邊在 `resolve` 裡另寫 `file.copy`（`purpose = 'gallery'`，[`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D5）。

#### 9.2 前端：檔案管理器的「加入圖片庫」

`core/file` 新增第四個擴充點 `registerFileAction`（目前有預覽解析器、驗證器、縮圖產生器，[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §6）：

```ts
// features/gallery/plugin.ts（示意）
registerFileAction({
  id: 'gallery.add',
  labelKey: 'gallery.fileAction.add',
  icon: 'image-plus',
  placement: ['selectionBar', 'contextMenu', 'lightbox'],
  isAvailable: ({ can }) => can(GALLERY_PERMISSION.CREATE),
  /** 每個選取的檔案：能不能處理、不能時的原因（停用並顯示）。 */
  check: (file) => (isGalleryImage(file) ? { ok: true } : { ok: false, reasonKey: 'gallery.fileAction.notImage' }),
  run: (files, ctx) => openAddToGalleryDialog(files.map((f) => ({ source: ctx.sourceId, refId: f.id }))),
});
```

- 檔案管理器在選取列、右鍵選單、LightBox 列出已登記的動作；`check` 全部不通過時按鈕停用並顯示第一個原因，部分通過時照樣可按，略過的列在結果裡。
- `ctx.sourceId` 由檔案管理器提供（它自己登記的後端來源 id），圖片庫不寫死 `'file'`。
- 「加入圖片庫」的對話框（選相簿、可以新建相簿）是圖片庫自己的元件；送出後顯示結果：加入幾張、略過幾張與原因，「前往圖片庫」連結用 route id。
- 前端的 `check` 只是體驗（型別、大小）；尺寸、解碼結果由後端判斷。

#### 9.3 前端：圖片庫裡的「從其他來源加入」

圖片庫的「加入」選單：「上傳」與「從其他來源…」。後者打開 [`frontend/23-image-picker.md`](../architecture/frontend/23-image-picker.md) §2 的 `ImageSourceDialog`，以 **多選模式** 列出其他來源
（排除上傳、最近使用、圖片庫自己）。目前實際上只有檔案管理；檔案管理沒啟用或沒有權限時，「從其他來源…」不出現。

- 來源的元件要支援多選：`registerImageSource` 加 `supportsMultiple`，不支援的來源在多選模式不列出。
- 這條路與 9.2 的結果相同（同一支 `from-source`），只是從圖片庫這一邊發起。

### 10. 作為圖片選取的來源

圖片庫的 plugin 登記 `registerImageSource({ id: 'gallery', … })`，後端登記 `ImageSourceRegistry` 的 `'gallery'`：

- 可用的條件：`gallery` 已安裝、有 `gallery:read`。
- 分頁內容是精簡版的列表：相簿切換、搜尋、方格；依用途過濾（型別、大小不符合的不列出；尺寸太小的列出但停用，同 [`backend/25-image.md`](../architecture/backend/25-image.md) §15 §9）。
- 選取之後 [`backend/25-image.md`](../architecture/backend/25-image.md) §15 複製成圖片資產（D1）；`resolve` 回原檔的 `storageKey`（已依 D5 移除位置資訊的那份），並寫 `galleryItem.copy`。

### 11. 權限

| 權限鍵 | 說明 |
| --- | --- |
| `gallery:read` | 進入圖片庫、瀏覽、檢視器、下載；選圖時看得到「圖片庫」分頁 |
| `gallery:create` | 上傳、從其他來源加入、建立相簿 |
| `gallery:update` | 編輯標題、說明、顯示方向；管理相簿（改名、封面、加入與移出圖片） |
| `gallery:delete` | 刪除圖片與相簿（移到回收桶） |

- 蘊含：`create`、`update`、`delete` 都蘊含 `read`（與 `file` 相同，[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) 的蘊含表）。
- 預設角色：`super-admin`、`admin` 全部；`auditor` 與 `member` 只有 `read`（D3）。
- 頁面權限 `GALLERY`：`gallery:read`。

### 12. 稽核、推播、回收桶、feature、容量

- **稽核**：`galleryItem.create`（處理完成時，不是登記時；帶來源）、`galleryItem.update`（只記有變的欄位）、`galleryItem.delete`、`galleryItem.restore`；
  `galleryAlbum.create`、`.update`、`.delete`、`.restore`；加入與移出相簿記在 `galleryAlbum.update` 的 `changes`（一次批次一筆）。
- **推播**：`ChangeSource.GALLERY_ITEM`、`GALLERY_ALBUM`，受眾 `gallery:read`；前端失效列表與詳情，檢視器據此偵測「已被刪除」。
  `galleryItem` 的 `create` 只在 `ready` 時推一次。
- **回收桶**：圖片與相簿各自註冊 `TrashHandler`；物件保留到 `trash.purge` 才刪；`POST /gallery/items/:id/restore` 標 `@RequireFeature('trash')`。
- **feature**：可關閉的 feature `gallery`。停用時端點回 `404 FEATURE_DISABLED`、背景工作照常完成（資料要一致）、
  前端 plugin 卸載（連同登記的檔案動作與圖片來源）、資料保留。新租戶與既有租戶都預設啟用：平台 migration 把 `gallery` 加進預設值並啟用既有租戶（D3）。
  停用前的影響數量（[`05-tenancy.md`](../architecture/05-tenancy.md) §12.5）：圖片數、相簿數。
- **容量**：原檔計入租戶的儲存容量；變體不計（與檔案相同）。與檔案、圖片資產共用租戶的容量 `file.storageQuotaMb`（[`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D3）；所有租戶的合計受系統的止水線限制（[`backend/25-image.md`](../architecture/backend/25-image.md) D8）。
- **維護排程** `gallery.maintenance`：逾時的 `pending` 與 `failed`、卡住的 `processing` 重新排入、物件儲存的孤兒（`gallery/` 前綴）、舊版本的變體。
  永久刪除（`trash.purge`）與刪除舊版本的變體之後，呼叫 `CdnPurger.schedule(keys)`（物件 key，`core/storage` 加上 bucket）清理邊緣快取（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.6）。
- **指標**：`gallery.process` 的處理時間與失敗數（[`08-monitoring.md`](../architecture/08-monitoring.md) §2.4）。

### 13. 會動到的既有模組

| 模組 | 改動 | 理由 |
| --- | --- | --- |
| `features/file` → `core/upload`（新） | 搬出直傳（單次 PUT）、`uploadSources`、`collectEntries`；檔案管理器改從 `core/upload` 匯入，行為不變 | 圖片庫不能 import `features/file` |
| `core/file` | 新增擴充點 `registerFileAction`；檔案管理器在選取列、右鍵選單、LightBox 渲染 | 讓其他 feature 對檔案提供動作，檔案管理器不必認識它們 |
| `features/file` 的框選 | `useMarqueeSelection` 的幾何計算抽到 `core/` 或 `web-core` | 圖片庫的多選要用 |
| `core/image` | 格式政策抽出共用；加 EXIF 讀取、主色、BlurHash、裁切（給 image-picker） | 檔案、圖片資產、圖片庫三處共用 |
| `modules/file` | 登記後端來源 `'file'`（`resolve`：既有的可見性檢查 ＋ 回原檔的 key） | image-picker 已經需要；圖片庫沿用 |
| `@b2b-system/ui` | 新增 `JustifiedGrid`、`ImageViewer` | 通用的版面與檢視元件 |
| `modules/tag`、`modules/comment` | 登記 `galleryItem` | 照各自的「加入一種資源」步驟 |
| `core/storage`、`core/image`、`web-core` | 使用 `ObjectUrlSigner`、`ImageUrlService`、`SignedImage`（由 [`backend/25-image.md`](../architecture/backend/25-image.md) 先做好） | 網址的產生與顯示三份提案共用 |
| `core/storage`（CDN 啟用時） | 刪除物件後呼叫 `CdnPurger.schedule(keys)`（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.6） | 沒有啟用 CDN 時是 no-op，照樣要呼叫 |

## 開放問題

全部已有結論（2026-10-09，照提案的傾向定案）；決定的理由與評估過的方案見下方「設計決策」。

1. **選圖時從圖片庫選的圖，要複製成圖片資產，還是引用圖片庫的那一筆？**（原 [`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D4）
   複製讓所有來源的生命週期一致，圖片庫刪圖不影響頭像；引用才能做到「圖片庫換掉 Logo，所有用到的地方一起換」，
   但圖片庫刪圖前要知道誰在用（被使用的不能刪，或刪了之後那些地方變成沒有圖片）。傾向複製。
   - **結論**：複製（D1）。
2. **由檔案管理加入時複製一份，同一張圖存兩份、容量算兩次，可以接受嗎？** 不複製的話，圖片庫要引用檔案、回頭問資料夾授權，
   兩邊就不再互不認識。傾向接受；之後若在意，可以在物件儲存層以 `content_hash` 去重（對使用者透明）。
   - **結論**：接受（D2）。
3. **`member` 預設有沒有 `gallery:read`（甚至 `create`）？新租戶與既有租戶預設啟用 `gallery` 嗎？**
   傾向：`member` 有 `read`；新租戶預設啟用、既有租戶以平台 migration 啟用（與其他新的可關閉 feature 一致，升版不讓任何租戶失去功能——不過這次是新增功能，也可以預設關閉讓平台逐一打開）。
   - **結論**：`member` 只有 `read`；新租戶與既有租戶都預設啟用（D3）。
4. **要不要相簿層級的授權？** 例：「人資活動照」只給人資部看。這一版只有 RBAC，整個圖片庫對有 `gallery:read` 的人全部可見。
   要做的話沿用關係圖（[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md) §10.1 的步驟），但一張圖在多個相簿時，可見性是「任一相簿可見」，列表的查詢會複雜很多。
   - **結論**：這一版不做（D4）。
5. **原檔的 GPS 怎麼處理？** 變體一律移除中繼資料；`exif` 欄不存 GPS。但「下載原檔」會帶著 GPS。選項：
   (a) 原檔原封不動（現狀，與檔案管理一致）；(b) 上傳時就移除原檔的 GPS（原檔不再是原檔）；(c) 租戶設定決定。傾向 (c)，預設移除。
   - **結論**：(c)，系統設定 `gallery.stripOriginalLocation`，預設移除（D5）。
6. **HEIC（iPhone 預設格式）要不要支援？** sharp 預編譯的 libvips 不含 HEIC 解碼（專利），要自己編 libvips 或在前端轉檔。
   傾向這一版不支援，選檔時提示「請匯出成 JPEG」。
   - **結論**：不支援，選檔時擋下並提示（D6）。
7. **重複的圖片要擋下還是保留？** 傾向保留並標示（同一張圖可能刻意放兩次、用不同的標題）；擋下的話，上傳者在處理完成之後才會知道，體驗也不好。
   - **結論**：保留並標示（D7）。
8. **要不要打包下載多張（ZIP）？** 要的話是背景工作組裝、放 bucket、給下載連結（沿用匯入匯出的作法，[`22-data-transfer.md`](../architecture/backend/22-data-transfer.md)）。傾向第二批。
   - **結論**：第二批（D8）。
9. **要不要對外分享連結（不登入就能看的相簿）？** 會碰到與租戶 Logo 相同的問題（不過期的公開網址，[`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D6），另外還要撤銷、到期、密碼。傾向不做或第二批。
   - **結論**：這一版不做；與 [`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D6 的公開網址一起評估（D9）。
10. **標題、說明要不要版本歷史？** 傾向不要：圖片庫的中繼資料改動少、價值低；`version` 欄照樣有（樂觀鎖）。
    - **結論**：不要（D10）。
11. **主色怎麼存？** 存 `#rrggbb` 最簡單，但前端規則「顏色一律走 Design Token、不寫十六進位色碼」是針對樣式表；這裡是資料，以 inline style 套用。
    傾向存 `#rrggbb`、前端只當資料用，並在規範裡註明這個例外。
    - **結論**：存 `#rrggbb`，歸檔時在 coding-standards 註明例外（D11）。
12. **檔案管理器的 `ImagePreview` 要不要也改用新的 `ImageViewer`（縮放與平移）？** 這一版不動；做完圖片庫之後再評估。
    - **結論**：這一版不動（D12）。
13. **反方向：圖片庫的圖要不要能「存到檔案管理」？** 對稱的作法是檔案管理登記一個「目的地」、圖片庫在檢視器列出。目前沒有需求，傾向不做。
    - **結論**：不做（D13）。

## 設計決策

背景見「背景」一節。歸檔時整節搬進 `backend/26-gallery.md` 的最後一章（前端的部分搬進 `frontend/24-gallery.md`）。

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D0 | **與檔案管理平行、互不認識**：後端經 `modules/image` 的 `ImageSourceRegistry`、前端經 `core/file` 的 `registerFileAction` 與 `web-core/image-picker` 的來源註冊表互相呼叫；開關由可關閉的 feature 處理；不以 `DomainEventBus` 同步資料（§2） | 使用者的要求；兩邊各自可以被關掉，任何一邊都不必處理另一邊的開關 | 圖片庫直接 import 檔案模組：關掉 `file` 時圖片庫要另外判斷，依賴是單向寫死的 |
| D1 | **選圖時從圖片庫選的圖複製成圖片資產**（[`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D4） | 所有來源的生命週期一致；圖片庫刪圖、改圖不影響已經用上的地方，也不必在刪除前查「誰在用」 | 引用：可以「換一次 Logo 全部更新」，但刪除要擋或讓引用處變空，而且圖片庫的 RBAC 會變成頭像能不能顯示的條件 |
| D2 | **由其他來源加入時複製，接受同一張圖存兩份**；之後若在意容量，在物件儲存層以 `content_hash` 去重，對使用者透明 | 引用就得回頭問資料夾授權，兩邊不再互不認識；照片的容量相對於租戶上限通常不大 | 引用檔案 |
| D3 | **權限與預設**：`gallery:read`／`create`／`update`／`delete`（後三者蘊含 `read`）；`super-admin`、`admin` 全部，`auditor`、`member` 只有 `read`。可關閉的 feature `gallery`，新租戶預設啟用，既有租戶由平台 migration 啟用 | 圖片庫是租戶共用的素材庫，人人能看、少數人維護；預設啟用與其他新的可關閉 feature 一致 | `member` 也有 `create`：素材庫容易變雜；預設關閉：平台要逐一打開 |
| D4 | **這一版只有 RBAC，沒有相簿層級的授權** | 一張圖在多個相簿時可見性是「任一相簿可見」，列表的查詢與 `capabilities` 都會複雜很多；先確認需求 | 沿用關係圖做相簿 ACL |
| D5 | **原檔的位置資訊依系統設定 `gallery.stripOriginalLocation` 移除**（布林，預設 `true`，租戶層，[`12-settings.md`](../architecture/backend/12-settings.md)）：處理時以不重新編碼像素的方式移除 GPS，做不到時整段移除 EXIF；只影響之後的上傳。`exif` 欄一律不存 GPS，變體一律移除中繼資料 | 素材庫的圖會被很多人下載、拿去對外使用，拍攝地點容易外洩；需要保留的租戶（例：實地勘查照片）可以關掉 | 原封不動：與檔案一致，但預設會外洩；一律移除：需要的租戶沒有出路 |
| D6 | **不支援 HEIC／HEIF**：前端驗證器擋下並提示匯出成 JPEG，後端型別白名單照樣擋 | sharp 預編譯的 libvips 不含 HEIC 解碼；自己編 libvips 會讓映像與 CI 變複雜 | 自編 libvips；前端轉檔（WASM 解碼器很大，而且要把轉出的圖再上傳） |
| D7 | **重複的圖片保留並標示**（`content_hash` 相同時，在上傳結果與資訊面板提示） | 可能是刻意的（不同標題、不同相簿用途）；擋下的話上傳者在處理完成後才會知道 | 擋下；上傳前在瀏覽器算雜湊再查：大檔要先讀完整個檔案 |
| D8 | **打包下載（ZIP）延到第二批**；這一版的批次下載是逐張觸發 | 要背景工作組裝、放 bucket、清理，與匯入匯出的匯出相同的工程量 | — |
| D9 | **不做對外分享連結**；與 [`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D6 的公開網址一起評估 | 公開網址的快取、撤銷、到期都還沒有設計 | — |
| D10 | **標題、說明不做版本歷史**；照樣有 `version`（樂觀鎖） | 改動少、價值低 | 接 `RevisionService` |
| D11 | **主色存 `#rrggbb`**，前端只當資料以 inline style 套用；歸檔時在 [`coding-standards/`](../coding-standards/README.md) 註明「資料裡的顏色」不受「不寫十六進位色碼」限制 | 規則針對的是樣式表裡的顏色；這是每張圖不同的資料，不可能是 Design Token | 存 `oklch` 字串：沒有實質好處，前端還要多一層轉換 |
| D12 | **檔案管理器的 `ImagePreview` 這一版不改用 `ImageViewer`** | 不動檔案管理器的行為；做完圖片庫再評估 | — |
| D13 | **不做「圖片庫存到檔案管理」**；需要時由檔案管理登記一個「目的地」，與 D0 同一種解耦 | 目前沒有需求 | — |
| D14 | **所有物件只寫一次**（與 [`backend/25-image.md`](../architecture/backend/25-image.md) §16.2 D12 相同）：原檔在處理時寫一次；變體的 key 帶 `variant_rev`，調整顯示方向寫到新的版本，舊版本在網址效期（1 小時）過後由 `gallery.maintenance` 刪除 | 穩定網址與長期快取（瀏覽器、CDN：[`backend/09-file.md`](../architecture/backend/09-file.md) §16）的前提 | 覆寫同一個 key |

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/26-gallery.md`：資料模型、上傳與處理、從其他來源加入、權限、稽核與推播、回收桶；設計決策在最後一章
- `docs/architecture/frontend/24-gallery.md`：閱覽（等高排列、時間軸、快速捲動）、檢視器、整理與搜尋、檔案動作的登記
- `docs/architecture/frontend/12-file-manager.md` §6：新的擴充點 `registerFileAction`；§2 改成從 `core/upload` 匯入
- `docs/architecture/frontend/07-ui-system.md`：`JustifiedGrid`、`ImageViewer`
- `docs/architecture/iam/02-permission-catalog.md`：`gallery:*`
- `docs/architecture/05-tenancy.md` §5.1：可關閉的 feature 多一個 `gallery`
