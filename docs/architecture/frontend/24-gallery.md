# 前端 24 — 圖片庫

backstage 的 `features/gallery`：以看圖為主的素材庫。等高排列或方格、依日期分組的時間軸與日期捲軸、多選與批次操作、可以縮放與平移的檢視器、相簿與標籤。
後端（資料模型、處理、權限、設計決策 D0–D21）見 [`../backend/26-gallery.md`](../backend/26-gallery.md)；版面與檢視的元件在 `@b2b-system/ui`（[`07-ui-system.md`](./07-ui-system.md) §3.19、§3.20）。

```
features/gallery
  ├─ plugin.ts            同步階段：頁面權限、側欄、批次操作、回收桶類型、route link、檔案動作、圖片來源
  ├─ pages/Gallery        圖片庫與相簿頁（同一個頁面，相簿頁多一個 albumId）
  │    ├─ useGalleryBrowse      網址 ↔ 篩選、無限捲動、分組、日期捲軸的起點
  │    ├─ useGalleryGridState   捲動容器、版面、目前的區段、框選
  │    └─ components/           頁首、相簿列、工具列、選取列、格子、日期捲軸、檢視器、資訊面板
  ├─ fileAction           檔案管理器的「加入圖片庫」（core/file 的 registerFileAction）
  ├─ imageSource          選圖的來源「圖片庫」（web-core/image-picker 的 registerImageSource）
  └─ batch.ts             gallery.upload／gallery.delete／gallery.tag（web-core 的全域批次佇列）
```

## 1. 安裝與登記

`gallery` 是可啟用的 feature（[`02-plugin-system.md`](./02-plugin-system.md) §7）：`app/features.ts` 依 `/auth/profile` 的 `features` 安裝。
plugin 的同步階段登記的東西都經 `web-shared/registry` 追蹤，**卸載時一起撤回**——檔案管理器的「加入圖片庫」與選圖的「圖片庫」分頁跟著消失，
檔案管理與選圖不必處理圖片庫的開關（後端 D0）。`onInit` 載入語系包、清掉分頁當掉留下的排隊檔案，並在 session 結束時清空上傳暫存區。

| 登記 | 位置 | 說明 |
| --- | --- | --- |
| 頁面權限 `GALLERY`（`gallery:read`） | `permission.ts` | `/gallery`、`/gallery/album/$albumId` |
| 側欄與命令面板 | `navigation.ts` | 「圖片庫」入口 |
| route link | `routeLinks.ts` | `gallery.home`、`gallery.album`、`gallery.item`（`/gallery?item=<id>`；留言與關注的通知連到檢視器） |
| 回收桶類型 | `trash.ts` | 「圖片庫」「相簿」分頁 |
| 批次操作 | `batch.ts` | §4、§5 |
| 檔案動作、圖片來源 | `fileAction/`、`imageSource/` | §6、§7 |

## 2. 網址

篩選、排序與開著的檢視器都在網址（`routes/model.ts` 的 `GallerySearchSchema`），可以分享，上一頁回到前一個狀態：
`item`（檢視器）、`keyword`、`tag`（一個或多個，一律轉成陣列）、`from`／`to`（`YYYY-MM-DD`，以瀏覽器的時區解讀）、`orientation`、`origin`（自行上傳／加入）、
`sort`（`sortAt`／`createdAt`／`title`）、`reverse`。每個欄位都 `.catch()`：手改成不合法的值時當作沒有帶，不變成錯誤頁。
相簿頁的路徑多一個 `albumId`，其餘相同。

## 3. 閱覽

| 能力 | 做法 |
| --- | --- |
| **顯示方式** | 工具列右側的切換（`gallery-view-mode`）：**等高排列**（預設）、**方格**、**列表** |
| 等高排列與方格 | `@b2b-system/ui` 的 `JustifiedGrid`：輸入每一張的寬高比，尺寸在回應裡，不必等圖片載入就算得出版面；虛擬捲動只渲染可視範圍上下的列 |
| 列表 | `GalleryList`（`VirtualList`，列高固定 64 px）：一列一張，縮圖、標題與說明、圖片日期（依加入時間排序時是加入時間）、尺寸、大小、標籤；窄螢幕只留前三欄。不分組、沒有框選，勾選框與 Shift 連續選取、點標題打開檢視器與格子相同 |
| **縮放級別** | 列高（方格是格子大小）120／180／240／320 px；列表沒有 |
| **依日期分組** | 「日」「月」或不分組；以 `sortAt`（依加入時間排序時用 `createdAt`）在瀏覽器的時區分組，區段標題黏在上方。標題排序與列表時不分組 |
| **偏好** | 顯示方式、縮放級別、分組記在 localStorage（`preference.ts`，這台裝置的偏好） |
| **日期捲軸** | `GalleryTimeline`：`GET /gallery/items/timeline` 回每個月的張數，依年份分段（年份寫在段首、月份只寫月，窄欄裡不折行），每個月一格、高度依張數比例，放不下時整欄捲動而不壓縮格子；點一個月就以那個月為起點（`startAt`）重新載入，頁面上方出現「回到最前面」（後端 D18）。三種顯示方式都有，列表時不標示目前所在的月份 |
| **無限捲動** | keyset 游標（`get-gallery-items` 的 infinite query），一頁 100 張；接近底部時載下一頁 |
| **佔位** | 主色當底（inline style，後端 D11）、BlurHash 在格子出現時才解碼成模糊圖（`blurhash.ts`）、真正的圖載入後蓋上去 |
| **圖片** | `SignedImage` 的 `grid` 版面（`thumb 480w, medium 1280w`）＋ `sizes`，瀏覽器依格子寬度與螢幕密度選；網址到期前隨查詢重抓 |
| **窄螢幕**（< 640 px） | 等高排列改成方格（不能選等高排列）、列高 120；列表照舊 |

## 4. 上傳

「加入」選單：上傳圖片、上傳資料夾（只取裡面的圖片、不保留結構）、從其他來源…（§6）。也可以把檔案或資料夾拖進頁面、或貼上（`useGalleryDrop`）。

```
選檔／拖曳／貼上 → core/upload 展開資料夾
  → 檢查（只是體驗）：檔頭簽章、型別、HEIC 另外提示「請匯出成 JPEG」（後端 D6）、≤ 50 MiB
  → 不能上傳的以 toast 列出第一個原因
  → galleryUploadSources.store（IndexedDB 暫存區 gallery-upload）→ 全域批次佇列的 gallery.upload
       每一筆：createImageBitmap 量暫定尺寸 → POST /gallery/items → PUT → POST …/complete
```

- 佇列項目 id 是 `<暫存 id>@<相簿 id>`：項目只能帶 id（要能跨 worker、跨分頁傳遞），接手的分頁也知道目的地相簿。
- 處理完成之前圖不在列表裡；頁首的 `GalleryUploadStatus` 顯示自己的「處理中 N 張」與處理失敗的清單（原因、清除），收到推播時重抓。
- 上傳暫存區與檔案管理各自一個（`core/upload` 的 `createUploadSources(name)`）：任一個 feature 被關掉，另一個的排隊檔案不受影響。

## 5. 整理：多選、批次操作、相簿、標籤

- **多選**（`useGallerySelection`）：格子的選取框、Shift 連續選取（依已載入的順序）、框選（`core/selection` 的 `useMarqueeSelection`，命中以 `hitTestGrid` 算）、
  區段標題的「全選這一天」、選取列的「全選已載入的」。有選取時點一下是切換選取，不打開檢視器；選取列的「清除」取消選取。
- **選取列**（`GallerySelectionBar`）：加入相簿、移出相簿（相簿頁）、貼標籤、下載、刪除，依權限顯示。

| 動作 | 怎麼送 |
| --- | --- |
| 刪除 | 全域批次佇列 `gallery.delete`（每一筆一個 `DELETE`；結果彈窗帶「復原」） |
| 貼標籤 | 全域批次佇列 `gallery.tag`（項目 id 是 `<圖片 id>@<標籤 id>`） |
| 加入、移出相簿 | 一個請求（最多 500 張），不經過佇列 |
| 下載 | 在目前的分頁逐張觸發（最多 50 張）：瀏覽器只讓前景的分頁觸發下載，佇列可能在別的分頁執行；打包下載是第二批（後端 D8） |

- **相簿列**（`GalleryAlbumBar`）：封面、名稱、張數；「新增相簿」。相簿頁的頁首有編輯（名稱、說明）與刪除；檢視器裡可以「設為封面」。
- **相簿選擇**（`AlbumPicker`）：加入圖片庫、上傳、加入相簿共用，可以直接新建。
- **標籤**：標籤組 `gallery`；單張在檢視器編輯，多張用批次。工具列的標籤篩選是「貼了其中任一個」。
- **搜尋與篩選**（`GalleryToolbar`）：版面與檔案管理的工具列（[`12-file-manager.md`](./12-file-manager.md)）、其他列表頁一致——左邊是常駐的搜尋框（`TableSearch`，關鍵字）與套用中的條件 Chip（`ActiveFilters`，可單獨移除）；
  右邊是篩選面板（`FilterBar`，`useGalleryFilters`：標籤、圖片日期、方向、來源，按「搜尋」一次寫進網址；日期區間在網址裡是 `from`／`to`）、
  檢視選項（`GalleryViewOptions`：排序與反轉、分組、縮放）與顯示方式。後端另支援的上傳者篩選這一版沒有畫面。
- **圖片日期**：畫面上 `sortAt` 的名稱——EXIF 的拍攝時間，沒有時是加入時間。不叫「拍攝時間」：圖片庫也放設計稿、截圖等不是拍出來的圖。

## 6. 從其他來源加入

### 6.1 檔案管理器的「加入圖片庫」

`fileAction/register.ts` 以 `core/file` 的 `registerFileAction` 登記（[`12-file-manager.md`](./12-file-manager.md) §6）：

- `placement: ['selectionBar', 'lightbox']`；`isAvailable` 是 `gallery:create`；`check` 逐檔判斷型別（HEIC 另外說明）與大小，全部不通過時按鈕停用並顯示第一個原因。
- 按下後打開 `AddToGalleryDialog`（延遲載入，檔案管理器的首屏不帶圖片庫的程式）：選相簿（可以新建）→ `POST /gallery/items/from-source { source: sourceId, refIds }`。
  `sourceId` 由檔案管理器給（它自己登記的後端來源 id），圖片庫不寫死 `'file'`。
- 結果：加入幾張、略過幾張與原因（檔案管理器的 `check` 略過的與後端略過的一起列；「已經加入過」連到那一張），「前往圖片庫」以 route id `gallery.home`／`gallery.album` 連過去。

### 6.2 圖片庫裡的「從其他來源…」

打開 `web-core/image-picker` 的 `MultiImageSourceDialog`（[`23-image-picker.md`](./23-image-picker.md) §2.1）：列出支援多選（`supportsMultiple`）、用途 `gallery.item` 允許、`isAvailable` 為真的來源，
排除圖片庫自己。目前實際上只有檔案管理；沒有可用的來源時選單沒有這一項（`useMultiImageSourcesAvailable`）。
勾選只在一個來源內（一次 `from-source` 只能帶一個 `source`），送出後與 §6.1 同一支 API（`AddFromSourcesDialog`；在相簿頁打開時一併加入那個相簿），結果以 toast 顯示加入與略過的張數。

## 7. 作為選圖的來源

`imageSource/register.ts` 登記 `registerImageSource({ id: 'gallery', order: 25, … })`，`isAvailable` 是 `gallery:read`；分頁標題用 app 的全域字串 `image.source.gallery`
（feature 的語系包只在進入圖片庫時才載入）。`GalleryImageSource` 是精簡版的列表：相簿切換、搜尋、方格、「載入更多」；
以 `imageUsage` 讓伺服器過濾型別與大小，尺寸太小的列出但停用（使用者記得圖片庫裡有那張，找不到會以為壞了）。支援多選模式，但圖片庫自己的「從其他來源…」排除它。
選了之後由伺服器 **複製** 成一張新的圖片資產（後端 D1）。

## 8. 權限

頁面元件只呼叫 `useGalleryPermission()`（`canCreate`、`canUpdate`、`canDelete`），不直接比對權限鍵。

| 權限 | 畫面 |
| --- | --- |
| `gallery:read` | 進入頁面、閱覽、檢視器、下載 |
| `gallery:create` | 「加入」選單、拖曳與貼上、新增相簿；檔案管理器的「加入圖片庫」 |
| `gallery:update` | 加入或移出相簿、貼標籤、檢視器的編輯標題與說明、旋轉、設為封面、編輯相簿 |
| `gallery:delete` | 刪除圖片與相簿 |

## 9. 檢視器

`GalleryViewer`：全螢幕的對話框，網址帶 `?item=<id>`。

| 能力 | 做法 |
| --- | --- |
| **縮放與平移** | `@b2b-system/ui` 的 `ImageViewer`：滾輪與觸控板以游標為中心縮放、拖曳平移、雙擊在「符合視窗」與「100%」之間切換、雙指縮放；`+`／`-`／`0` |
| **漸進載入** | 依目前的縮放倍率選解析度：先 `medium`，放大後 `large`，超過 `large` 的解析度才載入原檔（轉過方向的圖沒有原檔，停在 `large`） |
| **上一張／下一張** | ← / →、按鈕、觸控左右滑；範圍是整個結果：到了已載入的最後幾張就載入下一頁。從分享的網址直接打開、目前這張不在已載入的範圍時，以 `GET /gallery/items/:id/neighbors` 取前後 |
| **預先載入** | 前後各兩張的 `large`；以與檢視器相同的 `<picture>` 結構（`preload.ts`），抓的是瀏覽器會顯示的格式（例：WebP），不是 `<img>` 的主格式 |
| **底片列** | 下方一列小圖，標出目前的位置；窄螢幕隱藏 |
| **幻燈片** | 空白鍵開始／暫停，間隔 3／5／10 秒；`prefers-reduced-motion` 時不做轉場 |
| **全螢幕** | F 鍵或按鈕（Fullscreen API） |
| **關閉** | 標題列右側的關閉按鈕或 Esc；網址拿掉 `item` |
| **資訊面板** | I 鍵、工具列的「資訊」或面板右上角的關閉按鈕開關（`GalleryInfoPanel`）：標題與說明（直接編輯，樂觀鎖）、圖片日期、相機與鏡頭、曝光參數、尺寸與大小、上傳者、來源（只是文字，不連回檔案）、所在的相簿、標籤、內容相同的其他圖（後端 D7）、位置資訊是否已移除 |
| **留言** | 資訊面板下方的 `<ResourcePanels resourceType="galleryItem">`（[`22-comment.md`](./22-comment.md) §2） |
| **動作** | 下載（原檔／`large`）、加入相簿、編輯標籤、向左轉／向右轉、設為封面（相簿頁）、刪除；依權限顯示 |
| **已被刪除** | 詳情回 `GALLERY_ITEM_NOT_FOUND`（推播或查詢得知）時顯示「圖片已被刪除」，自動前往下一張 |

按鍵寫在元件裡，只在檢視器開著時有效（與檔案管理器的 LightBox 相同），不經全域快捷鍵的註冊表（D22）。

## 10. 測試

| 檔案 | 內容 |
| --- | --- |
| `features/gallery/__tests__/helpers.test.ts` | 依日期分組、日期捲軸的起點與日期範圍、偏好、批次項目 id、BlurHash 解碼、上傳前與加入圖片庫的檢查 |
| `features/gallery/__tests__/register.test.ts` | 檔案動作與圖片來源的登記、卸載時撤回 |
| `features/gallery/hooks/__tests__/useGalleryPermission.test.tsx` | 權限 hook |
| `pages/Gallery/__tests__/GalleryPage.test.tsx` | 頁面的三個權限案例、閱覽（空狀態、篩選與條件 Chip、列表的顯示方式、相簿頁）、檢視器（開啟、切換、資訊面板與檢視器的關閉） |
| `pages/Gallery/__tests__/useGallerySelection.test.tsx` | 點選、Shift 連續選取、區段全選、框選的套用 |
| `pages/Gallery/__tests__/preload.test.ts` | 預先載入的 `<picture>` 結構 |
| `apps/e2e/tests/gallery.spec.ts` | 上傳 → 時間軸 → 檢視器切換、放大後載入原檔（轉向與 TIFF 不載）、檔案管理器的「加入圖片庫」、member／auditor 唯讀、關掉 feature 後入口消失 |
| `packages/ui` 的 `JustifiedGrid`、`ImageViewer` | 版面計算、命中、虛擬捲動；縮放、平移、解析度的選擇（[`07-ui-system.md`](./07-ui-system.md) §9） |
| `packages/web-core` 的 `MultiImageSourceDialog` | 多選模式的來源篩選與送出 |

## 11. 設計決策

後端的決定（D0–D21）見 [`../backend/26-gallery.md`](../backend/26-gallery.md) §14。前端另外的決定：

| # | 決定 | 理由 |
| --- | --- | --- |
| D22 | **檢視器的按鍵寫在元件裡**，不經全域快捷鍵的註冊表（原提案：經 [`18-command-palette.md`](./18-command-palette.md) 的註冊表登記） | 註冊表放的是整個 app 的入口；檢視器的按鍵只在它開著時有效，與 LightBox 相同 |
| D23 | **「從其他來源…」用另一個元件 `MultiImageSourceDialog`**，不是 `ImageSourceDialog` 的多選模式 | 單選的對話框有「上傳」「最近使用」與裁切，多選都不需要；勾選、送出與結果的流程不同，硬併在一起兩邊的條件分支會很多 |
| D24 | **加入與移出相簿、下載不經全域批次佇列**；刪除與貼標籤經佇列 | 相簿的增減後端一次收 500 張，一個請求就完成；下載只能在前景的分頁觸發 |
| D25 | **檔案動作的形狀是 `component`（對話框元件）**，不是 `run(files, ctx)`；`placement` 只有選取列與 LightBox | 對話框要 React 的脈絡（語系、查詢、路由）；檔案管理器沒有右鍵選單 |
| D26 | **日期捲軸以月為單位**、點了以那個月為起點重新載入（後端 D18） | 以日為單位在多年的圖片庫裡一格太細；跳轉後頁面上方有「回到最前面」 |
| D27 | **窄螢幕沒有「長按進入多選」**；以格子的選取框多選 | 長按與捲動、系統的長按選單衝突，要另外處理觸控的手勢；先確認需求 |
