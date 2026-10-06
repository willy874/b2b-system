# 檔名與資料夾名稱允許雙向文字控制字元、C1 控制字元與零寬字元

## 現況

`apps/api/src/modules/file/dto/create-file-upload.dto.ts` 的 `FileNameSchema`（L7–14）只排除路徑分隔字元、C0 控制字元與 DEL：

```ts
.regex(/^[^/\\\u0000-\u001f\u007f]+$/, 'must not contain path separators or control characters');
```

用到它的地方：

- 上傳時的檔名（`CreateFileUploadSchema`）；
- 改名（`update-file.dto.ts`）；
- 對外 API 的上傳（`external/file.external.dto.ts`）；
- 資料夾名稱 `FileFolderNameSchema`（`file-folder.dto.ts` L10–13），以及上傳資料夾的路徑（`EnsureFileFolderPathsSchema`）。

以 node 實測，下列字元都會通過：

| 字元 | 類別 |
| --- | --- |
| U+202E（RLO） | 雙向文字控制 |
| U+0085、U+009B | C1 控制字元 |
| U+200B | 零寬空白 |
| U+2028 | 行分隔 |
| U+FEFF | BOM（夾在名稱中間時；頭尾的會被 `.trim()` 去掉） |

[`backend/09-file.md`](../architecture/backend/09-file.md) §4 規定 `name`「不可含 `/`、`\`、控制字元」。C1（U+0080–U+009F）也屬於 Unicode 的控制字元（`Cc`）。

範例：上傳或改名為 `invoice` ＋ U+202E ＋ `fdp.exe`，檔案管理器、稽核紀錄、資料夾的存取申請都會顯示成 `invoiceexe.pdf`。

## 影響

- 任何能上傳或改名的成員，都能偽裝副檔名，誘使同事下載、執行檔案。
  - 下載後存檔的檔名會被瀏覽器另外清理，例如 Chrome 會換掉 `Cc`、`Cf` 類的字元。
  - 但列表、稽核頁、審批頁顯示的是偽裝後的名稱。
- C1 控制字元與 U+2028 會原樣存進稽核紀錄的 `resourceName` 與資料夾存取申請的 `folderName`（`file-folder-access.approval.ts` L126），之後顯示或匯出時都帶著它們。
- 零寬字元可以做出「看起來同名」的兩個資料夾：同一層的唯一索引 `file_folders_parent_name_key` 比的是字串，`a` ＋ U+200B ＋ `b` 和 `ab` 不算同名。
  - NFC 正規化是另一件事，已列在 [`features/hardening-followups.md`](../features/hardening-followups.md)。

## 修正方式

- `FileNameSchema` 改用 Unicode 屬性排除，regex 要加 `u` flag：
  - `\p{Cc}`：C0、C1 與 DEL；
  - 雙向文字控制：U+061C、U+200E、U+200F、U+202A–U+202E、U+2066–U+2069；
  - 零寬與分隔：U+200B、U+2028、U+2029、U+FEFF。
  - 保留 U+200D（ZWJ），以 ZWJ 串起來的 emoji 組合序列才不會被擋。
  - 例：`/^[^/\\\p{Cc}\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]+$/u`
- 既有資料不必遷移：新規則只影響新增與改名。
  - 要清理的話，另寫一支腳本列出含這些字元的名稱，交給管理者決定。
- [`backend/09-file.md`](../architecture/backend/09-file.md) §4 的 `name` 欄，以及 §4.2 的資料夾 `name` 欄，補上排除的字元類別。

## 驗證方式

- 新增 `apps/api/src/modules/file/dto/__tests__/create-file-upload.dto.spec.ts`，參考 `modules/role/dto/__tests__/update-role.dto.spec.ts` 的寫法：
  - 上表每一種字元都回 `VALIDATION_FAILED`；
  - 一般中文、全形字、以 ZWJ 串起來的 emoji（例：U+1F468 U+200D U+1F469）照常通過。
- `apps/api/src/modules/file/__tests__/file-system-folder.service.spec.ts` 已斷言系統資料夾的名稱通過 `FileFolderNameSchema`，改完要確認仍然通過。
- `apps/api/test/file-lifecycle.spec.ts`：以含 U+202E 的名稱 `PATCH /files/:id` 改名，回 400。
