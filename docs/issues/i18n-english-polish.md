# 英文介面的語系細節：html lang 固定中文、沒有複數形、寫死全形標點

## 現況

### 1. `<html lang>` 與頁面標題不會改變

- `apps/backstage/index.html`：L2 `<html lang="zh-Hant">`、L6 `<title>B2B System</title>`。
- `apps/platform/index.html`：L2 `<html lang="zh-Hant">`、L6 `<title>B2B System 帳號</title>`。
- 程式裡沒有任何地方更新 `document.documentElement.lang` 或 `document.title`。
  切換語系由 `packages/web-core/src/plugins/app/i18n.ts` 的 `i18nPlugin()`（L33–66）處理，沒有碰 `lang`。

### 2. 英文沒有複數形

- 所有 `en_US.json` 裡，`_one`／`_other` 結尾的鍵一個都沒有。
- 帶數量的英文句子約 60 句，例：
  - `apps/backstage/src/features/user/locales/en_US.json` L52：`"Delete {{count}} users? …"`
  - `apps/backstage/src/features/approval/locales/en_US.json` L33：`"Approved {{count}} requests."`
  - `apps/backstage/src/features/file/locales/en_US.json` L84：`"Added {{count}} files to the upload queue"`；L137：`"{{count}} subfolders"`
  - `apps/backstage/src/features/notification/locales/en_US.json` L15：`"Marked {{count}} notifications as read"`
  - `packages/web-core/src/locales/resources/en_US.json` L154：`"{{userCount}} users still hold this role."`
- 規格寫「複數：i18next 的 `_one` / `_other` 後綴」（[`frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §5）。
- 目前只有公告的週期摘要另外處理（`apps/backstage/src/features/announcement/constants.ts` 分成 `one`、`many` 兩個鍵）。

### 3. 程式裡寫死的全形標點

用 `、` 串接清單：

- `apps/backstage/src/core/components/Tag/TagChips.tsx` L41
- `apps/backstage/src/features/service-account/pages/ServiceAccountList/adapter.ts` L18
- `apps/backstage/src/features/announcement/pages/AnnouncementDetail/components/AnnouncementSettingsSection.tsx` L265

全形括號、冒號、分隔線：

- `apps/backstage/src/features/webhook/pages/WebhookDetail/components/WebhookSettingsSection.tsx` L323：建立者（時間）
- `apps/backstage/src/features/role/components/PermissionSkillTree.tsx` L168（aria-label）、L210、L215（「包含：」「需要：」）
- `apps/backstage/src/features/permission/pages/PermissionList/components/PermissionCatalogTree.tsx` L97（aria-label）
- `apps/backstage/src/features/file/pages/FileManager/components/FolderGridItem.tsx` L55、`FileListHeader.tsx` L68
- `apps/backstage/src/core/components/ExplainPath/ExplainPath.tsx` L63
- `apps/backstage/src/plugins/features/table-column-settings/TableColumnsSection.tsx` L147
- `apps/backstage/src/features/webhook/components/WebhookEventSelect.tsx` L37（`｜`）
- `apps/platform/src/features/audit-log/pages/AuditLogList/components/AuditLogDetail.tsx` L13、L21

同一個 repo 已經有正確的寫法：`PermissionSkillTree.tsx` L77 用 `Intl.ListFormat`（`list.format(...)`）串接名稱。

## 影響

只影響英文介面：

- 報讀器用中文語音念英文（`lang`）。多個分頁的標題都一樣，不好分辨；platform 的標題還是中文。
- 勾一筆時出現「Delete 1 users?」「Approved 1 requests.」這類文法錯誤。
- 出現「VIP、Partner」「Error code：」「Alice（Oct 6, 2026）」這類中英混排的標點，可存取名稱裡也帶全形括號。
- 不影響功能；中文介面不受影響。

## 修正方式

1. `lang` 與標題：
   - `i18nPlugin` 在初始化與切換語系時設定 `document.documentElement.lang`（`zh-Hant`／`en`）。
   - 路由加上標題的語系鍵（例：route 的 `staticData`），換頁與換語系時設定 `document.title`，格式「頁面 · 產品名」。
2. 複數：
   - en_US 帶數量的句子改成 `_one`／`_other`；zh_TW 只留 `_other` 即可。
   - 錯誤碼的插值改用 `count`（例：`ROLE_IN_USE` 的 `userCount`），才能套到複數規則。
3. 全形標點：
   - 清單一律用 `Intl.ListFormat(language)`（照 `PermissionSkillTree` 的寫法），或加一個共用的 `formatList()`。
   - 「名稱（狀態）」「欄位：值」改成語系鍵，例：zh `{{name}}（{{state}}）`、en `{{name}} ({{state}})`。

## 驗證方式

- web-core 補 i18n plugin 的測試：切換成 en-US 之後，`document.documentElement.lang` 是 `en`。
- `apps/backstage/src/app/__tests__/locales.test.ts`、`apps/platform/src/app/__tests__/locales.test.ts`（以及 web-core 的語系測試）：en_US 中含 `{{count}}` 的鍵必須有 `_one` 版本。
- 寫死字串的檢查（[`frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §6 的掃描）加入全形標點 `、（）：｜`，只看非註解的程式碼。
