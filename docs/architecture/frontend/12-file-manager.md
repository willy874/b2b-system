# 前端 12 — 檔案管理器

> 狀態：**已實作**（`features/file`，路由 `/file`）。後端的檔案模組、上傳流程、API 見
> [`../backend/09-file.md`](../backend/09-file.md)；上傳進入全域佇列的決策見 [ADR-0013](../../adr/0013-file-manager-upload.md)。

## 1. 功能

| 需求 | 做法 | 章節 |
| --- | --- | --- |
| 列表、圖示卡片兩種排版 | 同一套固定尺寸的版面計算，依容器寬度決定欄數 | §3 |
| 分頁、無限捲動兩種閱覽模式 | 分頁用 offset；無限捲動用 keyset 游標（捲動中有人新增或刪除也不重複、不漏） | §5 |
| 拖曳到主區塊上傳 | `useFileDrop`：只對帶檔案的拖曳反應，資料夾略過並提示 | §7 |
| 框選多個檔案做批次處理 | `useMarqueeSelection`：以版面幾何計算命中，畫面外（虛擬捲動沒渲染）的項目也算得到 | §7 |
| RWD | 欄數、卡片寬度、列表顯示的欄位都由容器寬度決定；工具列在窄螢幕換行 | §3 |
| 常見格式的圖示、圖片的縮圖預覽 | `core/file` 的 `getFileKind()` ＋ 上傳時由瀏覽器產生的縮圖 | §6、§8 |
| 前後端效能 | 虛擬捲動、縮圖、穩定的下載網址（瀏覽器快取命中）、索引與 keyset 分頁 | §9 |
| 變更事件的同步與資源競爭 | 推播失效、選取以 id 記錄並自動修剪、改名樂觀鎖、LightBox 偵測已刪除 | §10 |
| 排序、搜尋、篩選 | 檔名搜尋（去抖動）、分類篩選、三種排序 ＋ 方向 | §4 |
| 上傳與全域批次佇列共用 | 上傳是一種批次操作（`file.upload`），進度、取消、結果彈窗、跨分頁接手都沿用佇列 | §8 |
| 大檔分塊上傳 | 後端決定切法，前端邊要網址邊並行上傳各塊、各塊重試 | §8 |
| LightBox 預覽 | 詳情對話框；內容由預覽解析器顯示，內建圖片與純文字 | §6 |
| 插件能力 | `core/file` 的三個註冊表：預覽解析器、檔案驗證器、縮圖產生器 | §6 |
| 偏好記憶 | 排列方式、閱覽模式、排序、每頁筆數存在 localStorage，跨分頁同步 | §4 |

---

## 2. 分層

```
features/file/                       業務：頁面、上傳入口、內建的解析器與驗證器
├── plugin.ts                        同步階段：頁面權限、批次操作、內建擴充；onInit：語系、清理暫存
├── batch.ts                         批次操作 file.upload / file.delete、enqueueFileUploads()
├── preference.ts                    排列方式、閱覽模式、排序、每頁筆數（dictStorage ＋ 跨分頁頻道）
├── upload/                          uploadSources（IndexedDB 暫存）、內建驗證器
├── preview/                         內建解析器：ImagePreview、TextPreview
├── hooks/                           useFilePermission、useFileUpload、useFileRenameMutation / useFileDeleteMutation
└── pages/FileManager/               page.tsx ＋ 版面計算、資料、選取、框選、拖放的 hooks ＋ 元件

core/file/                           機制：檔案類型、三個擴充點的註冊表、圖片縮圖產生器（不認識任何 feature）
core/batch/                          全域批次佇列（上傳與其他批次工作共用）
apis/file/                           uploadFile()（單次／分塊／縮圖）、列表（分頁／無限）、詳情、內容（文字預覽）、上傳政策
shared/storage/blobStore.ts          Blob 的鍵值儲存（記憶體 ＋ IndexedDB）
```

- 擴充點放在 `core/file` 而不是 feature 裡：其他 feature（例如之後的關卡編輯器要預覽自訂格式）只能經由 `core/` 互動
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
- 主區塊有自己的捲動範圍（高度 `max(24rem, 100dvh − 17rem)`），工具列與選取列不跟著捲走。

---

## 4. 狀態放哪裡

| 狀態 | 位置 | 理由 |
| --- | --- | --- |
| 搜尋關鍵字、分類、第幾頁（`offset`）、LightBox 開著的檔案（`preview`） | 網址（`FileSearchQuerySchema`） | 分享連結時對方看到同一個結果；上一頁可還原 |
| 排列方式、閱覽模式、排序、每頁筆數 | `preference.ts`：`dictStorage('file-view')` ＋ 頻道 `store:file-view:storage` | 個人偏好，下次打開沿用；改了其他分頁立即跟上；不進網址（對方有自己的偏好） |
| 選取 | `useFileSelection`（頁面狀態） | 換條件、換頁、換閱覽模式時清空 |

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
- 上一個／下一個：按鈕與 ← / →，在目前載入的項目之間切換（`replace`，返回鍵直接關掉 LightBox）；先把相鄰的圖片抓進快取。
  方向鍵在 **capture** 階段監聽：Base UI Dialog 的焦點管理會在事件冒泡到 window 之前停止傳遞。
- 詳情另外查 `GET /files/:id`：拿到最新的名稱、版本與網址；別人刪除了（404）顯示「檔案已被刪除」並隱藏操作。
- 純文字預覽只讀前 256 KB（`Range`），JSON 自動排版；內容以 id 為 key、不可變，不重抓。

---

## 7. 選取與互動

| 操作 | 結果 |
| --- | --- |
| 點擊 | 只選這一個 |
| ⌘ / Ctrl 點擊、點勾選框 | 切換這一個 |
| Shift 點擊 | 從錨點選到這一個 |
| 在空白處按下滑鼠拖曳 | 框選（按著 Shift / ⌘ / Ctrl 開始時疊加）；拖到上下邊緣自動捲動；空白處單純點一下清空選取 |
| 方向鍵 / Home / End | 移動焦點並選取（Shift 延伸選取）；卡片模式上下移一整列 |
| 空白鍵 / Enter | 切換焦點項目 / 打開 LightBox |
| ⌘ / Ctrl ＋ A、Esc、Delete | 全選、清除、刪除選取（有刪除權限時） |
| 觸控 | 拖曳是捲動（不框選）；沒有選取時點一下打開，有選取後點一下切換 |
| 把檔案拖進主區塊 | 出現遮罩；放開後驗證並送進上傳佇列；資料夾略過並提示 |

- 主區塊是 WAI-ARIA listbox（`aria-multiselectable`、`aria-activedescendant`），項目是 `role="option"`：
  點擊以事件委派處理，一萬個項目也不必各掛一組 handler。勾選框由自己的 `onCheckedChange` 切換
  （Base UI 會把 click 轉發給隱藏的 input，委派處理會看到兩次）。
- 選取列常駐（沒有選取時顯示操作提示）：框選途中它若突然出現，主區塊會被往下推、框跟著跳動。
- 多選的刪除送進全域佇列逐筆處理；單一檔案直接呼叫單筆 API。多選下載以 250 ms 間隔依序觸發（同一瞬間觸發多個，瀏覽器只處理第一個）。

---

## 8. 上傳

```
選檔 / 拖放
  → useFileUpload：validateFile()（core/file 的驗證器）→ 被擋下的以 toast 列出第一個原因
  → enqueueFileUploads()：檔案放進 uploadSources（記憶體 ＋ IndexedDB），佇列項目只帶 { id, label: 檔名, weight: 大小 }
  → 全域批次佇列（concurrency 3）交派給某個分頁
  → file.upload 操作：從 uploadSources 取檔 → createThumbnail() → uploadFile(file, thumbnail, onProgress, signal)
       uploadFile：登記 → 單次 PUT 或分塊（4 塊並行、各塊重試）→ complete；失敗或中止時放棄上傳
  → 成功：invalidateResources(file create)；不論成敗都清掉暫存的檔案
```

- **與其他批次工作共用佇列**：進度（依位元組加權）、取消（中止進行中的請求並放棄上傳）、AppHeader 的佇列面板、
  結束時的結果彈窗都沿用 `core/batch`；主區塊上方顯示本頁送出的工作進度。
- **跨分頁接手**：發起的分頁關掉時，佇列把剩下的項目交給其他分頁；它們從 IndexedDB 讀到同一個檔案繼續上傳。
  IndexedDB 不可用（隱私模式）時接手的分頁拿不到檔案，該筆以 `FILE_UPLOAD_INCOMPLETE` 失敗，請使用者重傳。
  分頁當掉留下的暫存在下次啟動時清除（超過 24 小時）。
- 大檔切塊與網址續期見 [backend 09 §5.2](../backend/09-file.md)。

---

## 9. 效能

| 位置 | 做法 |
| --- | --- |
| 渲染 | 虛擬捲動（只渲染看得到的列）；項目元件 `memo`，回呼以 ref 保持穩定，選取改變時不重新渲染所有項目；點擊事件委派 |
| 圖片 | 上傳時產生的縮圖（數十 KB）而不是原圖；`loading="lazy"`、`decoding="async"`；沒有縮圖的圖片只有 ≤ 2 MiB 才直接用原檔 |
| 網路 | 下載網址在時間窗內不變 ＋ `Cache-Control: immutable`：重抓列表不會重新下載縮圖；搜尋去抖動；換頁 `keepPreviousData` |
| 推播 | 失效經依賴圖，背景分頁只標 stale、可見分頁合併後隨機延遲重抓（[11 §4](./11-realtime.md)） |
| 後端 | (排序欄位, id) 索引 ＋ keyset 分頁：每一頁都是索引範圍掃描；檔名部分比對用 `pg_trgm` 的 GIN 索引；網址在 api 本地簽章，不打儲存服務 |
| 上傳 | 內容不經過 api；3 個檔案並行、大檔 4 塊並行；進度回報節流 200 ms 再經頻道廣播 |

---

## 10. 同步與資源競爭

| 情境 | 處理 |
| --- | --- |
| 別人上傳、改名、刪除 | 推播 `file` 變更 → 依賴圖失效列表與詳情（`Resource.FILE`）；沒有推播時靠自己的寫入失效與 window focus |
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
| `…/__tests__/FileBrowser.test.tsx` | 點擊與勾選框、雙擊、鍵盤、拖放（含資料夾、無權限）、列表表頭排序、空狀態 |
| `…/__tests__/FileLightbox.test.tsx` | 依註冊表選解析器、無解析器、超過大小上限、解析器壞掉、上一個／下一個、已刪除、權限 |
| `…/__tests__/adapter.test.ts` | 縮圖／原檔／圖示的選擇、多頁去重、網址效期 |
| `features/file/hooks/__tests__/useFilePermission.test.tsx` | 有權限／只有 `file:read`／未水合 三案例 |
| `features/file/__tests__/batch.test.ts` | 送進佇列的形狀、上傳操作（進度、失效、清暫存、拿不到檔案）、刪除操作 |
| `features/file/upload/__tests__/validators.test.ts`、`__tests__/preference.test.ts` | 內建驗證器、偏好的逐欄驗證 |
| `core/file/__tests__/*` | 類型判斷、三個註冊表 |
| `core/batch/__tests__/BatchQueue.test.ts` | 工作內並行、進度回報與廣播、取消時中止處理中的項目、依份量計算進度 |
| `shared/storage/__tests__/blobStore.test.ts` | 沒有 IndexedDB 時退回記憶體、`prune` |
