# 系統設定的導覽

- 優先度：P2
- 狀態：提案
- 依賴：系統設定（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §4、§5.1）；系統設定的分頁外框（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.5，`core/system-settings`）；
  命令面板（[`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) §4）；route id（`@b2b-system/web-core/route-link`）；稽核日誌的篩選（[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)）
- 相關：[`tag-management.md`](./tag-management.md)（`features/tag/search.ts` 在那份提案做）；[`list-filters-completion.md`](./list-filters-completion.md)（稽核日誌的篩選進網址）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

系統設定頁隨功能增加已有 8 個分類（`features/system/constants.ts` 的 `SETTING_CATEGORY_LABEL_KEY`：一般、帳號與登入、檔案、回收桶、版本紀錄、通知、匯入匯出、圖片庫），找一個設定越來越慢：

| 位置 | 現況 | 問題 |
| --- | --- | --- |
| `features/system/pages/SettingList/page.tsx:51-58` | 所有分類的 `SettingCategoryForm` 由上往下平鋪 | 沒有分類目錄、沒有錨點；要改「圖片庫」得捲過前面七張表單 |
| `features/system/` | 沒有 `search.ts` | ⌘K 搜不到「回收桶保留天數」這類設定；`announcement`、`tag` 也沒有 `search.ts`（現在登記的是 file、user、role、group、service-account、webhook、organization） |
| `pages/SettingList/components/SettingField.tsx:131-150` | 每一列顯示預設值、範圍、「已修改」與「恢復預設」 | 沒有「誰、何時改的」：`GET /system/settings` 已回 `updatedAt`（`apps/api/src/modules/system/dto/system-setting.dto.ts:38`），畫面沒用；也沒有到稽核日誌的連結 |
| `apps/api/src/modules/system/system-setting.service.ts:108-116` | 一次儲存寫一筆 `setting.update`，`resourceName` 是以逗號串起的 key，`resourceId` 是 null | 稽核日誌只能篩 `resourceType=setting`，篩不到「某一個 key」的歷史 |
| `features/system/hooks/useSettingDraft.ts`、`PATCH /system/settings` | 草稿只記與伺服器不同的 key，送出時沒有版本 | 兩個管理員同時改 **同一個 key**，後送出的默默蓋掉先送出的；[`backend/12-settings.md`](../architecture/backend/12-settings.md) 沒有提到這是刻意的，`system_settings`（§1.1）也沒有 `version` 欄 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 設定頁的分類目錄：寬螢幕是側邊的錨點清單（捲動時標示目前分類），窄螢幕是頂端的 `Select` | 設定頁內的全文搜尋框（命令面板已能搜，開放問題 4） |
| 命令面板：搜尋設定（名稱、說明、key），選了跳到那一列並高亮 | 依設定授權（某些分類只給某些人改；權限仍是 `system:read`／`system:update`） |
| 公告的 `search.ts`：搜尋公告、「建立公告」動作 | 把設定改成審批（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §3：存得進去的值都安全，只寫稽核、不走審批） |
| 每一列顯示「最後修改：時間・修改者」與「查看變更紀錄」，連到稽核日誌 | 設定的版本歷史與還原到某一版（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) 的 `RevisionService`，開放問題 3） |
| 同時編輯的處理：先釐清是否刻意，再決定（開放問題 1） | apps/platform 的設定頁（平台參數另有自己的頁面） |

## 使用者故事

**作為租戶管理員，我希望在 ⌘K 輸入「保留」就找到回收桶與稽核的保留天數，以便不必記得它在哪個分類。**

- **Given** 我有 `system:read`
- **When** 我按 ⌘K 輸入「保留」
- **Then** 「設定」群組列出「回收桶保留天數」「通知保留天數」…；選了之後到 `/system/settings?key=trash.retentionDays`，頁面捲到那一列並短暫高亮

**作為管理員，我希望知道某個設定是誰改的，以便問清楚原因。**

- **Given** 「登入失敗鎖定次數」顯示「已修改」
- **When** 我看那一列
- **Then** 顯示「最後修改：10/08 14:20・王小明」，「查看變更紀錄」打開稽核日誌，只列改過這個 key 的紀錄

## 初步構想

### 1. 分類目錄（`features/system`）

- `SettingList/page.tsx` 改成兩欄：左側 `nav` 列出分類（`SETTING_CATEGORY_LABEL_KEY` 的順序，只列有設定的分類），右側維持現在的表單；每個 `SettingCategoryForm` 的根節點加 `id="setting-<category>"`。
- 捲動時以 `IntersectionObserver` 標示目前分類（`aria-current="true"`）。窄螢幕（< 1024 px）改成表單上方的 `Select`，與 [`a11y-mobile.md`](./a11y-mobile.md) 的響應式規則一致。
- 網址：`?category=` 與 `?key=`（search 參數而非 hash：route id 的 `RouteLinkRef` 只描述 route、params、search，沒有 hash）。進頁時有 `key` 就捲到那一列並高亮 2 秒，然後以 `replace` 拿掉參數。
- 目錄元件是否放 `packages/ui`（通用的「頁內目錄」）：個人頁也要（[`account-self-service.md`](./account-self-service.md)），傾向做成 `@b2b-system/ui` 的 `PageToc`，不含業務名詞。

### 2. 命令面板

- `features/system/search.ts`：`registerSearchProvider({ key: 'systemSetting', pageKey: SETTING_PAGE, … })`，以 `GET /system/settings` 的查詢快取（TanStack Query）在前端比對標籤、說明與 key；結果連到新的 route id `systemSetting.field`（`search: { key: 'key' }`）。
  平台沒有開放的設定後端本來就不回（§4），面板自然不列。
- `features/announcement/search.ts`：`GET /announcements?keyword=`（`ListAnnouncementSchema` 已有 `keyword`），結果連到 `announcement.detail`（新的 route id）；`registerPaletteCommand('announcement.create')`。
- 兩個都在 plugin 同步階段登記；`app/__tests__/navigation.test.ts` 的完整性檢查與 [`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) §4 的清單一起更新。

### 3. 最後修改與變更紀錄

- 後端：`GET /system/settings` 每一列加 `updatedBy: { id, name } | null`（`system_settings.updated_by` 已存在，left join `users`）。
- 稽核要能依 key 篩選，兩個選項（開放問題 2）：
  - A. 每個 key 一筆稽核（`resourceId` = key），一次儲存寫多筆；稽核列表直接用既有的 `resourceType`＋`resourceId` 篩選（`apps/api/src/modules/audit-log/dto` 已有 `resourceId`）。
  - B. 維持一筆，稽核列表加「`changes` 含某個 key」的篩選（jsonb 的 `?` 運算子）。
- 前端：`audit-log` 登記 route id `auditLog.byResource`（`search: { resourceType, resourceId }`；稽核頁的 search 要先加 `resourceId`），`SettingField` 以 `<RouteLink>` 連過去；沒有 `auditLog:read` 時不顯示。

### 4. 同時編輯

- 若決定要防：`system_settings` 加 `version integer NOT NULL DEFAULT 1`；`GET` 每列帶 `version`，`PATCH` 的 `values` 改成 `{ <key>: { value, version } }`（沒有覆寫的 key 帶 `0`），條件式寫入，衝突回 `409 SETTING_VERSION_CONFLICT`（`details.keys`）。
  前端沿用 `VersionConflictAlert` 的「重新載入」。這是 API 的不相容修改，前端同一批改。
- 若決定不防：在 [`backend/12-settings.md`](../architecture/backend/12-settings.md) 寫下理由（設定少、改的人少、稽核看得到），並在編輯中收到 `resource.changed`（§4 第 4 點已推給 `system:read` 的人）時提示「這個分類剛被其他人修改」。

## 開放問題

1. 設定的同時編輯是刻意不防嗎？[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 要求「可編輯的實體要有 `version`」，設定是 key-value 的覆寫值而不是實體，規格兩邊都沒寫。
   傾向不加 `version`、只做推播的提示（§4 第二種）：成本低，且設定頁一個分類一次儲存，衝突的窗口小。
2. 稽核依 key 篩選選 A 還是 B？A 改了稽核的形狀（已有的資料仍是合併的一筆），B 要在稽核的熱表加 jsonb 條件、冷表也要支援。
3. 設定要不要進版本歷史（`RevisionService`）？有了它「查看變更紀錄」就不必連到稽核，也能還原；但設定不是實體，沒有 `resourceId`。
4. 設定頁內要不要另有搜尋框？命令面板已涵蓋，但不知道 ⌘K 的人找不到。
5. 「最後修改」對沒有覆寫（預設值）的設定顯示什麼？還原預設會刪掉那一列（§1），修改者也一起消失——只能從稽核得知。

## 設計決策

## 歸檔去向

完成後預計寫成：

- [`backend/12-settings.md`](../architecture/backend/12-settings.md) §4、§5.1：`updatedBy`、目錄與 `?key=`、同時編輯的決定；新增「設計決策：設定的導覽」一節
- [`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) §4 的登記清單加上設定與公告
- 若稽核選 A：[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) 的 `setting.update` 說明
