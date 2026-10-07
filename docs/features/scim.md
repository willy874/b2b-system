# SCIM 使用者佈建與外部 IdP 的群組對應

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9.3 D15（「IdP 群組對應另開提案，與 SCIM 一起評估」）、[`rbac/08-groups.md`](../rbac/08-groups.md) 的「不做」（外部 IdP 的群組對應、SCIM 另開提案）、
  [`04-sso.md`](../architecture/04-sso.md) §12 D10（沒有對應帳號時的 `reject`／`auto_create`）、[`06-external-api.md`](../architecture/06-external-api.md)（對外 API 程序與 API token）、
  [`tenant-security-policy.md`](./tenant-security-policy.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

企業客戶以外部 IdP（Entra ID、Okta、Google Workspace）管理員工。現在：

- 外部 IdP 登入時，沒有對應帳號就依連線設定 `reject` 或 `auto_create`（建立 **沒有角色** 的帳號，[`04-sso.md`](../architecture/04-sso.md) §12 D10）。
  員工離職時 IdP 停用了帳號，我們這邊的帳號仍是啟用的，只是登不進來（API token 仍然有效）。
- 群組只有手動成員（[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9.3 D15）；IdP 的群組沒有對應，角色要由租戶管理者逐一指派。

D15 已經寫明這兩件事要一起評估，預設方向是「整個群組由 IdP 管理、不能手動改成員」。SCIM 2.0（RFC 7643／7644）是企業 IdP 推送使用者與群組的標準協定。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| SCIM 2.0 的 `/Users`、`/Groups`（建立、更新、PATCH、停用、查詢與 filter 的常用子集） | `/Bulk`、`/Schemas` 的自訂擴充 |
| IdP 推送的使用者：建立、更新屬性、`active=false` 時停用並撤銷 session 與 API token | 從我們這邊回寫 IdP |
| IdP 推送的群組成為「由 IdP 管理」的群組，成員不能在畫面上手動修改 | 一個群組同時有手動與 IdP 成員 |
| 租戶管理者為 SCIM 連線簽發專用 token | 登入時以 ID token 的群組 claim 同步（見開放問題 1） |
| 第一批驗證：Entra ID、Okta | |

## 使用者故事

**作為客戶的 IT 管理員，我希望員工在 Entra ID 被停用時，後台帳號也立刻停用，以便離職流程只做一次。**

- **Given** 租戶設定了 SCIM 連線，員工 E 由 SCIM 建立
- **When** IT 在 Entra ID 停用 E
- **Then** Entra ID 送 `PATCH /scim/v2/Users/{id}`（`active: false`）；E 的帳號停用、所有 session 與 API token 失效、稽核記 `user.disable`（actor 為 SCIM 連線）

**作為租戶管理者，我希望 IdP 的「業務部」群組對應到我們的群組，以便入職的人自動拿到業務部的角色。**

- **Given** IdP 推送群組「業務部」，我把它（我們這邊的對應群組）指派了角色「業務」
- **When** IdP 把新員工加進「業務部」
- **Then** 新員工自動成為群組成員、取得角色；權限即時生效（`permissionsChanged()`）

## 初步構想

- 程序：SCIM 是 IdP 對我們的 machine-to-machine 呼叫，放在 **對外 API 程序**（[`06-external-api.md`](../architecture/06-external-api.md)），路徑 `/scim/v2`，以專用 token 驗證、從前綴決定租戶（D7）。
- 資料模型（租戶 DB）：`users` 加 `scim_external_id`、`managed_by`（`null` ｜ `scim`）；`groups` 加同樣兩欄。由 SCIM 管理的使用者不能在畫面上改姓名、email、啟用狀態。
- 寫入走既有的 `UserService`／`GroupService`（同一套業務規則、稽核），**不另寫一份**；群組成員變更後照常 `permissionService.permissionsChanged()`。
- 反提權：SCIM 連線不是一個人。它只能改成員，**不能** 改群組持有的角色，因此不會給出任何人沒有的能力；角色仍由租戶管理者指派給群組（受反提權）。
- 權限：`scim:manage`（建立連線與 token）；SCIM 端點本身由 token 授權。
- 稽核：每次 SCIM 寫入以連線為 actor 記稽核。

## 開放問題

1. 不支援 SCIM 的 IdP（或小客戶）要不要以登入時 ID token 的 `groups` claim 同步？各家 claim 差異大（Entra ID 用 object id、有數量上限，D15 的評估）。
2. 既有手動建立的使用者，SCIM 第一次推送時怎麼比對（email？）比對到的帳號要轉成「由 SCIM 管理」嗎？
3. SCIM 刪除使用者（`DELETE /Users`）對應我們的軟刪除還是停用？
4. SCIM 連線要不要是可由平台關閉的 feature（只有某些方案有）？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/04-sso.md`（新增 SCIM 章節）、`docs/rbac/08-groups.md`（由 IdP 管理的群組）
- 設計決策：`docs/rbac/01-domain-model.md` §9（延續 D15）
