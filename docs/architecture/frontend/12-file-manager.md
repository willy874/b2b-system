# 前端 12 — 檔案管理器

> 狀態：**已實作**（`features/file`，路由 `/file`）。後端的檔案模組、上傳流程、API 見
> [`../backend/09-file.md`](../backend/09-file.md)；上傳進入全域佇列的決策見 [ADR-0013](../../adr/0013-file-manager-upload.md)。

## 1. 功能

| 需求 | 做法 | 章節 |
| --- | --- | --- |
| 列表、圖示卡片兩種排版 | 同一套固定尺寸的版面計算，依容器寬度決定欄數 | §3 |
| 分頁、無限捲動兩種閱覽模式 | 分頁用 offset；無限捲動用 keyset 游標（捲動中有人新增或刪除也不重複、不漏） | §5 |
| 資料夾分類（巢狀） | 左側樹狀面板 ＋ 麵包屑 ＋ 主區塊的資料夾（排在檔案前面）；一份扁平清單組成樹 | §12 |
| 拖曳移動檔案與資料夾 | `useItemDrag`：拖到資料夾卡片、樹的節點、麵包屑上移動；擋下移進自己的子孫；「移動到…」對話框是替代方式 | §12 |
| 拖曳到主區塊上傳 | `useFileDrop`：只對帶檔案的拖曳反應；資料夾保留結構上傳；放在資料夾卡片上就傳到那個資料夾 | §7、§8 |
| 上傳資料夾 | 拖放資料夾或選取資料夾（`webkitdirectory`）；先在目的地建出同樣的結構（同名合併），再把檔案送進佇列 | §8 |
| 框選多個檔案做批次處理 | `useMarqueeSelection`：以版面幾何計算命中，畫面外（虛擬捲動沒渲染）的項目也算得到 | §7 |
| RWD | 欄數、卡片寬度、列表顯示的欄位都由容器寬度決定；工具列在窄螢幕換行 | §3 |
| 常見格式的圖示、圖片的縮圖預覽 | `core/file` 的 `getFileKind()` ＋ 伺服器產生的圖示預覽（`thumbnailUrl`；之前退回上傳時由瀏覽器產生的縮圖） | §6、§8 |
| 前後端效能 | 虛擬捲動、縮圖、穩定的下載網址（瀏覽器快取命中）、索引與 keyset 分頁 | §9 |
| 變更事件的同步與資源競爭 | 推播失效、選取以 id 記錄並自動修剪、改名樂觀鎖、LightBox 偵測已刪除 | §10 |
| 排序、搜尋、篩選 | 檔名搜尋（去抖動）、分類篩選、三種排序 ＋ 方向 | §4 |
| 上傳與全域批次佇列共用 | 上傳是一種批次操作（`file.upload`），進度、取消、結果彈窗、跨分頁接手都沿用佇列 | §8 |
| 大檔分塊上傳 | 後端決定切法，前端邊要網址邊並行上傳各塊、各塊重試 | §8 |
| LightBox 預覽 | 詳情對話框；內容由預覽解析器顯示，內建圖片與純文字 | §6 |
| 插件能力 | `core/file` 的三個註冊表：預覽解析器、檔案驗證器、縮圖產生器 | §6 |
| 偏好記憶 | 排列方式、閱覽模式、排序、每頁筆數存在 localStorage，跨分頁同步 | §4 |
| 資料夾層級的權限與共用 | 按鈕看後端回傳的 `capabilities`；「共用」對話框管理資料夾授權、中斷繼承 | §13 |

---

## 2. 分層

```
features/file/                       業務：頁面、上傳入口、內建的解析器與驗證器
├── plugin.ts                        同步階段：頁面權限、批次操作、內建擴充；onInit：語系、清理暫存
├── batch.ts                         批次操作 file.upload / file.delete、enqueueFileUploads()
├── preference.ts                    排列方式、閱覽模式、排序、每頁筆數（dictStorage ＋ 跨分頁頻道）
├── upload/                          uploadSources（IndexedDB 暫存）、內建驗證器、collectEntries（展開拖放／選取的資料夾）
├── preview/                         內建解析器：ImagePreview、TextPreview
├── hooks/                           useFilePermission、useFileUpload、useFileRenameMutation / useFileDeleteMutation、
│                                    useFolderMutations（建立、改名、遞迴刪除、還原、移動）
└── pages/FileManager/               page.tsx ＋ 版面計算、資料、選取、框選、拖放、資料夾樹（folderTree）、拖曳移動（useItemDrag）的 hooks ＋ 元件

core/file/                           機制：檔案類型、三個擴充點的註冊表、圖片縮圖產生器（不認識任何 feature）
core/batch/                          全域批次佇列（上傳與其他批次工作共用）
apis/file/                           uploadFile()（單次／分塊／縮圖）、列表（分頁／無限）、詳情、內容（文字預覽）、上傳政策、
                                     資料夾（列表、建立、改名、刪除、確保路徑）、移動
shared/storage/blobStore.ts          Blob 的鍵值儲存（記憶體 ＋ IndexedDB）
```

- 擴充點放在 `core/file` 而不是 feature 裡：其他 feature（例如之後的業務功能要預覽自訂格式）只能經由 `core/` 互動
  （[conventions/07](../../conventions/07-layer-dependencies.md) §2.2）。
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
  工具列與選取列不跟著捲走、分頁列固定在底部；畫面太矮時最少保留 `24rem`，改由主內容捲動。

---

## 4. 狀態放哪裡

| 狀態 | 位置 | 理由 |
| --- | --- | --- |
| 所在的資料夾（`folder`）、搜尋關鍵字、分類、第幾頁（`offset`）、LightBox 開著的檔案（`preview`） | 網址（`FileSearchQuerySchema`） | 分享連結時對方看到同一個結果；上一頁回到上一個資料夾 |
| 排列方式、閱覽模式、排序、每頁筆數 | `preference.ts`：`dictStorage('file-view')` ＋ 頻道 `store:file-view:storage` | 個人偏好，下次打開沿用；改了其他分頁立即跟上；不進網址（對方有自己的偏好） |
| 選取 | `useFileSelection`（頁面狀態） | 換資料夾、換條件、換頁、換閱覽模式時清空 |

- 偏好從 localStorage 與其他分頁讀進來時逐欄驗證（`parseFileViewPreference`）：一個欄位壞掉只退回那一欄的預設值。
- 搜尋打字後 300 ms 才寫進網址，且用 `replace`：不讓每個字都留一筆瀏覽紀錄。

---

## 5. 資料（`useFileListData`）

| 閱覽模式 | query | 說明 |
| --- | --- | --- |
| 分頁 | `getFileListQueryOptions`（`FILE_LIST_QUERY_KEY`） | offset ＋ limit；換頁時 `keepPreviousData` 不閃空白 |
| 無限捲動 | `getFileInfiniteListQueryOptions`（`FILE_INFINITE_LIST_QUERY_KEY`） | 以上一頁的 `nextCursor` 接續（[backend 09 §6.1](../backend/09-file.md)）；捲到離底部 600 px 內就載下一頁（`useInfiniteScroll`），內容不滿一屏時自動連續載入 |

- 兩個 query 同時只啟用一個；切換模式時另一個留在快取。
- 無限捲動重新驗證時 TanStack 依序以游標重抓已載入的頁；合併時以 id 去重（`mergePages`），重抓途中頁與頁短暫重疊也不會出現兩次。
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

都在 plugin 的 **同步** 階段註冊（批次佇列可能在任何分頁啟動時就交派上傳）。新增一種格式的預覽：

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
  （[conventions/06](../../conventions/06-literal-strings.md)）。驗證器自己拋錯視為通過，交給後端把關。
- 縮圖產生器產不出來回 `undefined`，不要拋錯；產出的縮圖超過 `maxBytes` 會換下一個產生器。

### 6.1 LightBox（`FileLightbox`）

- 開啟：雙擊、Enter、觸控時點一下（還沒有選取時）；網址帶 `?preview=<id>`，可以直接分享。
- 圖片預設顯示伺服器產生的 **全螢幕預覽**（`StoredFile.image.previewUrl` → `FileItemVM.displayUrl`，長邊 2560 px 的 progressive JPEG，
  下載途中就由模糊到清楚逐步顯示）；切到「原始大小」才載入原圖（`url`）。變體還沒產生時直接用原圖（[backend 09 §5.4](../backend/09-file.md)）。
- 上一個／下一個：按鈕與 ← / →，在目前載入的項目之間切換（`replace`，返回鍵直接關掉 LightBox）；先把相鄰的圖片（全螢幕預覽）抓進快取。
  方向鍵在 **capture** 階段監聽：Base UI Dialog 的焦點管理會在事件冒泡到 window 之前停止傳遞。
- 詳情另外查 `GET /files/:id`：拿到最新的名稱、版本與網址；別人刪除了（404）顯示「檔案已被刪除」並隱藏操作。
- 純文字預覽只讀前 256 KB（`Range`），JSON 自動排版；內容以 id 為 key、不可變，不重抓。

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

- 主區塊是 WAI-ARIA listbox（`aria-multiselectable`、`aria-activedescendant`），項目是 `role="option"`：
  點擊以事件委派處理，一萬個項目也不必各掛一組 handler。勾選框由自己的 `onCheckedChange` 切換
  （Base UI 會把 click 轉發給隱藏的 input，委派處理會看到兩次）。
- 選取列常駐（沒有選取時顯示操作提示）：框選途中它若突然出現，主區塊會被往下推、框跟著跳動。
- 多選的刪除送進全域佇列逐筆處理（檔案 `file.delete`、資料夾 `file.deleteFolder` 各一個工作）；單一項目直接呼叫單筆 API。
  資料夾是遞迴刪除，確認對話框明講「其中的檔案與子資料夾一併移到回收桶」。
  刪除是移到回收桶：單一檔案的刪除提示附「復原」、單一資料夾的附「復原」（還原整批），見 [`13-trash.md`](./13-trash.md) §4.2。
- 選取列：只選一個時可改名（檔案與資料夾各自的對話框）、「移動」、下載（只下載選取中的檔案）、刪除。多選下載以 250 ms 間隔依序觸發（同一瞬間觸發多個，瀏覽器只處理第一個）。

---

## 8. 上傳

```
選檔 / 選資料夾 / 拖放
  → collectEntries：展開成 { file, directories（相對路徑的各層） }，並列出每一個資料夾路徑（含空資料夾）；略過 .DS_Store 等系統檔
  → useFileUpload：validateFile()（core/file 的驗證器）→ 被擋下的以 toast 列出第一個原因
  → 有資料夾時：POST /file-folders/paths 在目的地建出同樣的結構（同名合併），拿到每個路徑的資料夾 id；失敗就整批不上傳
  → enqueueFileUploads()：檔案放進 uploadSources（記憶體 ＋ IndexedDB），佇列項目只帶
       { id: <暫存 key>@<資料夾 id>, label: 相對路徑, weight: 大小 }——目的地編進 id，接手的分頁也知道要傳到哪裡
  → 全域批次佇列（concurrency 3）交派給某個分頁
  → file.upload 操作：從 uploadSources 取檔 → createThumbnail() → uploadFile(file, folderId, thumbnail, onProgress, signal)
       uploadFile：登記 → 單次 PUT 或分塊（4 塊並行、各塊重試）→ complete；失敗或中止時放棄上傳
  → 成功：invalidateResources(file create)；不論成敗都清掉暫存的檔案
```

- **與其他批次工作共用佇列**：進度（依位元組加權）、取消（中止進行中的請求並放棄上傳）、AppHeader 的佇列面板、
  結束時的結果彈窗都沿用 `core/batch`；主區塊上方顯示本頁送出的工作進度。
- **跨分頁接手**：發起的分頁關掉時，佇列把剩下的項目交給其他分頁；它們從 IndexedDB 讀到同一個檔案繼續上傳。
  IndexedDB 不可用（隱私模式）時接手的分頁拿不到檔案，該筆以 `FILE_UPLOAD_INCOMPLETE` 失敗，請使用者重傳。
  分頁當掉留下的暫存在下次啟動時清除（超過 24 小時）。
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
| 兩個人同時改名 | 送出畫面上看到的 `version`；後到者收到 `FILE_VERSION_CONFLICT`，對話框保留輸入，詳情重抓後可以再送 |
| 正在預覽的檔案被刪除 | 詳情 404 → LightBox 顯示「已刪除」並隱藏操作；自己刪除時關掉 LightBox |
| 同一個檔案在批次刪除時已被刪除 | 單筆 API 回 `FILE_NOT_FOUND`，佇列記為失敗並一併移出選取（`isGoneError`） |
| 上傳完成與取消同時發生 | 後端以 `WHERE status='pending'` 決勝（[backend 09 §5.3](../backend/09-file.md)），不會刪掉已完成的檔案 |
| 多個分頁改了偏好 | dictStorage 經頻道同步，其他分頁的畫面立即跟上 |

---

## 11. 測試

| 檔案 | 內容 |
| --- | --- |
| `features/file/pages/FileManager/__tests__/layout.test.ts` | RWD 欄數、框選命中（含畫面外、間距）、方向鍵 |
| `…/__tests__/useFileSelection.test.ts` | 點擊、⌘ / Shift、框選取代與疊加、資料更新後自動修剪 |
| `…/__tests__/FileBrowser.test.tsx` | 點擊與勾選框、雙擊（檔案／資料夾）、鍵盤、拖放上傳（含放在資料夾卡片上、無權限）、拖曳移動（整批、只拖一個、放進自己被擋、無權限不可拖）、列表表頭排序、空狀態 |
| `…/__tests__/FileMoveDialog.test.tsx` | 樹狀下拉選單選目的地（自己與子孫停用、目前位置不能送出）、資料夾樹預設收合且與選單連動 |
| `…/__tests__/folderTree.test.ts` | 自然排序、孤兒不掛到根目錄、路徑、`isWithin`、移動的合法性（含目的地的 canCreate） |
| `…/components/__tests__/FileAccessRequestDialog.test.tsx` | 送出等級與理由、已送出的狀態 |
| `features/file/upload/__tests__/collectEntries.test.ts` | `webkitRelativePath` 還原結構、略過系統檔、拖放的遞迴展開（含空資料夾、分批的 `readEntries`） |
| `…/__tests__/FileLightbox.test.tsx` | 依註冊表選解析器、無解析器、超過大小上限、解析器壞掉、上一個／下一個、已刪除、權限 |
| `…/__tests__/adapter.test.ts` | 縮圖／原檔／圖示的選擇、全螢幕預覽、多頁去重、網址效期 |
| `features/file/preview/__tests__/ImagePreview.test.tsx` | 預設顯示全螢幕預覽、原始大小才載入原圖、沒有預覽時用原圖 |
| `features/file/hooks/__tests__/useFilePermission.test.tsx` | 目前位置的能力（根目錄、資料夾）、選取項目的能力取交集、未水合 |
| `…/components/__tests__/FileShareDialog.test.tsx` | 列出直接與繼承的授權、新增／變更等級／移除、中斷繼承、反提權錯誤、無權限 |
| `features/file/__tests__/batch.test.ts` | 送進佇列的形狀、上傳到資料夾（目的地編進 id）、上傳操作（進度、失效、清暫存、拿不到檔案）、刪除檔案與資料夾 |
| `features/file/upload/__tests__/validators.test.ts`、`__tests__/preference.test.ts` | 內建驗證器、偏好的逐欄驗證 |
| `core/file/__tests__/*` | 類型判斷、三個註冊表 |
| `core/batch/__tests__/BatchQueue.test.ts` | 工作內並行、進度回報與廣播、取消時中止處理中的項目、依份量計算進度 |
| `shared/storage/__tests__/blobStore.test.ts` | 沒有 IndexedDB 時退回記憶體、`prune` |

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
| 放在哪 | 標了 `data-drop-folder` 的元素：主區塊的資料夾卡片／列、樹的節點（也可以把節點拖到別的節點上）、麵包屑的每一層（往上層移）。容器上掛一組 handler，以事件委派找出目標 |
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
| 新增資料夾（在目前的資料夾裡） | 工具列「新增資料夾」→ `FileFolderDialog` | 目前位置的 `canCreate` |
| 改名 | 只選一個資料夾時，選取列的「重新命名」 | 該資料夾的 `canUpdate` |
| 刪除（遞迴） | 選取後 Delete 鍵或選取列的「刪除」 | 選取的每一項都 `canDelete` |
| 共用（管理授權） | 只選一個資料夾時選取列的「共用」；工具列的「共用此資料夾」 → `FileShareDialog` | 該資料夾的 `canShare` |
| 進入 | 雙擊、Enter、觸控點一下、樹的節點、麵包屑 | 看得到就能進（清單只含看得到的） |

---

## 13. 權限與共用（資料夾層級授權）

規格：[`../../rbac/07-resource-grants.md`](../../rbac/07-resource-grants.md)。前端 **不重算** 繼承與擁有者規則，只讀後端的旗標。

| 資料 | 來源 | 用在 |
| --- | --- | --- |
| 能不能進檔案管理器 | 頁面權限 `FILE`：`file:access` 或 `file:read`（SOME） | 路由 guard、選單 |
| 目前位置能不能上傳、建資料夾、共用 | 目前資料夾的 `capabilities`；根目錄是 `FileFolderList.rootCapabilities` | 工具列、拖放上傳、空狀態 |
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
  新增對象（`GET /file-folders/:id/grant-subjects` 搜尋角色／使用者，或選「所有人」）、選等級、選過期時間；變更等級、移除；
  「不繼承上層的授權」開關（開啟時提示會複製目前繼承到的授權）；「存取申請」區塊列出待審的申請，可核准或駁回。等級選單只列出操作者授予得起的（反提權，後端仍會再擋）。
- 授權變更之後後端推 `fileFolder update`：資料夾清單與檔案清單重抓，旗標自然更新；被移除授權的人正在看的資料夾
  從清單消失時，走既有的「網址上的資料夾不存在 → 回到根目錄」（`onMissingFolder`）。

