# 詳情頁的清單與選項清單被截斷，畫面上沒有任何提示

## 現況

以下查詢只取第一頁，畫面沒有分頁、「還有 N 筆」或搜尋，超過的部分直接看不到：

| 位置 | 取多少 | 畫面 |
| --- | --- | --- |
| `apps/backstage/src/apis/group/get-group-members/query.ts` 7 行（`limit = 50`）；`features/group/pages/GroupDetail/page.tsx` 29–32 行用預設值 | 群組的直接成員前 50 位 | `GroupMemberSection` 的標題顯示 **總數**（`pagination.total`），清單只有 50 位；`GET /groups/:id/members` 只收分頁（`apps/api/src/modules/group/dto/list-group.dto.ts` 15 行 `ListGroupMembersSchema = PaginationSchema`），沒有關鍵字可以找人 |
| `apps/backstage/src/apis/role/get-role-users/query.ts` 7 行（`limit = 20`）；`features/role/pages/RoleDetail/page.tsx` 42–45 行 | 角色的直接持有者前 20 位 | `RoleHolderSection` 沒有總數也沒有提示 |
| `features/role/pages/RoleDetail/page.tsx` 48 行（`limit: 100`） | 經由群組持有角色的群組前 100 個 | 同上 |
| `features/user/pages/UserDetail/components/UserGroupSection.tsx` 12、29 行（`USER_GROUP_LIMIT = 100`） | 使用者所在的群組前 100 個 | 註解說「超過就只列前面這些」，畫面不說 |
| `apps/backstage/src/apis/role/get-role-list/query.ts` 35 行、`apis/group/get-group-list/query.ts` 36 行（`limit: 200`） | 角色、群組的選項前 200 個（依名稱） | 用在使用者建立與詳情、群組詳情、服務帳號、審批流程的審核者、審批詳情、公告受眾、MFA 政策等十多個選擇器。`Select` 在本地過濾，名稱排在 200 名之後的角色或群組搜尋不到；200 也是 api 分頁的上限（`apps/api/src/core/http/pagination.ts` 15 行），不能再調大 |

規格（`iam/07-groups.md`、`frontend/` 各功能文件）都沒有提到這些上限。

## 影響

- 群組超過 50 位成員時，第 51 位以後在畫面上 **看不到也移除不了**（只能移除看得到的）；標題的總數與清單長度不一致，看起來像資料錯誤。
- 角色持有者超過 20 位時，管理者以為只有這些人持有角色（例如稽核「誰有 admin」時漏看）。
- 角色或群組超過 200 個的租戶，排在後面的選不到，無法指派、無法設為審核者或公告受眾；畫面沒有任何跡象說明原因。

嚴重度中：資料本身正確，但畫面呈現的清單不完整又沒有提示，管理者會據此做出錯誤判斷；大租戶的部分操作無法在畫面完成。

## 修正方式

1. 詳情頁的清單：加分頁（比照 `OrgUnitMemberSection` 的 `Pagination`），或至少在超過時顯示「顯示前 N 筆，共 M 筆」並連到已篩選的列表頁
   （角色持有者 → `/user?roleId=`；群組成員 → 使用者列表依群組篩選；使用者的群組 → `/group?userId=`）。
2. `GET /groups/:id/members` 加 `keyword`（名稱、email），群組成員區塊提供搜尋。
3. 選項清單改為伺服器端搜尋（與使用者選擇器相同：`searchValue`／`onSearchChange`／`filterOption={false}`，查詢帶 `keyword`），
   已選、不在結果裡的項目另外取名稱（`AudiencePicker` 對使用者的做法）。可以抽一個 `useRemoteOptions` 給角色、群組共用。
4. 在對應的前端規格寫下清單的分頁或上限。

## 驗證方式

- `GroupMemberSection`、`RoleHolderSection`、`UserGroupSection` 的元件測試：msw 回 `total` 大於一頁 → 看得到分頁或「顯示前 N 筆」與連結；換頁後帶對的 `offset`。
- 選擇器的測試：輸入關鍵字 → 送出帶 `keyword` 的查詢；選項包含第 201 個以後的項目（msw 依 keyword 回傳）。
- api 整合測試：`GET /groups/:id/members?keyword=` 只回符合的成員，分頁的 `total` 是過濾後的數量。

（2026-10-10 backstage 各功能的優化分析發現。）
