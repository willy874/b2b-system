# 圖片選取與上傳來源

- 優先度：P2
- 狀態：規劃中
- 依賴：檔案（[`backend/09-file.md`](../architecture/backend/09-file.md)、[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md)）、
  可關閉的 feature（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §7、§9）、
  [`backend/25-image.md`](../architecture/backend/25-image.md)（網址的產生、效期、具名尺寸、存參照不存網址）
- 相關：[`image-gallery.md`](./image-gallery.md)（圖片庫：在這裡登記成來源，也使用這裡的「來源」介面從檔案管理加入圖片）；
  之後要放圖片的功能——使用者頭像、租戶 Logo、富文本的內嵌圖片、留言與審批的附件；
  [`image-cdn.md`](./image-cdn.md)（以「物件只寫一次」為前提，讓圖片由邊緣快取送出；刪除後清理快取）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

系統裡能上傳圖片的地方只有檔案管理器。下面這些地方看起來都需要圖片，但現在都還沒有：

| 位置 | 現況 |
| --- | --- |
| 使用者頭像 | `Avatar` 只顯示名字縮寫（[`DashboardShell.tsx`](../../packages/web-core/src/layout/DashboardShell.tsx)、[`CommentItem.tsx`](../../apps/backstage/src/features/comment/components/CommentItem.tsx)） |
| 租戶 Logo | 側欄品牌那一行與 `AuthShell` 只有文字 |
| 富文本 | `packages/rich-text` 沒有圖片節點，公告內文不能放圖 |
| 留言、審批 | 不能附圖片 |

每個功能都自己做上傳會遇到同樣的問題：

1. **檔案管理器的上傳綁在 `file` feature 上**：`/files` 整個 controller 標了 `@RequireFeature('file')`，而且要 `file:create`。
   租戶關掉檔案管理器之後，頭像也跟著不能上傳；使用者只為了換頭像，也不該需要「上傳檔案」的權限。
2. **檔案管理器裡的檔案是別人的**：直接引用 `files.id`（[`09-file.md`](../architecture/backend/09-file.md) §4.1 的建議）的話，
   檔案被改名、移動、刪除、或資料夾的授權改變，引用它的頭像就跟著壞掉或外洩。
3. **選圖的介面每處都得做一次**：上傳、從檔案管理挑、從圖片庫挑，再加上裁切、大小與型別的限制。

使用者希望：選圖時能挑不同的來源；**某個來源的條件不滿足**（依賴的 feature 沒開、沒有權限、沒有內容）**就不列出它**；
只剩「一般上傳」時，不顯示來源選擇，直接進入上傳。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 後端的「圖片資產」：與檔案管理器無關的儲存、變體與生命週期；不依賴 `file` feature | 從網址匯入（見「其他來源的評估」） |
| 來源 1：一般上傳，含 **拖曳** 與 **貼上剪貼簿**（§7） | 外部雲端硬碟（Google Drive、Dropbox） |
| 來源 2：**最近用過的圖片**——自己最近上傳或選過的圖片（§8） | apps/platform（平台 DB 沒有 bucket；之後有平台的圖片需求再評估） |
| 來源 3：從檔案管理器挑選，伺服器端複製成圖片資產；列表先過濾掉不能用的圖（§9） | 富文本的內嵌圖片（一份內容多張圖，生命週期另外設計；第二批） |
| 來源 4：從圖片庫挑選並複製（圖片庫登記這個來源，[`image-gallery.md`](./image-gallery.md) §10、D1） | 濾鏡、旋轉以外的編輯 |
| 後端的來源介面（`ImageSourceRegistry`）：任何模組都能登記「我能提供圖片」，圖片庫也拿它從檔案管理加入圖片 | 租戶 Logo（第二批；登入前就要顯示，網址的授權不同，D6） |
| 前端的來源註冊表：可用的來源依 feature、權限、用途與「有沒有內容」決定；只剩上傳時不顯示來源選擇 | |
| 用途（usage）：每個使用圖片的地方宣告大小、型別、最小尺寸、比例 | |
| 選完之後的裁切（固定比例的用途必須裁切），由伺服器套用；之後可以重新裁切，不必重傳 | |
| 第一個使用的地方：使用者頭像 | |

## 使用者故事

**作為一般使用者，我希望換頭像時可以直接上傳，也可以挑檔案管理器或圖片庫裡已經有的照片，以便不必先下載再上傳。**

- **Given** 租戶啟用了 `file` 與 `gallery`，我有 `file:access` 與 `gallery:read`
- **When** 我在個人資料按「更換頭像」
- **Then** 出現「上傳」「最近使用」「檔案管理」「圖片庫」分頁；後兩個只列出能當頭像的圖片

**作為沒有檔案管理器的租戶的使用者，我希望換頭像時不必多經過一個只有一個選項的畫面。**

- **Given** 租戶關掉了 `file` 與 `gallery`（或我沒有權限），而且我從沒上傳過圖片
- **When** 我按「更換頭像」
- **Then** 直接打開作業系統的選檔視窗；選好之後進入裁切，**不** 出現來源選擇

**作為常寫公告的人，我希望截圖之後直接貼上，以便不必先存檔再選檔。**

- **Given** 我用系統的截圖工具把畫面複製到剪貼簿
- **When** 焦點在圖片欄位上（或來源對話框開著）時按 ⌘V／Ctrl+V
- **Then** 圖片直接進入上傳（需要裁切的用途先進入裁切）

**作為管理多個帳號的管理者，我希望剛才幫 A 設的團隊照，換到 B 時可以直接再選一次。**

- **Given** 我五分鐘前上傳過一張照片給使用者 A 當頭像
- **When** 我幫使用者 B 換頭像，打開「最近使用」
- **Then** 那張照片排在第一個；選了之後可以重新裁切，A 的頭像不受影響

**作為租戶管理者，我希望使用者挑了檔案管理器裡的圖片之後，原檔被刪除或搬到私人資料夾，頭像也不受影響。**

- **Given** 使用者從檔案管理器選了 `/行銷/團隊照.jpg` 當頭像
- **When** 檔案被刪除、移動，或資料夾中斷繼承
- **Then** 頭像照常顯示；看頭像的人也看不到原檔所在的資料夾

## 初步構想

### 1. 整體結構

```
consumer（例：使用者頭像）
  │  存 image_asset_id；儲存時認領「這個資產是我建立的、還沒被別處使用」
  ▼
modules/image（新，通用模組）
  ├─ 圖片資產：登記、直傳、確認、正規化、裁切、變體、清理
  └─ ImageSourceRegistry：「我能提供一張圖片」的來源
        ▲ 登記（onModuleInit）          ▲ 登記                  ▲ 內建
   modules/file「檔案」          modules/gallery「圖片庫」   modules/image「最近使用」
                                       │
                                       └─ 也是來源的使用者：從檔案管理加入圖片庫（image-gallery.md §9）
```

- **所有來源的結果都是一筆新的圖片資產**，consumer 只認識 `image_asset_id`，不知道圖片從哪裡來。
- `modules/image` 是通用模組（與 `modules/tag`、`modules/comment` 相同），不 import 任何業務模組。
  檔案與圖片庫在 `onModuleInit` 把來源登記進去（[`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §3.2）；
  檔案與圖片庫 **彼此不認識**，只認識 `modules/image` 的介面。
- 關掉 `file` 時，「檔案」來源回 `404 FEATURE_DISABLED`，其他來源照常可用。

### 2. 後端的來源介面：`ImageSourceRegistry`

```ts
// modules/image/image-source.registry.ts（示意）
interface ImageSource {
  id: string;                  // 'file'、'gallery'、'recent'；之後新增的來源用自己的 id
  feature?: TenantFeature;     // 所屬的可關閉 feature；沒啟用時 resolve 一律 404 FEATURE_DISABLED
  /**
   * 以呼叫者的身分讀取：看不到或不存在就拋擁有者自己的 404，拒絕要寫 authz.denied。
   * `purpose` 是呼叫端的用途字串（例：`imageAsset:user.avatar`、`gallery`），來源寫進自己的稽核 `<resource>.copy`（D5）；
   * 來源不解讀它，所以仍然不認識呼叫端。
   */
  resolve(refId: string, actor: Actor, purpose: string): Promise<ResolvedImage>;
}

interface ResolvedImage {
  storageKey: string;          // 同一個租戶 bucket 內的物件，呼叫端以 CopyObject 複製，不經過 api 的記憶體
  contentType: string;
  size: number;
  name: string;                // 原本的名稱（例：檔名），給稽核與「最近使用」顯示
  width?: number;              // 已知時帶上，讓呼叫端先擋掉太小的圖
  height?: number;
}
```

- **呼叫端一律複製**：解析出的物件只在複製的當下被讀一次，之後原物件的命運與呼叫端無關。
- 使用的有兩處：圖片資產（`POST /images/from-source`，§5）與圖片庫（從其他來源加入，[`image-gallery.md`](./image-gallery.md) §9）。
- 來源的 id 是字串契約，不是 import：圖片庫拿到的是前端送來的 `{ source, refId }`，它不知道 `'file'` 代表什麼。

### 3. 資料模型（租戶 DB）

新表 `image_assets`。不放進 `files`：`files.folder_id = null` 已經代表「根目錄」，
混進去之後檔案管理器的每一個查詢、容量、維護排程、推播都要再加一個條件來排除它（D1）。

| 欄位 | 說明 |
| --- | --- |
| `id` | uuid |
| `usage` | 用途 id（例：`user.avatar`），決定限制、要產生哪些 preset 與網址的效期 |
| `status` | `pending` / `ready` / `failed`（解碼失敗、不是圖片、不符合用途的限制） |
| `content_type`、`size` | 正規化之後的主檔（§5） |
| `width`、`height`、`has_alpha` | 主檔的尺寸（**未裁切**） |
| `crop` | jsonb `{ x, y, width, height }`，以主檔的像素為單位；null 是不裁切 |
| `variant_rev` | 變體的版本，每次重新裁切遞增；物件 key 帶著它，所以舊的變體不會被覆寫（D12） |
| `content_hash` | 主檔的 SHA-256：「最近使用」以它去除重複（§8） |
| `source` | `upload` / `file` / `gallery` / `recent`：稽核與排查用 |
| `source_ref_id`、`source_name` | 來源那一筆的 id 與名稱（**不是外鍵**：原本那筆刪除不影響資產） |
| `owner_type`、`owner_id` | 使用它的資源（`user` ＋ 使用者 id）；還沒被儲存時是 null |
| `detached_at` | 被換掉或資源被永久刪除的時間；清理排程依它判斷（§6） |
| `hidden_from_recent_at` | 使用者把它從「最近使用」移除的時間（§8） |
| `created_*` / `updated_*` | 慣例欄位；沒有 `version`：資產建立之後只有 `crop` 會變，而且只由擁有者資源的寫入改（§5） |

- 物件 key：`images/<id>/master.<格式>`、`images/<id>/r<variant_rev>/<變體>.<格式>`；**每個物件只寫一次**（D12），可以放心給瀏覽器與 CDN 長期快取（[`image-cdn.md`](./image-cdn.md)）。`file.maintenance` 只管 `files/`、`thumbnails/`、`variants/`，
  圖片資產的對帳由 `modules/image` 自己的維護排程負責。
- 一個資產只屬於一個資源：consumer 儲存時以條件式 UPDATE 認領（`WHERE owner_id IS NULL AND created_by = 目前的人`），
  拿別人的資產或已經被使用的資產 id 來存就失敗。不必為「誰能看到這張圖」另外設計授權：資產跟著 consumer 的可見性走。

### 4. 用途（usage）

使用圖片的模組在 `onModuleInit` 登記用途，後端是唯一的事實來源；前端由 `GET /images/usages` 取得同一份限制，用來先擋、顯示提示（D8）。

| 屬性 | 例：`user.avatar` |
| --- | --- |
| `maxSize` | 10 MiB（來源的原檔） |
| `contentTypes` | JPEG、PNG、WebP、AVIF、GIF（第一格）；**不收 SVG**（[`09-file.md`](../architecture/backend/09-file.md) §5.4 同理：不讓 api 解析使用者給的 XML，也不必處理 SVG 內的腳本） |
| `minWidth` / `minHeight` | 128 × 128（裁切之後） |
| `aspectRatio` | `1`：必須裁切成正方形；省略時不限比例、不強制裁切 |
| `presets` | `{ sm: 32, md: 96, lg: 256 }`：長邊 px，套用裁切之後再縮；每個 preset 另產生 2x（[`backend/25-image.md`](../architecture/backend/25-image.md) §6） |
| `urlTtl` | 12 小時：網址的效期（[`backend/25-image.md`](../architecture/backend/25-image.md) §4） |
| `visibility` | `signed`（預設，簽章網址）；`public` 保留給第二批的租戶 Logo，這一版不實作（D6、[`backend/25-image.md`](../architecture/backend/25-image.md) §8） |
| `sources` | 省略時是全部；某個用途想限制來源時才列（例：只允許上傳） |

### 5. 建立資產：所有來源走同一條後段

```
上傳：      POST /images { usage, contentType, size } → 直傳網址 → PUT → POST /images/:id/complete { crop? }
其他來源：  POST /images/from-source { usage, source, refId, crop? }
              └ ImageSourceRegistry.get(source).resolve(refId, actor, 'imageAsset:<usage>') → CopyObject 到 images/<id>/upload
                            │
                            ▼  同一條後段（worker 的背景工作 image.process）
        解碼（ImageProcessor）→ 檢查用途的限制 → 依 EXIF 轉正 → 長邊縮到 4096 → 移除中繼資料
        → 寫主檔（master）→ 套用裁切 → 寫變體（每個 preset 的 1x 與 2x，主格式與 WebP 各一份）→ 刪除 upload → status = ready（推播給建立者本人）
重新裁切：  PATCH 擁有者資源（例：PATCH /users/:id { avatarCrop }）→ 擁有者模組呼叫 ImageAssetService.recrop()
            → variant_rev + 1，寫到新的 r<rev>/ 底下；舊版本的變體由 image.maintenance 在網址效期過後刪除
```

- **一般上傳**：沿用檔案的直傳模型（大小與「只能寫一次」簽進網址，[`09-file.md`](../architecture/backend/09-file.md) §5），
  先寫到 `images/<id>/upload`，處理完就刪掉。路由 `@Authenticated()`：上傳本身不需要權限，能不能「用」由 consumer 儲存時的權限決定。
  濫用的控制靠速率限制、每人 `pending` 上限、租戶容量，以及沒被認領的資產 24 小時後清除（§6）。
- **其他來源**：`from-source` 只宣告 `@Authenticated()`，來源的 `resolve` 是唯一的讀取權限檢查（與標籤、留言的擁有者判斷相同，拒絕寫 `authz.denied`）。
  來源有 `feature` 時，service 先檢查租戶是否啟用，沒有就 `404 FEATURE_DISABLED`。
- **主檔是正規化過的，但不裁切**：不保留使用者的原檔（手機照片的 GPS 等中繼資料不會跟著頭像被所有人下載），
  但保留完整的畫面，所以 **之後可以重新裁切**、「最近使用」換一個比例也能用同一張圖。
- **裁切由伺服器套用**：前端只送 `crop`（以轉正後的原圖像素為單位）。不必在瀏覽器以 canvas 重新編碼（品質變差、大圖吃記憶體），
  從檔案管理或圖片庫挑的圖也不必先下載再上傳。`ImageProcessor` 目前只有 `decode → render`，要加上 `extract`（裁切）。
- 變體的產生沿用 `core/image` 的 `ImageProcessor`；`FileImageService` 裡「哪些格式、主格式怎麼選」的政策抽到 `core/image`，檔案、圖片資產、圖片庫共用（D2）。

### 6. 生命週期與清理

| 狀況 | 做法 |
| --- | --- |
| 上傳了但沒按儲存 | `owner_id` 一直是 null；`image.maintenance` 刪除建立超過 24 小時、沒被認領的資產 |
| 換了一張新圖 | 舊資產設 `detached_at`，**保留**到回收桶的保留期限：版本歷史還原到舊的頭像時，舊資產還在就重新認領；期間也出現在「最近使用」 |
| 資源被軟刪除 | 不動資產（還原時圖片要還在） |
| 資源被永久刪除 | consumer 的 `TrashHandler.purge` 把它的資產設 `detached_at`，交給清理排程 |
| `detached_at` 超過保留期限 | `image.maintenance` 刪除紀錄與物件；物件刪除後呼叫 `CdnPurger.schedule(paths)` 清理邊緣快取（[`image-cdn.md`](./image-cdn.md) §7，沒有啟用 CDN 時是 no-op） |
| 版本歷史還原到一張已經清掉的圖 | 圖片欄位變成 null；還原照常成功，回應帶警告 |

容量：主檔 **計入** 租戶的儲存容量（使用者上傳的內容；與 `transfers/` 那種系統產物不同），變體不計（與檔案相同）。
每個租戶一個上限，檔案、圖片資產、圖片庫共用：沿用參數 `file.storageQuotaMb`、計數 `file_storage_usage`、錯誤碼 `FILE_STORAGE_QUOTA_EXCEEDED`，語意改成「租戶的儲存容量」；`file` 關掉時照樣計算（D3）。
所有租戶的合計另由平台計算，作為系統的止水線（[`backend/25-image.md`](../architecture/backend/25-image.md) §12）。

### 7. 來源 1：一般上傳（選檔、拖曳、貼上）

三種入口，進入同一條「驗證 → （裁切）→ 上傳」：

| 入口 | 在哪裡有效 | 細節 |
| --- | --- | --- |
| 選檔 | 「更換」按鈕、對話框的「上傳」分頁 | `<input type="file" accept>`，`accept` 由用途的 `contentTypes` 產生；手機上的選檔視窗本來就有「拍照」 |
| 拖曳 | `ImageField` 本身、對話框的任何一個分頁 | 拖進對話框時自動切到「上傳」分頁；拖曳進入時整個區域顯示放置提示（沿用 `FileUpload` 的樣式） |
| 貼上 | 焦點在 `ImageField` 上、或來源對話框開著 | 監聽 `paste`，從 `clipboardData.items` 取第一個 `kind === 'file'` 且是圖片的項目 |

- **只取一張**：拖進或貼上多個檔案時取第一張圖片，toast 說明「一次只能選一張圖片，已使用第一張」。
- **不是圖片就略過**：貼上的是文字（例：複製了一段網址）時不攔截，讓瀏覽器照常處理（欄位不是輸入框，所以通常什麼都不會發生）；
  拖進來的是網頁上的圖片（只有 `text/uri-list`、沒有檔案）時，顯示「請先把圖片存到電腦再拖曳進來」——那其實是「從網址匯入」，這一版不做。
- **貼上的圖片沒有檔名**（瀏覽器給 `image.png`）：以「貼上的圖片 2026-10-09 14:32.png」當名稱，「最近使用」才分得出來。
- **不做全頁攔截**：只在焦點落在欄位上、或對話框開著時才處理 `paste`，避免在頁面上別處貼上時意外換掉圖片。
  欄位可以取得焦點（`tabIndex=0`），聚焦時提示「可直接貼上圖片」。
- **驗證**：沿用 `core/file` 的驗證器（大小、檔頭簽章），再加上用途的型別與大小；貼上與拖曳的檔案一樣要經過，不信任 `File.type`。
  最小尺寸要解碼才知道：以 `createImageBitmap` 讀尺寸，太小就不進入上傳（後端仍會再擋）。
- **裁切**：用途有 `aspectRatio` 時，選好（或貼上、拖進）之後一律先進入 `ImageCropper`；沒有時直接上傳，之後仍可按「裁切」。
- **上傳不經過全域批次佇列**：只有一張、要立刻看到結果，直接在對話框裡顯示進度；關掉對話框就放棄上傳
  （檔案管理器要跨分頁接手的大量上傳才需要佇列）。

### 8. 來源 2：最近用過的圖片

列出 **我自己** 建立過、還沒被清除的圖片資產（不分是上傳、從檔案管理或圖片庫選來的），讓同一張圖不必再找一次。

| 項目 | 做法 |
| --- | --- |
| 範圍 | `created_by = 我`、`status = ready`、`hidden_from_recent_at IS NULL`、還沒被清除；不分用途 |
| 去除重複 | 同一個 `content_hash` 只列最新的一筆：同一張圖選過三次只出現一次 |
| 排序與數量 | 依建立時間新到舊，最多 30 張（`GET /images/recent?usage=<usage>`） |
| 過濾 | 伺服器端以用途過濾型別與大小；尺寸太小（主檔不夠裁出 `minWidth` × `minHeight`）的列出但停用，滑過顯示原因 |
| 選取 | `POST /images/from-source { source: 'recent', refId: <資產 id> }`：**複製** 成一筆新資產（一個資產只屬於一個資源），可以重新裁切 |
| 移除 | 每張的選單有「從最近使用移除」：設 `hidden_from_recent_at`，不影響正在使用它的資源 |
| 保留多久 | 跟著資產本身的清理（§6），不另外延長（D11）：沒被使用的 24 小時後消失；被換掉的保留到回收桶的保留期限；正在使用的一直在 |

- **只有自己的**：不是「租戶裡最近被用過的圖片」——那會讓人看到別人的頭像原圖（未裁切的主檔）。要分享給別人重複使用的圖片放進圖片庫。
- **權限**：`recent` 的 `resolve` 只檢查 `created_by = actor`。從檔案管理複製來的資產，即使之後失去那個資料夾的權限，自己的副本仍可再用（D10）。
- **有沒有內容決定是否列出**：沒有任何最近使用的圖片時不列出這個分頁（§10）。

### 9. 來源 3：從檔案管理挑選，以及過濾

分兩層：

| 層 | 條件 | 不符合時 |
| --- | --- | --- |
| 伺服器端（`GET /files` 加上 `imageUsage=<usage>`） | `status = ready`；`content_type` 在用途的 `contentTypes` 內（排除 SVG）；`size ≤ maxSize`；`variant_status` 不是 `failed` | **不列出** |
| 前端（依 `image_width` / `image_height`） | 不小於 `minWidth` / `minHeight`；變體還沒好（`pending`，沒有尺寸）時先當作可選，交給後端檢查 | **列出但停用**，滑過顯示原因（「圖片太小：至少 128 × 128」） |

- 太小的圖列出來但停用，而不是藏起來：使用者記得檔案管理器裡有那張圖，找不到會以為壞了。
- 畫面沿用檔案管理器的資料夾樹與縮圖格（`useFileListData`），但是唯讀、只能單選；不帶上傳、改名、刪除、拖曳。
  它是 `features/file` 自己的元件，不是另一個 feature 拿去用（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §3.1：feature 之間不共用元件）。
- 看不到任何資料夾（只有 `file:access`、沒有任何資料夾授權）時，分頁照樣出現，顯示空狀態並提示改用上傳。
  前端無法事先便宜地知道有沒有可讀的資料夾（要走過整棵樹的授權），所以這裡不像「最近使用」那樣先查。

### 10. 前端：來源的註冊表與 `ImageField`

機制放在 `@b2b-system/web-core/image-picker`（兩個前端都可能用到；web-core 不呼叫 app 的 API，實際的請求由 app 注入）：

| 部分 | 放在 | 內容 |
| --- | --- | --- |
| `ImageField` | web-core | 以 `SignedImage`（[`backend/25-image.md`](../architecture/backend/25-image.md) §5）顯示目前的圖片；「更換」「裁切」「移除」；接受拖曳與貼上（§7）；`usage` 決定限制與裁切比例 |
| 來源選擇 `ImageSourceDialog` | web-core | 每個可用的來源一個分頁；只有一個來源時不出現 |
| 裁切 `ImageCropper` | `@b2b-system/ui` | 通用元件，不含業務名詞；輸出裁切框 |
| `registerImageSource()` | web-core | 來源的註冊表，在 plugin 的 **同步** 階段註冊 |
| 上傳、最近使用 | backstage `core/image` | 用 `apis/image/*` 實作，app 啟動時註冊；上傳永遠可用，是最後的退路 |
| 檔案管理 | backstage `features/file` | `file` feature 的 plugin 註冊；feature 沒安裝時自然不存在 |
| 圖片庫 | backstage `features/gallery` | `gallery` feature 的 plugin 註冊（[`image-gallery.md`](./image-gallery.md) §10） |

```ts
// features/file/plugin.ts（示意）
registerImageSource({
  id: 'fileManager',
  order: 30,
  isAvailable: ({ can }) => can(FILE_PERMISSION.ACCESS) || can(FILE_PERMISSION.READ),
  labelKey: 'file.imageSource.label',
  component: lazy(() => import('./imageSource/FileImageSource')),
});

// core/image/sources.ts（示意）：有沒有內容要先查
registerImageSource({
  id: 'recent',
  order: 20,
  isAvailable: async ({ usage, queryClient }) =>
    (await queryClient.fetchQuery(recentImagesQuery(usage))).items.length > 0,
  ...
});
```

**判斷哪些來源可用**（每次按「更換」時計算）：

1. 有註冊（feature 已安裝；feature 被平台關掉時 plugin 卸載，來源跟著消失）；
2. `isAvailable(ctx)` 為真：權限（同步），或有沒有內容（非同步，只有「最近使用」）；
3. 用途的 `sources` 允許它。

- 非同步的判斷以 React Query 快取（`staleTime` 1 分鐘），`ImageField` 在滑過或取得焦點時預先抓，按下時通常已經有答案；
  還沒回來時按鈕顯示載入中，最多等 1 秒，逾時或失敗就當作不可用（不讓查詢卡住上傳）。
- 結果只剩「上傳」時：按「更換」直接打開作業系統的選檔視窗，選好之後若用途要求比例就進入裁切，否則直接上傳——**不出現來源選擇**。
  有兩個以上時打開 `ImageSourceDialog`，「上傳」固定是第一個分頁。
- 後端照樣把關（前端的判斷只是體驗）：`from-source` 依來源的 `feature` 回 `FEATURE_DISABLED`，並以呼叫者的身分讀取。

### 11. 權限、稽核與推播

- **不加新的權限鍵**：上傳與「最近使用」是 `@Authenticated()`；從檔案管理、圖片庫複製看各自的讀取權限；
  能不能把圖片存到某個資源看 consumer 原本的權限（換自己的頭像不需要權限、換別人的頭像要 `user:update`）。
- **稽核寫在 consumer**：`user.update` 的 `changes` 記下 `avatarImageId` 的前後值與 `source`、`source_ref_id`。
  建立資產本身不寫稽核（還沒被使用的資產不是業務事件）。從檔案管理或圖片庫複製時，來源模組在 `resolve` 裡另寫一筆 `file.copy`／`galleryItem.copy`
  （`resourceId` 是原本那筆，`changes.after.purpose` 是呼叫端給的用途字串）：管理者看得到「這張圖被誰拿去哪裡用」（D5）。
- **推播**：資產處理完只推給建立者本人（`ChangeSource.IMAGE`，受眾是 `user:<id>`）；consumer 的推播照舊。
- **網址**：依 [`backend/25-image.md`](../architecture/backend/25-image.md)——consumer 只存 `image_asset_id`（R1），組回應時由 `ImageUrlService` 直接簽出 `ImageSources`
  （不經過 api 轉址、不查 DB，R5），前端以 `SignedImage` 顯示，網址過期時自動重抓。**不新增** 圖片資產的影像 API。

## 其他來源的評估

| 來源 | 價值 | 成本與風險 | 建議 |
| --- | --- | --- | --- |
| **貼上剪貼簿**、**拖曳** | 高 | 低 | **這一版做**，歸在上傳來源（§7） |
| **最近用過的圖片** | 中高：同一張圖重複用在多處 | 中：要去除重複、決定保留多久 | **這一版做**（§8） |
| **行動裝置拍照**（`capture`） | 低：後台很少在手機上用 | 極低：手機的選檔視窗本來就有「拍照」 | 不另做；`accept="image/*"` 就夠 |
| **從網址匯入** | 中：貼一個圖片網址就好 | 高：伺服器要代為下載，需要 SSRF 防護（可沿用 [`17-webhook.md`](../architecture/backend/17-webhook.md) §9.2 D15 的 `core/http/outbound.ts`）、大小與逾時上限、重新導向的處理；也容易變成「把伺服器當代理」 | **不做**；有明確需求時再登記一個來源，接口已經容得下 |
| **外部雲端硬碟**（Google Drive、Dropbox、OneDrive） | 依租戶而定 | 高：每家各自的 OAuth 與 picker SDK、租戶層的整合設定，CSP 要放行第三方網域 | **不做**；與「整合（integrations）」一起規劃 |
| **預設圖示或自動產生**（例：頭像用名字縮寫） | 中 | 低 | 不是來源，是「沒有圖片時的顯示」；`Avatar` 已經做到 |
| **AI 生成** | 低 | 高：要接外部模型，內容審核與費用 | 不做 |

## 開放問題

全部已有結論（2026-10-09，照提案的傾向定案）；決定的理由與評估過的方案見下方「設計決策」。

1. **另開 `image_assets` 表，還是擴充 `files`（加 `purpose` 欄）？**
   傾向另開：`files` 的查詢、容量、維護排程、推播、回收桶都假設「每一列都是檔案管理器裡的檔案」；
   另開表的代價是上傳、直傳、變體的程式有一部分要抽成共用（問題 2）。
   - **結論**：另開 `image_assets`（D1）。
2. **變體產生的程式怎麼共用？** `FileImageService` 的格式政策（progressive JPEG／有透明度用 WebP、移除中繼資料）
   抽到 `core/image`，讓檔案、圖片資產、圖片庫三處共用？`core/` 不能 import `modules/`，政策要放在三邊都拿得到的地方。
   - **結論**：抽到 `core/image`；尺寸由各模組決定（D2）。已在階段 1 實作，決策搬到 [`backend/25-image.md`](../architecture/backend/25-image.md) §11 D9。
3. **容量的計數**：`file_storage_usage` 改名成租戶的儲存用量（`storage_usage`）、三者共用一個上限，還是各自計算？
   feature 參數 `file.storageQuotaMb` 在 `file` 被關掉時還算不算數——關掉檔案管理器的租戶，頭像與圖片庫也要受容量限制。
   - **結論**：共用一個上限，`file` 關掉時照樣計算；參數改成全租戶的 `storage.quotaMb`（D3）。
   - **修正（2026-10-09）**：容量仍依租戶，三者共用租戶的上限，但 **不改名**：參數 key、錯誤碼上線後不改名，改表名是破壞性的 migration（要拆兩次部署）；
     `file` 關掉時參數照常生效本來就成立（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3 D5）。所有租戶的合計由平台計算，是系統的止水線（[`backend/25-image.md`](../architecture/backend/25-image.md) D8）。
4. **（移到 [`image-gallery.md`](./image-gallery.md) 開放問題 1）** 從圖片庫選的圖要複製還是引用。
   這份只要求：不論哪一種，consumer 都只存 `image_asset_id`。
   - **結論**：複製（[`image-gallery.md`](./image-gallery.md) D1）。
5. **從檔案管理、圖片庫複製時要不要寫在來源的稽核裡？** 寫的話，管理者能追到「檔案被拿去哪裡用」；
   不寫的話與「讀檔不寫稽核」一致。傾向寫：這是把資料夾內的內容帶到資料夾授權之外的動作。
   - **結論**：寫，動作是 `<resource>.copy`（D5）。
6. **登入前就要顯示的圖片**（租戶 Logo 在登入頁）：簽章網址會過期，登入頁拿不到新的網址。
   是另一種「公開的資產」（不過期、可快取的網址），還是由 `GET /system/settings/public` 每次簽發？第二批做租戶 Logo 時決定，但資料模型這一版就要留下空間。
   - **結論**：第二批決定；這一版在用途上預留 `visibility`，只實作 `signed`（D6）。
7. **第一個使用的地方是不是頭像？** 頭像同時考驗裁切（1:1）、多處顯示（頂列、留言、使用者列表）、版本歷史還原；
   但使用者表要加欄位、`Avatar` 要接網址，牽動的檔案不少。另一個選項是先做沒有版本歷史的租戶 Logo，但它卡在問題 6。
   - **結論**：頭像（D7）。
8. **`GET /images/usages` 要不要做，還是前端的限制寫在 consumer 的 feature 裡？** 前者只有一份事實來源；
   後者少一次請求，但前後端的數字會漂移。也可以由 OpenAPI 帶出常數、經 `api-sdk` 提供給前端。
   - **結論**：做 `GET /images/usages`（D8）。
9. **GIF 動畫**：變體只取第一格。頭像取第一格就好；之後富文本可能想保留動畫，到時候用途加一個 `animated` 屬性？
   - **結論**：是；這一版一律取第一格（D9）。
10. **失去來源的權限之後，「最近使用」裡的副本還能不能再用？** 傾向可以：副本是當時有權限時建立的、只有自己看得到；
    若要更嚴格，`recent` 的 `resolve` 要回頭問原本的來源，等於讓 `modules/image` 依賴來源的存活。
    - **結論**：可以（D10）。
11. **「最近使用」保留多久？** 現在跟著資產的清理：沒被使用的只留 24 小時（上傳了沒按儲存）。
    要不要讓「最近使用」至少留 7 天，代價是容量多算一些、清理排程的條件多一個？
    - **結論**：不延長，跟著資產的清理（D11）。

## 設計決策

背景見「背景」一節。歸檔時整節搬進 `backend/25-image.md` 的最後一章（前端的部分搬進 `frontend/23-image-picker.md`）。

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | **圖片資產另開 `image_assets` 表**（租戶 DB），物件放 `images/<id>/` 前綴；有自己的維護排程 `image.maintenance` | `files` 的列表、容量、維護排程、推播、回收桶都假設每一列是檔案管理器裡的檔案，且 `folder_id = null` 已經代表根目錄；混在一起每個查詢都要排除，漏一個就讓頭像出現在檔案管理器 | `files` 加 `purpose` 欄：少一張表，但改動散在檔案模組各處，而且 `file` 被關掉時要另外放行 |
| D2 | **格式政策抽到 `core/image`**：已實作，見 [`backend/25-image.md`](../architecture/backend/25-image.md) §11 D9 | — | — |
| D3 | **容量依租戶、三者共用一個上限，沿用現有的名稱**：參數 `file.storageQuotaMb`、計數 `file_storage_usage`、錯誤碼 `FILE_STORAGE_QUOTA_EXCEEDED` 不改名，說明與文案改成「租戶的儲存容量」；檔案、圖片資產、圖片庫的寫入點都維護同一個計數。主檔與原檔計入，變體不計。`file` 關掉時照樣計算（參數在 feature 關閉時照常生效，[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3 D5）。所有租戶的合計另由平台計算，是系統的止水線（[`backend/25-image.md`](../architecture/backend/25-image.md) D8） | 容量是租戶「買了多少空間」，與用哪個功能無關；參數 key 與錯誤碼上線後不改名（既有的覆寫、前端與對外 API 的使用者都依賴它們） | 改名成全租戶的 `storage.quotaMb`／`storage_usage`／`STORAGE_QUOTA_EXCEEDED`（原本的決定）：要搬移覆寫值、新舊錯誤碼並存、表改名拆兩次部署，換到的只是名稱；各自一個上限：平台要分別設定三個數字，租戶也看不懂哪個滿了 |
| D4 | **從圖片庫選的圖複製成圖片資產**（[`image-gallery.md`](./image-gallery.md) D1） | 所有來源的生命週期一致 | 見圖片庫 D1 |
| D5 | **複製時來源寫稽核 `<resource>.copy`**（`file.copy`、`galleryItem.copy`）：`resolve(refId, actor, purpose)` 的 `purpose` 是呼叫端給的字串（`imageAsset:<usage>`、`gallery`），寫進 `changes.after.purpose`；來源不解讀它 | 複製是把內容帶到原本授權之外的動作，管理者要追得到；`purpose` 讓來源記下去處，又不必認識呼叫端 | 不寫：與「讀檔不寫稽核」一致，但追不到內容的去向；呼叫端寫：呼叫端要知道來源的 `resourceType`，等於認識來源 |
| D6 | **用途預留 `visibility`**（`signed` ｜ `public`），這一版只實作 `signed`；公開網址的做法在第二批做租戶 Logo 時決定 | 登入頁要的不過期網址牽涉快取、撤銷、獨立網域；現在決定會缺少實際的使用情境。欄位先留，之後不必改資料模型 | 現在就做公開資產：沒有第二個需求驗證設計 |
| D7 | **第一個 consumer 是使用者頭像**：`users.avatar_image_id`、`PATCH /users/:id` 的 `avatarImageId`／`avatarCrop`、`Avatar` 接受圖片網址並保留縮寫當退路 | 同時驗證裁切、多處顯示、版本歷史還原、他人代換（`user:update`） | 租戶 Logo：卡在 D6 的公開網址 |
| D8 | **`GET /images/usages`** 回所有用途的限制，前端以 React Query 快取（`staleTime: Infinity`，部署更新才變） | 後端是唯一的事實來源，前後端的數字不會漂移 | 前端各自寫常數：會漂移；經 OpenAPI 產生常數：要改產生器，收益不大 |
| D9 | **GIF 一律取第一格**；之後需要動畫時，用途加 `animated` 屬性 | 頭像不需要動畫；動畫的變體（逐格縮放）成本高 | — |
| D10 | **「最近使用」的副本在失去來源的權限之後仍可再用**：`recent` 的 `resolve` 只檢查 `created_by = actor` | 副本是有權限時建立、只有自己看得到；回頭問來源會讓 `modules/image` 依賴來源的存活與開關 | 回頭檢查原本的來源 |
| D11 | **「最近使用」不另外延長保留**：跟著資產的清理（沒被使用 24 小時、被換掉的到回收桶的保留期限、正在使用的一直在） | 沒被使用的資產多半是放棄的上傳；真正用過的圖本來就會保留很久。少一個清理條件 | 至少留 7 天：容量多算、清理排程多一個條件 |
| D12 | **所有物件只寫一次**：主檔在處理時寫一次；變體的 key 帶 `variant_rev`（`images/<id>/r<rev>/…`），重新裁切寫到新的版本、回應帶新的網址，舊版本在網址效期（用途的 `urlTtl`）過後由 `image.maintenance` 刪除 | 物件以 id 為 key、從不覆寫，是穩定網址與長期快取的前提（[`09-file.md`](../architecture/backend/09-file.md) §7.1、[`image-cdn.md`](./image-cdn.md)）；覆寫同一個 key 會讓瀏覽器與 CDN 繼續顯示裁切前的圖 | 覆寫同一個 key 並在網址加 `?v=`：CDN 的快取 key 若忽略查詢字串就失效，而且物件儲存上的內容與已簽出的網址對不上 |

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/25-image.md`：圖片資產、用途、來源介面、處理流程、生命週期與清理；設計決策在最後一章
- `docs/architecture/frontend/23-image-picker.md`：`ImageField`、來源的註冊表與可用性的判斷、貼上與拖曳、最近使用、檔案管理來源的過濾、裁切
- `docs/architecture/backend/09-file.md`：§4.1「其他模組要引用檔案」改成指向圖片資產；新增「檔案作為圖片來源」一節
- `docs/architecture/frontend/07-ui-system.md`：`ImageCropper`
- 頭像（第一個 consumer）寫進使用者的規格
