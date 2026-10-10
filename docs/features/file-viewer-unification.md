# 檔案預覽與圖片檢視統一

- 優先度：P2
- 狀態：提案
- 依賴：要修訂 [`backend/26-gallery.md`](../architecture/backend/26-gallery.md) §14.2 D12（檔案管理器的 `ImagePreview` 不改用 `ImageViewer`），連同 [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.20 的最後一句；
  既有的 `@b2b-system/ui` 的 `ImageViewer`、`JustifiedGrid`（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.19–§3.20）；`GET /files` 不帶 `folderId` 的範圍（[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md) §5.2，已實作）；回收桶的 `TrashHandler`（[`backend/13-trash.md`](../architecture/backend/13-trash.md) §1.1）
- 相關：檔案管理器 [`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §5、§6.1、§7；圖片庫 [`frontend/24-gallery.md`](../architecture/frontend/24-gallery.md) §3、§9、§11；
  回收桶 [`frontend/13-trash.md`](../architecture/frontend/13-trash.md)、[`backend/13-trash.md`](../architecture/backend/13-trash.md) §7.4；檔案的影像 API [`backend/09-file.md`](../architecture/backend/09-file.md) §5.4

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

圖片庫的檢視器（`GalleryViewer`）已經有縮放平移、整個結果之間切換、觸控滑動；檔案管理器的 LightBox 與格子瀏覽是更早的版本，兩邊的體驗落差越來越明顯。以下路徑相對 `apps/backstage/src/features/`。

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 在 LightBox 一路按 → 看資料夾裡的圖 | `file/pages/FileManager/components/FileLightbox.tsx:72-78` 在傳入的 `items` 裡找前後一個；`page.tsx:197` 傳的是 `data.items`（已載入的檔案） | 分頁模式停在這一頁的最後一個；無限捲動停在已載入的最後一個，不會載下一頁（圖片庫的檢視器會，[`24-gallery.md`](../architecture/frontend/24-gallery.md) §9） |
| LightBox 標題的「3 / 60」 | `FileLightbox.tsx:127-131` 用 `items.length` | 顯示的是已載入數而不是符合條件的總數（`data.total`），資料夾有 500 個檔案也寫「/ 60」 |
| 看大圖的細節 | `file/preview/ImagePreview.tsx:24-26`、`:57-67` 只有「符合視窗／原始大小」切換，原始大小靠捲軸 | 不能以游標為中心縮放、不能拖曳平移、沒有雙指縮放與左右滑；`ImageViewer` 已經做好這些 |
| 只用鍵盤瀏覽圖片庫 | `gallery/pages/Gallery/components/GalleryGrid.tsx:70-99` 每格兩個 `<button>`（打開、選取），只能 Tab | 沒有方向鍵、Home／End、Enter 打開、空白鍵選取；虛擬捲動卸載了焦點所在的格子時焦點遺失。檔案管理器有 `useBrowserKeyboard`（listbox ＋ `aria-activedescendant`，[`12-file-manager.md`](../architecture/frontend/12-file-manager.md) §7） |
| 忘了檔案放在哪個資料夾 | `file/pages/FileManager/useFileManagerItems.ts:46` 一律送 `folderId: folderId ?? 'root'` | 只搜得到目前資料夾直接包含的檔案。後端早就支援：`apps/api/src/modules/file/dto/list-file.dto.ts:21-24` 的 `folderId` 選填，不帶時 `file.service.ts:594-605` 的 `listScope` 以 `readableFolderIds()` 限縮到看得到的資料夾（`file.repository.ts:148`），前端沒有入口 |
| 在回收桶找誤刪的圖 | 列表只有名稱、說明、刪除時間（`TrashItem`，`apps/api/src/modules/trash/trash.types.ts:8-17`、`trash/pages/TrashList/adapter.ts`） | 一堆 `IMG_0012.jpg` 分不出哪張。檔案的影像 API 對已刪除的檔案回 404（`file-image.service.ts:184-188` 經 `file.repository.ts:113-118` 的 `notDeleted`），物件其實保留到 `trash.purge`（[`backend/13-trash.md`](../architecture/backend/13-trash.md) §7.0） |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| LightBox 在整個結果之間切換：接近已載入的尾端就載下一頁、分頁模式跨頁；計數用總數（§1） | 右鍵選單（[`12-file-manager.md`](../architecture/frontend/12-file-manager.md) §6.2、[`24-gallery.md`](../architecture/frontend/24-gallery.md) D25：檔案管理器沒有右鍵選單） |
| 檔案的圖片預覽改用 `ImageViewer`：縮放、平移、雙擊切換、雙指、左右滑、`+`／`-`／`0`（§2） | 把 LightBox 與圖片庫的檢視器合成同一個元件：兩者平行、互不認識（[`backend/26-gallery.md`](../architecture/backend/26-gallery.md) D0）；LightBox 不加幻燈片、底片列、資訊面板 |
| 圖片庫格子的鍵盤操作，與檔案管理器一致（§3） | 檢視器或 LightBox 的按鍵改經全域快捷鍵的註冊表（[`24-gallery.md`](../architecture/frontend/24-gallery.md) D22：寫在元件裡） |
| 檔案管理器的「搜尋所有資料夾」，結果標出所在位置（§4） | 窄螢幕的長按多選（[`24-gallery.md`](../architecture/frontend/24-gallery.md) D27） |
| 回收桶的圖片縮圖：檔案、圖片庫的圖片（§5） | 改變無限捲動只保留 10 頁（`maxPages`，[`12-file-manager.md`](../architecture/frontend/12-file-manager.md) §5）；回收桶「只列你還原得了的」（[`backend/13-trash.md`](../architecture/backend/13-trash.md) §7.4） |
| | 搜尋檔案內容（全文）；跨資料夾搜尋時的拖放上傳與拖曳移動（見開放問題 4） |

## 使用者故事

**作為檢查素材的成員，我希望在 LightBox 裡一路看完整個資料夾的圖，以便不必關掉 LightBox 換頁再打開。**

- **Given** 資料夾有 240 張圖，無限捲動已載入 60 張，我打開第 58 張
- **When** 我連按三次 →
- **Then** 第 59、60 張照常切換，背景已載入下一頁，第三次到第 61 張；標題寫「61 / 240」

**作為檢查素材的成員，我希望放大圖片看細節，以便不必下載原圖。**

- **Given** 一張 6000×4000 的圖在 LightBox 裡以符合視窗顯示
- **When** 我在某個角落以滾輪放大、拖曳平移，或在平板上雙指縮放
- **Then** 以游標（或兩指中心）為中心放大，放大到需要時才載入原圖；回到符合視窗時左右滑可以切換上一個與下一個

**作為只有部分資料夾授權的成員，我希望搜尋所有資料夾，以便找到忘了放在哪裡的檔案。**

- **Given** 我讀得到「專案 A」「共用資料夾」，讀不到「財務」；三個資料夾都有名稱含「報價」的檔案
- **When** 我在搜尋框輸入「報價」並切到「所有資料夾」
- **Then** 結果只有前兩個資料夾裡的檔案，每一筆標出所在的路徑，點路徑進入那個資料夾；「財務」的檔案不出現，總數也不含它們

**作為鍵盤使用者，我希望在圖片庫用方向鍵移動、Enter 打開，以便不必用滑鼠。**

- **Given** 等高排列，焦點在第一列第三張
- **When** 我按 ↓、Shift＋→、Enter
- **Then** 焦點移到下一列水平位置最接近的那張，延伸選取右邊一張，Enter 打開檢視器；捲動中焦點所在的格子被卸載也不會遺失焦點

## 初步構想

### 1. LightBox 在整個結果之間切換（`features/file`）

- `FileLightbox` 收 `total`、`hasMore`、`onLoadMore`（無限捲動）或 `onPageEdge(direction)`（分頁模式：前往上一頁或下一頁並開在那一頁的第一個或最後一個）。接近尾端（剩 2 個）就 `onLoadMore`，與 `GalleryViewer` 的作法相同。
- 計數 `index + 1 / total`；`index` 要加上 `offset`（分頁）或 `dropped`（無限捲動被丟掉的頁，`useFileListData`）。
- 從分享的網址直接打開、目前這個檔案不在已載入的範圍時：上一個與下一個停用（圖片庫有 `neighbors` 端點，檔案要不要也加見開放問題 2）。

### 2. 圖片預覽改用 `ImageViewer`（`features/file/preview`）

- `ImagePreview` 換成 `ImageViewer`：`levels` 是 `[displayUrl（全螢幕預覽，長邊 2560）, url（原圖）]`，尺寸取 `StoredFile.image.width／height`（`FileItemVM` 加這兩個欄位）；變體還沒產生時只有原圖一層。
- 棋盤格背景保留（`ImageViewer` 的 `stage` slot），與透明圖的現況一致。
- `onSwipe` 接 LightBox 的上一個與下一個；`+`／`-`／`0` 寫在 `FileLightbox` 的 keydown（capture）裡，與 D22 一致。
- `ImageViewer` 已在 `packages/ui`，不搬任何東西；只有 backstage 用 LightBox，不進 `web-core`。

### 3. 圖片庫格子的鍵盤操作

- **幾何**：等高排列每一列的格數不同，↑／↓ 不能像檔案管理器的 `moveIndex` 用欄數加減。在 `packages/ui` 的 `JustifiedGrid/layout.ts` 加純函式 `moveInGrid(layout, key, direction)`：同一列左右移、跨列取水平中心最接近的格、Home／End、PageUp／PageDown，不含業務名詞（[`07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.19）。
- **焦點**：`JustifiedGrid` 的捲動容器當 listbox（`aria-multiselectable`、`aria-activedescendant`），格子是 `role="option"`；焦點留在容器，格子被虛擬捲動卸載也不遺失。`JustifiedGrid` 加 `scrollToItem(key)`。
- **按鍵**（與 [`12-file-manager.md`](../architecture/frontend/12-file-manager.md) §7 一致）：方向鍵／Home／End 移動並選取（Shift 延伸、⌘／Ctrl 只移焦點）、空白鍵切換、Enter 打開、⌘／Ctrl＋A、Esc、Delete。列表顯示方式（`GalleryList`）一起做。
- **放哪**：檔案管理器的 `useBrowserKeyboard` 綁著 `FileLayout`；共用的部分（焦點索引、按鍵分派、`aria-activedescendant`）可以抽到 app 的 `core/selection`（框選的 hook 已在那裡），版面的移動由呼叫端傳入（開放問題 3）。

### 4. 搜尋所有資料夾（`features/file`）

- 網址加 `scope=all`（`FileSearchQuerySchema`）；有關鍵字時搜尋框旁出現「目前資料夾／所有資料夾」切換。`useFileManagerItems` 在 `scope=all` 時 **不帶** `folderId`。
- **授權不在前端判斷**：後端不帶 `folderId` 時已只列看得到的資料夾（只有資料夾授權的人不含根目錄、不含別人的個人資料夾，[`iam/06-resource-grants.md`](../architecture/iam/06-resource-grants.md) §5.2、§12.1），總數也照這個範圍。後端不必改，補一個整合測試鎖住這個行為。
- 結果多一個「位置」欄（列表）或卡片上的路徑：以 `GET /file-folders` 的扁平清單組路徑（`folderTree.ts`），點了 `setFolder`。資料夾本身的比對沿用前端篩選，範圍改成整份清單。
- 選取列、LightBox、下載、刪除照常；跨資料夾時拖放上傳與拖曳移動停用（目的地不明確）。

### 5. 回收桶的圖片縮圖

- `TrashItem` 加選用的 `thumbnail: ImageSources | null`（[`backend/25-image.md`](../architecture/backend/25-image.md) §14 的簽章網址形狀），由各 `TrashHandler.listDeleted` 填；`trash.types.ts` 的「類型特有的欄位不放進來」改成「縮圖是共用的選用欄位」。
- 檔案：影像 API 要接受 **已刪除** 的檔案（`resolve()` 改用含已刪除的查詢）。簽章網址只從 `file:delete` 的回收桶回應拿得到，`file:delete` 蘊含全域 `file:read`（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) 的蘊含表），不會洩漏讀不到的資料夾內容。
- 圖片庫：網址由 `ObjectUrlSigner` 直接簽（`gallery-image-urls.ts`），物件在 `trash.purge` 前都在，不必改端點。
- 前端：`TrashList` 的名稱欄前加 `SignedImage`（`thumbnail` 版面）；沒有縮圖的類型（使用者、角色…）不佔欄寬。

### 6. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/backstage/src/features/file/pages/FileManager/components/FileLightbox.tsx`、`page.tsx`、`useFileListData.ts` | §1 的載入下一頁、跨頁、總數 |
| `apps/backstage/src/features/file/preview/ImagePreview.tsx`、`pages/FileManager/adapter.ts` | §2；`FileItemVM` 加寬高 |
| `packages/ui/src/components/JustifiedGrid/` | `moveInGrid`、listbox 的屬性、`scrollToItem`；Storybook |
| `apps/backstage/src/features/gallery/pages/Gallery/components/GalleryGrid.tsx`、`GalleryList.tsx` | §3 |
| `apps/backstage/src/core/selection/`、`features/file/pages/FileManager/useBrowserKeyboard.ts` | 共用的鍵盤 hook（若採用） |
| `apps/backstage/src/features/file/routes/model.ts`、`useFileManagerItems.ts`、`FileToolbar.tsx`、`FileListRow.tsx`、`FileGridItem.tsx` | §4 |
| `apps/api/src/modules/trash/`（`trash.types.ts`、`dto/trash.dto.ts`）、`modules/file/file-trash.handler.ts`、`file-image.service.ts`、`modules/gallery/gallery-trash.handlers.ts` | §5；重產 openapi 與 SDK |
| `apps/backstage/src/features/trash/pages/TrashList/` | §5 |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **分頁模式的 LightBox 到了頁尾怎麼辦？** (a) 自動換頁（網址的 `offset` 跟著變，列表也換頁）；(b) 只在這一頁裡切換，到頁尾停住並提示「下一頁」；(c) LightBox 自己另抓一頁、不動列表。傾向 (a)：關掉 LightBox 時列表就在那一頁，最不意外。
2. **從分享的網址打開、檔案不在已載入範圍時要不要有前後一個？** (a) 不要，按鈕停用；(b) 仿圖片庫加 `GET /files/:id/neighbors`（帶目前的篩選與排序）。傾向 (a)：檔案的排序有三種、還有 offset 分頁，鄰居的游標比圖片庫複雜；之後有需求再加。
3. **格子鍵盤的共用程度？** (a) 圖片庫自己寫 `useGalleryKeyboard`；(b) 抽 `core/selection/useListboxKeyboard`，檔案與圖片庫各自傳 `move()`；(c) 放進 `packages/web-core`。傾向 (b)：只有 backstage 用，不進 web-core（[`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2）；按鍵規則一致才不會兩邊分歧。
4. **「所有資料夾」的結果裡能不能拖放上傳、拖曳移動？** (a) 都停用；(b) 上傳到目前所在的資料夾、移動照常。傾向 (a)：結果混了多個資料夾，放開時的目的地不直覺。另外：「所有資料夾」要不要連沒有關鍵字也能用（等於「最近的檔案」）？傾向只在有關鍵字或篩選時出現。
5. **跨資料夾搜尋的效能**：只有資料夾授權的人，`folder_id = ANY($readable)` 可能帶上萬個 id 再加 `ilike`（`pg_trgm`）。要不要先實測 1 萬個資料夾、10 萬個檔案的計畫，必要時限制結果只回前 N 筆、不算總數？
6. **回收桶的縮圖欄位要通用還是走前端註冊表？** (a) `TrashItem.thumbnail`（後端填）；(b) `registerTrashType` 加 `Thumbnail` 元件、前端各自查。傾向 (a)：(b) 每列要多一個請求，而且已刪除的資源一般端點查不到。
7. **檔案的影像 API 放行已刪除的檔案，網址效期內被永久刪除怎麼辦？** 物件已刪，轉址後 404，前端退回類型圖示即可；要確認 CDN（[`backend/09-file.md`](../architecture/backend/09-file.md) §16）的清理有涵蓋永久刪除。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/frontend/12-file-manager.md`：§4 的 `scope`、§6.1 的 LightBox（整個結果、`ImageViewer`）、§7 的共用鍵盤
- `docs/architecture/frontend/24-gallery.md` §3：格子的鍵盤操作；§11 加新的決定
- `docs/architecture/frontend/07-ui-system.md` §3.19、§3.20：`moveInGrid`、listbox、`scrollToItem`；拿掉「LightBox 這一版不改用」
- `docs/architecture/backend/26-gallery.md` §14.2：D12 標為已取代
- `docs/architecture/backend/13-trash.md` §1.1、§7：`TrashItem.thumbnail`、已刪除檔案的影像 API；`docs/architecture/frontend/13-trash.md`
