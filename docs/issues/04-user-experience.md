# 使用者體驗檢查

> 掃描日期：2026-09-30 ・ 前提：企業多租戶、1000 人同時在線 ・ 範圍：`apps/backstage/src`（app、core、components、features：user、role、approval、account、auth、identity-provider、file 的錯誤處理、audit-log 的日期篩選）、`apps/auth/src`（features/login 全部頁面、tenant、platform-admin 列表、Layout、router）、`apps/api/src/core/errors/error-code.ts` 與 user／role／auth DTO 的驗證規則。以讀程式碼為主，未啟動瀏覽器；依規範推論、尚未實測的標「待驗證」。

## 摘要

| ID | 嚴重度 | 標題 | 位置 |
| --- | --- | --- | --- |
| UX-01 | P0 | 租戶網域一鍵移除，沒有確認、沒有防連點 | `apps/auth/.../TenantDetail/page.tsx:247` |
| UX-02 | P0 | 角色權限對話框在資料載入前勾選，儲存會移除該角色全部既有權限 | `apps/backstage/.../RoleDetailPermission/page.tsx:24` |
| UX-03 | P1 | 角色「編輯」「複製」失敗完全沒有提示 | `apps/backstage/src/features/role/hooks/useRoleMutations.ts:26` |
| UX-04 | P1 | 就地編輯失敗時仍關閉編輯區／對話框，使用者輸入直接丟失 | `UserBasicSection.tsx:77`、`RoleBasicSection.tsx:64`、`RoleDetailPermission/page.tsx:55` |
| UX-05 | P1 | 編輯被鎖定使用者的顯示名稱會順便把帳號解鎖；改成停用沒有確認 | `UserBasicSection.tsx:42` |
| UX-06 | P1 | 「重設密碼」單擊即寄信，沒有確認，緊貼刪除鈕 | `UserTable.tsx:140` |
| UX-07 | P1 | 列表查詢失敗時顯示「沒有資料」，沒有錯誤狀態與重試 | `UserList/page.tsx:35`、`components/Table/Table.tsx:222` |
| UX-08 | P1 | `/auth/profile` 失敗時整個 app 停在骨架屏，沒有出路 | `features/auth/hooks/useSyncPermissions.ts:16`、`app/Layout.tsx:40` |
| UX-09 | P1 | Router 沒設定 404／錯誤頁：未知網址與 chunk 載入失敗顯示框架預設英文畫面 | `apps/backstage/src/app/plugin.ts:10`、`apps/auth/src/app/plugin.ts:9` |
| UX-10 | P1 | 表單驗證訊息是 Zod 的英文技術字串 | `shared/hooks/form.ts:11`、`Register/page.tsx:25` |
| UX-11 | P1 | 偏好頁的「時區」「語言」對日期顯示完全無效 | `apps/backstage/src/shared/date/index.ts:10` |
| UX-12 | P1 | Session 結束：不說原因（一律「你已登出」）、只保留 pathname、未存資料全失 | `apps/backstage/src/app/App.tsx:37` |
| UX-13 | P1 | 忘記密碼在 429／網路錯誤時仍顯示「已寄出」 | `apps/auth/.../ForgotPassword/page.tsx:28` |
| UX-14 | P1 | 3 個後端錯誤碼沒有翻譯，且測試用手抄清單沒擋住 | `apps/api/src/core/errors/error-code.ts:108`、`locales.test.ts:12` |
| UX-15 | P1 | 刪除租戶與關閉外部 IdP 這類高影響操作，確認強度不足 | `apps/auth/.../TenantDetail/page.tsx:183`、`:296` |
| UX-16 | P1 | 頂列看不到目前租戶與使用者身分；帳號選單的無障礙名稱是「M」 | `apps/backstage/src/app/layouts/DashboardLayout.tsx:66` |
| UX-17 | P1 | 表單對話框點遮罩／Esc 就關閉，全站沒有「未儲存離開」提醒 | `components/Dialog/Dialog.tsx:38`、`UserCreate/page.tsx:64` |
| UX-18 | P2 | 刪除角色的確認不說明持有人數；`ROLE_IN_USE` 之後沒有下一步 | `RoleList/page.tsx:96`、`core/errors/useErrorMessage.ts:26` |
| UX-19 | P2 | 後端欄位錯誤（`details.fields`）沒有回填到欄位 | `core/errors/AppError.ts:13`、`UserCreate/page.tsx:55` |
| UX-20 | P2 | 建立使用者按 Enter 不送出；就地編輯區不是 `<form>` | `UserCreate/page.tsx:68`、`RoleBasicSection.tsx:45` |
| UX-21 | P2 | 詳情對話框的深層連結指向已刪除資源時是一個空白對話框 | `UserDetail/page.tsx:45`、`RoleDetail/page.tsx:82` |
| UX-22 | P2 | 分頁只有上一頁／下一頁，千筆資料難以操作；刪到空頁不回退 | `components/Pagination/Pagination.tsx:72` |
| UX-23 | P2 | 搜尋藏在篩選浮層；空結果不提供清除篩選；批次只能全選本頁 | `core/components/RichTable/FilterBar/FilterBar.tsx:76` |
| UX-24 | P2 | 沒有 RWD：側欄固定 15rem，小螢幕無法使用 | `app/layouts/DashboardLayout.css:7` |
| UX-25 | P2 | 表單錯誤不會被報讀；必填只有 `aria-hidden` 的星號 | `components/Field/Field.tsx:54`、`Interaction/page.tsx:209` |
| UX-26 | P2 | 英文硬編碼的 aria-label 與「☰」文字圖示 | `DashboardLayout.tsx:57`、`Pagination.tsx:62` |
| UX-27 | P2 | 輸入框邊框對比 1.30:1，未達 WCAG 1.4.11 的 3:1 | `apps/backstage/src/themes/tokens.css:83` |
| UX-28 | P2 | 登入流程的失敗回饋不完整（跳轉失敗、callback 重試、互動過期） | `features/auth/pages/Login/page.tsx:31`、`SsoCallback/page.tsx:66`、`Interaction/page.tsx:91` |
| UX-29 | P2 | 平台租戶列表沒有分頁、搜尋、篩選 | `apps/auth/src/features/tenant/pages/TenantList/page.tsx:27` |
| UX-30 | P2 | 變更密碼沒有確認欄、沒有 autocomplete，改完直接顯示「你已登出」 | `features/account/pages/Profile/page.tsx:98` |
| UX-31 | P3 | 429 訊息不帶可重試時間 | `plugins/fetcher/api-adapter.ts:14` |
| UX-32 | P3 | 403／404 頁沒有「回首頁」；apps/auth 的載入 fallback 是空白 | `core/components/ErrorPage/ErrorPage.tsx:28`、`apps/auth/src/app/Layout.tsx:21` |
| UX-33 | P3 | 登入表單缺顯示密碼、Caps Lock 提示、自動聚焦；沒有「記住我」 | `apps/auth/.../Interaction/page.tsx:188` |
| UX-34 | P3 | Toast 不支援動作鈕（復原／重試）；軟刪除沒有復原入口 | `components/Toast/Toast.tsx:31` |
| UX-35 | P3 | 同一狀態在列表與詳情用不同色調 | `UserBasicSection.tsx:93`、`UserTable.tsx:33` |
| UX-36 | P3 | 設計系統元件的中文預設文案在英文介面漏出 | `ApprovalReviewForm.tsx:31` |

統計：P0 × 2、P1 × 15、P2 × 13、P3 × 6，共 36 項。

---

## 詳細

### UX-01 租戶網域一鍵移除，沒有確認、沒有防連點

- **嚴重度**：P0
- **位置**：[apps/auth/src/features/tenant/pages/TenantDetail/page.tsx:247](../../apps/auth/src/features/tenant/pages/TenantDetail/page.tsx)（247–257）
- **現況**：網域旁的垃圾桶 `IconButton` 的 `onClick` 直接呼叫 `removeDomain.mutateAsync(...)`，沒有 `useConfirm`，按鈕也沒有綁 `loading`／`disabled`。只要網域多於一個就能移除，連標示「主要網域」的第一個（`index === 0`）也可以。
- **影響**：平台管理者手滑一下，該網域立刻不再對應租戶，這個網域上的所有使用者（可能上百人同時在線）都被擋在門外。連點還會送出重複請求。
- **建議**：改用 `useConfirm`，`tone: 'danger'`，說明內容寫成「移除後 `{{domain}}` 會立即無法進入此租戶，已登入的使用者會……」。主要網域另外擋下，或要求先換主要網域。按鈕綁 `removeDomain.isPending`。
- **驗收**：點垃圾桶先出現確認框，取消後網域還在；確認進行中兩顆按鈕都停用；主要網域沒有移除鈕，或移除時有額外警告。
- **狀態**：已修（fix/auth-ux）——確認框（`tone: danger`、說明影響）、送出中兩顆按鈕停用；主要網域不顯示移除鈕，後端也擋（`TENANT_PRIMARY_DOMAIN`，409）

### UX-02 角色權限對話框在資料載入前勾選，儲存會移除該角色全部既有權限

- **嚴重度**：P0（依程式邏輯推論；要在慢速網路下實測，**待驗證**）
- **位置**：[apps/backstage/src/features/role/pages/RoleDetailPermission/page.tsx:24](../../apps/backstage/src/features/role/pages/RoleDetailPermission/page.tsx)（24–38、70–82）
- **現況**：`initial` 在 `current.data` 回來之前是空集合。使用者一勾選，`setDraft(updater(previous ?? initial))` 就用空集合建立草稿。資料回來後 `selected` 仍是草稿，`remove = initial − selected` 等於該角色原有的全部權限。`PermissionPicker` 沒有在 `current.isPending` 時停用或顯示載入中。
- **影響**：網路慢時（1000 人同時在線的尖峰很常見），管理者打開對話框立刻勾一個權限再按儲存，角色原本的所有權限都會被撤掉，持有這個角色的所有人瞬間失去權限。
- **建議**：`current.isPending` 時不渲染 picker（改顯示 Skeleton），或把 `disabled` 設為 `!current.data`。另外可以把「將新增 N 項、移除 M 項」列在 footer，讓使用者送出前看清楚。
- **驗收**：用 MSW 延遲 `get-role-permissions` 3 秒，這段時間內 picker 不可操作；儲存前畫面顯示新增與移除的數量。
- **狀態**：已修（fix/backstage-ux）——已驗證屬實：頁面測試讓 `get-role-permissions` 延遲回應，舊程式在載入中就渲染勾選框。改為載入完成前顯示骨架、不能儲存，footer 顯示將新增／移除幾項

### UX-03 角色「編輯」「複製」失敗完全沒有提示

- **嚴重度**：P1
- **位置**：[apps/backstage/src/features/role/hooks/useRoleMutations.ts:26](../../apps/backstage/src/features/role/hooks/useRoleMutations.ts)（`useRoleUpdateMutation` 26–37、`useRoleDuplicateMutation` 54–70）；呼叫端 [RoleBasicSection.tsx:64](../../apps/backstage/src/features/role/pages/RoleDetail/components/RoleBasicSection.tsx)、[RoleDetail/page.tsx:53](../../apps/backstage/src/features/role/pages/RoleDetail/page.tsx)
- **現況**：這兩個 hook 沒有 `onError`，呼叫端又用 `.catch(() => undefined)` 把錯誤吞掉。`queryClient` 也沒有全域的 mutation 錯誤 toast（[core/cache/queryClient.ts](../../apps/backstage/src/core/cache/queryClient.ts)），只有 `PermissionDriftWatcher` 處理 403。
- **影響**：角色改名撞到 `ROLE_NAME_DUPLICATE`、名稱留空觸發 `VALIDATION_FAILED`、網路中斷時，畫面什麼都不說：編輯區關掉、名稱變回原樣，或複製按鈕轉一圈就停了。使用者只能猜。
- **建議**：比照同檔的 `useRoleDeleteMutation`，補上 `onError: useErrorToast()`。長期可以在 `MutationCache` 設一個全域 `onError`，`meta.silent` 用來讓呼叫端自己處理錯誤的情況退出。
- **驗收**：讓 update／duplicate 回 409／500，都會出現本地化的錯誤 toast。
- **狀態**：已修（fix/backstage-ux）——`useRoleUpdateMutation`、`useRoleDuplicateMutation` 補 `onError: useErrorToast()`

### UX-04 就地編輯失敗時仍關閉編輯區／對話框，使用者輸入直接丟失

- **嚴重度**：P1
- **位置**：[UserBasicSection.tsx:77](../../apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx)（77–82）、[RoleBasicSection.tsx:64](../../apps/backstage/src/features/role/pages/RoleDetail/components/RoleBasicSection.tsx)（64–69）、[RoleDetailPermission/page.tsx:55](../../apps/backstage/src/features/role/pages/RoleDetailPermission/page.tsx)（55–62）；同樣的模式也在 [apps/auth TenantDetail/page.tsx:178](../../apps/auth/src/features/tenant/pages/TenantDetail/page.tsx)（停用失敗仍關閉）
- **現況**：寫法都是 `await mutation.mutateAsync(...).catch(() => undefined); setEditing(false)` 或 `close()`，不管成功或失敗都會離開編輯狀態。
- **影響**：在權限挑選器勾了幾十個權限，儲存失敗（例如 `AUTHZ_ESCALATION`）後對話框直接關掉，全部要重來。
- **建議**：只在成功時關閉，失敗時保留草稿並就地顯示錯誤。可以參考 `ApprovalRowActions` 的 `reportError` 重拋模式，或 `UserCreate` 的 `formError`。
- **驗收**：讓 API 回 409，編輯區維持開啟、輸入值不變，並顯示錯誤訊息。
- **狀態**：已修（fix/backstage-ux）——角色／使用者就地編輯與權限對話框只在成功時關閉，失敗保留輸入並提示（apps/auth 的 TenantDetail 由 apps/auth 組處理）

### UX-05 編輯被鎖定使用者的顯示名稱會順便把帳號解鎖；改成停用沒有確認

- **嚴重度**：P1
- **位置**：[UserBasicSection.tsx:42](../../apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx)（42、58–67、79）
- **現況**：進入編輯時執行 `setStatus(user.status === 'locked' ? 'active' : user.status)`，儲存時一律送出 `{ displayName, status }`。狀態下拉沒有「鎖定」選項，也沒有說明。改成「停用」直接生效，不像批次停用那樣提示「他們會立即被登出」（`user.batch.deactivate.confirm`）。
- **影響**：管理者只想改名字，卻把一個因為暴力嘗試而被鎖的帳號解鎖了，而且不會察覺。改成停用時，對方正在做的事會被立刻中斷，管理者事先也不知道。
- **建議**：只送出有變動的欄位。鎖定狀態下把下拉顯示為「鎖定」，並另外提供明確的「解鎖」按鈕。狀態改成停用時跳出確認，文案沿用批次停用的說明。
- **驗收**：鎖定的使用者只改顯示名稱，儲存後仍是鎖定；active 改成 inactive 會先確認。
- **狀態**：已修（fix/backstage-ux）——只送出有變動的欄位；鎖定時狀態顯示為「鎖定」並提供「解鎖」鈕；改成停用先確認

### UX-06 「重設密碼」單擊即寄信，沒有確認，緊貼刪除鈕

- **嚴重度**：P1
- **位置**：[UserTable.tsx:140](../../apps/backstage/src/features/user/pages/UserList/components/UserTable.tsx)（140–151）；後端 [user.service.ts:277](../../apps/api/src/modules/user/user.service.ts)
- **現況**：鑰匙圖示直接 `resetPassword.mutate(...)`。後端會排入重設密碼信並寫稽核，按鈕沒有 pending 狀態（整列共用同一個 mutation）。
- **影響**：誤點就會寄信給使用者並留下稽核紀錄，連點會寄出多封。這顆圖示和刪除鈕並排，都是只有圖示的按鈕，很容易點錯。
- **建議**：加上 `useConfirm`（「會寄送重設連結到 `{{email}}`」），並以列為單位追蹤 pending（例如 `mutation.variables?.params.userId === row.id`）。
- **驗收**：點鑰匙會先確認；送出中按鈕是 loading 狀態；連點只送出一次。
- **狀態**：已修（fix/backstage-ux）——先確認寄到哪個 Email；以列為單位顯示 loading，確認框送出中不能重按

### UX-07 列表查詢失敗時顯示「沒有資料」，沒有錯誤狀態與重試

- **嚴重度**：P1
- **位置**：[UserList/page.tsx:35](../../apps/backstage/src/features/user/pages/UserList/page.tsx)、[RoleList/page.tsx:32](../../apps/backstage/src/features/role/pages/RoleList/page.tsx)、[components/Table/Table.tsx:222](../../apps/backstage/src/components/Table/Table.tsx)、[RichTable.tsx:186](../../apps/backstage/src/core/components/RichTable/RichTable.tsx)
- **現況**：列表頁只取 `{ data, isPending }`。`Table`／`RichTable` 沒有 `error` prop，查詢失敗時 `data` 是 undefined，畫面落到空狀態「沒有資料」。在 features 裡搜尋 `isError`，只有 apps/auth 的 `TenantDetail` 與檔案管理器有處理。
- **影響**：後端 5xx、逾時或 429 時，管理者看到「沒有資料」，會以為使用者或角色被刪光了，這在企業後台很嚇人。而且除了切回視窗觸發 refetch 之外，沒有重試入口。
- **建議**：`RichTable` 加上 `error` 與 `onRetry`，用 `Empty` 顯示 `useErrorMessage(error)` 加一顆「重試」按鈕。有舊資料時（`keepPreviousData`）保留舊資料，在上方顯示警示列。
- **驗收**：讓 `get-user-list` 回 500，表格顯示錯誤訊息與重試鈕，不會顯示「沒有資料」。
- **狀態**：已修（fix/backstage-ux）——`RichTable` 新增 `error`／`onRetry`；使用者與角色列表已接上（其他列表可比照傳入）

### UX-08 `/auth/profile` 失敗時整個 app 停在骨架屏，沒有出路

- **嚴重度**：P1
- **位置**：[features/auth/hooks/useSyncPermissions.ts:16](../../apps/backstage/src/features/auth/hooks/useSyncPermissions.ts)（16–23）、[app/Layout.tsx:40](../../apps/backstage/src/app/Layout.tsx)（38–46）、[core/store/permission.ts:19](../../apps/backstage/src/core/store/permission.ts)
- **現況**：只有 `setPermissions` 會把 `hydrated` 設成 true。profile 查詢失敗（5xx、逾時、`TENANT_UNAVAILABLE` 503）時不會 setPermissions，Layout 一直渲染 `PageSkeleton`，側欄也是空的（`useMenuGroups` 未水合時回傳 `[]`）。
- **影響**：上線尖峰、租戶佈建中或維護時，使用者看到的是永遠在轉的骨架屏，沒有錯誤說明，也沒有重試入口。
- **建議**：`useSyncPermissions` 回傳 `isError` 與 `refetch`，Layout 在 gated 且失敗時顯示錯誤頁（可沿用 `UnexpectedErrorPage onRetry`）。`TENANT_UNAVAILABLE` 用它自己的說明文案。
- **驗收**：讓 `/auth/profile` 回 503，畫面顯示錯誤頁與重試鈕，按下重試成功後進入頁面。
- **狀態**：已修（fix/backstage-ux）——Layout 在 profile 查詢失敗時顯示原因（例：`TENANT_UNAVAILABLE`）與重試

### UX-09 Router 沒設定 404／錯誤頁：未知網址與 chunk 載入失敗顯示框架預設英文畫面

- **嚴重度**：P1
- **位置**：[apps/backstage/src/app/plugin.ts:10](../../apps/backstage/src/app/plugin.ts)（10–18）、[apps/auth/src/app/plugin.ts:9](../../apps/auth/src/app/plugin.ts)、[core/components/ErrorPage/ErrorPage.tsx:40](../../apps/backstage/src/core/components/ErrorPage/ErrorPage.tsx)（40–69）
- **現況**：`createRouter` 沒有設定 `defaultNotFoundComponent`／`defaultErrorComponent`。已經寫好的 `NotFoundPage`、`UnexpectedErrorPage` 在整個 repo 沒有被引用（grep 結果為零）。
- **影響**：打錯網址、書籤指向舊路由時，會看到 TanStack Router 預設的英文「Not Found」。部署新版後，舊分頁 lazy 載入舊 chunk 失敗（1000 人在線時一定會遇到），畫面變成框架預設的錯誤畫面，可能還帶技術訊息。
- **建議**：兩個 app 都設定 `defaultNotFoundComponent: NotFoundPage`、`defaultErrorComponent`。錯誤元件要辨識 chunk 載入失敗（`Failed to fetch dynamically imported module`），這種情況提示「系統已更新，請重新整理」並附一顆重新整理按鈕。
- **驗收**：進入 `/not-exist` 顯示本地化的 404；把 chunk 檔刪掉後切換頁面，顯示「重新整理」提示。
- **狀態**：已修 apps/auth 部分（fix/auth-ux）——`defaultNotFoundComponent`／`defaultErrorComponent`／`defaultPendingComponent`（`app/ErrorPages.tsx`），chunk 載入失敗提示重新整理；backstage 部分由 backstage 組處理
- **狀態**：已修（fix/backstage-ux）（backstage）——router 設定預設的 404、錯誤頁與載入中；舊 chunk 載入失敗提示「系統已更新」（apps/auth 由 apps/auth 組處理）

### UX-10 表單驗證訊息是 Zod 的英文技術字串

- **嚴重度**：P1
- **位置**：[apps/backstage/src/shared/hooks/form.ts:11](../../apps/backstage/src/shared/hooks/form.ts)（11–22，直接使用 `issue.message`）；Schema 在 [UserCreate/page.tsx:21](../../apps/backstage/src/features/user/pages/UserCreate/page.tsx)、[RoleCreate/page.tsx:18](../../apps/backstage/src/features/role/pages/RoleCreate/page.tsx)、[apps/auth Interaction/page.tsx:23](../../apps/auth/src/features/login/pages/Interaction/page.tsx)、[ForgotPassword/page.tsx:17](../../apps/auth/src/features/login/pages/ForgotPassword/page.tsx)；寫死的英文在 [Register/page.tsx:27](../../apps/auth/src/features/login/pages/Register/page.tsx)、[Setup/page.tsx:24](../../apps/auth/src/features/login/pages/Setup/page.tsx)、[ResetPassword/page.tsx:23](../../apps/auth/src/features/login/pages/ResetPassword/page.tsx)
- **現況**：repo 沒有設定 zod 的 error map 或 locale（grep `z.config`／`errorMap` 為零）。實測 zod 4.6 的預設訊息是 `Too small: expected string to have >=1 characters`、`Invalid email address`。三個密碼頁的不一致訊息寫死成 `'passwords do not match'`。
- **影響**：登入、註冊、建立使用者這些最常用的表單，在繁中介面顯示英文技術訊息，而且把「最少 1 字元」這種規則描述當成錯誤說明。相對地，IdP、租戶、平台管理者的表單已經用 `t('xxx.error.*')` 本地化，全站體驗不一致。
- **建議**：在 i18n plugin 初始化時用 `z.config({ customError })` 依 issue code（`too_small`、`too_big`、`invalid_format`）對應到 `validation.*` 語系鍵，並跟著語系切換。refine 的 message 改成語系鍵，在 `firstError` 裡翻譯。
- **驗收**：繁中介面下，登入頁空白送出顯示「請輸入 Email」之類的中文；切到英文後顯示英文友善訊息。畫面上不再出現 `>=`。
- **狀態**：已修 apps/auth 部分（fix/auth-ux）——`core/locales/zodErrorMap.ts` 設為 Zod 全域 `customError`（`validation.*`），三個密碼頁的不一致訊息改用 `params.messageKey`；`shared/hooks/form.ts` 不必改（`issue.message` 已是語系文字）。backstage 可照同一個檔案同步
- **狀態**：已修（fix/backstage-ux）——`core/locales/zodErrorMap.ts`（與 apps/auth 相同）由 i18n plugin 設定 Zod 全域 customError；`shared/hooks/form.ts` 不需要改（訊息在 Zod 產生 issue 時就已翻譯）

### UX-11 偏好頁的「時區」「語言」對日期顯示完全無效

- **嚴重度**：P1
- **位置**：[apps/backstage/src/shared/date/index.ts:10](../../apps/backstage/src/shared/date/index.ts)（預設 `'zh-TW'` 與 `DEFAULT_TIMEZONE = 'Asia/Taipei'`）；設定入口 [Preference/page.tsx:62](../../apps/backstage/src/features/account/pages/Preference/page.tsx)（62–71）；稽核篩選 [AuditLogList/page.tsx:33](../../apps/backstage/src/features/audit-log/pages/AuditLogList/page.tsx)
- **現況**：全 repo 20 多處 `formatDateTime(...)` 都沒有傳 `options`（UserTable、RoleTable、AuditLogTable、ApprovalTable、JobTable、apps/auth 的各列表），`useTimezoneStore` 只有偏好頁本身在讀。稽核日誌的日期篩選則用瀏覽器本地時區（`new Date('YYYY-MM-DDT00:00:00')`）。
- **影響**：海外分公司的使用者把時區改成 UTC 或 America/New_York，列表仍顯示台北時間，英文介面也顯示中文格式的日期。稽核日誌「篩選用本機時區、顯示用台北時區」，查事件時間軸時可能差一天。
- **建議**：提供 `useFormatDateTime()`，從 `useTimezoneStore` 與 `useLocaleStore` 取值後呼叫 `formatDateTime`。稽核篩選的日界線改用同一個時區轉換。
- **驗收**：偏好時區改成 UTC 後，列表時間立即位移 8 小時；語言切成英文後日期是英文格式。
- **狀態**：已修（fix/backstage-ux）——`shared/date` 的預設語系與時區由 i18n plugin 依偏好設定；稽核篩選的日界線改用同一個時區（`zonedDayBoundary`）

### UX-12 Session 結束：不說原因（一律「你已登出」）、只保留 pathname、未存資料全失

- **嚴重度**：P1
- **位置**：[apps/backstage/src/app/App.tsx:37](../../apps/backstage/src/app/App.tsx)（37–53）、[core/auth/SessionStore.ts:149](../../apps/backstage/src/core/auth/SessionStore.ts)、[plugins/fetcher/refresh-token.ts:18](../../apps/backstage/src/plugins/fetcher/refresh-token.ts)、[features/auth/pages/Login/page.tsx:31](../../apps/backstage/src/features/auth/pages/Login/page.tsx)、[features/auth/locales/zh_TW.json](../../apps/backstage/src/features/auth/locales/zh_TW.json)（`auth.login.signedOut`）
- **現況**：`endSession(reason)` 會帶原因（`AUTH_REFRESH_EXPIRED`、`AUTH_REFRESH_REUSED`、`AUTH_ACCOUNT_DISABLED`、`password_changed`、`logout`），但 `ended` 的監聽器丟掉了 reason，一律帶 `signedOut: true`。登入頁只顯示「你已登出。所有產品共用同一組登入……」。`redirect` 只取 `location.pathname`，查詢字串（列表篩選、分頁）與子路由狀態都會遺失。session 結束時所有分頁會同時跳轉，表單草稿沒有保存。
- **影響**：使用者沒有按登出卻看到「你已登出」，不知道是逾時、被停用，還是被偵測到憑證重用而登出所有裝置（`error.AUTH_REFRESH_REUSED` 其實已經有很好的說明文案）。重新登入後篩選條件消失，正在填的表單也不見了。
- **建議**：把 reason 帶到登入頁（例如 `?reason=AUTH_REFRESH_EXPIRED`），用 `getErrorMessageKey` 顯示對應文案，`logout`／`password_changed` 用各自的文案。`redirect` 改帶 `pathname + search`。長期可以考慮在 access token 快過期前提示，或把建立與編輯表單的草稿暫存在 sessionStorage。
- **驗收**：讓 refresh 回 `AUTH_REFRESH_EXPIRED`，登入頁顯示「登入已過期」；在 `/user?status=locked&offset=40` 被登出，重新登入後回到同一個網址。
- **狀態**：已修 apps/auth 部分（fix/auth-ux）——`SessionWatcher` 帶 `?reason=`、`redirect` 改帶 pathname＋search，登入頁依原因說明（`features/login/sessionEnd.ts`）；backstage 部分由 backstage 組處理
- **狀態**：已修（fix/backstage-ux）——登入頁依 `?reason=` 說明原因（對照同 apps/auth 的 `sessionEnd.ts`，另有「密碼已變更」）；`redirect` 帶 pathname＋search。表單草稿暫存（sessionStorage）未做：改以未儲存提醒（UX-17）降低損失

### UX-13 忘記密碼在 429／網路錯誤時仍顯示「已寄出」

- **嚴重度**：P1
- **位置**：[apps/auth/src/features/login/pages/ForgotPassword/page.tsx:28](../../apps/auth/src/features/login/pages/ForgotPassword/page.tsx)（28–34）
- **現況**：`await forgot.mutateAsync(...).catch(() => undefined); setSent(true);` 把所有錯誤都吞掉並顯示成功。
- **影響**：帳號列舉防護只要求「email 存不存在」回應相同。但網路中斷、`RATE_LIMITED`、`TENANT_UNAVAILABLE` 也被顯示成「已寄出」，使用者會一直等一封不會來的信，然後打電話給客服。
- **建議**：只有 2xx 才 `setSent(true)`。`AppError` 的 429、5xx 與網路錯誤用 `useErrorMessage` 顯示在表單內。後端本來就對存在與不存在的 email 回同樣的 200，不會破壞防護。
- **驗收**：模擬 429 或斷網，畫面顯示錯誤訊息，不會顯示「已寄出」。
- **狀態**：已修（fix/auth-ux）——只有成功才顯示「已寄出」，429／503／網路錯誤在表單內顯示

### UX-14 3 個後端錯誤碼沒有翻譯，且測試用手抄清單沒擋住

- **嚴重度**：P1
- **位置**：[apps/api/src/core/errors/error-code.ts:108](../../apps/api/src/core/errors/error-code.ts)（108、111、112）、[apps/backstage/src/core/errors/errorMessageKey.ts](../../apps/backstage/src/core/errors/errorMessageKey.ts)、[apps/backstage/src/app/__tests__/locales.test.ts:12](../../apps/backstage/src/app/__tests__/locales.test.ts)
- **現況**：後端有 71 個錯誤碼。`FILE_FOLDER_SYSTEM_PROTECTED`（403）、`FILE_ACCESS_ALREADY_GRANTED`（409）、`FILE_ACCESS_REQUEST_NOT_FOUND`（404）不在兩個 app 的 `ERROR_MESSAGE_KEY` 裡，兩個語系檔也沒有 `error.<CODE>`。它們分別由 [file-folder.service.ts:483](../../apps/api/src/modules/file/file-folder.service.ts) 與 [file-access-request.service.ts:48](../../apps/api/src/modules/file/file-access-request.service.ts)、`:136` 拋出。`locales.test.ts` 的 `ERROR_CODES` 是手抄清單，所以沒有抓到。
- **影響**：刪除或改名系統資料夾、重複申請已有的存取權時，使用者看到的是「發生未預期的錯誤（代碼 xxx），請聯絡管理員」，而實際上這是可以預期、可以自行排除的業務錯誤。
- **建議**：補上三個鍵與中英文文案。測試改成直接 import 後端的 `ErrorCode`（或由 openapi／SDK 匯出錯誤碼清單），不要再手抄。
- **驗收**：`locales.test.ts` 以後端清單為來源；對系統資料夾執行刪除時顯示明確的中文說明。
- **狀態**：已修（fix/backstage-ux）——兩個 app 的 `locales.test.ts` 改讀後端 `ALL_ERROR_CODES`；補上三個錯誤碼的鍵與中英文案（apps/auth 的 `core/errors` 與語系檔依同步規則一併補）

### UX-15 刪除租戶與關閉外部 IdP 這類高影響操作，確認強度不足

- **嚴重度**：P1
- **位置**：[apps/auth/src/features/tenant/pages/TenantDetail/page.tsx:183](../../apps/auth/src/features/tenant/pages/TenantDetail/page.tsx)（183–199 刪除）、[:296](../../apps/auth/src/features/tenant/pages/TenantDetail/page.tsx)（296–313 外部 IdP 開關）
- **現況**：刪除租戶只有一般的 AlertDialog，文案有說明影響（網域釋出、資料不會立即清除），但按一次確認就執行。外部 IdP 的 `Checkbox` 一取消勾選就直接 PATCH，沒有任何確認。
- **影響**：刪除租戶會影響整個租戶的全部使用者。關掉外部 IdP 後，設定為 ssoOnly 網域的使用者可能立刻無法登入（**待驗證**：後端關閉後既有連線的登入行為）。這兩個動作都只是一個 click 的距離。
- **建議**：刪除租戶要求輸入租戶代碼才能按確認（GitHub 式 type-to-confirm）。外部 IdP 關閉時用 `useConfirm` 說明「使用 SSO 的使用者將無法以外部帳號登入」，最好附上受影響的連線數或網域數。
- **驗收**：刪除按鈕在輸入代碼前是停用狀態；取消勾選外部 IdP 會先跳確認。
- **狀態**：已修（fix/auth-ux）——刪除租戶要輸入租戶代碼；關閉外部 IdP 先確認並說明影響（已驗證：關閉後 discovery 當作沒有連線，只允許 SSO 的網域回到密碼登入，沒有密碼的 SSO 使用者要先重設密碼）。受影響的連線數需要跨租戶查詢，未附

### UX-16 頂列看不到目前租戶與使用者身分；帳號選單的無障礙名稱是「M」

- **嚴重度**：P1
- **位置**：[apps/backstage/src/app/layouts/DashboardLayout.tsx:66](../../apps/backstage/src/app/layouts/DashboardLayout.tsx)（66–70：`<Avatar name="Me" />`）、[:48](../../apps/backstage/src/app/layouts/DashboardLayout.tsx)（品牌區只顯示 `app.title`）
- **現況**：外框沒有顯示租戶名稱、使用者名稱或 email。帳號選單觸發鈕的內容是 Avatar 的縮寫「M」，這也是它唯一的無障礙名稱。backstage 內沒有「切換租戶」入口，要換租戶得自己到 apps/auth 的 `/enter`。
- **影響**：需要管理多個租戶的顧問或 MSP 人員開著好幾個分頁時，分不清自己在哪個租戶，可能在錯的租戶刪人或改權限。螢幕報讀器把帳號選單讀成「M 按鈕」。
- **建議**：頂列或側欄品牌區顯示租戶名稱（`get-current-tenant` 已經有 API），Avatar 用 profile 的 displayName，觸發鈕加 `aria-label={t('menu.account', { name })}`。帳號選單加「切換租戶」連到 apps/auth 的 `/enter`。
- **驗收**：任何頁面都看得到目前租戶名稱；報讀器唸出使用者名稱；帳號選單有切換租戶的入口。
- **狀態**：已修（fix/backstage-ux）——品牌區顯示租戶名稱；帳號選單以使用者名稱命名並顯示頭像與名稱；加上「切換租戶」連到 apps/auth 的 `/enter`

### UX-17 表單對話框點遮罩／Esc 就關閉，全站沒有「未儲存離開」提醒

- **嚴重度**：P1
- **位置**：[components/Dialog/Dialog.tsx:38](../../apps/backstage/src/components/Dialog/Dialog.tsx)（`dismissible = true` 為預設值，53）、[UserCreate/page.tsx:64](../../apps/backstage/src/features/user/pages/UserCreate/page.tsx)、[RoleCreate/page.tsx:57](../../apps/backstage/src/features/role/pages/RoleCreate/page.tsx)、[RoleDetailPermission/page.tsx:43](../../apps/backstage/src/features/role/pages/RoleDetailPermission/page.tsx)
- **現況**：全 repo 搜尋 `useBlocker`／`beforeunload`／dirty guard，結果為零。建立使用者、建立角色（含權限挑選器）、調整角色權限都是以 route 呈現的對話框，點遮罩、按 Esc、按瀏覽器返回都會直接關閉。
- **影響**：在權限挑選器勾了幾十項，一個誤點遮罩就全部歸零。
- **建議**：表單類對話框改用 `dismissible={false}`，並在 dirty 時用 `useConfirm` 詢問「放棄變更？」。route 層面用 TanStack Router 的 `useBlocker` 攔截返回與換頁，頁面型表單（Profile）另外處理 `beforeunload`。
- **驗收**：RoleCreate 勾選後點遮罩或按 Esc，會跳出放棄確認；沒有改動時直接關閉。
- **狀態**：已修（fix/backstage-ux）——`core/router` 的 `useUnsavedChangesGuard`（`useBlocker`＋`beforeunload`）：建立使用者／角色、權限對話框、就地編輯、角色指派、個人資料頁有改動時離開先確認。遮罩與 Esc 也是導覽，一起被攔下，所以不必改 `dismissible`

### UX-18 刪除角色的確認不說明持有人數；`ROLE_IN_USE` 之後沒有下一步

- **嚴重度**：P2
- **位置**：[RoleList/page.tsx:96](../../apps/backstage/src/features/role/pages/RoleList/page.tsx)（96–111）、[role/pages/RoleList/adapter.ts:33](../../apps/backstage/src/features/role/pages/RoleList/adapter.ts)、[apps/api/src/modules/role/role.service.ts:239](../../apps/api/src/modules/role/role.service.ts)、[core/errors/useErrorMessage.ts:26](../../apps/backstage/src/core/errors/useErrorMessage.ts)
- **現況**：單筆刪除的 `canDelete` 只檢查非系統角色（批次刪除有檢查 `userCount === 0`）。確認文案是「確定要刪除角色「X」嗎？此操作無法復原」，沒有提到持有人數。後端在有人持有時丟出 `ROLE_IN_USE { userCount }`，前端的 `useErrorMessage` 不把 `details` 帶進 `t()`，只顯示「仍有使用者持有這個角色」。後端支援 `force`，UI 卻沒有對應的路徑。
- **影響**：使用者確認後才被拒絕，而且不知道有幾個人持有、要去哪裡處理。
- **建議**：確認框直接顯示「目前有 N 位使用者持有」。N > 0 時，提供「前往持有者清單」或需要二次確認的「仍要刪除（N 人將失去此角色）」。`useErrorMessage` 把 `error.details` 當作插值參數。
- **驗收**：刪除一個有 3 位持有者的角色，確認框寫明 3 人，並提供後續動作。
- **狀態**：已修（fix/backstage-ux）——確認框寫明持有人數並直接提供「仍要刪除（N 人將失去此角色）」（`force`）；`useErrorMessage` 以 `details` 插值

### UX-19 後端欄位錯誤（`details.fields`）沒有回填到欄位

- **嚴重度**：P2
- **位置**：[core/errors/AppError.ts:13](../../apps/backstage/src/core/errors/AppError.ts)（`fieldErrors` getter 沒有任何呼叫端）、[components/Form](../../apps/backstage/src/components/Form)（features 未使用）、[UserCreate/page.tsx:55](../../apps/backstage/src/features/user/pages/UserCreate/page.tsx)
- **現況**：`VALIDATION_FAILED` 的欄位細節與 `USER_EMAIL_DUPLICATE` 之類的錯誤，一律用 `toMessage(error)` 顯示在表單底部。前端 schema 也比後端寬鬆：email 沒有 `max(255)`，roleIds 沒有 `max(20)`，密碼沒有 `max(128)`（對照 [create-user.dto.ts:8](../../apps/api/src/modules/user/dto/create-user.dto.ts)、[password.ts:55](../../apps/api/src/modules/auth/password.ts)）。輸入框沒有設 `maxLength`。
- **影響**：使用者看到「輸入內容不正確，請檢查後再試」，卻不知道是哪一欄。Email 重複時，錯誤顯示在離 Email 欄很遠的底部。
- **建議**：送出失敗時，用 `form.setFieldMeta` 把 `fieldErrors` 與已知的欄位衝突碼（`USER_EMAIL_DUPLICATE` → email）回填到欄位並聚焦第一個錯誤欄位。前端 schema 對齊後端上限，並設定 `maxLength`。
- **驗收**：建立使用者時用已存在的 email，錯誤出現在 Email 欄下方，焦點也移到該欄。
- **狀態**：已修（fix/backstage-ux）——`core/errors` 的 `useServerFieldErrors`：衝突碼與 `details.fields` 回填到欄位並聚焦；schema 與 `maxLength` 對齊後端上限（email 255、名稱 100、角色最多 20 個）

### UX-20 建立使用者按 Enter 不送出；就地編輯區不是 `<form>`

- **嚴重度**：P2（依 HTML 隱式送出規則推論，**待瀏覽器驗證**）
- **位置**：[UserCreate/page.tsx:68](../../apps/backstage/src/features/user/pages/UserCreate/page.tsx)（送出鈕在 Dialog `footer`，位於 `<form>`〔82〕之外）、[RoleBasicSection.tsx:45](../../apps/backstage/src/features/role/pages/RoleDetail/components/RoleBasicSection.tsx)、[UserBasicSection.tsx:53](../../apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx)、[Profile/page.tsx:60](../../apps/backstage/src/features/account/pages/Profile/page.tsx)
- **現況**：沒有送出鈕的 form 若有超過一個會阻擋隱式送出的欄位（email、displayName、username 三個 input），按 Enter 不會送出。就地編輯與個人資料頁完全沒有 `<form>`。所有表單都沒有自動聚焦第一個欄位（grep `autoFocus`／`initialFocus` 在 features 為零）。
- **影響**：鍵盤使用者填完表單按 Enter 沒有反應，要切到滑鼠。RoleCreate 只有一個 input，所以 Enter 有效，兩個頁面行為不一致。
- **建議**：footer 的送出鈕加 `form={formId}` 與 `type="submit"`，或讓 Dialog 支援 `as="form"`。就地編輯改用 `<form onSubmit>`。對話框打開時聚焦第一個欄位（Base UI Dialog 的 `initialFocus`）。
- **驗收**：建立使用者在任一欄按 Enter 都會觸發驗證並送出；開啟時游標在 Email 欄。
- **狀態**：已修（fix/backstage-ux）——已驗證屬實（送出鈕在 `<form>` 外）。送出鈕以 `form` 屬性連回表單；就地編輯與個人資料改用 `<form>`；就地編輯進入時聚焦第一欄（對話框本來就由 Base UI 聚焦第一個可聚焦元素）

### UX-21 詳情對話框的深層連結指向已刪除資源時是一個空白對話框

- **嚴重度**：P2
- **位置**：[UserDetail/page.tsx:45](../../apps/backstage/src/features/user/pages/UserDetail/page.tsx)（25、45–47）、[RoleDetail/page.tsx:82](../../apps/backstage/src/features/role/pages/RoleDetail/page.tsx)（26、82–84）
- **現況**：只處理 `isPending` 與 `data` 兩種狀態，`isError`（`USER_NOT_FOUND`、`ROLE_NOT_FOUND`）時對話框標題顯示預設的「使用者詳情」，內容空白。
- **影響**：同事貼來的連結、瀏覽器歷史，或另一個分頁剛刪掉的資源，開起來都是一個空白框，看不出發生什麼事。
- **建議**：錯誤時在對話框內用 `Empty` 顯示 `useErrorMessage(error)`，附「回到列表」按鈕。404 時可以自動關閉並跳一則 toast。
- **驗收**：開啟 `/user/<不存在的 id>`，顯示「找不到這個使用者」與返回按鈕。
- **狀態**：已修（fix/backstage-ux）——錯誤時顯示原因與「回到列表」（404 不提供重試）

### UX-22 分頁只有上一頁／下一頁，千筆資料難以操作；刪到空頁不回退

- **嚴重度**：P2
- **位置**：[components/Pagination/Pagination.tsx:72](../../apps/backstage/src/components/Pagination/Pagination.tsx)（72–92）、[RichTable.tsx:201](../../apps/backstage/src/core/components/RichTable/RichTable.tsx)、[useUserSearchFilter.ts:26](../../apps/backstage/src/features/user/pages/UserList/useUserSearchFilter.ts)
- **現況**：分頁只有上一頁與下一頁，沒有第一頁、最後一頁或跳頁。摘要是 `${from}-${to} / ${total}`，沒有千分位，也沒有用現成的 `common.total`。在最後一頁刪到沒有資料時，offset 不會回退，畫面停在「沒有資料」、頁碼顯示成 3 / 2 這種情況。
- **影響**：1,200 位使用者、每頁 20 筆就是 60 頁，要看最早建立的帳號得按 59 次（或改排序）。刪除後落到空頁，容易誤以為資料消失了。
- **建議**：加上首頁、末頁與可輸入的頁碼（或數字頁碼加省略號），摘要用 `Intl.NumberFormat`。資料回來後若 `offset >= total && total > 0`，自動 `setPage` 到最後一頁。
- **驗收**：60 頁的列表可以一步跳到第 60 頁；刪掉最後一頁唯一的一筆後回到上一頁；總數顯示 `1,200`。
- **狀態**：已修（fix/backstage-ux）——`Pagination` 加上第一頁、最後一頁與可輸入的頁碼；摘要用千分位；刪到空頁自動退回最後一頁

### UX-23 搜尋藏在篩選浮層；空結果不提供清除篩選；批次只能全選本頁

- **嚴重度**：P2
- **位置**：[core/components/RichTable/FilterBar/FilterBar.tsx:76](../../apps/backstage/src/core/components/RichTable/FilterBar/FilterBar.tsx)（76、101）、[useUserFilters.ts:28](../../apps/backstage/src/features/user/pages/UserList/useUserFilters.ts)、[app/locales/zh_TW.json](../../apps/backstage/src/app/locales/zh_TW.json)（`common.selectAll`：「全選本頁」）、[Table.tsx:222](../../apps/backstage/src/components/Table/Table.tsx)
- **現況**：關鍵字搜尋要先點最後一欄表頭的篩選鈕、打開 Popover 才能輸入。套用中的條件只在按鈕上顯示「篩選（n 個條件）」，不會列出具體條件。有篩選但沒有結果時，空狀態跟真的沒資料一樣是「沒有資料」。勾選只能「全選本頁」（跨頁保留，但沒有「選取全部 N 筆符合條件」）。
- **影響**：後台最常用的動作是找人，現在每次都要多點兩下。把 300 位離職者批次停用，得一頁一頁勾（每頁上限 200）。
- **建議**：列表上方常駐搜尋框（debounce 後寫進網址），套用中的篩選以可移除的 Chip 列出。空結果時顯示「沒有符合條件的結果」加上「清除篩選」。批次操作加上「選取全部符合的 N 筆」，交給後端依條件批次處理（或在佇列逐頁展開）。
- **驗收**：不開浮層就能搜尋；有篩選但沒結果時可以一鍵清除；可以對整個篩選結果執行批次停用。
- **狀態**：已修（fix/backstage-ux）（部分）——使用者與角色列表常駐搜尋框、套用中的篩選以 Chip 列出、空結果可清除篩選。「選取全部符合的 N 筆」延後——需要後端依條件批次處理的 API

### UX-24 沒有 RWD：側欄固定 15rem，小螢幕無法使用

- **嚴重度**：P2
- **位置**：[apps/backstage/src/app/layouts/DashboardLayout.css:7](../../apps/backstage/src/app/layouts/DashboardLayout.css)（7–12、`.ge-shell__content` 的 `padding: var(--seed-space-6)`）
- **現況**：`grid-template-columns: 15rem 1fr`，整份 CSS 沒有寬度相關的 `@media`（只有 prefers-reduced-motion）。收合狀態仍然佔 3.5rem。只有檔案管理器用了 `sm:`／`md:`。
- **影響**：375px 寬的手機上主內容只剩約 135px，列表、對話框都擠在一起。主管在手機上審批申請、臨時停用帳號之類的情境幾乎做不到。
- **建議**：`< 768px` 時側欄改成覆蓋式抽屜（預設收起），頂列漢堡鈕控制，內距縮小。列表在窄螢幕改用卡片或允許水平捲動，並固定第一欄。
- **驗收**：375×812 下側欄預設隱藏，審批列表與詳情可以完成核准。
- **狀態**：已修（fix/backstage-ux）——< 768px 側欄改成覆蓋式抽屜（預設收起），內距縮小；表格本來就可水平捲動、對話框寬度隨視窗。未改成卡片式列表

### UX-25 表單錯誤不會被報讀；必填只有 `aria-hidden` 的星號

- **嚴重度**：P2
- **位置**：[components/Field/Field.tsx:54](../../apps/backstage/src/components/Field/Field.tsx)（54–58）、[UserCreate/page.tsx:165](../../apps/backstage/src/features/user/pages/UserCreate/page.tsx)、[RoleCreate/page.tsx:127](../../apps/backstage/src/features/role/pages/RoleCreate/page.tsx)、[apps/auth Interaction/page.tsx:209](../../apps/auth/src/features/login/pages/Interaction/page.tsx)、[ApprovalReviewForm.tsx:67](../../apps/backstage/src/features/approval/pages/ApprovalDetail/components/ApprovalReviewForm.tsx)
- **現況**：表單層級的錯誤是普通的 `<p>`，沒有 `role="alert"` 或 `aria-live`。`Field` 的必填星號是 `aria-hidden`，而 `required` 沒有傳到 input（也沒有 `aria-required`）。
- **影響**：螢幕報讀器使用者按下登入後聽不到「帳號或密碼錯誤」，也不知道哪些欄位必填。
- **建議**：表單錯誤區加 `role="alert"`。`Field` 的 `required` 透過 Base UI Field 的 context 或 props 設到 control 上（`required` 或 `aria-required`），並對報讀器提供「必填」文字。
- **驗收**：在 VoiceOver 下送出錯誤的登入資料，會即時唸出錯誤訊息；必填欄位唸出「必填」。
- **狀態**：已修（fix/backstage-ux）——表單層級錯誤區加 `role="alert"`；`Field` 必填另有給報讀器的「必填」；`Input` 依 Field 錯誤補 `aria-invalid`

### UX-26 英文硬編碼的 aria-label 與「☰」文字圖示

- **嚴重度**：P2
- **位置**：[DashboardLayout.tsx:57](../../apps/backstage/src/app/layouts/DashboardLayout.tsx)（57–63：`aria-label="toggle sidebar"`、內容是字元 `☰`、沒有 `aria-expanded`）、[components/Pagination/Pagination.tsx:62](../../apps/backstage/src/components/Pagination/Pagination.tsx)（`aria-label="pagination"`、70 `"page size"`，`labels` prop 無法覆寫這兩個）、[components/Toast/Toast.tsx:115](../../apps/backstage/src/components/Toast/Toast.tsx)（`aria-label="close"`）；apps/auth 的同名元件相同
- **現況**：這些字串都繞過了 i18n。側欄開關沒有 `aria-expanded` 狀態。
- **影響**：繁中報讀器使用者會聽到英文的「toggle sidebar」「page size」，而且無從得知側欄目前是展開還是收合。
- **建議**：用 `t()` 傳入。Pagination 的 `labels` 擴充 `nav` 與 `pageSize`，Toast 的 close 由 `ToastHost` 傳入。側欄開關改用 `Icon` 並加上 `aria-expanded={!collapsed}`。
- **驗收**：`grep 'aria-label="[a-z]'` 在 features、app、components 為零；報讀器唸出中文與展開狀態。
- **狀態**：已修（fix/backstage-ux）——側欄開關改用 Icon、語系 aria-label 與 `aria-expanded`；Pagination、Toast 的名稱改走 `ComponentLabelsContext`（apps/auth 的元件複本已同步，app 層的 Host 待 apps/auth 接上）

### UX-27 輸入框邊框對比 1.30:1，未達 WCAG 1.4.11 的 3:1

- **嚴重度**：P2
- **位置**：[apps/backstage/src/themes/tokens.css:83](../../apps/backstage/src/themes/tokens.css)（`--color-border: --seed-gray-300 #dee2e6`）、[components/Input/Input.module.css:6](../../apps/backstage/src/components/Input/Input.module.css)、[themes/contrast.test.ts](../../apps/backstage/src/themes/contrast.test.ts)
- **現況**：Input 與 Checkbox 的邊框用 `--color-border`，在白底上是 1.30:1，在 `--color-bg` 上是 1.24:1（本次計算）。`contrast.test.ts` 只驗文字 token 與按鈕填色，沒有驗表單控制項的邊界。`--color-fg-muted` 在 `--color-fill` 上是 4.48:1，略低於 4.5（中性 Chip、停用欄位可能用到這個組合，**待驗證**實際組合）。
- **影響**：低視力使用者或在戶外強光下，很難看出輸入框在哪裡。
- **建議**：新增 `--color-border-control`（淺色約 `#8a929b`，≥ 3:1），給 Input／Select／Checkbox 使用。contrast test 增加「控制項邊框 × surface ≥ 3:1」以及「fg-muted × fill-subtle／fill ≥ 4.5」。
- **驗收**：contrast test 新增的斷言通過；深淺兩種主題下輸入框輪廓都清楚。
- **狀態**：已修（fix/backstage-ux）——新增 `--color-border-control`（淺色 3.67:1、深色 4.09:1），`--color-fg-muted` 微調到在 fill 上 ≥ 4.5:1；contrast test 新增斷言

### UX-28 登入流程的失敗回饋不完整（跳轉失敗、callback 重試、互動過期）

- **嚴重度**：P2
- **位置**：[apps/backstage/src/features/auth/pages/Login/page.tsx:31](../../apps/backstage/src/features/auth/pages/Login/page.tsx)（31–37）、[SsoCallback/page.tsx:66](../../apps/backstage/src/features/auth/pages/SsoCallback/page.tsx)、[apps/auth/src/features/login/pages/Interaction/page.tsx:91](../../apps/auth/src/features/login/pages/Interaction/page.tsx)（91–101）、[SsoError/page.tsx:15](../../apps/auth/src/features/login/pages/SsoError/page.tsx)
- **現況**：
  1. `startSsoLogin` 失敗時（例如 `get-current-tenant` 回 `TENANT_NOT_FOUND`／503）只把 `failed` 設為 true，description 仍然是「正在前往登入頁…」，沒有錯誤訊息。
  2. callback 失敗後的「登入」鈕呼叫 `startSsoLogin(undefined)`，原本的 `pending.returnTo` 就遺失了。
  3. IdP 互動過期時只顯示「登入頁已過期，請回到原本的網站重新登入」，沒有按鈕或連結。`SsoError` 頁也沒有下一步。
- **影響**：租戶停用、網址打錯、登入頁放太久這些常見情況下，使用者停在沒有出口的頁面，或登入後被帶到首頁而不是原本的頁面。
- **建議**：Login 頁失敗時用 `useErrorMessage` 顯示原因。callback 的重試帶上 `pending?.returnTo`。互動過期頁提供「重新開始登入」（有 client 資訊時導回該 client，沒有時導到 `/enter`）。
- **驗收**：讓 `get-current-tenant` 回 503，頁面顯示「這個租戶目前無法使用」；callback 失敗重試後回到原本的頁面。
- **狀態**：已修（fix/auth-ux）——兩個 app 的登入頁顯示失敗原因、callback 重試帶 `returnTo`；互動過期與 `/error` 頁提供「重新開始登入」

### UX-29 平台租戶列表沒有分頁、搜尋、篩選

- **嚴重度**：P2
- **位置**：[apps/auth/src/features/tenant/pages/TenantList/page.tsx:27](../../apps/auth/src/features/tenant/pages/TenantList/page.tsx)、[platform-admin/pages/PlatformAdminList/page.tsx:35](../../apps/auth/src/features/platform-admin/pages/PlatformAdminList/page.tsx)
- **現況**：`useQuery(getTenantListQueryOptions())` 不帶任何參數，routes 也沒有 `validateSearch`，一次渲染全部租戶，沒有搜尋或狀態篩選。
- **影響**：租戶一多，平台管理者要找「佈建失敗」或某個代碼的租戶，只能用瀏覽器的 Ctrl+F。
- **建議**：比照 backstage 的列表加上 `RichTable` 分頁、代碼／名稱搜尋、狀態篩選，條件存在網址。
- **驗收**：租戶列表可以依狀態篩出 `failed`，重新整理後條件仍在。
- **狀態**：已修（fix/auth-ux）——`GET /platform/tenants` 支援 `offset`／`limit`／`q`（代碼、名稱、網域）／`status`，前端條件存在網址；平台管理者清單（`PlatformAdminList`）人數少，維持不分頁

### UX-30 變更密碼沒有確認欄、沒有 autocomplete，改完直接顯示「你已登出」

- **嚴重度**：P2
- **位置**：[features/account/pages/Profile/page.tsx:98](../../apps/backstage/src/features/account/pages/Profile/page.tsx)（98–121、46）
- **現況**：只有「目前密碼」和「新密碼」兩欄，沒有「確認新密碼」，也沒有 `autoComplete="current-password"`／`"new-password"`。長度不足時按鈕只是停用（`newPassword.length < 12`），沒有即時說明。成功後 `endSession('password_changed')`，登入頁顯示的是通用的「你已登出」（見 UX-12）。
- **影響**：新密碼打錯一個字就會把自己鎖在外面。密碼管理器無法產生或儲存新密碼。改完密碼突然被登出，也沒有說明為什麼。
- **建議**：加上確認欄與強度或長度的即時提示，設定 autocomplete。送出前告知「變更後所有裝置都會登出」，登入頁顯示「密碼已變更，請用新密碼登入」。
- **驗收**：確認欄不一致時無法送出並顯示原因；Chrome 會提示儲存新密碼；改完後登入頁顯示對應說明。
- **狀態**：已修（fix/backstage-ux）——確認欄、autocomplete、長度即時說明、送出前確認「所有裝置都會登出」，登入頁顯示「密碼已變更」

### UX-31 429 訊息不帶可重試時間

- **嚴重度**：P3
- **狀態**：部分修正（fix/infra-tenancy）：後端 429 帶 Retry-After 與 details.retryAfterSeconds，兩個前端顯示「請在 N 秒後再試」。登入表單倒數期間停用送出鈕屬於前端表單，交給 UX 組
- **位置**：[plugins/fetcher/api-adapter.ts:14](../../apps/backstage/src/plugins/fetcher/api-adapter.ts)、[app/locales/zh_TW.json](../../apps/backstage/src/app/locales/zh_TW.json)（`error.RATE_LIMITED`）
- **現況**：`AppError` 只保留 code、status、details、requestId，沒有讀取 `Retry-After`。文案是「操作太頻繁，請稍後再試」。後端是否送出 `Retry-After` 標頭**待驗證**。
- **影響**：使用者不知道「稍後」是多久，會一直重試，讓限流持續更久。
- **建議**：adapter 讀取 `Retry-After` 放進 details，文案改成「請在 {{seconds}} 秒後再試」。登入類表單在倒數期間停用送出鈕。
- **驗收**：觸發限流時顯示秒數，倒數結束後按鈕恢復可按。

### UX-32 403／404 頁沒有「回首頁」；apps/auth 的載入 fallback 是空白

- **嚴重度**：P3
- **位置**：[core/components/ErrorPage/ErrorPage.tsx:28](../../apps/backstage/src/core/components/ErrorPage/ErrorPage.tsx)（28–50）、[apps/auth/src/app/Layout.tsx:21](../../apps/auth/src/app/Layout.tsx)（21–23）
- **現況**：`ForbiddenPage` 與 `NotFoundPage` 沒有傳 `action`。apps/auth 的 `PageFallback` 是一個空的 `div aria-busy`，沒有 spinner 或骨架。
- **影響**：使用者停在 403 只能靠側欄或上一頁離開。平台頁面載入時是一整片空白，看起來像當掉。
- **建議**：403／404 提供「回首頁」與「返回上一頁」，403 可以再附「複製網址給管理員」。apps/auth 的 fallback 改用 Skeleton 或 Spinner。
- **驗收**：403 頁有可點的返回動作；apps/auth 的慢速載入有視覺回饋。
- **狀態**：已修 apps/auth 部分（fix/auth-ux）——403／404 有「回首頁」「返回上一頁」，載入中改成 Spinner；backstage 的 `ErrorPage` 由 backstage 組處理
- **狀態**：已修（fix/backstage-ux）（backstage 部分）——403／404 有「回首頁」與「返回上一頁」

### UX-33 登入表單缺顯示密碼、Caps Lock 提示、自動聚焦；沒有「記住我」

- **嚴重度**：P3
- **位置**：[apps/auth/src/features/login/pages/Interaction/page.tsx:188](../../apps/auth/src/features/login/pages/Interaction/page.tsx)（160–206）
- **現況**：密碼欄沒有顯示／隱藏切換，沒有 Caps Lock 提示，Email 欄沒有 autoFocus，也沒有「記住我」或「保持登入」選項。autocomplete 設定正確（`username`／`current-password`）。
- **影響**：企業使用者每天登入，細節上的摩擦累積起來很可觀。是否提供「記住我」取決於資安政策（refresh token 的壽命），這是產品決策，**待確認**。
- **建議**：加上密碼顯示切換、Caps Lock 提示，Email 欄 autoFocus。如果政策允許，提供「在這台裝置保持登入 N 天」並延長 refresh 壽命；不允許的話，在登入頁說明 session 長度。
- **驗收**：密碼欄可以切換顯示；開著 Caps Lock 輸入時有提示；進頁面後游標在 Email 欄。
- **狀態**：已修（fix/auth-ux）——密碼顯示切換、Caps Lock 提示、互動載入後聚焦 Email；「記住我」已決定不做

### UX-34 Toast 不支援動作鈕（復原／重試）；軟刪除沒有復原入口

- **嚴重度**：P3
- **位置**：[components/Toast/Toast.tsx:31](../../apps/backstage/src/components/Toast/Toast.tsx)（`ToastOptions` 只有 type、title、description、timeout）、[features/user/locales/zh_TW.json](../../apps/backstage/src/features/user/locales/zh_TW.json)（`user.delete.confirm`：帳號會被軟刪除）
- **現況**：刪除使用者是軟刪除，但 UI 沒有「已刪除」檢視或復原功能。toast 無法附加動作。
- **影響**：刪錯人只能請工程師進資料庫處理。錯誤 toast 也不能直接按「重試」。
- **建議**：`ToastOptions` 增加 `action: { label, onClick }`。刪除使用者成功後的 toast 提供「復原」（需要後端 restore API），或者在使用者列表加上「已刪除」篩選。
- **驗收**：刪除使用者後 8 秒內可以一鍵復原。
- **狀態**：已修（fix/backstage-ux）（部分）——`ToastOptions.action` 支援動作鈕，`useToast().show()` 可附上。刪除使用者的「復原」延後——後端沒有 restore API

### UX-35 同一狀態在列表與詳情用不同色調

- **嚴重度**：P3
- **位置**：[UserBasicSection.tsx:93](../../apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx)、[UserTable.tsx:33](../../apps/backstage/src/features/user/pages/UserList/components/UserTable.tsx)（33–38）
- **現況**：列表用 `STATUS_TONE`（locked 是 danger、pending 是 warning），詳情頁只區分 active（success）和其他（neutral）。
- **影響**：同一個「鎖定」狀態，在列表是紅色，進到詳情變成灰色，會讓人誤判嚴重程度。
- **建議**：把 `STATUS_TONE` 移到 `features/user/constants.ts` 共用，或做成 `UserStatusChip` 業務元件。
- **驗收**：兩處同一個狀態顏色一致。
- **狀態**：已修（fix/backstage-ux）——`USER_STATUS_TONE` 移到 `features/user/constants.ts`，列表與詳情共用

### UX-36 設計系統元件的中文預設文案在英文介面漏出

- **嚴重度**：P3
- **位置**：[ApprovalReviewForm.tsx:31](../../apps/backstage/src/features/approval/pages/ApprovalDetail/components/ApprovalReviewForm.tsx)（31–47：有傳 `searchPlaceholder`，沒傳 `noMatchLabel`／`loadingLabel`）；預設值在 [components/Select/Select.tsx:318](../../apps/backstage/src/components/Select/Select.tsx)（318–325）
- **現況**：規範允許 `components/` 寫死預設文案，但 features 使用時必須傳入 `t()`（[docs/conventions/02-frontend.md](../conventions/02-frontend.md) §8）。這裡漏傳了。
- **影響**：英文介面搜尋角色、沒有結果時顯示「沒有符合的項目」。
- **建議**：在 core 層包一個 `LocalizedSelect`（或由 i18n plugin 提供元件預設文案的 context），一次補齊所有預設文案，不要每個呼叫端各自傳。
- **驗收**：英文介面下所有 Select 的空結果與載入文案都是英文。

---
- **狀態**：已修（fix/backstage-ux）——`components/labels.ts` 的 `ComponentLabelsContext`，app 以 `t()` 提供 Select 等元件的預設文案

## 已做得好的地方

- **錯誤訊息的退路設計正確**：不認得的錯誤碼顯示「未預期的錯誤（代碼 requestId）」，不會在畫面上露出原始 key；逾時與網路錯誤各有文案；使用者自己取消的請求與 session 結束時中止的請求不會跳 toast（[useErrorMessage.ts](../../apps/backstage/src/core/errors/useErrorMessage.ts)）。
- **兩個語系檔的鍵完全一致**：本次用腳本比對兩個 app 共 20 組 `en_US`／`zh_TW`，沒有缺漏的鍵（兩邊值相同的只有 Email、Issuer、Client ID 這類專有名詞）。
- **權限即時變動的自我修正**：`PermissionDriftWatcher` 收到 403 時 debounce、提示並重抓 profile，Layout 依 store 即時切換到 403 頁（[GlobalProvider.tsx:31](../../apps/backstage/src/app/GlobalProvider.tsx)）。未水合時不渲染操作按鈕，避免按鈕突然冒出來。
- **「為什麼不能按」一定看得到**：停用的 `Button`／`IconButton` 包在 `Tooltip` 內時，自動改成 `aria-disabled` 並保持可聚焦；`loading` 期間焦點不會被踢回 `<body>`（[Tooltip.tsx:46](../../apps/backstage/src/components/Tooltip/Tooltip.tsx)、[Button.tsx:52](../../apps/backstage/src/components/Button/Button.tsx)）。
- **列表狀態存在網址**：user、role、approval、audit-log、job、file 的分頁、篩選、排序都寫進 search 並用 Zod 驗證，重新整理與分享連結都能還原；對話框子路由也保留列表的 search。
- **重試策略安全**：只有冪等方法會退避重試，4xx 不重試；`/auth/refresh` 不會被重送（[retry.ts](../../apps/backstage/src/plugins/fetcher/retry.ts)）。
- **確認後失敗可以重試**：`useConfirm` 在 `onConfirm` 丟錯時保留對話框，審批的快速核准／駁回正確使用了這個模式（[ApprovalRowActions.tsx:32](../../apps/backstage/src/features/approval/pages/ApprovalList/components/ApprovalRowActions.tsx)）。AlertDialog 預設聚焦「取消」，點遮罩不會關閉。
- **破壞性操作的文案多半有說明影響**：刪除使用者會「立即登出」、刪除資料夾會連同子項目、停用租戶會登出全部使用者等。
- **批次操作體驗完整**：在背景佇列逐筆處理，有進度條與頂列面板，結束時彈出失敗清單，失敗項目保持勾選方便重試。
- **主題與對比**：深色模式只覆寫 alias token，首次繪製前就設好 `data-theme` 不會閃白；文字 token 在兩種主題的 surface 上都有 ≥ 4.5:1 的自動化測試。
- **即時連線狀態可感知**：頂列的 `<output>` 是 live region，斷線時說明「資料改為定期更新」。
- **檔案管理器的錯誤處理較完整**：`FILE_VERSION_CONFLICT`、`FILE_NOT_FOUND`、`FILE_FOLDER_NOT_FOUND` 各有專門處理，改名與建立資料夾的錯誤就地顯示在欄位旁。
- **帳號列舉防護與 UX 取得平衡**：註冊申請不論 email 是否存在，都顯示同樣的「已送出」；IdP 登入頁在 blur 時才查 email 網域，不會每打一個字就查一次。
- **Toast 依類型調整停留時間**：錯誤 8 秒、其他 4 秒，Base UI Toast 內建 `aria-live`。
