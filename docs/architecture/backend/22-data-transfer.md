# 後端 22 — 匯入／匯出（data transfer）

把資源整批匯出成 CSV／XLSX／JSON／YAML／SQL、從 CSV／XLSX／JSON／YAML 整批新增或修改。重點不在個別的資源，而是 **共同的框架**：
擁有者模組登記一份欄位定義（`TransferResource`），匯出與匯入共用；檔案的解析、驗證、套用都在伺服器端，預覽與編輯在前端。
目前登記的資源：使用者、角色、群組與群組成員、部門與部門成員、標籤（匯入＋匯出）；稽核日誌、審批請求與決定、服務帳號（只匯出）（§12）。

> 程式碼：後端 `apps/api/src/modules/data-transfer/`（框架：登記表、API、工作、寫檔器與讀檔器、驗證器）、
> 各資源的 `<name>.transfer.ts`（§12、§11）與 `apps/api/src/modules/data-transfer/resources/audit-log.transfer.ts`（稽核日誌，D27）；
> 前端見 [`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md)。
> 相關：[`10-jobs.md`](10-jobs.md)（背景工作）、[`09-file.md`](09-file.md) §14（伺服器端的分段上傳、`transfers/` 前綴）、
> [`15-notification.md`](15-notification.md)（完成通知）、[`../05-tenancy.md`](../05-tenancy.md) §5（feature 與參數）、[`03-api-conventions.md`](03-api-conventions.md) §10（不提供批次端點的例外）。

---

## 目錄

1. 背景
2. 範圍
3. 使用者故事
4. 名詞與整體流程
5. 欄位定義：匯入與匯出共用的一份
6. 匯出
7. 匯入
8. 前端（見 frontend/21）
9. 權限、稽核、通知、推播、指標
10. 上限與保留期限
11. 程式碼地圖
12. 其他資源：角色、群組、組織、標籤、審批、服務帳號
13. 設計決策：匯入／匯出

---

## 1. 背景

大量建立使用者、把稽核日誌交給外部稽核、之後業務資料的搬移，都需要匯入匯出。現在：

- **沒有任何匯出**：稽核日誌只有 `GET /audit-logs`、`GET /audit-logs/:id`。整個 api 沒有產生 CSV 的地方，也沒有 CSV／XLSX 套件。
- **前端批次佇列不適合大量**（[`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13）：
  - 它逐筆呼叫單筆 API、全域一次一筆，而且需要至少一個分頁開著。
  - 「選取全部符合」的上限是 10 000 筆（`BATCH_SELECT_ALL_MAX`），送出前要先把每一頁抓回瀏覽器。
  - 幾百筆的狀態切換沒問題；幾萬筆的匯出、需要整批驗證的匯入就不行。
- **需要的零件都有**：
  - 背景工作：pg-boss，交易內入列走 `job_outbox`。
  - 每個租戶一個 bucket，並有有時效的下載連結（`presignDownload`，`FILE_URL_TTL` ≤ 1 小時）。
  - 瀏覽器直傳物件儲存（`presignUpload`）。
  - 「模組把 handler 註冊進通用模組」的模式：審批 handler、標籤資源、`TrashHandler`、`SettingService.register`。

參考實作是一套純前端的批次匯入。它的問題正是這份設計要避開的（§13 D1）：

- 在瀏覽器解析 CSV、逐列呼叫既有的單筆 API。
- 上限 500 列。
- 驗證規則在前端重寫一份，比對用的目錄整份抓進記憶體。
- 關掉分頁就遺失所有編輯。
- 「建立實體再建關聯」不是原子操作，部分成功的列會被回報成失敗，重匯就建出重複的資料。

## 2. 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 模組登記「可匯入匯出的資源」（`TransferResource`），一份欄位定義同時供匯出與匯入使用 | 排程定期匯出 |
| 匯出：勾選的資料或目前的篩選條件 → 背景工作組裝檔案 → 放租戶 bucket → 回傳下載連結，前端以 `<a>` 下載 | 跨租戶搬移（平台層級）、apps/platform 的匯入匯出 |
| 匯出格式：**CSV（預設）**、XLSX、SQL（PostgreSQL `INSERT`） | 匯入 SQL 檔、JSON 格式 |
| 匯入：專用頁面，分 **新增模式**、**修改模式**；**不支援刪除** | 「新增或修改」（upsert）的混合模式 |
| 匯入格式：CSV（UTF-8／UTF-16／Big5）、XLSX（第一個工作表或指定工作表） | 一次匯入多個檔案、在預覽中追加第二個檔案 |
| 下載範本（CSV／XLSX；修改模式的範本預先填入現有資料） | 富文本、附件類型的欄位 |
| 上傳給後端 **分析**：各種格式（CSV、XLSX…）統一轉成 JSON 回傳；預覽時前端持有 JSON，驗證由後端的無狀態端點負責 | 在瀏覽器解析檔案、在瀏覽器實作驗證規則 |
| 預覽中的編輯自動存成瀏覽器草稿（IndexedDB，加密），重新整理後可以接續 | 跨裝置接續未套用的匯入 |
| 類似 Excel 的預覽表格：虛擬捲動、鍵盤移動、儲存格錯誤標示、就地修改、貼上範圍、復原、只看錯誤列、跳到下一個錯誤 | 公式、排序、合併儲存格、填滿控點（fill handle） |
| 修改模式在預覽中顯示「原值 → 新值」，沒有變更的儲存格淡化 | 欄位層級的部分套用（同一列只套用部分欄位） |
| 確認後背景套用：每列一個交易、走與 API 相同的 service，可取消，結果報告逐列列出 | 套用後的整批復原 |
| 失敗的列一鍵另開成新的匯入，修正後再套用 | |
| 「我的匯入匯出」列表頁 | 管理者看所有人的匯入匯出（稽核日誌已記錄） |
| 第一批：使用者（匯入＋匯出）、稽核日誌（只匯出）；之後加上角色、群組、組織、標籤（匯入＋匯出）與審批、服務帳號（只匯出），見 §12 | 系統設定、通知政策、審批流程、公告這類巢狀設定（D46）；檔案清單、Webhook、API token（D47） |

## 3. 使用者故事

**作為租戶管理者，我希望從 Excel 一次建立 300 個帳號，以便新部門上線時不必一個一個填表單。**

- **Given** 我有 `user:create`，並下載了新增模式的 XLSX 範本
- **When** 我填好 300 列上傳，其中 4 列的 Email 格式錯誤、2 列與現有帳號重複
- **Then** 預覽表格標出這 6 列的錯誤儲存格，滑鼠移上去看到原因
- **And** 我直接在表格裡改好後按「套用 300 筆」
- **And** 背景建立 300 個帳號並各寄出啟用信，完成時我收到通知；即使中途關掉分頁也一樣

**作為租戶管理者，我希望匯出全部帳號、在試算表裡改顯示名稱與狀態後匯回，以便大量整理資料。**

- **Given** 我有 `user:export`、`user:update`
- **When** 我匯出 CSV（含 `id` 欄），刪掉不需要的欄位，改了 40 列再以修改模式上傳
- **Then** 預覽只顯示檔案裡有的欄位，變更的儲存格標出原值與新值，沒改的 2 000 列標為「無變更」並自動略過
- **And** 套用時只送出 40 列

**作為稽核人員，我希望把上一季的稽核日誌匯出成 XLSX 交給外部稽核，以便不必逐頁截圖。**

- **Given** 我有 `auditLog:export`，在稽核日誌頁篩選了 7 月到 9 月
- **When** 我按「匯出」、選 XLSX
- **Then** 對話框顯示進度，完成後瀏覽器自動下載 `audit-logs-20261008-1430.xlsx`
- **And** 若我先關掉對話框，完成時會收到通知，可以從通知或「我的匯入匯出」下載

**作為租戶管理者，我希望套用時失敗的 12 列能直接修正後重送，以便不必下載失敗清單再重新上傳。**

- **Given** 一次匯入完成，12 列因為「預覽後資料已被別人修改」而失敗
- **When** 我在結果報告按「以失敗的列重新匯入」
- **Then** 開出一份新的匯入，只含那 12 列，並已重新比對現有資料、重新驗證，可以直接修改後套用

## 4. 名詞與整體流程

| 名詞 | 意思 |
| --- | --- |
| 傳輸（transfer） | 一次匯出或一次匯入，對應 `data_transfers` 的一列 |
| 資源類型（`type`） | 可匯入匯出的資源，例：`user`、`auditLog` |
| 欄位（column） | 資源的一個欄位，有穩定的機器鍵 `key`（`email`、`displayName`），檔案的標頭以它對應 |
| 匯入 JSON（import rows） | 後端分析檔案後回傳的標準化 JSON：每列是 `{ rowNo, sourceRow, cells: { columnKey: 原始字串 } }`。預覽與修改期間由前端持有 |
| 問題（issue） | 一列上的錯誤（`error`）或警告（`warning`），以代碼＋參數表示，前端翻譯 |
| 套用列（apply row） | 送出套用時，前端把 JSON 列交給後端，存成 `data_transfer_rows`，背景工作逐列處理並記錄結果 |
| 比對目標（target） | 修改模式中，一列要修改的現有紀錄 |

```
匯出
  列表頁「匯出」─▶ POST /data-transfers/exports ─▶ [dataTransfer.export 工作]
                   └ 202 { id, status: queued }      逐頁查詢 → 寫 CSV/XLSX/SQL → 分段上傳到 bucket
  前端等推播 ◀────────────────────────────── status: completed（＋站內通知）
  POST /data-transfers/:id/download ─▶ { url（presigned，attachment）} ─▶ <a href download>.click()

匯入
  ① 分析：匯入頁 ─▶ POST /data-transfers/importers/:type/analyze（multipart：檔案＋mode＋選填的 mapping）
           api 在 worker thread 解析 CSV／XLSX → 標頭對應 → 轉成 JSON → 逐列驗證 → 回傳
           ├ 對應不完整 → 200 { status: 'needsMapping', headers, samples } ─▶ 使用者對應 ─▶ 帶 mapping 重送同一個檔案
           └ 200 { status: 'ok', columns, rows: [{ rowNo, sourceRow, cells }], issues, targets, summary }
  ② 預覽：前端持有 JSON（＋IndexedDB 草稿），類似 Excel 的表格
           修改 ─▶ POST /data-transfers/importers/:type/validate（只送被改的列）─▶ 回傳這些列的 issues、targets
           檔案內重複、同一個目標出現多次：前端在整份 JSON 上計算
  ③ 套用：POST /data-transfers/imports { type, mode, fileName, rows, skipInvalid } ─▶ 202 { transfer }
           ─▶ [dataTransfer.applyImport 工作] 先以同一個驗證器重新驗證全部列 → 每列一個交易走既有 service
           ─▶ status: completed（逐列 outcome）─▶ 結果報告、下載結果、以失敗的列重新匯入
```

伺服器在 ①② **不保存任何東西**：分析與驗證都是無狀態的請求，檔案只在請求期間存在於記憶體。
從 ③ 開始才有 `data_transfers` 這筆傳輸（§13 D21）。

傳輸的狀態：

| 方向 | 狀態轉移 |
| --- | --- |
| 匯出 | `queued` → `running` → `completed` ｜ `failed` ｜ `cancelled`；保留期限到 → `expired` |
| 匯入 | `queued` → `applying` → `completed` ｜ `failed` ｜ `cancelled`；保留期限到 → `expired` |

- 匯入的傳輸在 **送出套用時** 才建立；分析與預覽期間沒有傳輸，只有前端的 JSON 與草稿。
- 匯入的 `completed` 包含「部分列失敗」，失敗與成功各自計數。
- `failed` 只表示整個傳輸無法進行，例如工作重試用盡、建立者已被停用。
- 「不上傳檔案，直接在表格輸入」不呼叫分析端點：前端直接建立 20 列空白的 JSON（§7.2）。

### 4.1 資料模型（租戶 DB）

傳輸是業務資料，含個資，所以放在 **租戶 DB**（[`05-tenancy.md`](../05-tenancy.md) §1）。

```
data_transfers
  id               uuid pk
  direction        text not null          -- 'export' | 'import'
  type             text not null          -- 登記的資源類型：'user' | 'auditLog'
  mode             text null              -- 匯入：'create' | 'update'
  format           text not null          -- 'csv' | 'xlsx' | 'sql'
  status           text not null          -- §4 的狀態
  created_by       uuid not null fk users
  locale           text not null          -- 建立當下的語系：標頭、標籤、訊息
  timezone         text not null          -- 建立當下的時區：日期時間、檔名
  params           jsonb not null         -- 匯出：{ scope, columns }；匯入：{ skipInvalid, columns }
  source_name      text null              -- 匯入：原始檔名（只用於顯示與結果報告的檔名；檔案本身不保存）
  output_key       text null              -- 匯出的產出
  output_name      text null
  output_size      bigint null
  total_rows       int not null default 0
  processed_rows   int not null default 0
  succeeded_rows   int not null default 0
  failed_rows      int not null default 0
  skipped_rows     int not null default 0
  error_code       text null              -- 整個傳輸失敗時的錯誤碼
  error_details    jsonb null
  version          int not null default 1 -- 樂觀鎖：取消與工作的狀態更新
  expires_at       timestamptz not null
  started_at       timestamptz null
  finished_at      timestamptz null
  created_at, updated_at
  index (created_by, created_at desc, id)        -- 我的匯入匯出
  index (expires_at)                             -- 清理
  index (status) where status in ('queued','running','applying')   -- 進行中的上限檢查

data_transfer_rows                        -- 只有匯入，在送出套用時一次寫入
  transfer_id      uuid fk data_transfers on delete cascade
  row_no           int                    -- 預覽中的列號（從 1 起）；手動新增的列接在最後
  source_row       int null               -- 檔案中的實際列號（含標頭），結果報告用；手動新增的為 null
  raw              jsonb not null         -- { columnKey: 原始字串 }：前端送來的 JSON 列
  target_id        uuid null              -- 修改模式：預覽時比對到的紀錄（套用時以權限重新確認）
  target_version   int null               -- 修改模式：預覽時的 version，套用時用於樂觀鎖
  target_expected  jsonb null             -- 修改模式：比對當下的關聯欄（例：roleIds），套用時的樂觀鎖輸入（D29）
  target_manual    boolean not null default false  -- 修改模式：預覽中手動指定（target_id 有值）或撤回（target_id 是 null）的目標，套用時照用（§7.5）
  outcome          text not null default 'pending'  -- pending | succeeded | failed | skipped | cancelled
  outcome_error    jsonb null             -- { code, details } 或 { code: 'VALIDATION_FAILED', issues }
  changes          jsonb null             -- 修改模式：{ columnKey: [原值, 新值] }，在套用的交易內記下，結果報告用
  result_id        uuid null              -- 套用後的紀錄 id（新增模式也有）
  updated_at
  primary key (transfer_id, row_no)
  index (transfer_id, outcome)
```

- 兩張表都不軟刪除、不進回收桶、不記版本歷史：它們是有期限的工作資料，不是使用者維護的實體。
- 預覽期間的列 **不在資料庫**：分析與驗證是無狀態的（§13 D21）。前端送出套用時才把整份 JSON 寫進 `data_transfer_rows`，
  用途只有兩個：讓套用工作可以重試而恰好一次（§7.6），以及結果報告。
- `version` 只保護傳輸本身的狀態轉移（使用者的取消與工作的狀態更新不互相覆蓋）。

### 4.2 API 一覽

前綴 `/data-transfers`。所有路由都是 `@Authenticated()` ＋ `@RequireFeature('dataTransfer')`；依資源而定的權限在 service 檢查（§9.1）。

| 方法與路徑 | 用途 | 回應 |
| --- | --- | --- |
| `GET /data-transfers` | 我的匯入匯出（`direction`、`type`、`status[]` 篩選，`offset` 分頁） | 列表 |
| `GET /data-transfers/:id` | 傳輸詳情與計數 | `DataTransfer` |
| `POST /data-transfers/:id/cancel` | 取消（帶 `version`） | `DataTransfer` |
| `DELETE /data-transfers/:id` | 刪除已結束的傳輸：立即刪除檔案與套用列（不影響任何業務資料） | 204 |
| `POST /data-transfers/:id/download` | 取得匯出檔的下載連結 | `{ url, expiresAt, fileName }` |
| `GET /data-transfers/:id/report` | 匯入結果報告（`format`、`rows=all\|failed\|invalid`），直接串流 | 檔案 |
| `GET /data-transfers/resources` | 操作者可以匯出或匯入的資源類型，以及各自可用的欄位與格式 | 清單 |
| `POST /data-transfers/exports` | 建立匯出（§6.1） | 202 `DataTransfer` |
| `GET /data-transfers/importers/:type` | 匯入的欄位定義（`mode`），依請求的語系 | 欄位清單 |
| `GET /data-transfers/importers/:type/template` | 範本（`mode`、`format=csv\|xlsx\|json\|yaml`），直接串流 | 檔案 |
| `GET /data-transfers/importers/:type/columns/:key/options` | `reference` 欄位的搜尋（`keyword`），預覽中的下拉選單；文字欄有 `import.suggest` 時是自動完成的建議（`id` 與 `label` 都是值） | `{ id, label }[]` |
| `GET /data-transfers/importers/:type/targets` | 修改模式：手動指定比對目標的下拉選單（`keyword`，§7.5） | `{ id, label, description? }[]` |
| `POST /data-transfers/importers/:type/analyze` | **分析**：multipart 上傳檔案（`file`、`mode`、選填 `encoding`、`sheet`、`mapping`），轉成 JSON 並驗證（§7.3） | 200 `ImportAnalysis` |
| `POST /data-transfers/importers/:type/validate` | 驗證 JSON 列：`{ mode, rows: [{ rowNo, cells, targetId? }] }`，最多 1 000 列（§7.4） | 200 `{ rows: [{ rowNo, issues, target? }] }` |
| `POST /data-transfers/imports` | **套用**：`{ type, mode, fileName?, skipInvalid, rows: [{ rowNo, sourceRow?, cells, targetId?, target? }] }`（§7.6） | 202 `DataTransfer` |
| `GET /data-transfers/:id/rows` | 匯入的套用列與結果（`outcome` 篩選、`afterRowNo` keyset、`limit` ≤ 1 000）；「以失敗的列重新匯入」用 | 列與 `nextRowNo` |

- `analyze` 是 api **第一個收 multipart 的端點**。其他上傳都是瀏覽器直傳 bucket，這裡例外的理由見 §13 D22：
  - 只收單一檔案，大小上限在串流讀取時就檢查，超過立即中斷；
  - 檔案只在記憶體，不落地、不進 bucket；
  - 解析在 worker thread 中執行，不卡住 api 的 event loop（§7.3）。
- `analyze`、`validate` 都是 **無狀態** 的：不寫任何資料表，同樣的輸入得到同樣的結果。重送、多分頁同時操作都沒有副作用，也不需要清理。
- `POST /imports` 的請求本體可能有數 MB（5 000 列 × 15 欄）。這條路由的 body 上限單獨放寬到 `dataTransfer.importMaxSizeMb` 的兩倍，其他路由不變。

## 5. 欄位定義：匯入與匯出共用的一份

參考實作的匯出與匯入各有一份欄位定義：

- 匯出沒有 `id` 欄。
- 匯出的欄位有一半不能匯入，重匯時被默默忽略。
- 為了防公式注入加上的 `'` 前綴，重匯時被當成內容寫回。

「匯出 → 在試算表修改 → 匯回」因此無法運作。這裡每個資源只有 **一份** 欄位定義（§13 D4）。

### 5.1 登記

擁有者模組在 `onModuleInit` 登記；`modules/data-transfer` 不 import 業務模組（[`coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2）。

```ts
// modules/user/user.transfer.ts
@Injectable()
export class UserTransferResource implements OnModuleInit {
  constructor(private readonly transfers: DataTransferRegistry, /* UserService、UserRepository… */) {}
  onModuleInit() {
    this.transfers.register(defineTransferResource({
      type: 'user',
      fileBaseName: 'users',           // 檔名 users-20261008-1430.csv、SQL 的表名 users_export
      label: { 'zh-TW': '使用者', 'en-US': 'Users' },
      columns: USER_TRANSFER_COLUMNS,
      exporter: { … },                 // §6.2；沒有就是不能匯出
      importer: { … },                 // §7.4；沒有就是不能匯入
    }));
  }
}
```

### 5.2 欄位

```ts
type LocalizedText = Readonly<Record<'zh-TW' | 'en-US', string>>;

type ColumnKind =
  | 'string' | 'number' | 'boolean' | 'date' | 'datetime'
  | 'enum'        // 固定選項（使用者狀態）
  | 'reference'   // 指向其他資源的名稱（角色）；匯入時解析成 id
  | 'json';       // 只匯出（稽核日誌的 changes、metadata）

interface TransferColumn<TRecord> {
  key: string;                          // 穩定的機器鍵；發佈後不改名
  label: LocalizedText;                 // 範本標頭與預覽表格的欄名
  aliases?: readonly string[];          // 額外接受的標頭寫法（舊名、常見同義詞）
  kind: ColumnKind;
  multiple?: { separator?: string; max?: number };     // 多值，預設以 ; 分隔
  enum?: readonly { value: string; label: LocalizedText; aliases?: readonly string[] }[];
  reference?: ReferenceSpec;            // kind = 'reference' 時必填
  hint?: LocalizedText;                 // 「怎麼填」的補充說明（範本說明頁、表頭提示）
  example?: (ctx: TransferContext) => Promise<unknown> | unknown;   // 新增範本的範例值
  /** 讀這一欄要的權限；沒有就不出現在匯出、範本與預覽（例：角色欄要 role:read） */
  permission?: PermissionKey;

  export?: {
    get: (record: TRecord) => unknown;  // 回傳「值」，格式化由寫檔器依 kind 處理
  };
  import?: {
    modes: readonly ('create' | 'update')[];
    requiredOnCreate?: boolean;
    matchKey?: number;                  // 修改模式的比對鍵，數字小的先比（id: 1、email: 2）
    nullable?: boolean;                 // 修改模式能不能以 \N 清空
    schema: z.ZodType;                  // 單一值的驗證；直接取用 API 的 DTO 欄位，不另寫
    transitions?: Readonly<Record<string, readonly string[]>>; // 狀態欄的合法轉移
    /** 匯入時額外要的權限（例：角色欄要 user:assignRole） */
    permission?: PermissionKey;
    /** 文字欄的自動完成：依輸入查詢現有的值（使用者的 Email、帳號）；沒有的欄位前端只以同一欄填過的值建議 */
    suggest?(keyword: string, ctx: TransferContext): Promise<readonly string[]>;
  };
}

interface ReferenceSpec {
  resolve(names: readonly string[], ctx: TransferContext): Promise<Map<string, { id: string; label: string } | 'ambiguous'>>;
  search(keyword: string, ctx: TransferContext): Promise<readonly { id: string; label: string }[]>;   // 預覽中的下拉選單
}
```

規則：

- `schema` 取自 API 的 DTO（例：`CreateUserSchema.shape.email`），驗證只有一份來源。DTO 改了，匯入跟著改。
- 只有 `export` 的欄位（`createdAt`、`lastLoginAt`、`mfaEnabled`）在匯入時是 **已知的唯讀欄位**：
  - 預覽頂端列出「以下欄位是唯讀，已忽略」。
  - 不會被當成「不認得的欄位」，也不會默默消失。
- 範本只包含可匯入的欄位；匯出包含全部有 `export` 的欄位。
- `key` 一經發佈不改名：舊的匯出檔要能匯回，而且標頭比對以它為準（§7.3）。

### 5.3 值的格式（雙向）

| kind | CSV／XLSX 匯出 | SQL 匯出 | 匯入接受 |
| --- | --- | --- | --- |
| `string` | 原文 | `text` | 去頭尾空白；開頭的 `'` 後面若接 `= + - @ Tab CR`，去掉這個 `'`（§6.5） |
| `number` | 數字（XLSX 是數值儲存格） | `numeric` | 十進位數字；拒絕 `1e3`、`0x10` 這類寫法 |
| `boolean` | 依匯出者語系（`是`／`否`、`Yes`／`No`） | `boolean` | `true/false/1/0/yes/no/y/n/是/否`，加上兩個語系的標籤，不分大小寫 |
| `date` | `YYYY-MM-DD`（XLSX 是日期儲存格） | `date` | `YYYY-MM-DD`、`YYYY/MM/DD`、XLSX 日期儲存格；拒絕不存在的日期（02-30） |
| `datetime` | ISO 8601 含時差，以匯出者的時區表示（`2026-10-08T14:30:00+08:00`） | `timestamptz` | ISO 8601；沒有時差時以 **建立這次匯入的人的時區** 解讀；XLSX 日期時間儲存格同樣以該時區解讀 |
| `enum` | 匯出者語系的標籤（`啟用`） | 值代碼（`active`） | 值代碼、任一語系的標籤、`aliases`；正規化（去空白、小寫、壓縮空白）後 **完全相符** |
| `reference` | 名稱 | 名稱（`text`） | 名稱、代碼（slug）或 id，完全相符（不分大小寫）；多值以 `;` 分隔 |
| `json` | 單行 JSON 字串 | `jsonb` | 不能匯入 |
| 多值 | 以 `;` 串接 | `text[]` | 以 `;` 分隔；也接受同一個標頭重複多次（每欄一個值） |
| 空值 | 空白儲存格 | `NULL` | 新增模式：空白＝沒填；修改模式：空白＝**不變更**，`\N`＝清空（只限 `nullable`） |

時區取「使用者的 `timezone`」，沒設定時用系統設定 `general.defaultTimezone`。建立傳輸時就把時區寫進 `data_transfers.timezone`，之後改設定不影響進行中的傳輸。

---

## 6. 匯出

### 6.1 前端送出什麼

列表頁的匯出對話框送出：

```http
POST /data-transfers/exports
{
  "type": "user",
  "format": "csv",                       // csv（預設）| xlsx | sql
  "scope": { "kind": "ids", "ids": ["…", "…"] },        // 勾選的資料
  // 或 "scope": { "kind": "filter", "filter": { "status": ["active"], "keyword": "acme", "sort": ["-createdAt"] } },
  "columns": ["id", "email", "displayName", "status", "roles"]   // 選填；預設全部
}
→ 202 { "data": DataTransfer }
```

- `scope.kind = 'ids'`：列表上勾選的資料，最多 10 000 筆。
- `scope.kind = 'filter'`：目前列表的篩選條件，就是列表頁送給 `GET /users` 的同一個物件，去掉 `offset`、`limit`、`cursor`。
  - 用「選取全部符合」勾選時，前端送 **filter**，不先把 10 000 筆 id 抓回來（§13 D3）。
- 每個資源的 `filterSchema` 由列表的 query DTO 衍生（`ListUserSchema.omit({ offset, limit })`），沒有第二份篩選規則。
- 不論哪一種，匯出時 **以操作者當下的權限重新查詢**：
  - 勾選後失去可見性的 id 不會出現。
  - `DataTransfer.totalRows` 是實際寫出的筆數，對話框顯示「已勾選 120 筆，匯出 118 筆（2 筆已無法存取）」。
- `columns` 只能是操作者有權讀的欄位（§5.2 `permission`）；送了沒權限的欄位回 `403 AUTHZ_FORBIDDEN`。

### 6.2 Exporter

```ts
interface TransferExporter<TFilter, TRecord> {
  permissions: readonly PermissionKey[];          // user:export；稽核日誌是 auditLog:export
  filterSchema: z.ZodType<TFilter>;
  /** 以 keyset 逐頁讀；以 ctx.actor 的權限過濾。每頁 500 列 */
  iterate(scope: ExportScope<TFilter>, ctx: TransferContext): AsyncIterable<readonly TRecord[]>;
  /** 預估筆數，供上限檢查與進度；可以是上限截斷的估計 */
  count(scope: ExportScope<TFilter>, ctx: TransferContext): Promise<number>;
}

interface TransferContext {
  actor: AuthUser;               // 建立者（工作裡由 created_by 重建）
  locale: 'zh-TW' | 'en-US';
  timezone: string;
  transferId: string;
  signal: AbortSignal;           // 工作的關機／逾時，加上使用者取消（§6.4）
}
```

- 稽核日誌的 `iterate` 沿用列表的 keyset（`audit-log.cursor.ts`），會一起讀熱表與冷表。
  - 列表限制查詢範圍最多 90 天；匯出放寬到 **366 天**。超過回 `400 VALIDATION_FAILED`（`details.field: 'filter.from'`）。
- 使用者的 `iterate` 以 `(created_at, id)` 作 keyset，排序固定，不採用列表的 `sort`。
  - 理由：offset 分頁在匯出途中有資料新增時會跳過或重複。
  - 檔案內的列序因此可能與畫面不同；對話框說明「依建立時間排序」。

### 6.3 工作：`dataTransfer.export`

| 項目 | 設定 |
| --- | --- |
| `scope` | `tenant` |
| `concurrency` | 2（每程序）；另受租戶的 `job.maxConcurrency` 限制 |
| `retryLimit` | 2；每次重試從頭產生並覆寫同一個物件 key |
| `expireInSeconds` | 3600 |
| 工作資料 | `{ transferId }`；不放篩選條件、不放個資（`job:read` 看得到，[`backend/10-jobs.md`](10-jobs.md) §4） |
| 輸出 | `{ rows, bytes }` |

步驟：

1. `queued` → `running`：條件式更新（`WHERE status = 'queued'`）。沒命中表示已取消，直接結束。
2. 重新檢查權限：`permissionService.assertHasAll(actor, exporter.permissions)`。建立後被拿掉權限 → `failed`，錯誤碼 `AUTHZ_FORBIDDEN`。
3. `count()` 超過上限（§10）→ `failed`，錯誤碼 `DATA_TRANSFER_TOO_MANY_ROWS { max, count }`。
   - 這一步也在 `POST /exports` 當下先做一次，超過就直接回 422，不入列。
4. 依格式建立寫檔器（§6.5），逐頁寫入。
   - 每累積 8 MiB 以 **伺服器端的 multipart** 上傳一段：`ObjectStorage` 新增 `uploadPart(key, uploadId, partNumber, body)`（§13 D6）。
   - 整份檔案不放記憶體。
5. 每處理 500 列或每秒（取較慢者）更新 `processed_rows` 並推播進度（§9.4）；同時檢查取消旗標。
6. 完成：
   - 在一個交易內：`status = completed`、`output_key`、`output_size`、`expires_at`，寫稽核 `dataTransfer.export`，`notify()` 建立者。
   - 交易後推播。
7. 例外：先放棄 multipart（`abortMultipartUpload`），再交給工作重試；最後一次失敗時寫 `failed` 與錯誤碼，並通知。

物件 key：`transfers/<transferId>/<fileName>`，放在租戶 bucket。`file.maintenance` 只管 `files/`、`thumbnails/`、`variants/`，不會碰這個前綴；過期清理由 `dataTransfer.cleanup` 負責（§10）。

### 6.4 下載、取消

```http
POST /data-transfers/:id/download          → 200 { url, expiresAt, fileName }
POST /data-transfers/:id/cancel  { version } → 200 DataTransfer
```

下載：

- 每次呼叫都重新簽發（`presignDownload(key, { disposition: 'attachment', fileName, expiresIn: FILE_URL_TTL })`）。檔案保留數天，連結最多 1 小時（§13 D12）。
- 走獨立的檔案網域（`FILE_STORAGE_DOWNLOAD_ENDPOINT`），與檔案管理相同（[`backend/09-file.md`](09-file.md) §13）。
- 只有建立者能下載，而且 **下載當下** 仍要有該資源的匯出權限。被拿掉權限的人不能下載先前產生的檔案。
- 寫稽核 `dataTransfer.download`。用 `POST` 是因為它有寫入。
- 回應帶 `@NoStore()`。

取消：

- 只能取消 `queued`、`running`（匯出），或 `queued`、`applying`（匯入）。預覽中的匯入還沒有傳輸，放棄就是清掉前端的資料與草稿。
- 設 `status = cancelled`，帶 `version` 防止與工作的狀態更新互相覆蓋。
- 執行中的工作在下一個檢查點發現取消後停止：
  - 匯出：放棄 multipart。
  - 匯入：已套用的列保留，其餘列的 `outcome = cancelled`。

### 6.5 檔案格式

**CSV（預設）**

- UTF-8 加 BOM（Excel 才能正確辨識中文）、CRLF 換行，依 RFC 4180 加引號。
- 第一列是標頭，用匯出者語系的 `label`。
- **公式注入防護**：`string` 欄的值開頭是 `= + - @ Tab CR` 時前置 `'`。
  - 匯入時 `string` 欄去掉這個 `'`，所以來回不會變形（§13 D16）。
  - 數字欄不加，負數照常是 `-5`。
- 自己寫一個約 80 行的寫檔器，不引入套件：只需要「加引號＋跳脫」。

**XLSX**

- 以 `exceljs` 的串流寫檔（`stream.xlsx.WorkbookWriter`）。
- 一個工作表，名稱是資源的 `label`。標頭列粗體、凍結，欄寬依標頭與前 100 列估算。
- `number`、`date`、`datetime` 寫成對應型別的儲存格，`datetime` 以匯出者時區的牆上時間呈現。
- 字串一律寫成字串儲存格，不會被解讀成公式，所以 **不加** `'` 前綴。
- XLSX 上限 1 048 576 列、單一儲存格 32 767 字元。匯出上限（§10）遠低於列數上限；超長的儲存格截斷並在最後加 `…`，計入 `output` 的 `truncatedCells`。

**JSON／YAML**

- 一個物件陣列，每筆紀錄一個物件，**鍵是欄位的 `key`**（穩定、與語系無關；匯回時標頭對應直接以 `key` 比對）。
- 值保留型別（`toDataValue`）：`number` 是數字、`boolean` 是 `true`／`false`、多值是陣列（沒有值是 `[]`）、空值是 `null`、`enum` 是值代碼（與 SQL 相同）。
  `date`、`datetime` 的文字與 CSV 相同（`datetime` 帶匯出者時區的時差）。
- JSON 逐頁寫出：`[` 之後每筆一行，最後 `]`，不必把整份資料組成一個物件再序列化。YAML 每頁以 `yaml` 套件序列化成序列（`- key: value`）後接上。
- 字串不加公式前綴：JSON／YAML 不會被試算表直接執行。
- 範本也有 JSON／YAML（`format=json|yaml`）：新增模式是一筆範例、修改模式是抽樣的現有資料；沒有「欄位說明」工作表（說明看預覽頂端的表格）。
- 結果報告只有 CSV／XLSX：報告多出的「列號」「結果」「錯誤」是表格的欄位。

**SQL（只匯出）**

```sql
-- b2b-system export: users (使用者)
-- generated at 2026-10-08T14:30:00+08:00 by admin@example.com, 1234 rows
BEGIN;
CREATE TABLE IF NOT EXISTS "users_export" (
  "id" uuid, "email" text, "username" text, "display_name" text,
  "status" text, "roles" text[], "created_at" timestamptz
);
INSERT INTO "users_export" ("id", "email", "username", "display_name", "status", "roles", "created_at") VALUES
  ('5f0c…', 'a@example.com', NULL, 'A', 'active', ARRAY['admin'], '2026-01-02T03:04:05Z'),
  …;                                   -- 每 500 列一個 INSERT
COMMIT;
```

- 方言：PostgreSQL。
- 表名是 `<fileBaseName>_export`，欄名是欄位 `key` 的 snake_case。
  - **刻意不使用系統內部的表名與欄位**：匯出的是資源的對外欄位，不是資料表傾印。不外洩內部結構與敏感欄位（例：密碼雜湊），載入同一個資料庫時也不會蓋到正式表。
- 型別依 `kind` 對應（§5.3）。`enum` 輸出值代碼，`datetime` 輸出 UTC ISO 8601。
- 字串以單引號包住並把 `'` 加倍（`standard_conforming_strings = on` 的寫法），`NULL` 輸出 `NULL`；不使用 `E''`。
- 不提供「匯入 SQL」：執行任意 SQL 不在這個框架的範圍，也不安全。

**檔名**

- 格式：`<fileBaseName>-<YYYYMMDD-HHmm>.<ext>`，時間取匯出者時區，例：`users-20261008-1430.csv`。
- 勾選範圍的匯出加 `-selection`。

---

## 7. 匯入

### 7.1 為什麼由後端分析、前端持有 JSON

參考實作的做法：

- 在瀏覽器解析（Web Worker）、在瀏覽器驗證（Zod）。
- 唯一值與比對目錄以「把整個列表分頁抓回來」取得。
- 套用時逐列呼叫單筆 API，並用跨分頁的 SharedWorker 協調。

它遇到的問題：

- 驗證規則有前後端兩份，會分歧。
- 目錄越大越慢。
- 只認 UTF-8 與 CSV。
- 「建立＋指派角色」分成兩個請求，部分成功時無法收拾。
- 500 列上限。

這裡把工作分成三段，各自交給最適合的一方（§13 D1、D21）：

| 階段 | 誰做 | 理由 |
| --- | --- | --- |
| **分析**：檔案 → JSON | 後端（`analyze`） | 編碼偵測、XLSX 解壓與型別、標頭對應都集中在一處；前端不必載入 XLSX 函式庫。之後要支援新格式，只加一個伺服器端的讀檔器，前端完全不變 |
| **預覽與修改**：持有 JSON、編輯 | 前端 | 編輯是即時的本機操作，不必每次都往返；伺服器不保存任何東西，沒有暫存要清理 |
| **驗證** | 後端（`analyze` 一次全驗、`validate` 驗改過的列） | 規則只有一份：API 的 DTO、資料庫的唯一值、反提權、比對目標都只在伺服器端有 |
| **套用** | 後端（背景工作） | 每列一個交易、可重試、可取消、離開頁面不中斷 |

代價：

- 預覽中的資料只在這個瀏覽器。重新整理靠 IndexedDB 草稿接續（[`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md) §4）；換一台電腦就要重新上傳。
- 套用前送出的 JSON 是客戶端資料，所以套用工作 **一定重新驗證全部列**，不信任前端的驗證結果（§7.6）。

### 7.2 匯入頁面

各資源在自己的 feature 有一個匯入頁，例：`/user/import?mode=create|update`。

- 是 **全頁**，不是對話框：表格需要整個畫面。
- 套用之後網址帶 `transfer=<id>`，重新整理或從通知回來時直接顯示進度與結果。

| 步驟 | 畫面 |
| --- | --- |
| 1. 選擇模式 | 頁首的切換：「新增」「修改」。只有其中一種權限時只顯示那一種的文字。已經有預覽資料時切換要確認，確認後放棄目前的資料 |
| 2. 取得範本 | 「下載範本（CSV／XLSX）」；下方是 **欄位說明**：欄名、必填、格式、可用的選項（≤ 12 個時列出）、`hint` |
| 3. 上傳 | 拖放區（`@b2b-system/ui/FileUpload`），接受 `.csv`、`.xlsx`，在前端先檢查大小與副檔名（§10）。進階選項：編碼（自動／UTF-8／Big5／UTF-16）、工作表（XLSX 有多個工作表時）。另有「不上傳，直接輸入」：前端直接建立 20 列空白的 JSON |
| 4. 分析 | 上傳並等待 `analyze` 回應，顯示「正在分析… 」與檔名。5 000 列以內通常數秒 |
| 5. 對應欄位（必要時） | `analyze` 回傳 `needsMapping` 時才出現（§7.3）：左邊是檔案的標頭與前 5 列樣本，右邊選要對應的欄位或「忽略」。確認後 **以記憶體中的同一個檔案** 加上 `mapping` 再送一次 `analyze`，不必重新選檔 |
| 6. 預覽與修正 | 類似 Excel 的表格（[`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md) §4），資料是前端持有的 JSON |
| 7. 套用 | 確認對話框 → 送出 JSON → 進度條（可取消）；之後可以離開頁面，完成時收到通知 |
| 8. 結果 | 計數、逐列結果表、下載結果報告、以失敗的列重新匯入 |

### 7.3 分析：`POST /data-transfers/importers/:type/analyze`

**請求**

- `multipart/form-data`：`file`（單一檔案）、`mode`、選填的 `encoding`（`auto`｜`utf-8`｜`big5`｜`utf-16`）、`sheet`、`mapping`（JSON 字串：`{ 來源欄序號: columnKey | null }`）。
- 路由先檢查：資源類型存在、該模式的權限（`importer.modes[mode].permissions`）、檔案大小上限（串流讀取時累計，超過立即中斷並回 `413 DATA_TRANSFER_FILE_TOO_LARGE`）。

**在 worker thread 解析**

- CSV 解壓、XLSX 解壓與解析是 CPU 密集的工作，在 api 的主執行緒做會卡住同一個程序的所有請求。
- 解析放進 worker thread 池（`node:worker_threads`，每程序預設 2 個，env `DATA_TRANSFER_PARSE_WORKERS`）。
  - 池滿時排隊最多 5 秒，仍拿不到就回 `503 DATA_TRANSFER_BUSY`（帶 `Retry-After`），前端自動重試一次後才顯示錯誤。
  - worker 出錯或結束時拒絕它手上的請求、移出池子；有人在排隊就立刻補一個新的 worker 給它（不交給壞掉的 worker、不等排隊時限）。
    程序關閉時，排隊中與解析中的請求都以 `DATA_TRANSFER_BUSY` 結束，不會懸著。
  - worker 只做「位元組 → 二維字串陣列＋標頭」，不碰資料庫。驗證回到主執行緒做（需要 DI 與資料庫）。
- 耗時量測：`api_data_transfer_parse_duration_seconds{format}`（§9.6）。

**讀檔**

- CSV：`csv-parse`。
  - 編碼：有 BOM 時依 BOM 判斷（UTF-8／UTF-16LE／UTF-16BE）。
  - 沒有 BOM 時先以嚴格的 UTF-8 解碼（`TextDecoder('utf-8', { fatal: true })`），失敗再用 Big5。
  - 繁中 Windows 的 Excel 另存 CSV 預設是 Big5（cp950），參考實作只吃 UTF-8，這種檔案會變成亂碼。
  - 使用者也可以指定編碼。
  - 分隔字元自動偵測 `,`、`;`、Tab（從 Excel 貼成 TSV 的也能讀）。
- XLSX：`exceljs`。
  - 讀第一個工作表，或指定的工作表。有多個工作表又沒指定時，回應附上 `sheets` 清單，前端讓使用者改選。
  - 公式儲存格取快取的計算結果；沒有結果的視為空白，並加警告 `formulaWithoutValue`。
  - 日期儲存格依 §5.3 轉成字串（`YYYY-MM-DD` 或含時差的 ISO 8601），JSON 中一律是字串。
- JSON／YAML：最上層是物件陣列，或只有一個陣列屬性的物件（例：`{ "users": [...] }`）；其他形狀回 `422 DATA_TRANSFER_FILE_UNREADABLE`。
  - 標頭是所有物件的鍵（依第一次出現的順序），標頭對應與 CSV 相同（所以匯出的 JSON 直接以 `key` 對上）。
  - 值轉成儲存格文字：陣列以 `;` 串接（多值欄）、`null` 是空白、數字與布林轉成字串、物件是 JSON；之後的驗證與 CSV 完全相同。
  - 列號是陣列中的第幾筆（1 起）。要清空修改模式的欄位，值寫字串 `"\\N"`（`null` 是「不變更」）。
  - YAML 以 `yaml` 套件的 1.2 core schema 解析（`2026-10-08` 仍是字串，不會變成 Date），別名展開上限 100（防 billion laughs）。
- 格式依副檔名判斷：`.csv`／`.tsv`／`.txt`、`.xlsx`、`.json`、`.yaml`／`.yml`（`importFormatOf`）。
- 空白列（所有儲存格都是空的）略過，不佔列號。
- 第一個非空白列是標頭。
- 之後要加新格式（例：ODS），只要加一個讀檔器輸出同樣的二維字串陣列，其餘流程不變。

**標頭對應**

1. 請求帶了 `mapping` 就照它；否則依序比對 `key`、任一語系的 `label`、`aliases`，比對前正規化（去空白、小寫、全形轉半形）。
   - 檔案的語言因此 **與介面語言無關**。參考實作只認介面語言的標頭，中文介面做的檔案在英文介面匯入時整欄對不上。
2. 已知但唯讀的欄位（§5.2）、操作者沒有權限的欄位，標為「忽略」並在回應中說明原因。
   - 例：沒有 `user:assignRole` 時，角色欄會被忽略並註明原因。
3. 對應完成的條件：
   - 新增模式：所有 `requiredOnCreate` 的欄位都有對應。
   - 修改模式：至少一個比對鍵，加上至少一個可修改的欄位。
4. 對應不完整，或有不認得的標頭時，回 `needsMapping`，附上標頭、自動對應的建議、前 5 列樣本。
   - 不認得的標頭不會默默忽略，至少要在對應步驟按一次「忽略」。

**超過上限**

- 超過列數上限（§10）時 **不截斷**：回 `422 DATA_TRANSFER_TOO_MANY_ROWS { max }`，訊息請使用者分成多個檔案。匯入前 N 列會讓人以為全部都匯入了。

**驗證**

轉成 JSON 後，在同一個請求內對全部列跑一次驗證（與 `validate` 端點是同一個驗證器，§7.4），回應就帶著每一列的問題，前端不必再呼叫一次。

**回應**

```ts
type ImportAnalysis =
  | {
      status: 'needsMapping';
      headers: readonly { index: number; text: string; suggestion: string | null }[];
      samples: readonly (readonly string[])[];          // 前 5 列
      sheets?: readonly string[];
    }
  | {
      status: 'ok';
      fileName: string;
      columns: readonly ImportColumnView[];             // 這次要顯示的欄位（依請求的語系），含唯一欄與比對鍵的標記
      ignored: readonly { header: string; reason: 'readOnly' | 'forbidden' | 'unmapped' }[];
      rows: readonly ImportRow[];
      results: readonly RowValidation[];                // 與 rows 一一對應
      sheets?: readonly string[];
    };

interface ImportRow {
  rowNo: number;                                        // 1 起
  sourceRow: number | null;                             // 檔案中的實際列號
  cells: Readonly<Record<string, string>>;             // columnKey → 原始字串（空白儲存格是 ''）
}

interface RowValidation {
  rowNo: number;
  issues: readonly RowIssue[];                          // { column | null, code, params?, severity }
  target?: {                                            // 修改模式：比對到的紀錄
    id: string;
    label: string;
    version: number;
    current: Readonly<Record<string, string>>;          // 檔案中有的欄位，目前值的「原始字串」表示（與 cells 同一種格式，方便比較）
    expected?: Readonly<Record<string, unknown>>;       // 關聯欄的樂觀鎖輸入（例：roleIds），套用時原樣送回
  };
  changed?: readonly string[];                          // 修改模式：與 current 不同的欄位
}
```

- JSON 中的值 **一律是原始字串**（`cells`），不是轉換後的值。前端只顯示與編輯字串，型別轉換與驗證都在後端；這樣前後端不會對「`是` 算不算 true」有兩種看法。
- 回應以 gzip 壓縮（5 000 列 × 15 欄的 JSON 約 1～3 MB，壓縮後約十分之一）。

### 7.4 驗證與 Importer

**`POST /data-transfers/importers/:type/validate`**

- 請求：`{ mode, rows: [{ rowNo, cells }] }`，最多 1 000 列；權限同 `analyze`。
- 回應：`{ rows: RowValidation[] }`。
- 前端在使用者改完儲存格（Enter、離開儲存格、貼上、套用建議）後，把 **被改的列** 送來重新驗證。連續的修改在 300 ms 內合併成一個請求。
- 無狀態：不寫資料、不保存，重送沒有副作用。

**驗證的內容與分工**

| 檢查 | 在哪裡 | 說明 |
| --- | --- | --- |
| 型別轉換（§5.3）、欄位 `schema` | 後端 | 失敗寫成 `{ column, code, params, severity: 'error' }`；Zod 的 issue 依代碼對應成 `tooShort { min }`、`tooLong { max }`、`invalidFormat { format: 'email' }`…（§9.5） |
| `enum`、`reference` 對應 | 後端 | 完全相符才算對上，**不自動更正**（§13 D7）；附上最接近的候選 `params.suggestion`（編輯距離） |
| 與資料庫重複（新增模式） | 後端 | 唯一欄以 `WHERE lower(email) = ANY($1)` 一次查完，命中的列標 `alreadyExists` |
| 比對目標（修改模式，§7.5） | 後端 | 回傳 `target` 與 `changed` |
| 資源特有的規則 | 後端 | `importer.validateRows`：例如角色是否可指派 → `roleNotAssignable { names }`；修改自己的狀態 → `selfModify` |
| **檔案內重複** | **前端** | 依 `columns` 的唯一欄標記，在整份 JSON 上計算（正規化後比對），每一列都標 `duplicateInFile { rows: [3, 17] }` |
| **同一個目標出現多次**（修改模式） | **前端** | 依各列 `target.id` 計算，標 `duplicateTarget { rows }` |

- 檔案內重複由前端計算，是因為 `validate` 只收到被改的那幾列，看不到整份資料。這兩條規則很單純（字串正規化後比對），規則本身由後端的欄位定義（`unique`、`matchKey`）決定，不會分歧。
- 套用工作會在伺服器端把這兩條也重算一次（§7.6），前端的計算只用於即時顯示。

**Importer 介面**

```ts
interface TransferImporter<TCreate, TPatch> {
  modes: {
    create?: { permissions: readonly PermissionKey[] };       // user:create
    update?: { permissions: readonly PermissionKey[] };       // user:update
  };
  /** 唯一欄：檔案內重複（前端與套用時）與資料庫重複（新增模式）的檢查 */
  uniqueColumns?: readonly string[];
  findExisting?(column: string, values: readonly string[], ctx): Promise<Map<string, { id: string; label: string }>>;
  /** 修改模式：依比對鍵找目標，回傳目前的值（只含要匯入的欄位）、version 與關聯欄的樂觀鎖輸入 */
  resolveTargets?(keys: readonly MatchKeys[], ctx): Promise<readonly MatchResult[]>;
  /** 修改模式：手動指定的目標（以 id 找）與比對目標的下拉選單；兩個都有才能手動指定（§7.5） */
  findTargetsById?(ids: readonly string[], ctx): Promise<Map<string, MatchResult>>;
  searchTargets?(keyword: string, ctx): Promise<readonly { id: string; label: string; description?: string }[]>;
  /** 資源特有的跨欄、跨列檢查；只回傳 issue，不寫資料 */
  validateRows?(rows: readonly ResolvedRow[], ctx): Promise<readonly RowIssue[]>;
  /** 範本：新增模式的範例列、修改模式抽樣的現有紀錄（最多 10 筆，以操作者的權限） */
  sampleRecords?(ctx, limit: number): Promise<readonly Record<string, unknown>[]>;

  /** 套用一列。必須使用傳入的 tx，而且走與 API 相同的業務規則 */
  create?(values: TCreate, ctx: ApplyContext, tx: Transaction): Promise<ApplyResult>;
  update?(target: ApplyTarget, patch: TPatch, ctx: ApplyContext, tx: Transaction): Promise<ApplyResult>;
}

interface ApplyResult {
  id: string;                                   // 結果報告連到這筆紀錄（新增模式也有）
  changes?: Readonly<Record<string, readonly [unknown, unknown]>>;   // 修改模式：實際寫入的原值與新值
  /** 交易提交後的副作用；由框架合併後執行（§7.6） */
  after?: readonly AfterCommitEffect[];
}
type AfterCommitEffect =
  | { kind: 'permissionsChanged' }                          // 多列只做一次
  | { kind: 'resourceChanged'; change: ResourceChangeWire } // 合併後分批推播
  | { kind: 'custom'; key: string; run: () => Promise<void> };  // 同一個 key 只跑一次
```

**對既有 service 的要求**：

- `create`／`update` 必須 **使用傳入的交易**，這樣「業務寫入」與「這一列的結果」在同一個交易提交（§7.6）。
- `UserService.create` 原本自己開交易，交易後再做 `permissionsChanged`、推播；現在拆成兩層：
  - 交易內的 `createInTx(dto, actor, tx): { user, after }`；
  - API 用的 `create()` 是「開交易 → `createInTx` → 交易後 `runAfterCommit(after)`」。
- 業務規則（email 重複、反提權、角色存在、最後一位 super-admin）只在 `createInTx` 裡寫一次，API 與匯入共用。
- `updateInTx`、`replaceRolesInTx` 照同樣方式。匯入把 `after` 轉成可合併的副作用（`user.transfer.ts` 的 `toEffects`）。

### 7.5 修改模式

**比對**

- 比對鍵依 `matchKey` 的順序。使用者是 `id`（1）、`email`（2）。
  - 有 `id` 而且有填 → 只用 `id` 比對；找不到是錯誤 `targetNotFound`，**不改用 email 重試**。避免 id 寫錯時默默改到另一筆。
  - 沒有 `id` 欄或沒填 → 用 `email`，不分大小寫。
  - 名稱類的鍵（例：角色名稱）可能命中多筆 → `ambiguousMatch`。
- 比對以操作者的權限查：看不到的紀錄等同不存在。
- 同一個目標出現在多列 → 每一列都是錯誤 `duplicateTarget { rows }`（前端計算，套用時重算）。
  - 參考實作只給「最後一列為準」的警告；但兩列各改一半時結果難以預期，所以改成錯誤。
- 使用者改了某列的比對鍵 → 那一列送 `validate`，重新比對。

**手動指定比對目標**

自動比對的結果不一定是使用者要的（Email 打錯、同名、要把資料改到另一筆）。預覽的「比對目標」欄是下拉選單：

| 選擇 | 送出的 `targetId` | 結果 |
| --- | --- | --- |
| 自動比對（預設） | 不帶 | 依比對鍵找（上面的規則） |
| 搜尋並選一筆紀錄 | 紀錄的 id | 以 id 找這筆（`importer.findTargetsById`，以操作者的權限）；**比對鍵不再用來找目標**，也仍然不會被修改。找不到 → `targetNotFound` |
| 撤回比對 | `null` | 錯誤 `targetNotSelected`：這一列不會套用，直到重新選擇或改回自動比對（勾選「略過有錯誤的列」時略過） |

- 下拉選單的搜尋：`GET /data-transfers/importers/:type/targets?keyword=`（修改模式的權限；回傳 `{ id, label, description }`，使用者是 Email 與顯示名稱）。
  資源沒有實作 `searchTargets`／`findTargetsById` 時不能手動指定，前端的比對目標欄是唯讀。
- `validate` 與送出套用的列都帶 `targetId`；套用列存 `target_manual`（`target_id` 是 null 就是撤回）。
  工作重新驗證時照用這個選擇，**不會改用比對鍵自動比對**——撤回的列即使 Email 對得上現有的紀錄也不會被修改。
- 選擇是一次編輯：可以復原、重做，也存進草稿。

**目前值與 version**

- 比對成功時，回應帶目標的 `version`，以及 **檔案中有的欄位** 目前的值（`target.current`）。前端把它存在該列。
- 預覽顯示「原值 → 新值」靠它（參考實作在送出前看不到差異）。
- 套用時前端把 `target.id`、`target.version`、`target.expected` 原樣送回；工作以這個 `version` 更新（[`backend/03-api-conventions.md`](03-api-conventions.md) §11）：
  - 預覽之後別人改過的紀錄 → 該列失敗 `USER_VERSION_CONFLICT`，**不會蓋掉別人的修改**。
  - 前端送來的 `target` 只是「樂觀鎖的輸入」，不是授權：工作仍以建立者的權限重新查詢這筆紀錄，看不到就失敗。竄改 `version` 只會讓自己的那一列衝突。
- 預覽放了很久的話，可以按「重新比對」：前端把所有列分批送 `validate`（每批 1 000 列），換成最新的目前值與 version，已編輯的內容保留。

**欄位與值**

- 只有檔案中有的欄位會修改；不在檔案中的欄位 **不出現在預覽，也不會被修改**。
  - 參考實作另外有「要修改哪些欄位」的開關，這裡由檔案本身決定，少一個概念。
- 空白儲存格 → 不變更；`\N` → 清空（只有 `nullable` 的欄位，其他欄位填 `\N` 是錯誤 `notNullable`）。
  - 預覽表格中，`\N` 顯示成「清空」標籤。
  - 使用者也可以在儲存格選單選「清空這個值」，不必記符號。
- 值與目前值相同 → 不送出。整列都沒有變更 → 警告 `noChanges`，套用時略過（`outcome = skipped`），不算失敗。
- 多值欄位（角色）是 **整組取代**：
  - 檔案寫 `編輯者;檢視者` 就是讓他剛好擁有這兩個角色。
  - 預覽顯示新增與移除的角色（`+編輯者 −管理員`）。
  - 套用時以 `target.expected.roleIds`（比對當下的角色集合）當 `expectedRoleIds`，沿用 `PUT /users/:id/roles` 的衝突檢查。
  - 參考實作的修改模式不支援多值欄位。
- 狀態欄依 `transitions` 檢查：使用者只能 `active ⇄ inactive`；`pending`、`locked` 不能由匯入改變 → `transitionNotAllowed { from, to }`。
  - 預覽的下拉選單只列可以轉移到的狀態。

**不支援刪除**

- 匯入只有新增、修改兩種模式，檔案裡沒有任何寫法能刪除紀錄。
  - 要停用帳號，就把狀態改成 `inactive`。
  - 要刪除，回列表用批次刪除（前端批次佇列，有逐筆確認與回收桶）。
- 預覽表格的「移除列」只是把這一列 **從前端的 JSON 中拿掉**，不影響任何資料。按鈕文字是「從匯入中移除」，避免誤解。

### 7.6 套用：`POST /data-transfers/imports` 與 `dataTransfer.applyImport`

```http
POST /data-transfers/imports
{
  "type": "user",
  "mode": "update",
  "fileName": "users-20261008-1430.csv",
  "skipInvalid": false,
  "rows": [
    { "rowNo": 1, "sourceRow": 2, "cells": { "id": "…", "displayName": "王小明", "status": "停用" },
      "target": { "id": "…", "version": 4 } },
    …
  ]
}
→ 202 { "data": DataTransfer }
```

**請求當下（同步）**

- 檢查：該模式的權限、列數上限、進行中的傳輸上限（§10）、每列的 `cells` 只含這次的欄位。
- 在一個交易內建立 `data_transfers`（`status = queued`）並一次寫入全部 `data_transfer_rows`（`raw` ＝ `cells`、`target_id`、`target_version`），同一個交易入列 `dataTransfer.applyImport`。
- **不在請求中驗證**：5 000 列的完整驗證要數秒，交給工作做。前端送出前已經驗證過，大部分情況工作會得到相同的結果。

**工作**

| 工作設定 | 值 |
| --- | --- |
| `concurrency` | 1（每程序）；同一個傳輸由 `exclusive` 保證不會同時跑兩份 |
| `retryLimit` | 5；`expireInSeconds` 3600 |
| 工作資料 | `{ transferId }`（JSON 列在資料表，不放進工作資料） |

1. `queued` → `applying`（條件式更新；沒命中表示已取消）。
2. **重新驗證全部列**：與 `analyze`／`validate` 同一個驗證器，加上檔案內重複與同一個目標多次的檢查。
   - 前端送來的是客戶端資料，不信任它的驗證結果。
   - 有錯誤的列：`skipInvalid` 時 `outcome = skipped`；否則 `outcome = failed`，`outcome_error = { code: 'VALIDATION_FAILED', issues }`。
     正常操作下前端不會送出有錯誤的列；會走到這裡的，是預覽之後資料庫變了（例：別人剛建了同一個 email）。
   - 修改模式沒有變更的列：`outcome = skipped`。
   - 重試時，已經有 outcome 的列不再驗證。
3. 依 `row_no` 順序處理 `outcome = pending` 的列，每列：
   1. 開交易。
   2. 呼叫 `importer.create`／`update`（傳入 tx）。
   3. 在 **同一個交易** 把該列的 `outcome` 改成 `succeeded`，寫入 `result_id` 與 `changes`。
   4. 提交。
   5. 失敗時回滾，另開一個小交易寫 `outcome = failed` 與錯誤：
      - `AppException` 的代碼與 details，例：`USER_EMAIL_DUPLICATE`、`USER_VERSION_CONFLICT`、`AUTHZ_ESCALATION`；
      - 其他例外記成 `INTERNAL_ERROR`，細節只進日誌。

這個做法的效果：

- **可重試而且恰好一次**：工作中斷或程序重啟後重跑，只會處理還是 `pending` 的列。成功的列不會建兩次，因為「建了」和「記下建了」是同一個交易。
- **一列是原子的**：使用者與角色指派在同一個交易。參考實作的「實體建好但關聯失敗、回報失敗、重匯後重複」不會發生。
- **業務稽核照常**：每列由 service 寫自己的稽核（`user.create`）。
  - 工作以建立者的身分執行（以 `created_by` 重建 `AuthUser`，放進 request context），稽核的 actor 是建立者，不是 `system`。
  - metadata 加上 `{ via: 'import', transferId }`（§13 D20）。
- 啟用信照常在交易內入列（`auth.activationMail`），由寄信工作的並行上限（5）自然限速（§13 D13）。

**交易後的副作用要合併**

- 每列各做一次 `permissionsChanged()`（整個租戶失效並廣播），5 000 列就是 5 000 次全租戶失效。
- 框架收集每列 `after` 的副作用，每 **100 列或每 2 秒** 執行一次：
  - `permissionsChanged` 只做一次；
  - `resourceChanged` 合併成每 100 筆一則推播（`MAX_CHANGES_PER_EVENT`）；
  - `custom` 依 `key` 去重。
- 工作結束時再做最後一次。

**其他**

- 取消：每列開始前檢查取消旗標。取消後未處理的列 `outcome = cancelled`。
- 權限中途被拿掉：每 100 列重新檢查一次。失敗時未處理的列 `outcome = failed`（`AUTHZ_FORBIDDEN`），傳輸照常 `completed` 並在報告中說明。
- 完成：
  - 在一個交易內：`status = completed`、各計數、稽核 `dataTransfer.import`（類型、模式、成功／失敗／略過筆數）、`notify()` 建立者。
  - 交易後推播。
- 送出成功後，前端刪除這次的 IndexedDB 草稿，頁面切到進度與結果（網址帶 `transfer=<id>`）。

### 7.7 結果與「以失敗的列重新匯入」

- 結果報告列出每一列的 outcome（`GET /data-transfers/:id/rows`）：
  - 失敗的排前面，附錯誤訊息（`error.<CODE>` 或問題代碼的翻譯）。
  - 成功的連到紀錄詳情：新增模式也有 `result_id`。參考實作新增模式拿不到新紀錄的 id，報告無法連結。
  - 修改模式顯示實際寫入的「原值 → 新值」（`changes`）。
- 「下載結果報告」：`GET /data-transfers/:id/report?format=csv|xlsx&rows=all|failed`，由 api 直接串流回應。
  - 欄位是原本的欄位，加上「列號」「結果」「錯誤」。
  - 格式與範本相同，所以修正後可以直接重新上傳。
- 「以失敗的列重新匯入」：完全在前端完成，不需要額外的端點。
  1. 以 `GET /data-transfers/:id/rows?outcome=failed` 取回失敗列的原始 `cells`。
  2. 開啟同一個資源、同一個模式的匯入頁，以這些列建立新的預覽 JSON（`sourceRow` 保留）。
  3. 全部送 `validate`（每批 1 000 列）：重新比對、重新驗證。
  4. 使用者修正後照常套用，成為一個新的傳輸。原本的傳輸不變。

### 7.8 同一份檔案內的引用

新增模式中，參照欄有時要指向 **同一份檔案裡另一列** 要新增的紀錄：部門的「上層」常常是檔案裡剛定義的部門（D40）。

- 登記：`reference.sameFile = { column }`，`column` 是被引用的欄（要是唯一欄，例：部門的「代碼」）；只能用在單一值的欄位。登記時檢查，寫錯就啟動失敗。
- 驗證：參照的值對不上資料庫、但等於檔案裡另一列 `column` 欄的值時，不是 `referenceNotFound`，而是先放一個佔位值（`SameFileRef`）。
  - `analyze` 與套用工作手上就是整份檔案；預覽的 `validate` 只送改過的列，所以前端另外帶 `fileKeys`：這批列引用到、而且檔案裡有的值（只帶引用到的，請求不會隨檔案變大）。
  - 引用形成循環（含引用自己）的列：`referenceCycle`。
  - 欄位清單的 `sameFile` 告訴前端哪一欄可以同檔引用；前端在被引用的欄改了值、或那一列新增或移除時，讓引用舊值或新值的列重新驗證。
- 套用：依相依關係排序（拓撲排序，沒有相依的列維持列號順序），被引用的列先套用；佔位值換成那一列建立出來的 id。
  被引用的列沒有成功（驗證失敗被略過、套用失敗）時，引用它的列 `failed`（`referenceFailed`）。
- 只在新增模式：修改模式的上層一定是已經存在的紀錄。

---

## 8. 前端

畫面與元件（`@b2b-system/ui/DataGrid`、web-core 的 `data-transfer`／`data-import`、backstage 的「我的匯入匯出」與匯入頁）見
[`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md)。後端與前端之間的約定只有兩個：

- 欄位名稱、選項、說明都由 `GET /data-transfers/importers/:type` 依請求的語系（`Accept-Language`）回傳，前端不為每個資源寫欄位定義。
- 預覽中的 JSON 一律是原始字串（D24）；問題以「代碼＋參數」回傳，前端翻譯（§9.5）。

## 9. 權限、稽核、通知、推播、指標

### 9.1 權限

| 權限鍵 | 說明 | 預設角色 |
| --- | --- | --- |
| `user:export` | 匯出使用者 | admin |
| `auditLog:export` | 匯出稽核日誌 | admin、auditor |
| `role:export` | 匯出角色 | admin |
| `group:export` | 匯出群組與群組成員（依賴 `user:read`：成員帶 email） | admin |
| `orgUnit:export` | 匯出部門與部門成員（依賴 `user:read`） | admin |
| `tag:export` | 匯出標籤定義（仍要進得了該標籤組） | admin |
| `approval:export` | 匯出審批請求與決定 | admin、auditor |
| `serviceAccount:export` | 匯出服務帳號 | admin |

- 匯出要 **獨立的權限**（§13 D11）：能在畫面上逐頁看，不代表可以整批帶走。
  - `PERMISSION_DEPENDENCIES`：`'user:export': { includes: ['user:read'] }`、`'auditLog:export': { includes: ['auditLog:read'] }`。
  - 依 G2，同一個資源內的包含是允許的。
- 匯入 **不新增權限**：
  - 新增模式要 `user:create`，修改模式要 `user:update`（`user:create` 已包含 `user:update`）。
  - 角色欄另外要 `user:assignRole`，並照常做反提權檢查。
- 欄位層級：
  - 匯出、範本、預覽中的角色欄要 `role:read`；
  - 匯入角色欄要 `user:assignRole`；
  - 沒有權限時該欄不出現，或被標為「忽略」（§7.3）。
- 「我的匯入匯出」與 `/data-transfers` 的傳輸操作只要登入（`@Authenticated()`），**只能操作自己建立的**。
  - 別人的傳輸一律 `404 DATA_TRANSFER_NOT_FOUND`，與通知相同，不洩漏存在與否。
  - 依資源而定的權限在 service 內以 `permissionService.assertHasAll` 檢查。它會寫 `authz.denied` 稽核，與路由宣告的 `@RequirePermissions` 效果相同。
- 匯入頁的頁面權限：`USER_IMPORT_PAGE` 要 `user:read` 與 `user:update`；頁內依權限決定可以切換哪些模式。其他資源的匯入頁見 §12。
- 第二批（§12）的六個匯出權限由租戶 migration `0049_data_transfer_resources` 補給既有租戶的系統角色。
- 同步：
  - `docs/architecture/iam/02-permission-catalog.md`；
  - `db/seeds/permissions.ts`（排在 user、auditLog 區塊的空號：107、401）；
  - 給系統角色的 migration（`INSERT INTO relation_tuples … ON CONFLICT DO NOTHING`）；
  - 前端兩個語系檔的 `permission.user.export`、`permission.auditLog.export`。

### 9.2 稽核

| action | 寫入時機 | metadata |
| --- | --- | --- |
| `dataTransfer.export` | 匯出完成 | `type`、`format`、`scope.kind`、篩選條件（只記鍵與值，不記 id 清單；勾選時記筆數）、`rows`、`columns` |
| `dataTransfer.download` | 每次取得下載連結 | `type`、`format`、`rows` |
| `dataTransfer.import` | 套用完成 | `type`、`mode`、`total`、`succeeded`、`failed`、`skipped`、`fileName` |
| `dataTransfer.cancel` | 取消 | `direction`、`type`、`status`（取消前的狀態） |
| 各資源自己的 action（`user.create`、`user.update`、`user.assignRole`） | 套用每一列 | 原本的 metadata，加上 `via: 'import'`、`transferId` |

- 失敗的套用列不寫業務稽核，因為交易回滾了。結果在 `data_transfer_rows` 與 `dataTransfer.import` 的計數裡。
- `resourceType` 是 `dataTransfer`，要加進稽核日誌頁的資源類型篩選。

### 9.3 通知

在 `modules/data-transfer/data-transfer.notifications.ts` 定義，類別 `dataTransfer`，管道只有站內（`inApp`）：

| 類型 | 時機 | 連結 |
| --- | --- | --- |
| `dataTransfer.exportFinished` | 匯出完成或失敗（`params.status`） | `dataTransfer.detail` |
| `dataTransfer.importFinished` | 套用完成或失敗 | `dataTransfer.detail` |

- `actorId` 傳 `null`（系統）。`notify()` 對「actor 就是收件人」不建立通知，而這裡的收件人一定是建立者本人。
- 使用者可以在個人通知設定關掉（[`backend/16-notification-event.md`](16-notification-event.md)）。
- 前端的句子：「{資源}匯出完成，共 N 筆」「{資源}匯入完成」＋成功／失敗／略過的筆數、失敗時附錯誤碼的訊息（[`../frontend/15-notification.md`](../frontend/15-notification.md) §5）。

### 9.4 推播

- 新的 `ChangeSource.dataTransfer`，在 `packages/realtime` 的物件與 `z.enum` 兩處都要加。
- 受眾規則 `perms: () => []`、`recordsAudit: false`，與 `notification` 相同。
- 以 `perRecipient` 只推給建立者。
- 進度推播每個傳輸 **最多每秒一次**。分析與預覽期間沒有推播（都是同步的請求）。
- 前端：`Resource.DATA_TRANSFER` 對應 `transfer(id)`、`transferRows(id)`、`transferList` 三組查詢鍵；`ServerChangeSource` 的編譯期檢查會提醒加上。

### 9.5 錯誤碼與問題代碼

**錯誤碼**（`packages/error-codes`，加上 web-core 的 `ERROR_MESSAGE_KEY` 與語系檔）：

| 代碼 | 狀態 | 時機 |
| --- | --- | --- |
| `DATA_TRANSFER_NOT_FOUND` | 404 | 不存在或不是自己的 |
| `DATA_TRANSFER_TYPE_UNSUPPORTED` | 400 | 未登記的資源類型，或該資源不支援這個方向或模式 |
| `DATA_TRANSFER_INVALID_STATE` | 409 | 狀態不允許這個操作（`details: { status }`） |
| `DATA_TRANSFER_VERSION_CONFLICT` | 409 | 傳輸的 `version` 不符（`details: { current }`） |
| `DATA_TRANSFER_FILE_TOO_LARGE` | 413 | 分析的檔案超過大小上限（`details: { maxBytes }`） |
| `DATA_TRANSFER_BUSY` | 503 | 分析的 worker thread 都在忙（帶 `Retry-After`） |
| `DATA_TRANSFER_MAPPING_INVALID` | 400 | `mapping` 對到不存在或不可匯入的欄位，或同一個欄位對了兩次 |
| `DATA_TRANSFER_TOO_MANY_ROWS` | 422 | 超過列數上限（`details: { max, count? }`） |
| `DATA_TRANSFER_FILE_UNREADABLE` | 422 | 格式錯誤、加密的 XLSX、沒有標頭、無法解碼 |
| `DATA_TRANSFER_EXPIRED` | 410 | 已過保留期限，匯出檔與套用列已清除 |
| `DATA_TRANSFER_LIMIT_EXCEEDED` | 429 | 同一個人進行中的傳輸超過上限（§10） |

**問題代碼**（`RowValidation.issues[].code`）不是錯誤碼，翻譯在 web-core 的 `dataTransfer.issue.<code>`：

- 型別與格式：`required`、`invalidNumber`、`invalidBoolean`、`invalidDate`、`invalidDateTime`、`invalidEnum`、`tooShort`、`tooLong`、`tooSmall`、`tooLarge`（數字欄）、`invalidFormat`、`tooManyValues`、`notNullable`、`formulaWithoutValue`
- 參照：`referenceNotFound`、`ambiguousReference`
- 唯一值：`duplicateInFile`、`alreadyExists`
- 修改模式的比對：`matchKeyRequired`、`targetNotFound`、`ambiguousMatch`、`duplicateTarget`、`targetNotSelected`（撤回比對）、`transitionNotAllowed`、`noChanges`（警告）
- 同檔引用（§7.8）：`referenceCycle`、`referenceFailed`
- 資源特有：`roleNotAssignable`、`selfModify`、`permissionNotGrantable`（角色：授予自己沒有的權限）、`immutable`（super-admin）、
  `superAdminForbidden`（群組持有 super-admin）、`exactlyOne`、`membershipCycle`、`escalation`（群組成員）、`primaryConflict`（部門成員）、`forbidden`（進不了標籤組）

問題以「代碼＋參數」存放，**翻譯只在顯示時做**：

- 切換語系後訊息跟著變。
- 參考實作把已翻譯的字串與 i18n key 混在同一個欄位，切換語系就留下舊語言的訊息。

### 9.6 指標

在 `core/metrics/instruments.ts` 加：

- `api_data_transfer_rows_total{direction, type, result}`：counter；`result` 是 `succeeded|failed|skipped`；`type` 是登記的資源類型，數量有限。
- `api_data_transfer_bytes_total{direction, format}`：counter。
- `api_data_transfer_parse_duration_seconds{format}`：histogram，分析時在 worker thread 解析檔案的秒數。

工作的耗時與成敗已由 `JobQueue` 依工作名稱記錄，不重複。標籤不帶租戶（[`08-monitoring.md`](../08-monitoring.md) §2.3）。

---

## 10. 上限與保留期限

| 項目 | 預設 | 設定方式 |
| --- | --- | --- |
| 匯入的列數 | 5 000 | 租戶 feature 參數 `dataTransfer.importMaxRows`（平台設定，100～20 000）。上限決定伺服器的負載，由平台控制，不讓租戶自己調高 |
| 匯入的檔案大小 | 10 MiB | 同上，`dataTransfer.importMaxSizeMb`（1～50）；`presignUpload` 簽入 `contentLength` |
| 匯出的列數 | 100 000 | 同上，`dataTransfer.exportMaxRows`（1 000～1 000 000） |
| 勾選範圍的 id 數 | 10 000 | 固定，與 `BATCH_SELECT_ALL_MAX` 一致 |
| 每人同時進行的傳輸 | 3 | 固定；指 `queued`、`running`、`applying` |
| 分析的並行 | 每程序 2 個 worker thread | env `DATA_TRANSFER_PARSE_WORKERS`（1～16）；排隊最多 5 秒，否則 `503 DATA_TRANSFER_BUSY` |
| `validate` 一次的列數 | 1 000 | 固定 |
| 匯出檔與套用列的保留 | 7 天 | 租戶系統設定 `dataTransfer.retentionDays`（1～30，新類別 `dataTransfer`）；從完成時起算 |
| 匯入的原始檔 | 不保存 | 只在分析請求期間存在於記憶體 |
| 預覽草稿（瀏覽器） | 24 小時 | 固定；套用、放棄、登出時清除（[`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md) §4） |
| 傳輸紀錄（摘要）的保留 | 90 天 | 固定；過期後連同紀錄刪除，稽核日誌另有保留 |
| 下載連結 | `FILE_URL_TTL`（≤ 1 小時） | 每次下載重新簽發 |

清理工作 `dataTransfer.cleanup`（env `DATA_TRANSFER_CLEANUP_CRON`，預設每天 05:25 UTC）：

- 每天執行，租戶範圍，`exclusive`。
- 到期的傳輸：刪除 `transfers/<id>/` 下的物件（匯出檔）、刪除套用列、`status = expired`。
- 摘要超過 90 天：刪除紀錄。
- 刪除物件失敗只記錄，下一輪再試。
- 超過一天還沒完成的分段上傳（工作在上傳途中被殺掉）放棄（`abortMultipartUpload`）。

**容量**

- 套用列在租戶 DB，5 000 列 × 每列約 1 KB，約 5 MB。7 天後清除。預覽期間伺服器端沒有任何資料。
- `transfers/` 的物件不計入 `file.storageQuotaMb`：與縮圖、變體一樣是系統產物，靠保留期限控制。

---

## 11. 程式碼地圖

| 位置（`apps/api/src/modules/data-transfer/`） | 內容 |
| --- | --- |
| `data-transfer.types.ts`、`data-transfer.definition.ts` | `TransferResource`、欄位、exporter、importer 的型別；`defineTransferResource()` |
| `data-transfer-registry.service.ts` | `DataTransferRegistry`：登記時檢查定義（欄位 key、enum／reference、修改模式要有比對鍵…），寫錯就啟動失敗；依租戶的 feature 過濾 |
| `data-transfer.values.ts` | 值的雙向格式（§5.3）：文字表示、XLSX 儲存格、SQL 字面量、解析與時區 |
| `data-transfer.columns.ts` | 欄位層級的權限：可讀、可匯入、唯讀、沒有權限 |
| `data-transfer.context.ts` | `TransferContext`（操作者、語系、時區、權限）；工作以建立者的身分執行（`runAs`，D20） |
| `data-transfer.service.ts` | 列表、詳情、取消、刪除、下載、資源清單、建立匯出、套用列 |
| `data-transfer.lifecycle.ts` | 保留期限、失敗、完成通知、推播 |
| `export/` | `CsvExportWriter`／`XlsxExportWriter`／`SqlExportWriter`、`MultipartSink`（每 8 MiB 一段）、`dataTransfer.export` |
| `import/sheet-reader.ts` | 讀檔器（編碼偵測、分隔字元、XLSX）；在 worker thread 執行，不 import 專案內的檔案 |
| `import/parse-pool.ts` | worker thread 池（`DATA_TRANSFER_PARSE_WORKERS`、排隊 5 秒） |
| `import/header-mapping.ts`、`import/import-validator.ts` | 標頭對應；驗證器（`analyze`、`validate`、套用工作共用） |
| `import/data-transfer-import.service.ts` | 欄位、範本、參照搜尋、分析、驗證、送出套用、結果報告 |
| `import/data-transfer-apply.service.ts` | `dataTransfer.applyImport`：重新驗證、逐列交易、交易後副作用的合併（D10） |
| `data-transfer-cleanup.service.ts` | `dataTransfer.cleanup` |
| `data-transfer.http.ts` | multipart（`ImportUploadInterceptor`）、套用路由的 JSON 上限（`registerDataTransferBodyParser`，`main.ts` 呼叫） |
| `resources/audit-log.transfer.ts` | 稽核日誌的匯出（D27） |
| `import/same-file.ts` | 同檔引用（§7.8）：佔位值、檔案裡可以被引用的值、相依排序與循環偵測 |

各資源的登記在擁有者模組（§12）：`user/user.transfer.ts`、`role/role.transfer.ts`、`group/group.transfer.ts`、`organization/org-unit.transfer.ts`、
`tag/tag.transfer.ts`、`approval/approval.transfer.ts`、`service-account/service-account.transfer.ts`。

加一種資源：在擁有者模組寫 `<name>.transfer.ts`（以 `UserTransferResource` 為範本），`onModuleInit` 登記；
需要套用的寫入要有交易內的版本（`createInTx` 這類，§7.4「對既有 service 的要求」）。前端只要在該資源的列表加入口、寫一個幾十行的匯入頁，並在 backstage 通知的 `DATA_TRANSFER_RESOURCE_LABEL_KEY`（`features/notification/constants.ts`）與兩個語系檔加上資源名稱（完成通知的句子用；沒補時顯示「資料」，[`../frontend/15-notification.md`](../frontend/15-notification.md) §5）。

## 12. 其他資源：角色、群組、組織、標籤、審批、服務帳號

第一批之後依同一個登記方式加上的資源。各資源的 importer 都走擁有者 service 的 **交易內版本**（`createInTx`、`updateInTx`…）：API 與匯入共用一份業務規則，
交易後的副作用（權限失效、推播）交給框架合併（D10）。檔案內的列互相引用見 §7.8。

| 資源（`type`） | 方向與模式 | 匯出權限 | 匯入權限 | feature |
| --- | --- | --- | --- | --- |
| `role` | 匯出；新增、修改 | `role:export` | `role:create`／`role:update`；權限欄另要 `role:grantPermission` | — |
| `group` | 匯出；新增、修改 | `group:export` | `group:create`／`group:update`；角色欄另要 `group:assignRole` | `group` |
| `groupMember` | 匯出；新增 | `group:export` | `group:update` | `group` |
| `orgUnit` | 匯出；新增、修改 | `orgUnit:export` | `orgUnit:create`／`orgUnit:update` | `organization` |
| `orgUnitMember` | 匯出；新增、修改 | `orgUnit:export` | `orgUnit:update` | `organization` |
| `tag` | 匯出；新增、修改 | `tag:export` | `tag:create`／`tag:update` | —（標籤組各自的 feature） |
| `approvalRequest`、`approvalDecision` | 只匯出 | `approval:export` | — | — |
| `serviceAccount` | 只匯出 | `serviceAccount:export` | — | `externalApi` |

### 12.1 角色

- 欄位：ID、代碼（slug）、名稱、說明、權限（權限鍵，多值）；只匯出的「系統角色」「直接持有的人數」「建立時間」。持有者不在這裡（使用者的「角色」欄、群組的「角色」欄）。
- 主要用途是把一個租戶調好的角色搬到另一個租戶：修改模式以 ID 或 **代碼** 比對（代碼跨租戶不變），新增模式可以指定代碼（D42）。
- 權限欄的選項是權限鍵本身（跨語系、跨租戶都一樣）；修改模式整組取代，以比對當下的權限鍵當 `expectedKeys`，預覽之後別人改過就 `ROLE_VERSION_CONFLICT`。
- 驗證：授予自己沒有的權限 → `permissionNotGrantable`（修改模式只看新增的鍵）；super-admin 不可修改 → `immutable`。自我鎖定在套用時由 `RoleService` 檢查。

### 12.2 群組與群組成員

- `group`：ID、名稱（修改模式沒有 ID 時的比對鍵）、說明、角色（整組取代，以 `expectedRoleIds` 防止覆蓋別人的修改）；只匯出的直接成員數。
  驗證：super-admin → `superAdminForbidden`（D12）；不能指派的角色 → `roleNotAssignable`；自己所屬的群組的角色 → `selfModify`。
- `groupMember`：一列一筆 **直接** 成員關係（群組 × 使用者或成員群組），只有新增模式（D41、D43）。
  - 「使用者」（Email）與「成員群組」擇一 → `required`、`exactlyOne`；把群組放進自己 → `membershipCycle`；更深的循環、巢狀層數在套用時由 `GroupService` 檢查。
  - 已是成員 → `alreadyExists`；把自己或自己所屬的群組放進去 → `selfModify`；加入後取得自己沒有的權限（D11）、或對象是 super-admin → `escalation`。
  - 匯出：全部、某個群組（`filter.groupId`），或勾選的群組的成員（勾選範圍是群組的 id）。

### 12.3 部門與部門成員

- `orgUnit`：ID、代碼（唯一、修改模式的比對鍵）、名稱、上層、說明；只匯出的路徑與成員數。
  - 上層以 **代碼** 引用，沒有代碼的部門以 **路徑**（`總部/業務部`）引用，也可以是 id；只有一個部門叫這個名字時名稱也可以。新增模式還可以引用檔案裡的其他列（§7.8）。
  - 匯出依組織樹排序（上層在前），上層寫代碼（沒有時寫路徑）：匯出的檔案直接匯到另一個租戶，上層都對得上。
  - 修改模式改了上層就搬移（排在新上層的最後），`\N` 搬到最上層；搬到自己或自己的下層之下 → `referenceCycle`。同一個上層之下撞名 → `alreadyExists`。
- `orgUnitMember`：一列一筆成員資格（部門 × 使用者）：主管、主要部門、職稱。
  - 新增模式加成員；修改模式以匯出檔裡的 ID（`部門 id:使用者 id`，成員關係沒有自己的 id）修改主管、主要部門、職稱。移除成員在組織頁做（D43）。
  - 不能改自己（D6）→ `selfModify`；已是成員 → `alreadyExists`；同一批裡同一個人有兩個主要部門 → `primaryConflict`。設為主要部門時原本的主要部門在同一個交易內取消。
  - 結果的紀錄 id 是成員本人（`result_id` 是 uuid；「查看紀錄」連到那個人）。

### 12.4 標籤

- ID、標籤組（每一列的欄位，選項是登記的標籤組）、名稱、顏色。唯一性是「組 × 名稱」，框架的唯一欄只看單一欄，所以在 `validateRows` 查（`alreadyExists`）。
- 標籤沒有讀取權限（[`18-tag.md`](18-tag.md) §7.2 D5：進得了標籤組就讀得到）：匯出與匯入都照樣以標籤組的 `assertCanBrowse` 檢查，進不了 → `forbidden`。
- 匯出一次一個標籤組（`filter.scope`，標籤管理頁目前的分頁）。標籤組的選項要在所有模組登記完標籤組之後才齊，所以這個資源在 `onApplicationBootstrap` 登記（D44）。

### 12.5 審批請求與決定（只匯出）

- `approvalRequest`：一筆請求一列（類型、狀態、申請人、理由、目前關卡、關卡數、定案者、意見、時間、結果資源、`payload`）。`private_payload` 一律不匯出。
- `approvalDecision`：一個決定一列：多階段的每一關每一人；單關的請求以請求上的審核者表示（「方式」是「單關審核」，沒有關卡序）。勾選的範圍是請求。
- 兩者都要 `approval:export`，它包含 `approval:read`：看得到全部的請求，不套用申請人與候選人的可見性（[`20-approval.md`](20-approval.md) §9.10、D45）。

### 12.6 服務帳號（只匯出）

- 名稱、狀態、角色、有效的 token 數、建立時間；token 本身（含前綴）不匯出。
- 不提供匯入：建立之後要另外簽發 token（只顯示一次），整批建立沒有意義（D47）。

## 13. 設計決策：匯入／匯出

### 13.1 背景

既有的匯入能力只有前端批次佇列，它是為「勾選幾百筆做同一個動作」設計的。參考實作（另一個專案已上線的前端批次匯入）把同樣的模式延伸到匯入：
在瀏覽器解析與驗證，逐列呼叫單筆 API，以跨分頁的 SharedWorker 協調執行權。那份實作上線後累積了十幾個問題（「評估過的方案」逐條引用）。

這份設計的主軸：**解析、驗證、套用都在伺服器端，預覽與編輯在前端**。後端把各種格式統一轉成 JSON，前端持有 JSON 編輯、把改過的列交給後端驗證；送出後才成為可重試、可取消的伺服器端工作（D21）。

### 13.2 決定

| # | 決定 | 理由與代價 |
| --- | --- | --- |
| D1 | ~~匯入在 **伺服器端** 解析、驗證、暫存（`data_transfer_rows`），預覽與修改都對暫存列操作；套用由背景工作執行~~ **已改為 D21**（2026-10-08）：解析與驗證仍在伺服器端，但預覽期間的資料改由前端持有，伺服器不暫存 | 驗證只有一份（API 的 DTO＋service）；不必把目錄抓到瀏覽器；上限可以從 500 拉到 5 000 以上 |
| D2 | 匯出 **一律** 是背景工作，不分大小；前端在對話框等待並自動下載 | 只有一條路徑：權限、稽核、上限、檔案格式只寫一次。幾百筆的匯出幾秒內完成，體感接近同步。代價：小匯出也多一次入列（約百毫秒） |
| D3 | 匯出範圍是 `ids`（勾選）或 `filter`（目前的篩選）；「選取全部符合」送 `filter` | 不必為了匯出先把上萬筆 id 抓回瀏覽器。兩者都以操作者 **當下** 的權限重新查詢 |
| D4 | 每個資源一份 `TransferResource` 欄位定義，匯出與匯入共用；欄位有穩定的 `key` | 匯出檔可以直接修改後匯回（含 `id`）；唯讀欄位明確標示；欄位改名不會讓舊檔失效 |
| D5 | 標頭以 `key`／任一語系的 `label`／`aliases` 比對；對不上才進入對應步驟 | 檔案的語言與介面語言無關；不認得的欄位一定要使用者看過一次 |
| D6 | CSV 自寫；XLSX 用 `exceljs`（串流讀寫）；CSV 解析用 `csv-parse`；SQL 自寫；`ObjectStorage` 新增伺服器端的 `uploadPart` 供串流寫檔 | CSV 寫入只是加引號與跳脫；`exceljs` 是同時支援串流讀寫的主流 MIT 套件。現在的 `putObject` 只收 Buffer，伺服器端分段上傳讓大檔不必整份放在記憶體 |
| D7 | `enum`、`reference` **完全相符** 才算對上，不自動更正；附建議值與「全部套用」 | 參考實作以拼音與編輯距離自動更正，只用琥珀色提示，使用者常沒注意到資料被改了。角色這類參照若被模糊比對指錯，就是權限錯誤 |
| D8 | 修改模式：比對鍵依序（`id` 有填就只用 `id`）；檔案中有的欄位才修改；空白＝不變更、`\N`＝清空；多值欄整組取代；以快照的 `version` 套用 | 規則都可以從檔案本身看出來，不必另外設定「要修改哪些欄位」。`version` 讓「預覽後別人改過」逐列失敗，不會覆寫 |
| D9 | 套用時每列一個交易，該列的 `outcome` 在 **同一個交易** 寫入 | 工作重試時恰好一次；一列內的多個寫入（使用者＋角色）是原子的 |
| D10 | 交易後的副作用由框架合併，每 100 列或 2 秒執行一次 | 避免每列一次全租戶權限失效與推播 |
| D11 | 匯出要獨立的 `<resource>:export`；匯入沿用 `create`／`update` | 整批帶走資料的風險高於逐頁閱讀；匯入的每一列本來就經過 create／update 的檢查 |
| D12 | 匯出檔與套用列保留 7 天（租戶可調 1～30）；下載連結每次重新簽發，下載當下重新檢查權限 | 連結外流的時效最多 1 小時；離職或被拿掉權限的人不能再下載 |
| D13 | 匯入建立的使用者一律寄啟用信 | 狀態是 `pending` 的帳號沒有啟用信就無法使用。寄信工作的並行上限 5 與重試已經是限速 |
| D14 | 預覽表格以 `react-data-grid` 包成 `@b2b-system/ui/DataGrid`，只有編輯中的儲存格掛輸入元件 | 需要雙向虛擬捲動、鍵盤移動、範圍複製貼上，自己做的成本高。包一層 ui 的 API，之後可以換實作 |
| D15 | 匯入不支援刪除；預覽中的「從匯入中移除」只影響前端的 JSON | 刪除需要逐筆確認與回收桶，已經由列表的批次刪除提供。檔案中的一列被誤刪，後果遠比被誤改嚴重 |
| D16 | CSV 匯出對字串欄前置 `'` 防公式注入，匯入字串欄時去掉；XLSX 以字串儲存格寫出，不加前置 | 防注入與來回不變形兩者都要 |
| D17 | 新增租戶 feature `dataTransfer`（預設啟用），上限是它的 feature 參數 | 平台可以對特定租戶關閉或調整上限；與 `job`、`file` 的做法一致 |
| D18 | 本框架是「非同步的傳輸資源」，不是 [`backend/03-api-conventions.md`](03-api-conventions.md) §10 禁止的批次端點；§10 歸檔時補一句例外 | §10 禁止的是「同步一次改多筆」的 CRUD 端點。這裡每列仍走單筆的 service 與稽核，執行是可觀察、可取消的背景工作 |
| D19 | 失敗的列以「重新匯入」帶回匯入頁的預覽（取回原始 `cells` 後重新驗證），修正後成為新的傳輸，不必下載後重新上傳 | 失敗多半是 version 衝突或唯一值，修正後就能送出 |
| D20 | 背景工作以建立者的身分執行：以 `created_by` 重建 `AuthUser` 放進 request context；業務稽核的 actor 是建立者，metadata 標記 `via: 'import'` | 稽核要能回答「是誰匯入的」，而不是 `system` |
| D21 | 匯入分三段：後端 **分析**（各種格式 → 標準化的 JSON＋驗證結果）→ 前端 **持有 JSON** 預覽與修改（改過的列送無狀態的 `validate`）→ 送出套用時才寫入伺服器，工作 **重新驗證全部列** 後套用。取代 D1 的伺服器端暫存 | 格式的差異只存在於後端的讀檔器，前端只認一種 JSON，之後加格式不動前端；編輯是本機操作、沒有往返延遲；伺服器在預覽期間零狀態，沒有暫存列的清理、併發修改（`revision`）與保留期限問題。代價：預覽只在這個瀏覽器（以 IndexedDB 草稿補重新整理）；JSON 是客戶端資料，套用時必須重新驗證 |
| D22 | `analyze` 以 multipart 直接上傳給 api、同步回應；檔案只在記憶體；解析放在 worker thread 池 | 上限是 10 MiB／5 000 列，同步回應數秒內完成，省掉「上傳到 bucket → 入列 → 推播 → 取回」的往返與原始檔的清理。這是 api 第一個 multipart 端點，例外於「上傳一律瀏覽器直傳 bucket」的慣例；CPU 密集的解析不能放在主執行緒，否則同一個程序的所有請求都會被卡住 |
| D23 | 檔案內重複、同一個目標多次，由前端在整份 JSON 上計算；套用工作再算一次 | `validate` 只收到被改的列，看不到整份資料；這兩條規則只是正規化後的字串比對，規則的依據（唯一欄、比對鍵）來自後端的欄位定義 |
| D24 | 預覽中的 JSON 只是 **原始字串**（`cells`），型別轉換的結果不回傳給前端 | 前後端不會對「`是` 算不算 true」「`2026/1/2` 是哪一天」各有一套判斷；前端只顯示與編輯字串 |

| D25 | **套用路由不在請求當下驗證**，所以不提供原本規劃的 `DATA_TRANSFER_HAS_INVALID_ROWS`：有錯誤又沒勾選略過時，由前端擋下送出；竄改過的請求在工作的重新驗證時逐列失敗 | 「有沒有錯誤」要跑完整驗證才知道（數秒），而且工作本來就一定重新驗證；同一件事不在兩個地方判斷 |
| D26 | **`dataTransfer.applyImport` 不設 `exclusive`** | `exclusive` 以租戶為 singleton key：同一個租戶第三個排隊的套用會被 pg-boss 丟掉。同一個傳輸只會有一個工作，開始時以條件式更新轉移狀態，不會被兩個 worker 同時處理 |
| D27 | **稽核日誌的匯出登記在 `modules/data-transfer/resources/`**，經由 `AuditLogService` 公開的 `exportPage`／`exportCount` 讀取 | 稽核日誌是葉節點模組（全域 guard 要注入 `AuditService`），只能依賴其他葉節點，不能 import 本模組；「擁有者登記」的例外，讀取仍只經過它公開的 service |
| D28 | **業務稽核的 `via: 'import'` 由 request context 的 `auditMetadata` 帶入**（`AuditService` 合併進每筆稽核） | 不必為每個 `*InTx` 方法加 metadata 參數；之後別的背景工作代替使用者操作時同一個機制可用 |
| D29 | **`data_transfer_rows` 多一欄 `target_expected`**：修改模式比對當下的關聯欄（`roleIds`），套用時原樣當成 `expectedRoleIds` | 多值欄整組取代要沿用 `PUT /users/:id/roles` 的衝突檢查；前端送回的值存下來才能讓工作在重試時一致 |
| D30 | **結果報告的「錯誤」欄寫錯誤碼與問題代碼**（例：`email: alreadyExists`），不翻譯 | 後端沒有語系檔；畫面上的結果表由前端翻譯，報告是給人修正後重新上傳的，代碼足以辨識。報告多出的「列號」「結果」「錯誤」三欄，重新上傳時自動視為唯讀欄 |
| D32 | **JSON／YAML 以欄位 `key` 為鍵、保留型別**（數字、布林、多值是陣列、`enum` 是值代碼）；匯入時讀檔器把值轉回儲存格文字，之後與 CSV 走同一個驗證器 | 給程式讀寫的格式不該依語系換鍵名；匯入只有「讀檔器」一處不同，驗證、預覽、套用都不必知道來源格式 |
| D33 | **結果報告只有 CSV／XLSX**；範本有四種格式 | 報告多出的「列號」「結果」「錯誤」是表格的欄位，放進 JSON 物件會和資源的欄位混在一起；範本是給人填的起點，四種都要 |
| D34 | **手動指定比對目標以 `targetId` 三態表示**（不帶＝自動、id＝指定、`null`＝撤回），套用列存 `target_manual`；撤回是錯誤 `targetNotSelected` 而不是略過 | 工作重新驗證時必須照用預覽中的選擇，不能又以比對鍵自動比對（撤回的列 Email 若對得上，會改到使用者明確不要的那筆）；撤回後的列要有明確的狀態提醒使用者處理，勾選「略過有錯誤的列」時才略過 |
| D35 | **文字欄的自動完成**：同一欄填過的值（新增模式的唯一欄不建議，改成補完 Email 的網域）＋修改模式向伺服器查現有的值（欄位有 `import.suggest`） | 新增模式建議現有的 Email 一定會重複；修改模式的 Email 是比對鍵，建議現有的值正好幫使用者找到要改的人 |
| D36 | **`DataGrid` 的下拉選單編輯器包專案的 `Select`**（樣式改成儲存格，功能相同），不用原生 `<select>`／`<datalist>` | 原生元件不能搜尋、多選、遠端查詢，樣式也無法統一；`Select` 已經有虛擬捲動與無障礙的鍵盤操作。儲存格存選項的名稱（與檔案、匯出相同的文字），不是值代碼 |
| D37 | **復原／重做的快捷鍵登記在全域快捷鍵（`registerHotkey`），只在預覽掛載期間有效**；輸入框裡不攔，是瀏覽器原生的文字復原 | 焦點不在表格（剛按過工具列的按鈕）時也要能復原；與命令面板的快捷鍵共用衝突偵測 |
| D38 | **編輯中的複製貼上交給瀏覽器**：只作用在輸入框選取的文字，不是整格或範圍貼上 | 表格的範圍貼上是「選取儲存格」時的行為；編輯中把整段 TSV 貼滿表格會覆蓋使用者沒選的儲存格 |
| D39 | **傳輸的狀態查詢在推播重新連上時重查一次，連線中也每 15 秒保險輪詢** | 斷線期間完成的傳輸收不到推播；只在斷線時輪詢的話，重新連上後畫面會一直停在「排隊中」 |
| D40 | **同一份檔案內的引用**（§7.8）：參照欄可以指向檔案裡另一列（唯一欄的值），套用時依相依順序先建立被引用的列 | 部門樹一定是「上層在檔案裡」；要求使用者分層匯入好幾次、或規定上層必須寫在前面都容易出錯。預覽只送改過的列，所以由前端帶「引用到、而且檔案裡有的值」，伺服器仍不保存預覽 |
| D41 | **成員關係另外登記成資源（`groupMember`、`orgUnitMember`）**，不在使用者的匯入加「群組」「部門」欄 | 成員關係本身有屬性（主管、主要部門、職稱）；使用者模組 import 群組、組織模組會形成循環，另做「欄位貢獻」的擴充點成本高。一列一筆關係也是 HR 系統常見的匯出形狀 |
| D42 | **角色以代碼（slug）比對，新增時可以指定代碼**（API 的建立仍由名稱產生） | 跨租戶搬移角色時名稱可能被改過，代碼不變；指定的代碼要符合 `slugify()` 的格式、不能重複 |
| D43 | **不提供刪除與「以檔案為準」的同步**：成員只能加入與修改屬性 | 框架沒有刪除模式（§2）；同步語意要定義「檔案裡沒有的就移除」的範圍，誤刪的代價高。移除在畫面上逐筆做 |
| D44 | **標籤在 `onApplicationBootstrap` 登記**，「標籤組」欄列出所有登記的組；租戶沒啟用的組在驗證時以 `forbidden` 擋下 | 標籤組由各模組在 `onModuleInit` 登記，順序不固定；欄位定義是登記時決定的，不能依租戶變動 |
| D45 | **審批的匯出看得到全部請求**：`approval:export` 包含 `approval:read` | 合規查核要的是完整的紀錄；只看得到自己相關的請求的人不需要整批匯出 |
| D46 | **巢狀的設定不走這個框架**（系統設定、通知政策、審批流程、公告） | 框架是一列一筆；這些設定是 key-value 或巢狀的 jsonb，裡面以 id 引用其他資源，`json` 欄不能匯入。之後若要在租戶之間複製設定，另做「設定快照」 |
| D47 | **不做檔案清單、Webhook、API token 的匯出；服務帳號只匯出** | 檔案的可見性是資料夾層級的授權，不是一個權限鍵；Webhook 與 token 含機密，匯入時也必須重新產生，失去搬移的意義 |
| D48 | **交易後的權限失效合併受影響的人**（`permissionsChanged` 帶 `userIds`，合併後一起交出） | 角色的權限鍵改了，持有者可能剛取得檔案權限，要補建個人資料夾；只做一次全租戶失效時也要知道是誰 |

### 13.3 評估過的方案

**D1：在瀏覽器解析與驗證（參考實作的做法）**

- 好處：編輯的回饋即時；伺服器零改動，每列走既有 API。
- 不選的原因（參考實作實際遇到的）：
  - 驗證規則前後端各一份，會漂移。例：參考實作的 email 唯一性沒有在前端檢查，送出後才逐列失敗。
  - 唯一值與比對目錄要把整個列表分頁抓回瀏覽器，目錄越大越慢，而且晚到的目錄不會重新套用到已解析的列。
  - 「建立實體」與「建立關聯」是多個請求。部分成功的列被回報為失敗，失敗清單重匯後就建出重複的資料。各資源對關聯失敗的處理不一致，文件與程式也不一致。
  - 沒有離開頁面的保護、沒有草稿，重新整理就失去所有編輯。
  - 執行中無法取消；卸載後還繼續送請求；沒有 429 退避。
  - 上限 500 列，再多就卡住主執行緒與網路。
- 同時保留兩條路徑（小量在前端、大量在後端）：兩套 UI 與兩份規則，不選。

**D2：小匯出同步回傳檔案**

- 好處：少一次入列。
- 不選：要維護兩條產生檔案的路徑，而「小」的界線會隨篩選條件變動。

**D2：在瀏覽器組裝匯出檔（參考實作的做法）**

- 參考實作逐頁抓列表 API，全部放在記憶體後一次產生 CSV。
- 不選的原因：
  - 關聯欄每列多一個請求，失敗的關聯默默變成空白，看起來像「沒有關聯」。
  - 大量時佔滿分頁的記憶體。
  - 不能在背景完成。
  - 匯出沒有稽核。

**D4：匯出與匯入各一份欄位定義**

- 參考實作就是這樣做的，結果是：
  - 匯出沒有 `id`；
  - 一半的欄位重匯時被默默忽略；
  - 文件描述的「匯出 → 修改 → 匯回」實際上無法運作。
- 不選。

**D5：只以介面語言的標頭比對（參考實作的做法）**

- 中文介面做的檔案，在英文介面匯入時整欄對不上：必填欄位每列都報「必填」，其他欄位被默默忽略。不選。

**D5：範本第二列放隱藏的機器鍵**

- 使用者在 Excel 中刪掉或排序時很容易弄壞；而以 `key` 比對已經涵蓋。不選。

**D6：XLSX 用 SheetJS**

- npm 上的版本已停止更新（新版只從官方 CDN 發佈），而且社群版的串流寫入有限。不選。
- `exceljs` 的維護狀態見 §13.4；若有阻礙，改用 SheetJS 的官方發佈版，只換寫檔器與讀檔器的實作。

**D6：SQL 匯出內部資料表**

- 會外洩內部結構與敏感欄位，而且在同一個資料庫執行就可能蓋到正式資料。不選。

**D7：保留模糊比對，但要求逐格確認**

- 實作與 UI 成本高，效果與「建議值＋一鍵套用」相同。不選。

**D8：修改模式以開關選擇要修改的欄位（參考實作的做法）**

- 多一個概念，而且開關與檔案內容不一致時令人困惑：檔案裡有這欄卻沒改到。
- 改為「檔案中有的欄位就是要修改的欄位」，不要的欄位在 Excel 裡刪掉即可。

**D8：比對鍵逐一嘗試（id 找不到就改用 email，參考實作的做法）**

- `id` 寫錯時會默默改到 email 相同的另一筆。不選。

**D8：同一個目標出現多次時「最後一列為準」**

- 結果取決於列的順序，難以預期。改成錯誤。

**D9：整批一個交易**

- 一列失敗整批回滾，5 000 列的交易會長時間持有鎖，而且無法回報進度。不選。

**D9：先做業務寫入，再另外記錄結果**

- 中途當掉時結果沒記到，重試就重複建立。不選。

**D11：沿用 `:read` 當作匯出權限**

- 能逐頁看與能整批帶走的風險不同，稽核要求常常要分開授權。不選。

**D14：AG Grid Community**

- 功能完整，但體積大，進階功能（範圍選取、填滿）屬於付費版。不選。

**D14：Handsontable**

- 最像 Excel，但商業使用需要授權。不選。

**D14：Glide Data Grid（canvas）**

- 效能最好，但 canvas 的無障礙支援差，以 Design Token 套用主題也較麻煩。不選。

**D14：以 TanStack Table＋TanStack Virtual 自己做**

- 依賴已經在專案中，沒有新增套件。但鍵盤移動、範圍選取、複製貼上、編輯器的焦點管理都要自己寫，估計成本是包裝套件的數倍。
- 列為備案：`react-data-grid` 的 bundle 或無障礙不符合時採用。

**D14：表格的每一格都是常駐的輸入元件（參考實作的做法）**

- 數千列時很重，也不像 Excel 那樣先選格再編輯。不選。

**D13：提供「不寄啟用信」的選項**

- 帳號會停在 `pending`，管理者事後還要逐一重寄。不選。

**D21：伺服器端暫存（原本的 D1）**

- 解析後的每一列存在 `data_transfer_rows`，預覽讀它、修改以 `PATCH` 寫它，伺服器端重新驗證受影響的列。
- 好處：換裝置也能接續；檔案內重複可以在伺服器端以 SQL 計算。
- 不選（2026-10-08 需求調整）：
  - 每次修改都要往返並寫資料庫；兩個分頁同時改同一列需要 `revision` 衝突處理。
  - 暫存列含個資，要有保留期限、清理工作與「我的未完成匯入」的管理。
  - 解析是背景工作，上傳後要等推播才能看到結果，多一段等待。

**D21：前端持有 JSON，驗證也在前端**

- 後端只負責格式轉換，欄位規則由欄位定義端點提供，前端照著驗證；後端只在套用時做最終驗證。
- 不選：資料庫的唯一值、比對目標、反提權只有後端能判斷，前端驗證只能做一半，「預覽說沒問題、套用卻失敗」會很常見。這正是參考實作的問題。

**D22：分析也走瀏覽器直傳 bucket ＋ 背景工作**

- 好處：大檔案較穩，api 不經手檔案位元組。
- 不選：在目前的上限內同步完成更簡單；原始檔還要清理。若之後上限要大幅提高（例：數十萬列），再改成這個做法，前端只需要把「等 `analyze` 回應」換成「等推播」。

**D22：在 api 的主執行緒解析**

- 10 MiB 的 XLSX 解壓與解析可能要數秒，期間同一個程序的所有請求都會停住。不選。

### 13.4 實作前的假設與驗證結果

| 假設 | 結果 |
| --- | --- |
| `react-data-grid` 的 chunk 低於 215 KB gzip，鍵盤與螢幕閱讀器可用 | 成立：7.0.0-beta.61，JS 約 23 KB gzip；`grid`／`gridcell` 角色、方向鍵與 Enter 編輯內建（[`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md) §3） |
| `exceljs` 串流讀寫穩定 | 匯出用 `stream.xlsx.WorkbookWriter`，分析用一般的 `Workbook.load`（上限 50 MB，在 worker thread）。注意：npm 上最新版 4.4.0 發佈於 2024-12，之後若有阻礙，依 D6 改用 SheetJS 官方版（只換寫檔器與讀檔器） |
| Node 的 `TextDecoder` 支援 `big5` | 成立（Node 24 官方建置含完整 ICU）；不需要 `iconv-lite` |
| 只在 `analyze` 收 multipart、只對 `POST /imports` 放寬 body 上限 | 成立：multer 以攔截器逐請求建立（上限是租戶的參數）；JSON 上限以 `registerDataTransferBodyParser` 在 Nest 預設的 parser 之前註冊（D31） |
| worker thread 池在 Nest 的生命週期內可以乾淨地啟動與關閉 | 成立：第一次使用才建立、`onModuleDestroy` 結束；閒置的 worker `unref()`。測試直接跑原始碼時 Node 以型別剝除執行 `sheet-reader.ts` |
| `UserService.create`／`update`／`replaceRoles` 可以拆出交易內的版本 | 成立：`createInTx`／`updateInTx`／`replaceRolesInTx` ＋ `runAfterCommit`，既有的使用者整合測試全部通過 |
| 工作裡建立的 request context 能讓稽核取得建立者 | 成立（`DataTransferContextFactory.runAs`），整合測試檢查 `user.create` 的 actor 與 `via` |

### 13.5 實作紀錄

- **D31：套用路由的 JSON 上限。** Nest 以函式名稱 `jsonParser` 判斷 JSON parser 是否已經註冊；直接 `app.use(path, json())` 會讓它略過全域的 parser，
  所以包一層匿名函式。上限是參數最大值（50 MB）× 2，租戶的實際上限由 service 依 `Content-Length` 檢查。nginx 另有 `/api/data-transfers/` 的 location（`client_max_body_size 101m`、`proxy_read_timeout 120s`）。
- **匯出檔的列序與註解。** SQL 檔的筆數寫在檔尾的註解（`-- N rows`）：寫檔時才知道實際筆數。
- **範本。** XLSX 範本多一個「欄位說明」工作表（欄位、必填、格式、選項、說明）。
- **XLSX 的日期時間。** 讀檔時沒有時差的牆上時間轉成 `YYYY-MM-DDTHH:mm:ss`，由驗證器以建立者的時區解讀；匯出時以匯出者時區的牆上時間寫入。
- **新的問題代碼。** 數字欄的範圍用 `tooSmall`／`tooLarge`（字串是 `tooShort`／`tooLong`）。
- **稽核日誌的筆數。** `exportCount` 最多數到「上限 ＋ 1」，超過上限時不必數完。
- **前端的實作差異** 見 [`../frontend/21-data-transfer.md`](../frontend/21-data-transfer.md) §7。
- **JSON／YAML、手動指定比對目標、自動完成（D32～D39）** 是第一版上線後依使用回饋加的：租戶 migration `0046_data_transfer_formats`
  放寬 `data_transfers.format` 的檢查並新增 `data_transfer_rows.target_manual`。
- **第二批資源（§12、D40～D48）。** 租戶 migration `0049_data_transfer_resources` 把六個匯出權限補給既有租戶的系統角色。
  `RoleService`、`GroupService`、`OrgUnitService`、`TagService` 拆出交易內的版本（API 改成呼叫它們，行為不變）。
  - 套用列的結果 id（`result_id`）是 uuid：部門成員回傳使用者的 id。
  - 實作時發現部門的「搬移」從來沒有成功過：同層排序的 `CASE … THEN $n` 參數沒有型別，postgres 推成 text 寫不進 `sort_order`。已修正並補上成功搬移的整合測試（[`23-organization.md`](23-organization.md)）。
  - `matchKeyRequired` 與修改模式的說明原本寫死「ID 或 Email」，改成通用的「比對欄位」。
