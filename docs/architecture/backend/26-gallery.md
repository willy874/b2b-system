# 26 — 圖片庫

租戶共用的素材庫：集中存放品牌素材、產品照、活動照片，**以看圖為主**，並能讓其他功能（頭像、公告、之後的業務功能）挑圖使用。
可以自己上傳，也可以由檔案管理 **加入**；兩者 **平行、互不認識**（§2、D0）。前端見 [`../frontend/24-gallery.md`](../frontend/24-gallery.md)；決定與理由見 §14。

```
上傳：POST /gallery/items → 直傳網址 → PUT → POST /gallery/items/:id/complete ─┐
加入：POST /gallery/items/from-source → ImageSourceRegistry.resolve → CopyObject ─┤（交易內排入 gallery.process，outbox）
                                                                              ▼
gallery.process：檔頭判型別 → 解碼、讀 EXIF → 依設定移除原檔的 GPS → 寫 original 一次 → 主色、SHA-256
                 → 依顯示方向產生 thumb／medium／large（主格式＋WebP）與 BlurHash，寫到 r<rev>/ → ready
                 → 第一次 ready：稽核 galleryItem.create、推播 create
列表：GET /gallery/items（keyset）、/timeline、/:id、/:id/neighbors → ImageUrlService 簽出 ImageSources
```

## 1. 與檔案管理的差異

| | 檔案管理（[`09-file.md`](./09-file.md)） | 圖片庫 |
| --- | --- | --- |
| 內容 | 任何檔案 | 只有伺服器能處理的圖片（§4） |
| 組織 | 資料夾樹，一個檔案一個位置 | 相簿（多對多）＋ 標籤；沒有「位置」 |
| 授權 | RBAC 閘門 ＋ 資料夾 ACL | 只有 RBAC（D4） |
| 預設排序 | 上傳時間 | 拍攝時間（沒有 EXIF 時用加入時間） |
| 中繼資料 | 檔名、大小、上傳者 | 標題、說明（替代文字）、EXIF、主色、BlurHash |
| 上傳 | 任何大小（分塊）、資料夾結構 | 單檔上限（feature 參數，預設 50 MiB）、單次 PUT；拖進資料夾只取圖片、不保留結構 |
| 預覽 | LightBox（[`../frontend/12-file-manager.md`](../frontend/12-file-manager.md) §6.1） | 檢視器：連續縮放、整個結果之間切換、幻燈片、資訊面板 |

## 2. 與檔案管理的關係：平行、互不認識

```
                    ┌──────────────── 通用層（兩邊都認識） ─────────────────┐
後端                │ modules/image：ImageSourceRegistry、ImageUsageRegistry │
                    │ core/image：ImageProcessor、EXIF、BlurHash             │
                    │ core/tenant：可關閉的 feature                          │
                    └────────────────────────────────────────────────────────┘
                         ▲ 登記來源 'file'              ▲ 登記來源 'gallery'、用途 gallery.item；
                         │                              │ 以 resolve(source, refId) 讀其他來源
                    modules/file                    modules/gallery
                    （不知道 gallery）               （不知道 file）
```

| 互動 | 解耦的方式 |
| --- | --- |
| 檔案管理 → 加入圖片庫 | 前端的 `registerFileAction`（[`../frontend/12-file-manager.md`](../frontend/12-file-manager.md) §6）＋ `POST /gallery/items/from-source { source, refIds }`。`source` 是前端給的字串，圖片庫只交給 `ImageSourceRegistry`（§8） |
| 選圖時挑圖片庫的圖 | 圖片庫登記來源 `'gallery'`（§9） |
| 任一邊被關掉 | 可關閉的 feature：前端 plugin 卸載，登記的動作與來源一起消失；後端的來源回 `404 FEATURE_DISABLED` |
| 原檔之後被刪除、移動 | 不需要事件：加入時就 **複製**（D2），兩邊的資料從此無關 |

不以 `DomainEventBus` 同步兩邊的資料：它是程序內、fire-and-forget，而且複製之後沒有需要同步的狀態。

## 3. 資料模型（租戶 DB，migration `0053_gallery`）

**`gallery_items`**（`db/schema/gallery.ts`）

| 欄位 | 說明 |
| --- | --- |
| `title`、`description` | 標題（預設是去掉副檔名的檔名，≤ 255，規則同檔名）；說明同時當作替代文字（≤ 1000） |
| `status`、`failure_reason` | `pending`（等直傳）/ `processing` / `ready` / `failed`；失敗的原因 `notImage`、`typeNotAllowed`、`tooLarge`、`missing` |
| `content_type`、`size` | pending 時是登記的值；處理後是以檔頭判斷的型別與原檔（移除位置資訊後）的大小。`size` 計入租戶容量 |
| `width`、`height` | 套用 EXIF 方向之後的尺寸（不含 `display_rotation`）；pending 時是瀏覽器量的暫定值 |
| `display_rotation` | 0 / 90 / 180 / 270：使用者調整的顯示方向（§5.3） |
| `has_original` | 原檔已經寫好（處理重試時跳過第一步） |
| `rev`、`variant_rev`、`variants`、`variant_format` | 要求的變體版本、已寫好的版本與它的描述（與圖片資產同一個形狀）、主格式（D14、D17） |
| `dominant_color`、`placeholder` | 主色 `#rrggbb`（D11）、BlurHash |
| `taken_at`、`sort_at` | EXIF 的拍攝時間（§5.2）；`sort_at = coalesce(taken_at, created_at)` 是產生欄位，時間軸與預設排序用它 |
| `exif` | jsonb：相機、鏡頭、焦距、光圈、快門、ISO、閃光燈；**不存 GPS**（D5） |
| `location_stripped` | 原檔的位置資訊已依系統設定移除 |
| `content_hash` | 原檔的 SHA-256：重複的保留並標示（D7） |
| `source`、`source_ref_id`、`source_name` | `upload` 或加入時的來源與那一筆的 id、名稱（**不是外鍵**） |
| `version` | 樂觀鎖：標題、說明、顯示方向；相簿與標籤的變更不遞增 |
| `queued_at`、`stale_revs_purge_after` | 清理排程用：卡住的處理、舊版本的變體何時可以刪（§11.5） |
| 慣例欄位 | `created_*`／`updated_*`／`deleted_at`（軟刪除，回收桶） |

列表的索引都只涵蓋 `deleted_at IS NULL AND status = 'ready'`：`(sort_at, id)`、`(created_at, id)`、`(title, id)`、
標題與說明的 trigram（GIN）；另有 `(content_hash)`、`(source, source_ref_id)`（判斷「已經加入過」）、`(created_by, status)`（上傳者的「處理中 N 張」）。

**`gallery_albums`**：`name`（不分大小寫唯一，只算沒刪除的）、`description`、`cover_item_id`（`ON DELETE SET NULL`）、`version`、慣例欄位、軟刪除。
張數與封面在查詢時算，沒有反正規化的 `item_count`（D15）。

**`gallery_album_items`**：`(album_id, item_id)` 主鍵、`added_by`、`added_at`；相簿或圖片永久刪除時隨外鍵 CASCADE 刪除。

物件都在 `gallery/<id>/` 底下，每個物件只寫一次（D14）：

| key | 內容 |
| --- | --- |
| `gallery/<id>/upload` | 瀏覽器直傳、或從其他來源複製來的檔案；處理完就刪 |
| `gallery/<id>/original` | 原檔（依 D5 移除位置資訊後）；處理時寫一次 |
| `gallery/<id>/r<rev>/<尺寸>.<格式>` | 變體；調整顯示方向寫到新的版本 |

`file.maintenance`、`image.maintenance` 不碰 `gallery/` 前綴，由 `gallery.maintenance` 對帳（§11.5）。

## 4. 自行上傳

沿用檔案的直傳模型，差在 **只收圖片**、**不分塊**：

```
POST /gallery/items { fileName, contentType, size, width?, height?, albumId? }
  → 型別白名單、≤ 單檔上限、每人 pending ≤ 50、容量（交易內佔用）→ INSERT（pending）
  ← { item, upload: { url, method: 'PUT', headers, expiresAt } }   ← 大小與型別簽進網址
PUT（瀏覽器直傳物件儲存）
POST /gallery/items/:id/complete
  → HEAD 確認大小 → status = processing，同一個交易排入 gallery.process（outbox）
```

- **型別**：`GALLERY_CONTENT_TYPES` = JPEG、PNG、WebP、GIF（第一格）、AVIF、TIFF。不收 SVG（不讓 api 解析使用者給的 XML）；
  **不收 HEIC／HEIF**（D6）：登記時回 `422 GALLERY_TYPE_NOT_ALLOWED`，前端選檔時就擋下並提示匯出成 JPEG。
- **單檔上限**：feature 參數 `gallery.maxItemSizeMb`（1～200，預設 50；[`../05-tenancy.md`](../05-tenancy.md) §5.3）。超過回 `413 GALLERY_ITEM_TOO_LARGE`。
- **列表只出現 `ready` 的圖片**：時間軸要可信的拍攝時間與尺寸才排得對。上傳者以 `GET /gallery/items/uploads` 看到自己的「處理中 N 張」與失敗的清單（回應另帶單檔上限的生效值 `maxItemSize`，前端選檔時先檢查），
  `DELETE /gallery/items/uploads/failed` 清掉自己失敗的紀錄。與檔案「先推 `create`、變體好了再推 `update`」不同：圖片庫的項目在 ready 之前什麼都不能做。
- `albumId`：處理完成後已經在那個相簿裡（登記時就寫進關聯，列表只顯示 ready 的）。

## 5. 處理：`gallery.process`

`GalleryProcessService` 分兩步，每一步都可以重做（重試、清理排程重新排入）：

1. **還沒有原檔**（`has_original = false`）：讀 `upload`（超過上限就停止讀取）→ **以檔頭判斷型別**（不信任宣告的型別）→ 解碼、讀 EXIF →
   依系統設定移除 GPS（§5.1）→ 寫 `original` → 記錄型別、大小（計入容量的值改成原檔的）、尺寸、SHA-256、EXIF、拍攝時間、主色 → 刪 `upload`。
2. **要求的版本（`rev`）還沒寫好**：依 `display_rotation` 產生 `thumb`（480）、`medium`（1280）、`large`（2560）× 主格式與 WebP，加上 BlurHash，
   寫到 `r<rev>/` → `variant_rev = rev`、`ready`。比原圖大的尺寸不放大，同一個物件共用（`sameAs`）。
   第一次 ready 時寫 `galleryItem.create` 的稽核（actor 是上傳者）並推 `create`；之後（調整方向）推 `update`。

失敗（不是圖片、型別不收、太大、原檔不見）不會因為重試而成功：還沒有任何版本的標成 `failed`；已經有版本的（調整方向）保留原本的版本。
儲存服務暫時不可用則拋出，交給背景工作重試。一個 worker 程序同時處理 2 張（解碼大圖很吃記憶體）。

格式政策（progressive JPEG，有透明度用 WebP）、網址與效期沿用 [`25-image.md`](./25-image.md)；`core/image` 新增的是 EXIF 的解析與 GPS 移除（`exif.ts`）、
主色與 BlurHash 的輸入（`DecodedImage.analyze`）、BlurHash 的編碼（`blurhash.ts`）、旋轉（`RenderOptions.rotate`）。

### 5.1 原檔的位置資訊（D5）

系統設定 `gallery.stripOriginalLocation`（布林，預設 `true`，分類 `gallery`）開著、而且 EXIF 有 GPS 時，以 **不重新編碼像素** 的方式移除：
在原檔裡找到 sharp 讀出的那段 EXIF（JPEG 的 APP1、WebP 的 `EXIF` 區塊、AVIF 的 Exif item、PNG 的 `eXIf`；TIFF 整個檔案就是 TIFF 結構），
把 GPS IFD 的每個欄位與它指向的值填 0、欄位數改成 0；長度不變，外層容器不必改寫（PNG 另外重算那個區塊的 CRC）。
**找不到 EXIF 在檔案裡的位置時**，退回重新輸出一份沒有中繼資料的檔案（主格式、品質 95）：寧可多一次編碼也不讓位置外洩（D16）。

設定只影響之後的處理，不回頭處理既有的圖片。變體一律移除中繼資料、`exif` 欄一律不存 GPS，與設定無關。

### 5.2 拍攝時間

EXIF 的 `DateTimeOriginal`：有 `OffsetTimeOriginal` 時換算成 UTC；沒有時以租戶的 `general.defaultTimezone` 解讀（`Intl` 兩次校正，同公告的週期計算）。
年份早於 1900、不存在的日期（`2026:02:30`）、相機沒設時間的 `0000:00:00` 都視為沒有，時間軸改用加入時間。

### 5.3 顯示方向

EXIF 方向寫錯的照片可以「向左轉／向右轉」：`PATCH /gallery/items/:id { version, displayRotation }` → `rev + 1`、交易內排入 `gallery.process`，
變體產生到新的版本底下；**不改原檔、不覆寫舊變體**（D14）。新版本寫好之前，回應照樣是舊版本的網址；
寫好之後 `stale_revs_purge_after = 現在 + 網址效期`，舊版本由清理排程刪除。原檔沒有轉，所以轉過的圖不提供原檔的 inline 網址（§6）。

## 6. 列表、時間軸與網址

| 端點 | 說明 |
| --- | --- |
| `GET /gallery/items` | keyset 分頁（一頁 100、最多 200）；回 `{ items, nextCursor, prevCursor }` |
| `GET /gallery/items/timeline?field=sortAt\|createdAt` | 每個月的張數（新到舊），以租戶的預設時區分月；日期捲軸用 |
| `GET /gallery/items/:id` | 詳情：EXIF、上傳者、來源、所在的相簿、標籤、內容相同的其他圖（最多 5 張，D7）、下載網址 |
| `GET /gallery/items/:id/neighbors` | 同一組篩選與排序下的前一張與下一張（從分享的網址直接打開檢視器時） |

- **篩選**（三者共用）：`keyword`（標題與說明的部分比對）、`albumId`、`tagIds`（任一個）、`takenFrom`／`takenTo`（以 `sort_at` 比對，`takenTo` 不含）、
  `orientation`（`landscape`／`portrait`／`square`，以套用顯示方向後的寬高算，差距 1% 內是正方形）、`uploaderId`、`origin`（`upload`／`added`）、
  `imageUsage`（選圖用：只列能當這個用途的型別與大小，§9）。
- **排序**：`sortAt`（預設，新到舊）、`createdAt`、`title`；游標是「排序值 ＋ id」，捲動途中有人新增或刪除也不重複、不漏。
  游標的排序與請求不一致時回 `400 VALIDATION_FAILED`。
  游標帶方向：`nextCursor` 取之後的一頁，`prevCursor` 取之前的一頁（前端的無限捲動只保留最近幾頁，往回捲時抓回被丟掉的頁；D22）。
  沒帶游標也沒有 `startAt` 的第一頁、或往前取已到最前面時 `prevCursor` 是 null。舊的游標（沒有方向）視為往後。
- **`startAt`**：日期捲軸的跳轉——以「那個時間點」為起點載入（`sort_at <= startAt`，升冪時反過來），不必一路捲過去（D18）。
- **網址**：每張圖帶 `ImageSources`（[`25-image.md`](./25-image.md) §5），版面 `grid`（`thumb 480w, medium 1280w`）、`medium`、`large`；
  未轉向的圖另帶 `original` 的 inline 網址（TIFF 除外：瀏覽器不能顯示）。效期 1 小時，由 `ImageUrlService` 直接簽，不查 DB。
  詳情另簽兩個下載網址（原檔、`large`，`Content-Disposition: attachment` 帶標題當檔名）。
- **CDN**（[`09-file.md`](./09-file.md) §16）：變體的集合標 `cdn: 'galleryItem'`（`ImageObjectSet.cdn`），`FILE_CDN_RESOURCES` 含 `galleryItem` 時改簽邊緣的網址；
  原檔的 inline 與兩個下載網址不標，一律 presigned（D21）。

## 7. 相簿

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /gallery/albums`、`GET /gallery/albums/:id` | `read` | 名稱排序；每個相簿帶張數與封面（指定的封面看得到就用它，否則相簿裡最新的一張） |
| `POST /gallery/albums` | `create` | 名稱不分大小寫唯一（`409 GALLERY_ALBUM_NAME_DUPLICATE`） |
| `PATCH /gallery/albums/:id` | `update` | 名稱、說明、封面（封面必須在相簿裡，`422 GALLERY_ALBUM_COVER_INVALID`）；樂觀鎖 |
| `POST /gallery/albums/:id/items`、`/items/remove` | `update` | 一次最多 500 張；已經在的略過、處理失敗的不加；一次一筆 `galleryAlbum.update` 稽核 |
| `DELETE /gallery/albums/:id`、`POST …/restore` | `delete` | 刪除相簿不刪圖片；關聯不動，還原時一起回來 |

一張圖可以在多個相簿；相簿不巢狀。相簿頁就是套了 `albumId` 篩選的圖片列表。

## 8. 從其他來源加入

```
POST /gallery/items/from-source { source, refIds: string[] (≤ 100), albumId? }       ← gallery:create
  → source 是 'gallery' 或 'upload' → 404 IMAGE_SOURCE_NOT_FOUND
  → ImageSourceRegistry.get(source)                  ← 來源的 feature 沒啟用：整批 404 FEATURE_DISABLED
  → 逐筆：resolve(refId, actor, 'gallery')            ← 讀取權限由來源判斷（檔案：資料夾授權），讀不到 → notFound
        → 型別不收 → typeNotAllowed；超過單檔上限 → tooLarge
        → 同一個 (source, refId) 已經在圖片庫 → alreadyAdded（帶 existingItemId）
        → 容量 → CopyObject 到 gallery/<id>/upload → INSERT（processing）＋ 加入相簿 ＋ 排入 gallery.process
  ← 200 { results: [{ refId, status: 'added' | 'skipped', itemId, reason, existingItemId, name }] }
```

- **複製，不引用**（D2）：之後原檔改名、移動、刪除、資料夾授權改變都與圖片庫無關。`CopyObject` 在物件儲存內完成，100 張也是同步完成。
- 處理與自行上傳相同（依 D5 移除位置資訊、寫成 `original` 一次）。
- 稽核：處理完成時的 `galleryItem.create`（`changes.after` 帶 `source`、`sourceRefId`、`sourceName`）；來源那一邊在 `resolve` 裡另寫自己的稽核（檔案：`file.copy`，`purpose = 'gallery'`）。
- **過濾用的用途 `gallery.item`**：圖片庫向 `ImageUsageRegistry` 登記一個 `filterOnly` 的用途（型別同 `GALLERY_CONTENT_TYPES`、大小上限取參數的最大值），
  前端的多選對話框以它讓檔案管理只列出圖片庫收得下的圖。`filterOnly` 的用途不能建立圖片資產（D19）。

## 9. 作為選圖的來源

`GalleryImageSource` 在 `onModuleInit` 登記 `ImageSourceRegistry` 的 `'gallery'`（`feature: 'gallery'`）：

- `resolve` 以呼叫者的身分讀取（`gallery:read`，否則 `403`），只認 ready、沒刪除的圖；寫 `galleryItem.copy`（`changes.after.purpose`）。
- 回傳原檔（已依 D5 移除位置資訊的那份）；**轉過顯示方向的圖回 `large` 的變體**（已轉好、沒有中繼資料），選到的圖與圖片庫裡看到的方向一致（D20）。
- 呼叫端（[`25-image.md`](./25-image.md) §15）把它 **複製** 成圖片資產（D1）：之後圖片庫刪圖、改圖都不影響已經用上的地方。

## 10. 權限

| 權限鍵 | 說明 |
| --- | --- |
| `gallery:read` | 進入圖片庫、瀏覽、檢視器、下載；選圖時看得到「圖片庫」分頁 |
| `gallery:create` | 上傳、從其他來源加入、建立相簿 |
| `gallery:update` | 編輯標題、說明、顯示方向；管理相簿（改名、封面、加入與移出圖片） |
| `gallery:delete` | 刪除與還原圖片、相簿 |

`create`、`update`、`delete` 都蘊含 `read`；預設角色 `admin` 全部、`auditor` 與 `member` 只有 `read`（D3）。
授權只有 RBAC（D4）：路由的 `gallery:*` 就是全部的判斷。清單與矩陣見 [`../iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §2.21。

## 11. 稽核、推播、回收桶、feature、容量

### 11.1 稽核

`galleryItem.create`（處理完成時，不是登記時；actor 是上傳者）、`galleryItem.update`（只記有變的 `title`、`description`、`displayRotation`）、
`galleryItem.delete`、`galleryItem.restore`、`galleryItem.copy`（被選圖複製）；`galleryAlbum.create`、`.update`、`.delete`、`.restore`；
加入與移出相簿記在 `galleryAlbum.update` 的 `changes`（一次請求一筆）。

### 11.2 推播

`ChangeSource.GALLERY_ITEM`、`GALLERY_ALBUM`，受眾 `gallery:read`。圖片的變更帶 `refs.galleryAlbum`（所在的相簿），前端據此失效相簿的張數與封面。
`galleryItem` 的 `create` 只在第一次 ready 時推一次；標籤或留言改了也推一筆 `update`，看得到它的人重抓。

### 11.3 回收桶

圖片（`galleryItem`）與相簿（`galleryAlbum`）各自註冊 `TrashHandler`（[`13-trash.md`](./13-trash.md)），列出要 `gallery:delete`。
還原是 `POST /gallery/items/:id/restore`、`POST /gallery/albums/:id/restore`，標 `@RequireFeature('trash')`。
物件保留到 `trash.purge` 才刪：紀錄刪掉之後才刪物件，刪除成功之後以 `CdnPurger.schedule(keys)` 清理邊緣快取（只列變體，`cdnKeysOf`）；刪除失敗只記 warn、不排清理，由清理排程的殘留對帳處理。圖片永久刪除時相簿的封面隨 `SET NULL`、關聯隨 CASCADE。

### 11.4 feature 與容量

- 可關閉的 feature `gallery`（[`../05-tenancy.md`](../05-tenancy.md) §5.1）：停用時端點回 `404 FEATURE_DISABLED`、背景工作照常完成、前端 plugin 卸載（連同登記的檔案動作與圖片來源）、資料保留。
  新租戶與既有租戶都預設啟用：平台 migration `0028_gallery_feature` 把 `gallery` 加進預設值並啟用既有租戶（D3）。
  停用前的影響數量（[`../05-tenancy.md`](../05-tenancy.md) §12.5）：`galleryItems`、`galleryAlbums`。
- 容量：原檔（pending 時是登記的大小）計入租戶的儲存容量，變體不計；與檔案、圖片資產共用 `file.storageQuotaMb` 與 `file_storage_usage` 的計數（`file.maintenance` 的對帳經 `StorageSizeSources` 加進圖片庫的合計），所有租戶的合計受止水線限制（[`25-image.md`](./25-image.md) §12）。

### 11.5 清理排程 `gallery.maintenance`

`GALLERY_MAINTENANCE_CRON`（預設 `45 * * * *`），同時段只跑一個。每一步冪等、一輪每步最多 200 筆：

1. 登記後超過 24 小時還沒完成上傳 → 刪除物件與紀錄、釋出容量；
2. 處理失敗超過 7 天 → 同上；
3. 舊版本的變體在 `stale_revs_purge_after` 之後刪除（D14）；
4. 處理卡住（排入超過 30 分鐘、要求的版本還沒寫好）→ 重新排入；
5. `gallery/` 底下查不到圖片的物件（至少 24 小時前的）→ 刪除。

第 3、5 步刪掉物件之後呼叫 `CdnPurger.schedule(keys)`（[`09-file.md`](./09-file.md) §16.6；沒有 CDN 時是 no-op、不會拋錯），只列變體（`r<rev>/`）：
原檔與上傳的暫存從不經過 CDN。第 1、2 步的圖從沒處理完成、沒簽過變體的網址，不必清理；完成上傳、處理時刪掉的上傳暫存也一樣。
緊急下架：平台管理者在 apps/platform 的 CDN 頁面選「圖片庫的圖片」＋ 租戶 ＋ id（`GalleryCdnPaths` 在 `onModuleInit` 向 `CdnPathResolver` 登記 `galleryItem`，[`09-file.md`](./09-file.md) §16.11；回收桶裡的也算），
或維運以 `cli:cdn-purge --tenant <代碼> --gallery-item <id>`；兩邊都用 `galleryCdnKeysOf` 列出每個版本的變體，已永久刪除時改用路徑清理。

### 11.6 指標

`api_gallery_process_duration_seconds`（`step` = `original`／`variants`、`result`）與 `api_gallery_process_failures_total`（`reason`）（[`../08-monitoring.md`](../08-monitoring.md) §2.4）。

### 11.7 標籤與留言

標籤組 `gallery`、資源類型 `galleryItem`（[`18-tag.md`](./18-tag.md) §1.1）；留言的資源類型 `galleryItem`，連結的 route id `gallery.item`（[`24-comment.md`](./24-comment.md) §1.1）。
讀標籤定義、讀與寫留言、關注都只要 `gallery:read`（整個圖片庫對有權限的人全部可見，D4）；貼與移除標籤要 `gallery:update`（與編輯標題相同）。

## 12. 錯誤碼

| 錯誤碼 | 狀態 | 說明 |
| --- | --- | --- |
| `GALLERY_ITEM_NOT_FOUND`、`GALLERY_ALBUM_NOT_FOUND` | 404 | 不存在、已刪除，或（圖片）還沒處理完 |
| `GALLERY_ITEM_VERSION_CONFLICT`、`GALLERY_ALBUM_VERSION_CONFLICT` | 409 | 樂觀鎖 |
| `GALLERY_ITEM_NOT_DELETED`、`GALLERY_ALBUM_NOT_DELETED` | 409 | 還原一個沒有刪除的 |
| `GALLERY_ITEM_NOT_READY` | 409 | 處理中的圖不能編輯 |
| `GALLERY_TYPE_NOT_ALLOWED` | 422 | 型別不收（含 HEIC，D6） |
| `GALLERY_ITEM_TOO_LARGE` | 413 | 超過單檔上限 |
| `GALLERY_UPLOAD_INCOMPLETE`、`GALLERY_ALREADY_UPLOADED` | 409 | 完成上傳時物件不在、大小不符；重複完成 |
| `GALLERY_PENDING_LIMIT_REACHED` | 409 | 登記了但還沒完成上傳的超過 50 張 |
| `GALLERY_ALBUM_NAME_DUPLICATE` | 409 | 相簿名稱重複 |
| `GALLERY_ALBUM_COVER_INVALID` | 422 | 封面不在相簿裡 |

## 13. 測試

| 層 | 檔案 | 內容 |
| --- | --- | --- |
| 單元 | `core/image/__tests__/exif.spec.ts`、`blurhash.spec.ts`、`sharp-image-processor.spec.ts` | TIFF 解析、各容器就地移除 GPS（PNG 的 CRC）、BlurHash、`analyze` 與旋轉 |
| 單元 | `modules/gallery/__tests__/` | 拍攝時間的換算、游標、上傳與加入的規則、相簿的規則 |
| 整合 | `test/gallery.spec.ts` | 上傳 → 處理 → ready（GPS 移除、拍攝時間、變體）、從檔案加入（略過的原因、已經加入過）、顯示方向的新版本、篩選與 keyset、時間軸、相簿、回收桶、權限、feature 停用、選圖的來源 |
| 整合 | `test/gallery-cdn.spec.ts` | 變體走 CDN、原檔與下載照舊 presigned；舊版本變體與永久刪除後排入的 `cdn.purge` 路徑（只有變體） |
| 單元 | `modules/gallery/__tests__/gallery-cdn.spec.ts`、`gallery-cdn-paths.spec.ts`、`cli/__tests__/cdn-purge.spec.ts` | `cdnKeysOf`、`GalleryImageUrls` 的 `cdn` 標記與原檔 inline 網址的條件（轉向、TIFF 時沒有）、`--gallery-item` 與 `galleryCdnKeysOf`、`galleryItem` 的路徑解析器登記 |
| E2E | `apps/e2e/tests/gallery.spec.ts` | 上傳 → 時間軸 → 檢視器切換、放大後載入原檔（轉向後不載）、從檔案管理器加入（略過非圖片）、member／auditor 唯讀與 403、關掉 feature 後入口消失 |
| 整合 | `test/cdn-settings.spec.ts` | apps/platform 的手動清理以 `galleryItem` 排入 `cdn.purge`（每個版本的變體、回收桶裡的也算）、找不到時 404 |

## 14. 設計決策：圖片庫

### 14.1 背景

檔案管理器能存圖片，也有變體與 LightBox，但它是 **檔案** 的工具：一個檔案只在一個資料夾、不讀 EXIF、固定尺寸的卡片、LightBox 沒有縮放、
資料夾授權對「一個租戶共用的素材庫」太重。使用者要求圖片庫與檔案管理 **平行**：兩者互不認識，只透過事件、API、feature、註冊表等解耦的方式互相呼叫；
可以自己上傳，也可以由檔案管理加入；大部分設計參照檔案管理的圖片，但更關注閱覽。

### 14.2 決定

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D0 | **與檔案管理平行、互不認識**：後端經 `ImageSourceRegistry`、前端經 `registerFileAction` 與選圖的來源註冊表互相呼叫；開關由可關閉的 feature 處理；不以 `DomainEventBus` 同步資料 | 兩邊各自可以被關掉，任何一邊都不必處理另一邊的開關 | 圖片庫直接 import 檔案模組：依賴單向寫死 |
| D1 | **選圖時從圖片庫選的圖複製成圖片資產**（[`25-image.md`](./25-image.md) §16.2 D4） | 所有來源的生命週期一致；圖片庫刪圖、改圖不影響已經用上的地方 | 引用：刪除要擋或讓引用處變空，圖片庫的 RBAC 會變成頭像能不能顯示的條件 |
| D2 | **由其他來源加入時複製，接受同一張圖存兩份**；之後若在意容量，在物件儲存層以 `content_hash` 去重 | 引用就得回頭問資料夾授權，兩邊不再互不認識 | 引用檔案 |
| D3 | **權限與預設**：`gallery:read`／`create`／`update`／`delete`（後三者蘊含 `read`）；`admin` 全部，`auditor`、`member` 只有 `read`。新租戶預設啟用，既有租戶由平台 migration 啟用 | 人人能看、少數人維護；與其他新的可關閉 feature 一致 | `member` 也有 `create`：素材庫容易變雜；預設關閉：平台要逐一打開 |
| D4 | **只有 RBAC，沒有相簿層級的授權** | 一張圖在多個相簿時可見性是「任一相簿可見」，列表的查詢會複雜很多 | 沿用關係圖做相簿 ACL |
| D5 | **原檔的位置資訊依系統設定 `gallery.stripOriginalLocation` 移除**（預設 `true`），以不重新編碼像素的方式；只影響之後的處理。`exif` 欄一律不存 GPS，變體一律移除中繼資料 | 素材庫的圖會被很多人下載、對外使用，拍攝地點容易外洩；需要保留的租戶可以關掉 | 原封不動；一律移除 |
| D6 | **不支援 HEIC／HEIF**：前端擋下並提示匯出成 JPEG，後端型別白名單照樣擋 | sharp 預編譯的 libvips 不含 HEIC 解碼 | 自編 libvips；前端 WASM 轉檔 |
| D7 | **重複的圖片保留並標示**（`content_hash` 相同時，資訊面板列出） | 可能是刻意的；擋下的話上傳者在處理完成後才會知道 | 擋下；上傳前在瀏覽器算雜湊 |
| D8 | **打包下載（ZIP）延到第二批**；這一版的批次下載是逐張觸發 | 要背景工作組裝、放 bucket、清理 | — |
| D9 | **不做對外分享連結**；與 [`25-image.md`](./25-image.md) §16.2 D6 的公開網址一起評估 | 公開網址的快取、撤銷、到期都還沒有設計 | — |
| D10 | **標題、說明不做版本歷史**；照樣有 `version`（樂觀鎖） | 改動少、價值低 | 接 `RevisionService` |
| D11 | **主色存 `#rrggbb`**，前端只當資料以 inline style 套用；[`../../coding-standards/02-frontend.md`](../../coding-standards/02-frontend.md) 註明這個例外 | 規則針對的是樣式表裡的顏色；這是每張圖不同的資料 | 存 `oklch` 字串：沒有實質好處 |
| D12 | **檔案管理器的 `ImagePreview` 這一版不改用 `ImageViewer`** | 不動檔案管理器的行為 | — |
| D13 | **不做「圖片庫存到檔案管理」**；需要時由檔案管理登記一個「目的地」，與 D0 同一種解耦 | 目前沒有需求 | — |
| D14 | **所有物件只寫一次**：原檔在處理時寫一次；變體的 key 帶版本，調整顯示方向寫到新的版本，舊版本在網址效期過後由清理排程刪除 | 穩定網址與長期快取（CDN，[`09-file.md`](./09-file.md) §16）的前提 | 覆寫同一個 key |

### 14.3 實作紀錄

實作時發現原提案的寫法會出錯、或有更簡單的作法而調整的地方：

| # | 決定 | 理由 |
| --- | --- | --- |
| D15 | **相簿的張數與封面在查詢時算**，不存反正規化的 `item_count` | 圖片的軟刪除、還原、處理失敗都會改變「看得到的張數」，維護計數要在每條路徑上加鎖；相簿的數量少，查詢時算的成本可以忽略 |
| D16 | **找不到 EXIF 在原檔裡的位置時，重新輸出一份沒有中繼資料的原檔**（`location_stripped = true`） | 少數編碼器把 EXIF 放在 sharp 讀得到、但位元組與檔案內容不完全相同的位置；寧可多一次編碼也不讓位置外洩 |
| D17 | **`has_original`、`rev`／`variant_rev` 分開，加上 `failure_reason`**（提案只有 `variant_rev`） | 處理分兩步，重試時跳過已完成的第一步；「要求的版本」與「已寫好的版本」分開，新版本寫好之前回應照樣是舊版本的網址；失敗的原因讓上傳者看得懂。沒有 `deletion_id`：圖片不會「連同上層一起刪除」，還原只看自己的 `deleted_at` |
| D18 | **日期捲軸以 `startAt` 重新載入**，不依張數估算捲動位置 | keyset 分頁下，估算的位置在還沒載入的範圍內沒有資料可以顯示；以時間點為起點載入，跳到哪裡都立刻有圖。張數只用來分配捲軸上每個月的高度 |
| D19 | **「從其他來源加入」以 `filterOnly` 的圖片用途 `gallery.item` 過濾**，不另外設計來源的過濾參數 | 來源元件已經以用途過濾型別與大小（[`../frontend/23-image-picker.md`](../frontend/23-image-picker.md) §2）；`filterOnly` 讓這個用途不能被拿來建立圖片資產 |
| D20 | **轉過顯示方向的圖，被選圖複製時給 `large` 的變體** | 原檔沒有轉；給原檔的話，選到的圖與圖片庫裡看到的方向不一致 |
| D21 | **接上 CDN**（[`09-file.md`](./09-file.md) §16）：變體以 `cdn: 'galleryItem'` 簽網址；原檔的 inline 與下載照舊 presigned；刪除變體之後以 `CdnPurger.schedule(keys)` 清理邊緣快取，只列變體（`cdnKeysOf`） | 變體只寫一次（D14），可以長期快取；原檔的 inline 只在放大時用、下載帶每次不同的 `Content-Disposition`，走 CDN 沒有好處。最初的實作把 CDN 留到合併之後（CDN 在另一個 branch），合併後補上 |
| D22 | **游標加上方向、列表回 `prevCursor`**（同檔案列表，[`09-file.md`](./09-file.md) §6.1） | 前端的無限捲動要有頁數上限（`maxPages`）：重新驗證時 TanStack 依序重抓保留的每一頁，捲了 50 頁就是 50 個請求；丟掉的頁要能以「排在這一筆之前」取回 |
