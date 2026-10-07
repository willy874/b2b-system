# 身分與存取（IAM）

誰是誰、誰能對什麼做什麼的規則：使用者、角色、群組、權限、資源授權，以及「為什麼能做 X」。
本資料夾講 **規則本身**，橫跨前後端；各層怎麼實作在下表的其他文件。

| 文件 | 內容 |
| --- | --- |
| [`01-model.md`](./01-model.md) | 實體、ER 圖、不變條件、權限解析；關係圖（ReBAC）的組成與模型（§6.4、§9） |
| [`02-permission-catalog.md`](./02-permission-catalog.md) | 權限的單一事實來源：權限清單、預設角色、頁面 × 權限、權限依賴樹（§9）；有測試比對 seed |
| [`03-flows.md`](./03-flows.md) | 授權檢查、建立角色與授權（反提權）、權限變更生效、指派角色、停用即登出、錯誤路徑總表 |
| [`04-api.md`](./04-api.md) | 使用者、角色、權限的 API；反提權規則（§4，所有授權寫入都適用） |
| [`05-bootstrap.md`](./05-bootstrap.md) | 權限目錄與系統角色的種子、第一位 super-admin、平台管理者、災難復原 |
| [`06-resource-grants.md`](./06-resource-grants.md) | 資源授權：資料夾層級的等級、繼承、擁有者規則 |
| [`07-groups.md`](./07-groups.md) | 群組：巢狀成員、群組持有角色、資料夾授權給群組 |
| [`08-explain.md`](./08-explain.md) | 授權的說明：有效權限的來源、資料夾存取的路徑、遮蔽規則 |

## 與其他文件的分工

| 主題 | 在哪裡 |
| --- | --- |
| 認證（你是誰）：登入、token、續期、啟用與密碼重設 | [`backend/04-auth.md`](../backend/04-auth.md)；SSO 與平台的身分範圍在 [`04-sso.md`](../04-sso.md) |
| 後端的授權機制：Guard、Decorator、關係圖引擎、權限快取、路由稽核、端點 × 權限總表 | [`backend/05-rbac.md`](../backend/05-rbac.md) |
| 前端的權限：註冊表、hooks、UI gating | [`frontend/06-permission.md`](../frontend/06-permission.md) |
| 審批（申請 → 核准 → 套用） | [`backend/20-approval.md`](../backend/20-approval.md) |
| API token 的權限範圍（scopes） | [`06-external-api.md`](../06-external-api.md)、[`backend/04-auth.md`](../backend/04-auth.md) §8.2 |

## 閱讀順序

第一次讀：`01` → `02` → `03`；要動資料夾授權讀 `06`，群組讀 `07`。
加權限的流程見 [`02-permission-catalog.md`](./02-permission-catalog.md) §7（同時要同步 seed、前端 `permission.ts` 與語系檔）。
