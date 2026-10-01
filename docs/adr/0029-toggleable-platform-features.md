# ADR-0029 — 回收桶、系統設定、外部 IdP、切換租戶改為平台可關閉的 feature

- 狀態：**採用**（實作中，branch `feat/toggleable-features`）
- 日期：2026-10-01
- 相關：延伸 [ADR-0021](./0021-runtime-feature-activation.md)（可啟用的 feature；本決定修改其「原本待決、已定案的事項」2 的清單）；
  取代 [ADR-0020](./0020-physical-tenant-isolation.md) D22 的 `tenants.allow_external_idp`；
  [ADR-0025](./0025-entity-revisions.md)（回收桶與還原）、[ADR-0019](./0019-sso-identity-platform.md)（外部 IdP）；
  規格 [`../architecture/05-tenancy.md`](../architecture/05-tenancy.md) §5.1、
  [`../architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §7

## 背景

ADR-0021 讓平台管理者對每個租戶開關 `file`、`auditLog`、`job`，其餘 feature 一律常駐。
定位改成通用後台之後，有些通用能力並不是每個部署都要：

| 能力 | 不需要的情境 |
| --- | --- |
| 回收桶（列表與還原） | 租戶的資料保留政策是「刪了就是刪了」，不希望使用者自行救回 |
| 系統設定頁 | 平台代管、不讓租戶管理者自行調整執行期設定 |
| 外部 IdP | 租戶只用帳號密碼；原本已有獨立的 `allow_external_idp` 開關 |
| 切換租戶 | 只服務單一租戶的部署，選單裡的「切換租戶」只會造成困惑 |

外部 IdP 已經有一個平台層開關，但它是 **另一套**：獨立的欄位、獨立的 UI 區塊、獨立的錯誤碼
（`IDENTITY_PROVIDER_NOT_ALLOWED`），前端也沒有隨開關即時更新（變更時不推播）。

## 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **`TENANT_FEATURES` 加四個 id**：`trash`、`systemSetting`、`identityProvider`、`tenantSwitch`。平台 DB 的預設值改為七個全開；migration（平台 0009）讓 **既有租戶** 全部啟用，`identityProvider` 沿用原本 `allow_external_idp` 的值 | 這四個原本都是常駐（或預設允許），升版不能讓任何租戶失去功能 |
| D2 | **外部 IdP 併進 `features`，刪除 `tenants.allow_external_idp`**：`TenantContext`／`PlatformTenant`／`UpdateTenantRequest` 不再有 `allowExternalIdp`；apps/auth 拿掉獨立的開關區塊，改由「啟用的功能」清單的一列表示；`IDENTITY_PROVIDER_NOT_ALLOWED` 與 `IdentityProviderList.allowed` 一併移除 | 同一種「平台決定租戶能不能用」的開關只留一套（ADR-0021 當時以「不做第二套」為由把它排除，現在反過來把舊的那套收進來）；改用 feature 之後，變更會推播 `tenantFeature`，backstage 的選單即時跟上 |
| D3 | **回收桶（`trash`）**：`GET /trash` 與各資源的 `POST /<resource>/:id/restore`（使用者、角色、群組、檔案、資料夾）標 `@RequireFeature('trash')`。`@RequireFeature` 改成 **handler 與 class 的宣告合併、全部都要啟用**（檔案的還原端點同時要 `file` 與 `trash`）。刪除照舊是軟刪除，`trash.purge` 照常在保留期滿後永久刪除。前端刪除成功的提示只在 `trash` 已安裝時附「復原」 | 「復原」本身就是回收桶的還原端點；只藏列表頁、留著還原端點等於沒關。資料與背景工作照舊，與 ADR-0021 D11 一致 |
| D4 | **系統設定（`systemSetting`）**：`GET`／`PATCH /system/settings` 標 `@RequireFeature`；`GET /system/settings/public`（登入前就要用）與 `GET /system/info` 不標。**已覆寫的值照樣生效**，關掉只是不能查看或修改 | 設定的消費端分散在各模組；關掉時改回預設值會在租戶不知情的情況下改變行為（例如放寬密碼規則）。與「資料保留、重新啟用後一致」的原則相同 |
| D5 | **外部 IdP（`identityProvider`）**：`/identity-providers` 整個 controller 標 `@RequireFeature`；登入流程（home realm discovery、`loginConfig`）判斷 `features` 是否含它，沒有就當作沒有連線——與原本 `allow_external_idp = false` 的行為相同。連線與外部身分的連結保留。apps/auth 關閉時的確認框另外說明對登入的影響（只靠外部 IdP、沒有密碼的人要先重設密碼） | 行為沿用 ADR-0020 D22，只是換一個來源；原本「關掉時仍可編輯、停用、刪除既有連線」的細節不保留——整頁消失，與其他 feature 一致 |
| D6 | **切換租戶（`tenantSwitch`）**：沒有後端端點，也沒有頁面；backstage 在 `FEATURE_CATALOG` 登記一個空的 plugin（`routes: []`），帳號選單以 `useIsFeatureReady('tenantSwitch')` 決定是否顯示「切換租戶」。apps/auth 的 `/enter` 不受影響 | 用同一個安裝狀態表示啟用與否，不必另開一條「profile 欄位 → UI」的路徑；`/enter` 是平台的入口，不屬於任何租戶 |
| D7 | **前端**：`trash`、`system`、`identity-provider` 三個 feature 改成可啟用（`AppDynamicPluginFactory`、最上層 route `beforeLoad: requireFeature(<ID>)`、從 `main.tsx` 移到 `FEATURE_CATALOG`）。其他 feature 往回收桶登記的類型（`registerTrashType`）不受影響：回收桶沒安裝時沒有人讀 | 照 [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §7 的步驟；側邊選單依頁面權限是否註冊自動隱藏 |

## 代價

| 代價 | 緩解 |
| --- | --- |
| 平台 migration 刪除欄位，舊版程式碼讀不到 `allow_external_idp` | 同一次部署；舊值在刪欄位前搬進 `features` |
| 關閉外部 IdP 後，租戶管理者看不到既有連線（原本還能編輯、刪除） | 連線保留，重新啟用後原樣出現；需要清理時由平台暫時打開 |
| `@RequireFeature` 的語意從「handler 蓋過 class」改成「合併」 | 現有用法沒有 handler 蓋過 class 的情況；單元測試與 `test/route-audit.spec.ts` 的對照表涵蓋 |

## 不做

- **租戶自行開關**：仍只有平台層（ADR-0021「原本待決、已定案的事項」1）。
- **全平台一次關閉**：目前以租戶為單位；單一租戶的部署關掉該租戶即可。要全平台預設不同時，改平台 DB 的預設值。
