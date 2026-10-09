# 23 — 選圖：`ImageField` 與圖片來源

使用圖片的地方（第一個是使用者頭像）放一個 `ImageField`：顯示目前的圖，「更換」「裁切」「移除」；更換時依 feature、權限、用途與「有沒有內容」
決定可以從哪裡挑（上傳、最近使用、圖片庫、檔案管理）；只剩上傳時不顯示來源選擇，直接打開選檔視窗。
後端的圖片資產（上傳、複製、處理、清理）見 [`../backend/25-image.md`](../backend/25-image.md) §15，決定與理由見 §16 與本文 §9。

```
features/account（頭像）、features/user（幫別人換）
  └─ <ImageField usage="user.avatar" value={user.avatar} assetId={user.avatarImageId} onChange onRecrop />   web-core/image-picker
        ├─ useImagePicker：判斷可用的來源 → 選（選檔、拖曳、貼上、來源分頁）→ 檢查 → 裁切 → 上傳或複製 → onChange(assetId)
        ├─ ImageSourceDialog：「上傳」＋ 每個可用的來源一個分頁
        └─ ImageCropDialog：ui 的 ImageCropper ＋ 上傳進度
  圖片來源的註冊表（web-core）  ← app/image-picker 登記「最近使用」與選圖的 api；features/gallery 登記「圖片庫」；features/file 登記「檔案管理」
```

---

## 1. `ImageField`

`@b2b-system/web-core/image-picker`：

| prop | 說明 |
| --- | --- |
| `usage` | 用途 id：決定限制、裁切的比例與可以用的來源（`GET /images/usages`） |
| `value`、`variant` | 目前的圖（`ImageSources`）與要顯示的具名版本（頭像用 `lg`） |
| `assetId` | 目前那張的資產 id；有值時顯示「裁切」「移除」 |
| `onChange({ assetId })` | 換了一張（`null` 是移除）：呼叫端把 id 存到自己的資源 |
| `onRecrop(crop)` | 重新裁切目前那張；沒給時不顯示「裁切」 |
| `fallback`、`shape`、`size` | 沒有圖時的顯示（頭像：名字縮寫的 `Avatar`）、圓形或方形、大小 |
| `pending`、`onExpired` | 呼叫端正在儲存；網址過期時重抓（`SignedImage`） |

- 選好、上傳好之後，在伺服器處理完之前先顯示選的圖（本機的 object URL 或來源的預覽）與「處理中」；呼叫端的資產 id 換成它而且有了網址之後就換回 `SignedImage`。
- 欄位本身可以取得焦點：焦點在上面時直接貼上圖片；也可以把圖片拖到欄位上（§4）。
- 沒有登記選圖的 api 時（只測其他區塊的頁面測試、沒有接上的 app）欄位停用，不讓整頁壞掉。

## 2. 圖片來源的註冊表與可用性

```ts
registerImageSource({
  id: 'file',                 // 與 api 的來源 id 相同
  order: 30,                  // 「上傳」固定是第一個分頁，不在註冊表裡（feature 拿不掉它）
  labelKey: 'image.source.file',      // app 的全域字串：對話框一打開就要顯示
  localeScope: FILE_LOCALE_SCOPE,     // 元件用到的語系包，對話框打開時載入
  isAvailable: ({ usage, can, queryClient }) => can('file:access') || can('file:read'),
  component: lazy(() => import('./FileImageSource')),   // 選圖時才載入
});
```

在 plugin 的 **同步** 階段登記；feature 被停用（卸載）時跟著撤回。每次按「更換」時依序判斷：

1. 有登記（feature 已安裝）；
2. 用途的 `sources` 允許它（`null` 是全部）；
3. `isAvailable` 為真：權限是同步的判斷，每次都重算；「有沒有內容」是非同步的判斷，以 React Query 快取 1 分鐘、最多等 1 秒，逾時或失敗當作不可用
   （`resolveAvailableSources`）。選好一張圖之後失效（例：第一次上傳之後「最近使用」就出現了）。

滑過或聚焦「更換」時預先判斷，按下時通常已經有答案。結果只剩「上傳」→ 直接打開選檔視窗；有兩個以上 → 開 `ImageSourceDialog`。
前端的判斷只是體驗：後端照樣把關（來源的 `feature`、以呼叫者的身分讀取）。

目前的來源：「最近使用」（order 20，§6）、「圖片庫」（order 25，[`24-gallery.md`](./24-gallery.md) §7）、「檔案管理」（order 30，§7）。

### 2.1 多選模式：`MultiImageSourceDialog`

一次從其他來源挑多張（圖片庫的「從其他來源…」，[`24-gallery.md`](./24-gallery.md) §6.2）。與 `ImageSourceDialog` 是不同的元件：沒有「上傳」「最近使用」、沒有裁切。

- 來源登記時帶 `supportsMultiple: true` 才列出；元件收到 `multiple: { selected, onToggle }` 時顯示勾選狀態（`aria-pressed`），點一張切換勾選，不呼叫 `onSelect`。
  目前只有「檔案管理」與「圖片庫」支援。
- `useMultiImageSources(usage, exclude)` 依序判斷：支援多選、用途允許、`isAvailable` 為真、不在 `exclude`（呼叫端自己）；
  `useMultiImageSourcesAvailable` 讓呼叫端決定要不要顯示入口（還在判斷時是 `undefined`，先不顯示，避免選單項目閃一下又消失）。
- 勾選只在一個來源內（後端一次只收一個 `source`），切換分頁時清空；`max` 限制張數（api 的 `from-source` 上限 100）。
  `onConfirm({ source, items })` 交給呼叫端送出，對話框不認識圖片庫。

## 3. 流程與 api 的注入

web-core 不呼叫 app 的 API：app 以 `registerImagePickerApi()` 注入 `ImagePickerApi`（`getUsages`、`upload`、`fromSource`、`getAsset`），
backstage 的實作在 `apps/backstage/src/app/image-picker/api.ts`，用 `apis/image/*`。

| 步驟 | 上傳 | 其他來源 |
| --- | --- | --- |
| 選 | 選檔、拖曳、貼上（§4） | 來源的元件呼叫 `onSelect({ kind: 'source', source, refId, preview })` |
| 檢查 | 檔頭判斷的型別、大小、`createImageBitmap` 讀的尺寸（§4） | 來源的列表已先擋（§6、§7） |
| 裁切 | 用途有比例時一定先裁切；沒有比例就直接上傳 | 同左（沒有預覽時直接送，伺服器取中央） |
| 送出 | `uploadImage`：`POST /images` → 直傳（進度顯示在對話框）→ `POST /images/:id/complete { crop }` | `POST /images/from-source { usage, source, refId, crop }` |

- 上傳不經過全域批次佇列：只有一張、要立刻看到結果；關掉對話框就放棄上傳（沒確認的資產 24 小時後被清掉）。
- 直傳物件儲存的 `putToStorage`（XHR，拿得到上傳進度）在 `web-core/direct-upload`，檔案管理與圖片資產共用。
- 失敗的訊息顯示在裁切對話框裡（`FormError`），對話框不關。

## 4. 上傳：選檔、拖曳、貼上

| 入口 | 在哪裡有效 | 細節 |
| --- | --- | --- |
| 選檔 | 只剩上傳時的「更換」、對話框的「上傳」分頁 | `accept` 由用途的 `contentTypes` 產生；手機的選檔視窗本來就有「拍照」 |
| 拖曳 | 欄位本身、對話框的任何一個分頁 | 拖進對話框時自動切到「上傳」 |
| 貼上 | 焦點在欄位上、或對話框開著 | 從剪貼簿取圖片；貼上的不是圖片（例：一段網址）就不攔截 |

- 只取一張：多個檔案時用第一張圖片並提示。拖進來的是網頁上的圖片（只有網址、沒有檔案）時提示「請先把圖片存到電腦再拖曳進來」（從網址匯入這一版不做）。
- 貼上的圖片沒有檔名（瀏覽器給 `image.png`）：以「貼上的圖片 2026-10-09 14:32.png」命名，「最近使用」才分得出來。
- 不做全頁攔截：只在焦點落在欄位上、或對話框開著時處理 `paste`。
- 檢查（`validateImageFile`）：以檔頭判斷型別（與 api 的規則相同），不信任 `File.type`，貼上的檔案的型別也以檔頭為準；大小；`createImageBitmap` 讀得出尺寸時，
  裁切之後最大的範圍不夠用途的最小尺寸就不上傳。瀏覽器解不了（例：舊瀏覽器的 AVIF）時放行，交給後端。

## 5. 裁切

`ImageCropDialog` 用設計系統的 `ImageCropper`（[`07-ui-system.md`](./07-ui-system.md) §3.18）：比例與最小尺寸來自用途，頭像顯示圓形參考線。
輸出以 **比例**（0～1）表示的範圍，由伺服器套用：不在瀏覽器以 canvas 重新編碼（品質變差、大圖吃記憶體），從其他來源挑的圖也不必先下載再上傳。
沒動過裁切框就送出時取中央。

重新裁切（「裁切」）以 `GET /images/:id` 取主檔的網址顯示整張圖，只有建立者拿得到；拿不到時提示「這張圖片無法重新裁切，請重新選一張」。

## 6. 來源「最近使用」

`apps/backstage/src/app/image-picker/RecentImageSource.tsx`（app 登記，order 20）：`GET /images/recent?usage=` 的縮圖格，同一個內容只列一次。
沒有任何最近使用的圖片時不列出這個分頁（非同步的 `isAvailable`）。尺寸太小的列出但停用，滑過顯示原因；每張可以「從最近使用移除」。
選了之後由伺服器複製成一筆新的資產，可以重新裁切（[`../backend/25-image.md`](../backend/25-image.md) §15.7）。

放在 `app/` 而不是 `core/`：`core/` 不能 import `apis/`（[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §2.2）。

## 7. 來源「檔案管理」

`apps/backstage/src/features/file/imageSource/`（`file` feature 的 plugin 登記，order 30）：資料夾的下拉選單（看不到內容的資料夾不列）＋ 縮圖格，
唯讀；單選，或在多選模式下勾選多張（§2.1）；不帶上傳、改名、刪除、拖曳。是 `features/file` 自己的元件，不是別的 feature 拿去用（[`02-plugin-system.md`](./02-plugin-system.md) §3.1）。

| 層 | 條件 | 不符合時 |
| --- | --- | --- |
| 伺服器（`GET /files?imageUsage=`） | 型別在用途的 `contentTypes` 內（排除 SVG）、大小不超過上限、變體沒有失敗 | 不列出 |
| 前端（`image.width`／`image.height`） | 裁切之後不小於用途的最小尺寸；變體還沒好（沒有尺寸）先當作可選 | 列出但停用，滑過顯示原因 |

太小的圖列出來但停用，而不是藏起來：使用者記得檔案管理器裡有那張圖，找不到會以為壞了。看不到任何資料夾時分頁照樣出現，顯示空狀態並提示改用上傳
（前端無法事先便宜地知道有沒有可讀的資料夾）。裁切時顯示檔案的全螢幕預覽，比例以原圖的尺寸換算。

## 8. 頭像

| 位置 | 做法 |
| --- | --- |
| 個人資料（`features/account` 的 Profile） | `ImageField`；換了就存（`PATCH /auth/profile { avatarImageId }`／`{ avatarCrop }`），不跟著「儲存」按鈕 |
| 使用者詳情（`features/user`） | 有 `user:update`：`ImageField`，存的時候帶目前看到的 `version`（`useUserAvatarMutation`，衝突時重抓並提示）；沒有：只顯示 `SignedAvatar` |
| 頂列的帳號選單 | `DashboardShell` 的 `userAvatar`（`SignedAvatar` 的 `sm`） |
| 使用者列表、留言 | 名稱前的 `SignedAvatar`（`sm`）；同一頁的多個頭像以 `coalesce()` 合併成一次失效 |

頭像處理好了，伺服器推使用者的 update：看得到這個人的畫面與本人的 profile 重抓。

---

## 9. 設計決策：選圖的前端

後端的決定（資料模型、複製、容量、用途、最近使用的權限…）在 [`../backend/25-image.md`](../backend/25-image.md) §16；這裡只記前端特有的。

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | **機制放 `web-core/image-picker`**（`ImageField`、來源的註冊表、對話框、檢查），`ImageCropper` 放 `@b2b-system/ui` | 兩個前端都可能用到；裁切是不含業務名詞的通用元件 | 放 backstage 的 `core/`：apps/platform 之後要用就得搬 |
| D2 | **api 以 `registerImagePickerApi()` 注入** | web-core 不呼叫 app 的 API（[`17-shared-packages.md`](./17-shared-packages.md) §2） | 每個 consumer 傳 `api` prop：每處都要組一次 |
| D3 | **「上傳」是內建的來源**，不在註冊表裡、永遠第一個 | 它是最後的退路，不能被 feature 拿掉；只剩它時不出現來源選擇 | 也登記成一個來源：要特別處理「不能卸載」 |
| D4 | **非同步的可用性判斷快取 1 分鐘、最多等 1 秒** | 「最近使用」要先查有沒有內容；查詢不能卡住上傳 | 每次按下都查、等到回來：慢的網路下按鈕像是沒反應 |

### 9.1 實作紀錄

- **「最近使用」放 `app/image-picker/`**（提案寫 `core/image`）：`core/` 不能 import `apis/`；它是 app 啟動時登記的內建來源，與 `app/plugin.ts` 登記 MFA 方式相同。
- **來源的 id 用 api 的來源 id**（`file`，提案的例子寫 `fileManager`）：用途的 `sources` 限制寫的是 api 的 id，前後端用同一個字串才比得起來。
- **`putToStorage` 搬到 `web-core/direct-upload`**：原本在 `apis/file/upload-file/`，圖片資產也要直傳；`apis/` 的操作資料夾彼此不能 import。放在獨立的模組而不是 `web-core/client`：它要用 `errors` 的 `AppError`，而 `errors` 已經依賴 `client`。
- **來源的分頁標題放 app 的全域字串、元件的字串以 `localeScope` 載入**：選圖的頁面（個人資料）不是來源 feature 的頁面，它的語系包還沒載入（與資源頁的面板相同的問題，`core/resource-panel`）。
- **沒有登記 api 時欄位停用，不丟例外**：個人資料頁的其他區塊（改密碼、MFA）的測試不必為了頭像準備 api。
