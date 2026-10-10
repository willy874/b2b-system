# 前端 12 — 檔案管理器

> 狀態：**已實作**（`features/file`，路由 `/file`）。後端的檔案模組、上傳流程、API 見
> [`../backend/09-file.md`](../backend/09-file.md)；上傳進入全域佇列的決策見 §14。

## 1. 功能

| 需求 | 做法 | 章節 |
| --- | --- | --- |
| 列表、圖示卡片兩種排版 | 同一套固定尺寸的版面計算，依容器寬度決定欄數 | §3 |
| 分頁、無限捲動兩種閱覽模式 | 分頁用 offset；無限捲動用 keyset 游標（捲動中有人新增或刪除也不重複、不漏） | §5 |
| 資料夾分類（巢狀） | 左側樹狀面板 ＋ 麵包屑 ＋ 主區塊的資料夾（排在檔案前面）；一份扁平清單組成樹 | §12 |
| 拖曳移動檔案與資料夾 | `useItemDrag`：拖到資料夾卡片、樹的節點、麵包屑上移動；擋下移進自己的子孫；「移動到…」對話框是替代方式 | §12 |
| 拖曳到主區塊上傳 | `useFileDrop`：只對帶檔案的拖曳反應；資料夾保留結構上傳；放在資料夾卡片上就傳到那個資料夾 | §7、§8 |
| 上傳資料夾 | 拖放資料夾或選取資料夾（`webkitdirectory`）；先在目的地建出同樣的結構（同名合併），再把檔案送進佇列 | §8 |
| 框選多個檔案做批次處理 | `useMarqueeSelection`（`core/selection` 的共用 hook ＋ 檔案的版面）：以版面幾何計算命中，畫面外（虛擬捲動沒渲染）的項目也算得到 | §7 |
| RWD | 欄數、卡片寬度、列表顯示的欄位都由容器寬度決定；工具列在窄螢幕換行 | §3 |
| 常見格式的圖示、圖片的縮圖預覽 | `core/file` 的 `getFileKind()` ＋ 伺服器產生的圖示預覽（`thumbnailUrl`；之前退回上傳時由瀏覽器產生的縮圖） | §6、§8 |
| 前後端效能 | 虛擬捲動、縮圖、穩定的下載網址（瀏覽器快取命中）、索引與 keyset 分頁 | §9 |
| 變更事件的同步與資源競爭 | 推播失效、選取以 id 記錄並自動修剪、改名樂觀鎖、LightBox 偵測已刪除 | §10 |
| 排序、搜尋、篩選 | 檔名搜尋（去抖動）、分類與標籤篩選（篩選面板）、三種排序 ＋ 方向 | §3、§4 |
| 上傳與全域批次佇列共用 | 上傳是一種批次操作（`file.upload`），進度、取消、結果彈窗、跨分頁接手都沿用佇列 | §8 |
| 大檔分塊上傳 | 後端決定切法，前端邊要網址邊並行上傳各塊、各塊重試 | §8 |
| LightBox 預覽 | 詳情對話框；內容由預覽解析器顯示，內建圖片與純文字 | §6 |
| 插件能力 | `core/file` 的四個註冊表：預覽解析器、檔案驗證器、縮圖產生器、檔案動作（其他 feature 在選取列與 LightBox 上的按鈕） | §6 |
| 偏好記憶 | 排列方式、閱覽模式、排序、每頁筆數存在 localStorage，跨分頁同步 | §4 |
| 資料夾層級的權限與共用 | 按鈕看後端回傳的 `capabilities`；「共用」對話框管理資料夾授權、中斷繼承 | §13 |

---

## 2. 分層

```
features/file/                       業務：頁面、上傳入口、內建的解析器與驗證器
├── plugin.ts                        同步階段：頁面權限、批次操作、內建擴充；onInit：語系、清理暫存
├── batch.ts                         批次操作 file.upload / file.delete、enqueueFileUploads()
├── preference.ts                    排列方式、閱覽模式、排序、每頁筆數（dictStorage ＋ 跨分頁頻道）
├── upload/                          檔案管理的上傳暫存區（`core/upload` 的 `createUploadSources('file-upload')`）、內建驗證器
├── preview/                         內建解析器：ImagePreview、TextPreview
├── hooks/                           useFilePermission、useFileUpload、useFileRenameMutation / useFileDeleteMutation、
│                                    useFolderMutations（建立、改名、遞迴刪除、還原、移動）
└── pages/FileManager/               page.tsx ＋ 版面計算、資料、選取、框選、拖放、資料夾樹（folderTree）、拖曳移動（useItemDrag）的 hooks ＋ 元件

core/file/                           機制：檔案類型、四個擴充點的註冊表、圖片縮圖產生器（不認識任何 feature）
core/upload/                         上傳的共用程式：collectEntries（展開拖放／選取的資料夾）、createUploadSources（IndexedDB 暫存）、
                                     matchesImageSignature（圖片的檔頭簽章）；直傳（單次 PUT）在 web-core/direct-upload
core/selection/                      框選的幾何（rectFromPoints、intersects、edgeScrollDelta）與共用的 useMarqueeSelection
web-core/batch/                          全域批次佇列（上傳與其他批次工作共用）
apis/file/                           uploadFile()（單次／分塊／縮圖）、列表（分頁／無限）、詳情、內容（文字預覽）、上傳政策、
                                     資料夾（列表、建立、改名、刪除、確保路徑）、移動
shared/storage/blobStore.ts          Blob 的鍵值儲存（記憶體 ＋ IndexedDB）
```

- 擴充點放在 `core/file` 而不是 feature 裡：其他 feature（例如之後的業務功能要預覽自訂格式）只能經由 `core/` 互動
  （[coding-standards/07](../../coding-standards/07-layer-dependencies.md) §2.2）。
- 上傳與框選的程式放在 `core/upload`、`core/selection` 而不是 `features/file`：其他會上傳、會多選的 feature（例：圖片庫）
  不能 import `features/file`，抽出來共用，檔案管理器的行為不變。
- `page.tsx` 只接線；刪除、下載的編排在 `useFileActions`，資料在 `useFileListData`。

---

## 3. 主區塊的版面（`layout.ts`）

格子大小固定，所以任何一筆的位置都算得出來：

```ts
const layout = computeFileLayout(viewMode, containerWidth, items.length);
itemRect(layout, index);       // 內容座標中的位置
hitTest(layout, rect, count);  // 框選命中的索引（只檢查框涵蓋的那幾列）
moveIndex(layout, i, 'ArrowDown', count);  // 鍵盤移動
```

| 排版 | 規則 |
| --- | --- |
| 圖示卡片 | 欄數 = ⌊(寬 − 留白 ＋ 間距) / (最小卡寬 ＋ 間距)⌋；最小卡寬：< 400 px → 100、< 520 px → 120、其他 164；卡片高 = 寬 × 0.75 ＋ 檔名列 |
| 列表 | 一列 48 px；顯示的欄位隨寬度增加：檔名、大小 → ＋類型（≥ 560）→ ＋上傳時間（≥ 760）→ ＋上傳者（≥ 920） |

- 寬度來自 `ResizeObserver`（`useElementSize`），跟著側欄收合、視窗縮放即時重排——量的是 **主區塊** 的寬度而不是視窗，
  所以側欄展開與否都正確。
- 超過 40 列才虛擬捲動（`@tanstack/react-virtual`，以「列」為單位）；以下全部渲染。
- 資料夾樹與主區塊填滿頁面剩餘的高度（同列表頁的 `fillHeight`，見 [`07-ui-system.md`](./07-ui-system.md) §6.1），各自有捲動範圍，
  工具列與選取列不跟著捲走、分頁列固定在底部；畫面太矮時最少保留 `24rem`，改由主內容捲動（側欄底部的容量用 sticky 貼在視窗底邊）。
- 主區塊上方三列，與其他列表頁（`RichTable`）的版面一致：
  | 列 | 內容 |
  | --- | --- |
  | 頁首（`FileManagerHeader`） | 標題、說明；右側是對目前資料夾的動作（`FileActions`）：共用此資料夾、新增資料夾、上傳 |
  | 工具列（`FileToolbar`） | 左：常駐搜尋框（`TableSearch`）＋ 套用中的篩選條件（`ActiveFilters`，可單獨移除）；右：篩選面板（`FilterBar`，分類、標籤，見 `useFileFilters`）、檢視選項（`FileViewOptions`：排序、閱覽模式，改了立即生效）、排列方式、重新整理 |
  | 位置列 | 麵包屑、目前條件下的檔案總數 |
- 麵包屑（`FileBreadcrumb`）永遠只佔一列：放不下時固定顯示根目錄與目前位置，其餘從目前位置往上、放得下幾層就顯示幾層，
  中間的層收進「…」選單（`breadcrumbLayout.ts` 的 `collapsedRange`）。寬度由一份看不見的副本量出（`ResizeObserver`），
  跟著容器寬度與資料夾名稱重算；被截斷的名稱以 `title` 顯示全名。
  選單裡的每一層同樣能點、也是放置目標；拖曳中停在「…」上 500 ms 自動展開，拖曳結束就收起。

---

## 4. 狀態放哪裡

| 狀態 | 位置 | 理由 |
| --- | --- | --- |
| 所在的資料夾（`folder`）、搜尋關鍵字、分類、第幾頁（`offset`）、LightBox 開著的檔案（`preview`） | 網址（`FileSearchQuerySchema`） | 分享連結時對方看到同一個結果；上一頁回到上一個資料夾 |
| 排列方式、閱覽模式、排序、每頁筆數 | `preference.ts`：`dictStorage('file-view')` ＋ 頻道 `store:file-view:storage` | 個人偏好，下次打開沿用；改了其他分頁立即跟上；不進網址（對方有自己的偏好） |
| 選取 | `useFileSelection`（頁面狀態） | 換資料夾、換條件、換頁、換閱覽模式時清空 |

- 偏好從 localStorage 與其他分頁讀進來時逐欄驗證（`parseFileViewPreference`）：一個欄位壞掉只退回那一欄的預設值。
- 搜尋打字後 300 ms 才寫進網址，且用 `replace`：不讓每個字都留一筆瀏覽紀錄。
- 分類、標籤在篩選面板裡改的是草稿，按「搜尋」才一次寫進網址（留一筆瀏覽紀錄）。

---

## 5. 資料（`useFileListData`）

| 閱覽模式 | query | 說明 |
| --- | --- | --- |
| 分頁 | `getFileListQueryOptions`（`FILE_LIST_QUERY_KEY`） | offset ＋ limit；換頁時 `keepPreviousData` 不閃空白 |
| 無限捲動 | `getFileInfiniteListQueryOptions`（`FILE_INFINITE_LIST_QUERY_KEY`） | 以 `nextCursor`／`prevCursor` 接續（[backend 09 §6.1](../backend/09-file.md)）；捲到離底部 600 px 內就載下一頁（`useInfiniteScroll`），內容不滿一屏時自動連續載入；只保留最近 10 頁（`maxPages`） |

- 兩個 query 同時只啟用一個；切換模式時另一個留在快取。
- 無限捲動重新驗證時 TanStack 依序以游標重抓已載入的頁；合併時以 id 去重（`mergePages`），重抓途中頁與頁短暫重疊也不會出現兩次。
- **只保留最近 10 頁**（`FILE_INFINITE_MAX_PAGES`）：重新驗證（推播、回到分頁）會依序重抓保留的每一頁，捲到第 30 頁時一次推播不該變成 30 個連續請求。
  往下捲超過 10 頁時丟掉最前面的頁；頁參數是 `{ cursor, index }`，`index` 是從頭數來第幾頁，被丟掉的檔案數＝第一個保留的頁碼 × 每頁筆數（`useFileListData` 的 `dropped`）。
- **捲動錨定以「格」解決**：`FileBrowser` 的版面、鍵盤焦點、框選都以格的索引計算，被丟掉的頁在資料夾之後、保留的檔案之前留下等量的 **佔位格**
  （`withPlaceholders`，`layout.ts`）——丟頁時佔位多一頁、項目少一頁，抓回來時反過來，其他項目的格索引不變，格狀排列也不會整片換列（頁大小不是欄數的倍數時，直接移除會讓後面每一列重排）。
  渲染中的列（含 overscan）碰到佔位時 `fetchPreviousPage`（`rowsTouchRange`）；有佔位時一律虛擬化，否則全部渲染會讓佔位一直「看得到」而不停往回抓。
- 總數只來自不帶游標的第一頁：第一頁被丟掉之後沿用最後一次的值，換了篩選條件才重來。
- **網址效期**：列表的 presigned 網址在 `FILE_URL_TTL` 後失效。`useFileListData` 在最早的 `urlExpiresAt` 前 60 秒重抓；
  縮圖載入失敗（網址被提早撤銷、時鐘偏差）時也重抓，但同一批資料只重抓一次。
- 下載網址在時間窗內不變（[backend 09 §7.1](../backend/09-file.md)）：重抓列表不會讓縮圖重新下載。

---

## 6. 擴充點（`core/file`）

| 擴充 | 註冊 | 誰呼叫 | 內建 |
| --- | --- | --- | --- |
| 預覽解析器 `FilePreviewer` | `registerFilePreviewer()` | LightBox：`resolveFilePreviewer(file)` 取能處理且 `priority` 最高者 | `image`（瀏覽器能顯示的圖片）、`text`（`text/*`、JSON / YAML / XML… 與常見的腳本、設定檔副檔名） |
| 檔案驗證器 `FileValidator` | `registerFileValidator()` | 上傳入口：`validateFile(file, { maxSize })`，通過的才送進佇列 | `max-size`（後端的單檔上限）、`image-signature`（宣稱是 PNG / JPEG / GIF / WebP 的檔案，檔頭必須相符） |
| 縮圖產生器 `ThumbnailGenerator` | `registerThumbnailGenerator()` | 上傳操作：`createThumbnail(file, { maxDimension, maxBytes })` | `image`：`createImageBitmap` → 長邊 480 px 的 WebP；SVG 不產生、超過 5000 萬像素不解碼 |
| 檔案動作 `FileActionDefinition` | `registerFileAction()` | 選取列、LightBox：`useFileActions(placement)`（訂閱，§6.2） | 無（由其他 feature 提供，例：圖片庫的「加入圖片庫」） |

都在 plugin 的 **同步** 階段註冊（批次佇列可能在任何分頁啟動時就交派上傳）。前三個只在使用時讀取；檔案動作會出現在畫面上，
檔案管理器訂閱它（feature 執行期被停用時按鈕跟著消失）。新增一種格式的預覽：

```ts
// features/level-editor/plugin.ts（示意）
registerFilePreviewer({
  id: 'level',
  priority: 10,                                     // 比內建的 text 優先
  canPreview: (file) => file.name.endsWith('.level.json'),
  maxSize: 5 * 1024 * 1024,                         // 超過就顯示「檔案太大」與下載鈕
  component: lazy(() => import('./preview/LevelPreview')),  // 大型解析器只在需要時載入
});
```

契約：

- `canPreview` 只看中繼資料，不下載內容；`component` 收到 `{ file: FilePreviewSource }`（id、name、contentType、size、url）。
- 解析器拋錯只換成「無法預覽」（`PreviewBoundary`），不讓 LightBox 或頁面掛掉。
- 驗證器回 `{ validatorId, messageKey, params }`；`messageKey` 是完整字面量的語系 key
  （[coding-standards/06](../../coding-standards/06-literal-strings.md)）。驗證器自己拋錯視為通過，交給後端把關。
- 縮圖產生器產不出來回 `undefined`，不要拋錯；產出的縮圖超過 `maxBytes` 會換下一個產生器。

### 6.1 LightBox（`FileLightbox`）

- 開啟：雙擊、Enter、觸控時點一下（還沒有選取時）；網址帶 `?preview=<id>`，可以直接分享。
- 圖片預設顯示伺服器產生的 **全螢幕預覽**（`StoredFile.image.previewUrl` → `FileItemVM.displayUrl`，長邊 2560 px 的 progressive JPEG，
  下載途中就由模糊到清楚逐步顯示）；切到「原始大小」才載入原圖（`url`）。變體還沒產生時直接用原圖（[backend 09 §5.4](../backend/09-file.md)）。
- 上一個／下一個：按鈕與 ← / →，在目前載入的項目之間切換（`replace`，返回鍵直接關掉 LightBox）；先把相鄰的圖片（全螢幕預覽）抓進快取。
  方向鍵在 **capture** 階段監聽：Base UI Dialog 的焦點管理會在事件冒泡到 window 之前停止傳遞。
- 詳情另外查 `GET /files/:id`：拿到最新的名稱、版本與網址；別人刪除了（404）顯示「檔案已被刪除」並隱藏操作。
- 純文字預覽只讀前 256 KB（`Range`），JSON 自動排版；內容以 id 為 key、不可變，不重抓。

### 6.2 檔案動作（`registerFileAction`）

其他 feature 對檔案提供的動作（例：圖片庫的「加入圖片庫」，[`24-gallery.md`](./24-gallery.md) §6.1），檔案管理器不認識它們，只依註冊表列出按鈕（`core/file/actions.ts`）：

```ts
// features/gallery/plugin.ts（示意）
registerFileAction({
  id: 'gallery.add',
  labelKey: 'gallery.fileAction.add',               // 完整字面量的語系 key，在 localeScope 裡
  localeScope: GALLERY_LOCALE_SCOPE,                // 列出按鈕時以 loadLocaleScope 載入
  icon: 'file-image',
  placement: ['selectionBar', 'lightbox'],
  isAvailable: ({ can }) => can(PermissionKey['gallery:create']),
  check: (file) => (isGalleryImage(file) ? { ok: true } : { ok: false, reasonKey: 'gallery.fileAction.notImage' }),
  component: lazy(() => import('./components/AddToGalleryDialog')),
});
```

| 項目 | 規則 |
| --- | --- |
| 位置 | `selectionBar`：選取列在內建按鈕之後（選取裡有 **檔案** 時；資料夾不算，動作只收檔案）。`lightbox`：LightBox 的 footer（檔案沒被刪除時） |
| 右鍵選單 | 檔案管理器沒有右鍵選單，這一版不新增（不改變行為），所以沒有 `contextMenu` 的位置；之後加右鍵選單時再加 |
| 順序與權限 | 依 `order` 排；`isAvailable({ can })` 以權限過濾（同步），權限還沒水合時一律不列出 |
| `check` | 每個檔案能不能處理（只看 `FileActionTarget`：id、name、contentType、size）；全部不通過時按鈕停用並以第一個原因當提示（`Tooltip`），部分通過照樣可按 |
| 按下之後 | 檔案管理器記住「哪個動作 ＋ 哪些檔案」，渲染 `<component files skipped sourceId onClose>`（包 `Suspense`，可以 `lazy`）：`files` 是通過 `check` 的、`skipped` 是不通過的與原因，`sourceId` 是檔案管理在後端登記的圖片來源 id（`'file'`，`FILE_IMAGE_SOURCE_ID`），動作不寫死 |
| 沒有任何動作 | 選取列與 LightBox 與沒有這個擴充點時完全相同 |
| testid | 選取列 `file-selection-action`、LightBox `file-lightbox-action`，動作的 `id` 放 `data-value` |

- 動作的對話框是提供動作的 feature 自己的元件，它呼叫自己的 `apis/`；檔案管理器與它之間沒有 import（前端規則 2）。
- 前端的 `check` 只是體驗（型別、大小），能不能處理由後端判斷。

---

## 7. 選取與互動

| 操作 | 結果 |
| --- | --- |
| 點擊 | 只選這一個（資料夾與檔案一樣可以選取、框選） |
| ⌘ / Ctrl 點擊、點勾選框 | 切換這一個 |
| Shift 點擊 | 從錨點選到這一個 |
| 在空白處按下滑鼠拖曳 | 框選（按著 Shift / ⌘ / Ctrl 開始時疊加）；拖到上下邊緣自動捲動；空白處單純點一下清空選取 |
| 方向鍵 / Home / End | 移動焦點並選取（Shift 延伸選取）；卡片模式上下移一整列 |
| 空白鍵 / Enter、雙擊 | 切換焦點項目 / 打開：資料夾是進入，檔案是 LightBox |
| 拖曳項目到資料夾（卡片、樹、麵包屑） | 移動；拖已選取的項目時整批一起移動（§12） |
| ⌘ / Ctrl ＋ A、Esc、Delete | 全選、清除、刪除選取（有刪除權限時） |
| 觸控 | 拖曳是捲動（不框選）；沒有選取時點一下打開，有選取後點一下切換；移動用選取列的「移動」 |
| 把檔案或資料夾從電腦拖進主區塊 | 出現遮罩；放開後驗證並送進上傳佇列（資料夾保留結構）；停在資料夾卡片上時卡片亮起、上傳到那個資料夾 |

- 框選是 `core/selection` 的共用 hook `useMarqueeSelection({ scrollElement, enabled, hitTest, getSelected, apply, clear, itemSelector })`：
  它不認識項目的版面，命中由呼叫端計算；檔案管理器的 `useMarqueeSelection` 只是薄包裝——以 `hitTest(layout, rect, count)` 換成格的 id
  （佔位格略過），項目的標記是 `[data-file-item]`。門檻 4 px、邊緣 48 px 內自動捲動（最快每幀 24 px，`edgeScrollDelta`）、
  Shift／Ctrl／⌘ 疊加、觸控不搶、捲軸上按下不算、點空白清空，都在共用的 hook 裡。
- 主區塊是 WAI-ARIA listbox（`aria-multiselectable`、`aria-activedescendant`），項目是 `role="option"`：
  點擊以事件委派處理，一萬個項目也不必各掛一組 handler。勾選框由自己的 `onCheckedChange` 切換
  （Base UI 會把 click 轉發給隱藏的 input，委派處理會看到兩次）。
  `FileBrowser` 只組裝：列與虛擬捲動在 `useBrowserRows`、焦點與鍵盤在 `useBrowserKeyboard`、點擊／觸控／拖曳的委派在 `useBrowserPointer`，
  一格的渲染是 `FileBrowserItem`。頁面（`page.tsx`）也只組裝：狀態與流程在 `useFileManagerPage`，共用、申請存取、標籤對話框的對象在 `useFileDialogs`（改名與新增資料夾在 `useRenameTarget`）。
- 選取列常駐（沒有選取時顯示操作提示）：框選途中它若突然出現，主區塊會被往下推、框跟著跳動。
- 多選的刪除送進全域佇列逐筆處理（檔案 `file.delete`、資料夾 `file.deleteFolder` 各一個工作）；單一項目直接呼叫單筆 API。
  資料夾是遞迴刪除，確認對話框明講「其中的檔案與子資料夾一併移到回收桶」。
  刪除是移到回收桶：單一檔案的刪除提示附「復原」、單一資料夾的附「復原」（還原整批），見 [`13-trash.md`](./13-trash.md) §4.2。
- 選取列：只選一個時可改名（檔案與資料夾各自的對話框）、「移動」、下載（只下載選取中的檔案）、刪除。多選下載以 `downloadSequentially`（`@b2b-system/web-core/data-transfer`，與圖片庫共用）依序觸發：間隔 250 ms（同一瞬間觸發多個，瀏覽器只處理第一個），一次最多 50 個，超過時只下載前 50 個並提示。

---

## 8. 上傳

```
選檔 / 選資料夾 / 拖放
  → collectEntries（`core/upload`）：展開成 { file, directories（相對路徑的各層） }，並列出每一個資料夾路徑（含空資料夾）；略過 .DS_Store 等系統檔
  → useFileUpload：validateFile()（core/file 的驗證器）→ 被擋下的以 toast 列出第一個原因
  → 有資料夾時：POST /file-folders/paths 在目的地建出同樣的結構（同名合併），拿到每個路徑的資料夾 id；失敗就整批不上傳
  → enqueueFileUploads()：檔案放進 uploadSources（`core/upload` 的 `createUploadSources('file-upload')`；記憶體 ＋ IndexedDB），佇列項目只帶
       { id: <暫存 key>@<資料夾 id>, label: 相對路徑, weight: 大小 }——目的地編進 id，接手的分頁也知道要傳到哪裡
  → 全域批次佇列（concurrency 3）交派給某個分頁
  → file.upload 操作：從 uploadSources 取檔 → createThumbnail() → uploadFile(file, folderId, thumbnail, onProgress, signal)
       uploadFile：登記 → 單次 PUT 或分塊（4 塊並行、各塊重試）→ complete；失敗或中止時放棄上傳
  → 成功：invalidateResources(file create)；不論成敗都清掉暫存的檔案
```

- **與其他批次工作共用佇列**：進度（依位元組加權）、取消（中止進行中的請求並放棄上傳）、AppHeader 的佇列面板、
  結束時的結果彈窗都沿用 `web-core/batch`；主區塊上方顯示本頁送出的工作進度。
- **跨分頁接手**：發起的分頁關掉時，佇列把剩下的項目交給其他分頁；它們從 IndexedDB 讀到同一個檔案繼續上傳。
  IndexedDB 不可用（隱私模式）時接手的分頁拿不到檔案，該筆以 `FILE_UPLOAD_INCOMPLETE` 失敗，請使用者重傳。
  分頁當掉留下的暫存在下次啟動時清除（超過 24 小時；plugin 的 `onInit` 呼叫 `prune()`）。
  暫存區是每個 feature 各自一個（`createUploadSources(name)`，`name` 是 IndexedDB 的名稱，檔案管理是 `file-upload`，不能改名），
  各自在 plugin 的 `onInit` 掛上 `clearOnSessionEnd()`、`onDestroy` 解除。
- 大檔切塊與網址續期見 [backend 09 §5.2](../backend/09-file.md)。
- **資料夾的讀取**：拖放時 `webkitGetAsEntry()` 只在 drop 事件的同步階段有效，`collectFromDataTransfer()` 在第一個 `await`
  之前就取出所有項目，再非同步遞迴展開（`readEntries` 一次最多回 100 筆，要讀到回空陣列為止）。
  選取資料夾（`<input webkitdirectory>`）則以 `webkitRelativePath` 還原路徑。

---

## 9. 效能

| 位置 | 做法 |
| --- | --- |
| 渲染 | 虛擬捲動（只渲染看得到的列）；項目元件 `memo`，回呼以 ref 保持穩定，選取改變時不重新渲染所有項目；點擊事件委派 |
| 圖片 | 伺服器產生的圖示預覽（長邊 480 px；之前退回上傳時產生的縮圖）而不是原圖；LightBox 用全螢幕預覽；`loading="lazy"`、`decoding="async"`；沒有縮圖的圖片只有 ≤ 2 MiB 才直接用原檔 |
| 網路 | 下載網址在時間窗內不變 ＋ `Cache-Control: immutable`：重抓列表不會重新下載縮圖；搜尋去抖動；換頁 `keepPreviousData` |
| 推播 | 失效經依賴圖，背景分頁只標 stale、可見分頁合併後隨機延遲重抓（[11 §4](./11-realtime.md)） |
| 後端 | (排序欄位, id) 索引 ＋ keyset 分頁：每一頁都是索引範圍掃描；檔名部分比對用 `pg_trgm` 的 GIN 索引；網址在 api 本地簽章，不打儲存服務 |
| 上傳 | 內容不經過 api；3 個檔案並行、大檔 4 塊並行；進度回報節流 200 ms 再經頻道廣播 |

---

## 10. 同步與資源競爭

| 情境 | 處理 |
| --- | --- |
| 別人上傳、改名、刪除 | 推播 `file` 變更 → 依賴圖失效列表與詳情（`Resource.FILE`）；推播帶所在的資料夾，只重抓正在看那個資料夾的列表（列表 key 的第二個元素是資料夾）；沒有推播時靠自己的寫入失效與 window focus |
| 別人建立、改名、移動、刪除資料夾 | 推播 `fileFolder` 變更 → 失效資料夾清單（`Resource.FILE_FOLDER`）；移動與刪除也失效檔案列表（`derivesFrom`） |
| 所在的資料夾被別人刪除 | 資料夾清單裡找不到網址上的 `folder` → 以 `replace` 回到根目錄 |
| 拖放時別人剛好改了結構 | 前端先依自己的資料夾清單擋下明顯的循環；後端在排隊的交易內再檢查一次（`FILE_FOLDER_CYCLE` / `NAME_CONFLICT`），失敗以 toast 顯示並重抓資料夾 |
| 無限捲動途中有人新增或刪除 | keyset 游標：下一頁從「最後一筆之後」取，不重複、不漏；重新驗證時合併以 id 去重 |
| 選取的檔案被別人刪除 | 選取以 id 記錄，並以目前載入的 id 過濾：資料更新後自動移出，批次操作不會送出看不到的項目 |
| 兩個人同時改名 | 送出 **開啟對話框時** 記下的 `version`（之後推播讓列表重抓也不換）；後到者收到 `FILE_VERSION_CONFLICT`，對話框保留輸入並以 `VersionConflictAlert` 提供「重新載入」，按下才換成最新的名稱與版本 |
| 正在預覽的檔案被刪除 | 詳情 404 → LightBox 顯示「已刪除」並隱藏操作；自己刪除時關掉 LightBox |
| 同一個檔案在批次刪除時已被刪除 | 單筆 API 回 `FILE_NOT_FOUND`，佇列記為失敗並一併移出選取（`isGoneError`） |
| 上傳完成與取消同時發生 | 後端以 `WHERE status='pending'` 決勝（[backend 09 §5.3](../backend/09-file.md)），不會刪掉已完成的檔案 |
| 多個分頁改了偏好 | dictStorage 經頻道同步，其他分頁的畫面立即跟上 |

---

## 11. 測試

| 檔案 | 內容 |
| --- | --- |
| `features/file/pages/FileManager/__tests__/layout.test.ts` | RWD 欄數、框選命中（含畫面外、間距）、方向鍵 |
| `…/__tests__/useMarqueeSelection.test.ts` | 檔案管理器的框選：命中略過佔位格、取代與疊加、門檻、邊緣捲動、從項目或控制項上開始不算 |
| `…/__tests__/FileSelectionBar.test.tsx` | 檔案動作：沒有動作時不變、依 order 列在內建按鈕之後、只有資料夾時不顯示、權限三案例、全部不通過時停用、按下後的 files／skipped／sourceId、lazy、反註冊 |
| `…/__tests__/useFileSelection.test.ts` | 點擊、⌘ / Shift、框選取代與疊加、資料更新後自動修剪 |
| `…/__tests__/FileBrowser.test.tsx` | 點擊與勾選框、雙擊（檔案／資料夾）、鍵盤、拖放上傳（含放在資料夾卡片上、無權限）、拖曳移動（整批、只拖一個、放進自己被擋、無權限不可拖）、列表表頭排序、空狀態 |
| `…/__tests__/FileMoveDialog.test.tsx` | 樹狀下拉選單選目的地（自己與子孫停用、目前位置不能送出）、資料夾樹預設收合且與選單連動 |
| `…/__tests__/folderTree.test.ts` | 自然排序、孤兒不掛到根目錄、路徑、`isWithin`、移動的合法性（含目的地的 canCreate） |
| `…/__tests__/FileBatchProgress.test.tsx` | 進度條只顯示檔案管理器的工作；`useFileActions()` 不訂閱佇列，進度快照不讓整頁重繪 |
| `…/components/__tests__/FileAccessRequestDialog.test.tsx` | 送出等級與理由、已送出的狀態 |
| `core/upload/__tests__/collectEntries.test.ts` | `webkitRelativePath` 還原結構、略過系統檔、拖放的遞迴展開（含空資料夾、分批的 `readEntries`） |
| `core/upload/__tests__/uploadSources.test.ts`、`imageSignature.test.ts` | 暫存區的 `prune`、session 結束只清自己的、解除訂閱；六種圖片的檔頭、認不得的型別回 `undefined` |
| `core/selection/__tests__/*` | 幾何（`rectFromPoints`、`intersects`、`edgeScrollDelta`）、共用的框選 hook（`hitTest` 回呼、疊加、資料更新時用最新的、`itemSelector`） |
| `…/__tests__/FileLightbox.test.tsx` | 依註冊表選解析器、無解析器、超過大小上限、解析器壞掉、上一個／下一個、已刪除、權限、檔案動作（沒有動作時不變、`check` 不通過時停用、按下後的對象與來源 id） |
| `…/__tests__/adapter.test.ts` | 縮圖／原檔／圖示的選擇、全螢幕預覽、多頁去重、網址效期 |
| `features/file/preview/__tests__/ImagePreview.test.tsx` | 預設顯示全螢幕預覽、原始大小才載入原圖、沒有預覽時用原圖 |
| `features/file/hooks/__tests__/useFilePermission.test.tsx` | 目前位置的能力（根目錄、資料夾）、選取項目的能力取交集、未水合 |
| `…/components/__tests__/FileShareDialog.test.tsx` | 列出直接與繼承的授權、新增／變更等級／移除、中斷繼承、反提權錯誤、無權限 |
| `features/file/__tests__/batch.test.ts` | 送進佇列的形狀、上傳到資料夾（目的地編進 id）、上傳操作（進度、帶目的地資料夾的失效、清暫存、被限流時保留檔案、拿不到檔案）、刪除檔案與資料夾 |
| `features/file/upload/__tests__/validators.test.ts`、`__tests__/preference.test.ts` | 內建驗證器（`image-signature` 只檢查 PNG／JPEG／GIF／WebP，AVIF、TIFF 照舊放行）、偏好的逐欄驗證 |
| `core/file/__tests__/*` | 類型判斷、四個註冊表（檔案動作：order、位置、`isAvailable`、未水合、訂閱與反註冊、reset、`check` 的分組） |
| `web-core/batch/__tests__/BatchQueue.test.ts` | 工作內並行、進度回報與廣播（進度快照的節流）、取消時中止處理中的項目、依份量計算進度（兩萬筆的耗時）、合併失效、限流時暫停重送 |
| `packages/web-shared/src/storage/__tests__/blobStore.test.ts` | 沒有 IndexedDB 時退回記憶體、`prune` |

---

## 12. 資料夾與拖曳移動

資料夾把檔案分類成巢狀結構（後端規則見 [backend 09 §4.2](../backend/09-file.md)）。

```
GET /file-folders（全部資料夾，扁平清單）
  → folderTree.buildFolderIndex()：byId ＋ 上層 → 子資料夾（自然排序）
  → 麵包屑（folderPath）、側欄的樹（FileFolderTree）、主區塊的子資料夾（useFolderView）、移動對話框、拖放的合法性判斷共用
GET /files?folderId=<目前資料夾 | root>  → 主區塊的檔案（資料夾排在前面）
```

- **為什麼一次拿全部資料夾**：資料夾數量遠少於檔案，一份清單就能畫出樹、麵包屑、判斷循環；逐層展開時才查詢
  會讓麵包屑（要知道所有上層）與拖放的合法性判斷（要知道所有子孫）都得多打 API。
- 主區塊的資料夾依名稱排序（依大小、上傳時間排序時仍以名稱排，只跟著「名稱遞減」反轉）；搜尋時依名稱篩選；選了檔案分類時不顯示。
  分頁模式只在第一頁放資料夾（檔案的 offset 分頁不包含資料夾）。
- 側欄只在 `lg` 以上顯示；窄螢幕以麵包屑往上層、以「移動」對話框移動。樹的節點：目前資料夾的上層自動展開，之後選到別處也保持展開。

### 12.1 拖曳移動（`useItemDrag`）

| 項目 | 做法 |
| --- | --- |
| 拖什麼 | 拖已選取的項目 → 整批（檔案與資料夾）；拖沒選取的 → 只拖它（不改變選取，同作業系統的檔案總管）。游標旁顯示「N 個項目」的小標籤 |
| 放在哪 | 標了 `data-drop-folder` 的元素：主區塊的資料夾卡片／列、樹的節點（也可以把節點拖到別的節點上）、麵包屑的每一層（往上層移；收進「…」的層在選單裡，選單在 portal 中，事件仍沿 React 元件樹冒泡到麵包屑的 handler）。容器上掛一組 handler，以事件委派找出目標 |
| 能不能放 | 放回原處不算；資料夾不能放進自己或子孫（同後端的 `FILE_FOLDER_CYCLE`）。不合法時 `dropEffect = 'none'`（游標顯示禁止），合法的目標亮起來 |
| 與上傳的區別 | 頁面內的拖曳只帶 `application/x-b2b-system-file-items`；從電腦拖進來的帶 `Files`。兩個 hook 在同一個容器上各自只認自己的型別 |
| 拖了哪些 | `dragover` 期間瀏覽器不讓讀 `getData()`，所以拖曳的項目記在 hook 的 ref 裡，`dataTransfer` 只帶型別標記 |
| 送出 | `POST /files/move` 一次送出檔案與資料夾（後端同一個交易）；成功後失效資料夾清單與檔案（`id='*'`），toast「已移動 N 個項目」 |
| 權限 | 被拖的每個項目都要 `capabilities.canUpdate`，目的地要 `canCreate`（根目錄看 `rootCapabilities`）；不能拖的項目不可拖曳，不能放的目標不亮（§13） |

**替代方式**：拖放不適合鍵盤、觸控、目的地不在畫面上的情況——選取列的「移動」開啟對話框（`FileMoveDialog`）。
目的地以 **樹狀下拉選單** 選（`Select` 的 `selectableGroups`，根目錄在最上層、可搜尋；`data-testid="file-move-target"`）；
側欄同一棵資料夾樹（`FileFolderTree`）預設收合在「以資料夾樹檢視」（`file-move-tree-toggle`）底下，展開後與選單是同一個目的地。
要移動的資料夾與其子孫不可選，目前所在的位置可以選但「移到這裡」不可按。

### 12.2 資料夾的操作

| 操作 | 入口 | 權限 |
| --- | --- | --- |
| 新增資料夾（在目前的資料夾裡） | 頁首「新增資料夾」→ `FileFolderDialog` | 目前位置的 `canCreate` |
| 改名 | 只選一個資料夾時，選取列的「重新命名」 | 該資料夾的 `canUpdate` |
| 刪除（遞迴） | 選取後 Delete 鍵或選取列的「刪除」 | 選取的每一項都 `canDelete` |
| 共用（管理授權） | 只選一個資料夾時選取列的「共用」；頁首的「共用此資料夾」 → `FileShareDialog` | 該資料夾的 `canShare` |
| 進入 | 雙擊、Enter、觸控點一下、樹的節點、麵包屑 | 看得到就能進（清單只含看得到的） |

---

## 13. 權限與共用（資料夾層級授權）

規格：[`iam/06-resource-grants.md`](../iam/06-resource-grants.md)。前端 **不重算** 繼承與擁有者規則，只讀後端的旗標。

| 資料 | 來源 | 用在 |
| --- | --- | --- |
| 能不能進檔案管理器 | 頁面權限 `FILE`：`file:access` 或 `file:read`（SOME） | 路由 guard、選單 |
| 目前位置能不能上傳、建資料夾、共用 | 目前資料夾的 `capabilities`；根目錄是 `FileFolderList.rootCapabilities` | 頁首的動作、拖放上傳、空狀態 |
| 項目能不能改名、移動、刪除 | 每個 `StoredFile` / `FileFolder` 的 `capabilities`（經 `adapter.ts` 放進 VM） | 選取列（取交集）、拖曳移動、LightBox、Delete 鍵 |

```
useFilePermission({ location })            ← hooks/useFilePermission.ts
  canAccess                                 頁面權限（未水合 → false）
  canUpload / canCreateFolder / canShare    目前位置的 capabilities
selectionCapabilities(items)                選取項目的能力取交集：canRename（只選一個）、canMove、canDelete
```

- **鎖住的資料夾**：沒有 `read` 的資料夾仍列出（`capabilities.canRead = false`），樹、卡片、列表都加鎖頭圖示並淡化；
  可以進入（看得到子資料夾，才走得到裡面被授權的資料夾），檔案區改顯示「沒有存取權」與「申請存取」
  （`FileAccessRequestDialog`：選等級、填理由；已申請時顯示「已送出申請，等待審核」）。不對鎖住的資料夾查檔案清單。
- **系統資料夾**：共用資料夾（`users` 圖示）、私人資料夾與個人資料夾（`user` 圖示）依 `FileFolder.kind` 顯示；
  沒有指定資料夾時開在自己的個人資料夾（`personalFolderId`，只在進入頁面時導一次，之後點「所有檔案」仍回到根目錄）。
  系統資料夾的 `capabilities.canUpdate/canDelete` 恆為 false，選取列自然不顯示改名、移動、刪除。
- **共用對話框（`FileShareDialog`）**：列出直接授權與繼承的授權（標出來源資料夾、不可在這裡改）；
  新增對象（`GET /file-folders/:id/grant-subjects` 搜尋角色／使用者，或選「所有人」）、選等級、選過期時間；變更等級、移除（移除與降級先確認，對象是角色、群組或所有人時說明影響的是一群人；升級與已過期授權的改等級直接送出）；
  「不繼承上層的授權」開關（開啟時提示會複製目前繼承到的授權）；「存取申請」區塊列出待審的申請，可核准或駁回。等級選單只列出操作者授予得起的（反提權，後端仍會再擋）。
- 授權變更之後後端推 `fileFolder update`：資料夾清單與檔案清單重抓，旗標自然更新；被移除授權的人正在看的資料夾
  從清單消失時，走既有的「網址上的資料夾不存在 → 回到根目錄」（`onMissingFolder`）。


---

## 14. 設計決策：上傳併入全域批次佇列、瀏覽器產生縮圖、keyset 分頁

> 原 ADR-0013，2026-09-27 決定。擴充 [`frontend/07-ui-system.md`](07-ui-system.md) §13（全域批次佇列）；
> D7 由 [`backend/09-file.md`](../backend/09-file.md) §12 部分取代（伺服器產生影像變體，瀏覽器縮圖降為退路），「分頁當掉時的殘留」由 [`backend/09-file.md`](../backend/09-file.md) §12 的維護排程處理。
> 後端的對應規格見 [`../backend/09-file.md`](../backend/09-file.md) §5、§6.1、§7.1。

### 14.1 背景

檔案管理器要一次上傳多個檔案（包含數十 MB 的素材包）、在列表上顯示圖片預覽，並支援無限捲動。直接套用既有機制會遇到：

- **上傳要有自己的進度、取消與失敗清單**，而這些 [`frontend/07-ui-system.md`](07-ui-system.md) §13 的全域批次佇列都有；另做一套上傳佇列，
  AppHeader 就會有兩個「背景工作」面板，行為也會分歧。但佇列原本只認得「一筆成功或失敗」、一次只處理一筆，項目也只帶 id。
- **大檔單次 PUT**：失敗要整個重傳，進度只有一條；超過 5 GiB 物件儲存也不接受。
- **列表的圖片預覽**：直接用原圖，一頁 60 張 1–5 MB 的圖就是上百 MB；presigned 網址每次查詢都不同，重抓列表就全部重新下載。
- **無限捲動用 offset**：捲動途中有人上傳（插在前面）會讓下一頁重複，有人刪除則會漏掉。

### 14.2 決定

| # | 問題 | 決定 |
| --- | --- | --- |
| D1 | 上傳走哪個佇列 | **全域批次佇列**：上傳是一種批次操作（`file.upload`），每個檔案是一筆。進度、取消、結果彈窗、跨分頁接手全部沿用 |
| D2 | 一次處理幾筆 | 工作之間仍是堵塞式；**工作內可以並行**：`BatchJobInput.concurrency`（上限 6），上傳用 3。其他批次操作維持 1 |
| D3 | 位元組進度 | 操作以 `BatchRunContext.reportProgress` 回報處理中那一筆的進度（分頁端節流 200 ms），佇列記在 `BatchJob.progress` 並廣播；項目帶 `weight`（位元組）時整體進度依份量計算 |
| D4 | 取消 | 佇列對處理中的項目送 `abort`，分頁中止該筆的 `AbortSignal`；被中止的那一筆不算失敗。上傳被中止時放棄這次上傳（`DELETE /files/:id/upload`） |
| D5 | 檔案本身放哪裡 | 佇列項目要能跨 worker、跨分頁傳遞，只帶 id；檔案放進 `uploadSources`（本分頁記憶體 ＋ IndexedDB）。發起的分頁關掉時，接手的分頁從 IndexedDB 讀到同一個檔案 |
| D6 | 大檔 | 大於 `FILE_MULTIPART_THRESHOLD` 改用 S3 multipart upload：後端決定切法、各塊網址邊傳邊要，前端 4 塊並行、各塊重試 |
| D7 | 縮圖 | **瀏覽器在上傳時產生**（`core/file` 的縮圖產生器），與本體一起直傳；後端只確認存在與規格（已由 [`backend/09-file.md`](../backend/09-file.md) §12 部分取代，見引述） |
| D8 | 下載網址的快取 | 簽章時間取整到 `FILE_URL_TTL / 2` 的倍數，時間窗內網址不變，並回 `Cache-Control: immutable` |
| D9 | 無限捲動 | keyset 游標（`nextCursor`）；游標帶排序條件與微秒精度的值 |
| D10 | 預覽與驗證的擴充 | `core/file` 的三個註冊表（預覽解析器、檔案驗證器、縮圖產生器）；內建項目由 `features/file` 在 plugin 的同步階段註冊 |

### 14.3 理由

- **一個佇列**：使用者只需要知道「背景有工作在跑」一件事；上傳與批次刪除彼此排隊，也不會同時搶頻寬與 API 配額。
- **並行只開在工作內**：上傳每筆彼此獨立、瓶頸在網路延遲，3 個並行幾乎是 3 倍快；[`frontend/07-ui-system.md`](07-ui-system.md) §13 的「前一筆影響後一筆」
  顧慮（例：最後一位 super-admin）只存在於會互相影響的操作，它們維持一次一筆。
- **IndexedDB 而不是把 File 放進佇列**：佇列快照每次進度更新都要廣播給所有分頁，帶著檔案內容會把數百 MB 反覆 structured clone。
- **瀏覽器產生縮圖**：api 不必裝影像處理的原生套件、不佔 CPU，也不必把原圖從物件儲存讀回來；瀏覽器上傳前本來就持有檔案。
- **keyset 而不是 offset**：唯一在插入與刪除下仍然正確的分頁方式；搭配 (排序欄位, id) 索引，每一頁都是索引範圍掃描。

### 14.4 取捨

- **縮圖依賴上傳者的瀏覽器**：瀏覽器不支援的格式（HEIC 等）、其他管道寫入的檔案沒有縮圖，列表退回類型圖示。
  之後若需要，可以加一個伺服器端的補產生排程，不影響前端（後來由 [`backend/09-file.md`](../backend/09-file.md) §12 實現）。
- **IndexedDB 不可用時不能跨分頁接手**：發起的分頁關掉後，接手的分頁拿不到檔案，該筆失敗並請使用者重傳（§8）。
- **session 結束時清掉排隊中的檔案**：佇列同時被清空（[`frontend/07-ui-system.md`](07-ui-system.md) §13.2 D12），`uploadSources.clear()`
  清掉本分頁的記憶體與 IndexedDB（`createUploadSources()` 的 `clearOnSessionEnd`）；上一個人沒傳完的檔案不留在這台瀏覽器上。
- **分頁當掉時的殘留**：未完成的 multipart upload 與 `pending` 紀錄要靠排程清理（[backend 09 §9](../backend/09-file.md)）。
- **下載網址的剩餘效期縮短為 TTL/2–TTL**：前端依 `urlExpiresAt` 在失效前重抓。

### 14.5 實作紀錄

- `web-core/batch`：`BatchJobInput.concurrency`、`BatchJobItem.weight`、`BatchJob.progress`、`BatchOperation.run(itemId, { signal, reportProgress })`；
  協定新增 `progress`（分頁 → 佇列）與 `abort`（佇列 → 分頁）；`jobProgressRatio()` / `jobProgressAmount()`。既有操作只多收一個參數，行為不變。
- 2026-10-07：上傳的變更改以 `run` 的 `invalidate` 宣告並帶目的地資料夾（`refs.fileFolder`，根目錄是 `root`），由佇列合併後每秒最多失效一次；
  被限流（`429`）的那一筆保留 `uploadSources` 裡的檔案，由佇列在時間到後重送（[`07-ui-system.md`](07-ui-system.md) §13.4）。
- 後端：`files` 新增 `upload_id`、`has_thumbnail`、`version` 與排序／搜尋索引（`0007_file_manager.sql`，需要 `pg_trgm`）；
  端點 `GET /files/upload-policy`、`POST /files/:id/parts`、`DELETE /files/:id/upload`；`GET /files` 回 `FileListPage`（含 `nextCursor`）；
  錯誤碼 `FILE_UPLOAD_PART_INVALID`、`FILE_VERSION_CONFLICT`；環境變數 `FILE_MULTIPART_THRESHOLD`、`FILE_MULTIPART_PART_SIZE`。
- 前端：`core/file`（類型、擴充點）、`packages/web-shared/src/storage/blobStore`、`features/file`。
- 2026-10-09：圖片庫要共用上傳與框選，`collectEntries`、上傳暫存區（改成工廠 `createUploadSources`）、圖片的檔頭簽章抽到 `core/upload`，
  框選的幾何與 hook 抽到 `core/selection`；`core/file` 加第四個擴充點 `registerFileAction`（§6.2）。檔案管理器的行為不變。
