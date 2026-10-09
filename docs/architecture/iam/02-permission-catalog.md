# 身分與存取 02 — 權限目錄

> 本文件是 **權限的單一事實來源**。任何新增／刪除權限都必須先改這裡，再同步
> `apps/api/src/db/seeds/permissions.ts`。兩者不一致視為 bug（`db/seeds/__tests__/permission-catalog-doc.spec.ts` 比對 §2 的鍵與 §9 的依賴樹）。

---

## 1. 權限鍵格式

```
<resource>:<action>
```

- `resource`：camelCase 的資源名，單數。例：`user`、`role`、`auditLog`
- `action`：camelCase 的動作名。CRUD 使用完整單字 `create` / `read` / `update` / `delete`，
  其餘為具名動作（`assign`、`grant`、`resetPassword`…）

> **為什麼不用單字母（`user:R`）**：可讀性。`@RequirePermissions('role:update')`
> 在 code review 時不需要查表。字串長度在 HTTP 與記憶體上的差異可忽略。

### 1.1 命名規則

| 規則                                   | 說明                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| 一個權限＝一個不可再分的授權決定       | 不要有 `user:manage` 這種涵蓋多件事的鍵                             |
| `read` 涵蓋列表與詳情                  | 不拆 `list` / `detail`                                              |
| 跨資源的關聯操作歸屬「被改變的那一邊」 | 指派角色給使用者 → `user:assignRole`（改變的是使用者）              |
| 具名動作只在 CRUD 無法表達時才新增     | 「停用使用者」是改狀態 → 用 `user:update`，不新增 `user:deactivate` |

---

## 2. 權限清單（共 76 項）

### 2.1 `user` — 使用者

| 權限鍵               | 顯示名稱（zh-TW） | 說明                                   |
| -------------------- | ----------------- | -------------------------------------- |
| `user:create`        | 建立使用者        | 建立新帳號（含發送啟用信）             |
| `user:read`          | 檢視使用者        | 使用者列表與詳情                       |
| `user:update`        | 編輯使用者        | 修改基本資料、啟用／停用、解鎖         |
| `user:delete`        | 刪除使用者        | 軟刪除帳號                             |
| `user:assignRole`    | 指派角色          | 增減使用者持有的角色。**受反提權限制** |
| `user:resetPassword` | 重設密碼          | 代使用者觸發密碼重設流程               |
| `user:resetMfa`      | 重設 MFA          | 刪除別人的所有驗證方式與備用碼、結束他的 session（[`backend/21-mfa.md`](../backend/21-mfa.md) §8）。獨立授予：`user:update` 不包含它 |
| `user:export`        | 匯出使用者        | 把使用者整批匯出成 CSV／XLSX／SQL（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §9.1）。能逐頁看不代表能整批帶走，所以獨立授予；匯入沿用 `user:create`／`user:update` |

### 2.2 `role` — 角色

| 權限鍵                 | 顯示名稱（zh-TW） | 說明                                 |
| ---------------------- | ----------------- | ------------------------------------ |
| `role:create`          | 建立角色          | 建立新角色（可同時授予權限）         |
| `role:read`            | 檢視角色          | 角色列表與詳情、角色已授予的權限     |
| `role:update`          | 編輯角色          | 修改名稱與描述                       |
| `role:delete`          | 刪除角色          | 刪除非系統角色                       |
| `role:grantPermission` | 授予／移除權限    | 變更角色的權限集合。**受反提權限制** |
| `role:export` | 匯出角色 | 把角色（含權限鍵）整批匯出（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.1），主要用來把角色搬到另一個租戶；匯入沿用 `role:create`／`role:update`，權限欄另要 `role:grantPermission` |

### 2.3 `permission` — 權限目錄

| 權限鍵            | 顯示名稱（zh-TW） | 說明                                         |
| ----------------- | ----------------- | -------------------------------------------- |
| `permission:read` | 檢視權限目錄      | 讀取全部可用權限。**編輯角色權限的前置條件** |

### 2.4 `auditLog` — 稽核日誌

| 權限鍵          | 顯示名稱（zh-TW） | 說明               |
| --------------- | ----------------- | ------------------ |
| `auditLog:read` | 檢視稽核日誌      | 稽核日誌列表與篩選 |
| `auditLog:export` | 匯出稽核日誌    | 把稽核日誌整批匯出（一次最多 366 天，[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §6.2） |

### 2.5 `system` — 系統

| 權限鍵          | 顯示名稱（zh-TW） | 說明                                     |
| --------------- | ----------------- | ---------------------------------------- |
| `system:read`   | 檢視系統資訊      | 版本、健康狀態、系統設定頁與事件通知頁（唯讀）       |
| `system:update` | 變更系統設定      | 修改與還原系統設定（[`backend/12-settings.md`](../backend/12-settings.md)）、開關事件通知（[`backend/16-notification-event.md`](../backend/16-notification-event.md)） |

### 2.6 `approval` — 審批

| 權限鍵            | 顯示名稱（zh-TW） | 說明                                                                                          |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `approval:read`   | 檢視審批          | 審批請求列表與詳情                                                                            |
| `approval:review` | 審核申請          | 核准／駁回。**核准另需該類型要求的權限**（`user.register` = `user:create`），見 [`backend/20-approval.md`](../backend/20-approval.md) §3.2 |
| `approval:override` | 強制定案審批    | 多階段審批卡住時：重新展開目前關卡的審核者、強制定案目前的關卡（意見必填）。最後一關的核准另需該類型要求的權限（[`backend/20-approval.md`](../backend/20-approval.md) §9.8、D10） |
| `approval:export` | 匯出審批紀錄 | 把審批請求與每一關的決定整批匯出（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.5）；看得到全部的請求 |

> 為什麼不是 `approval:update`：核准與駁回是具名的「審核」決定，不是修改請求內容；
> 也讓「能看不能審」（auditor）與「能審」清楚分開。

### 2.7 `file` — 檔案

| 權限鍵        | 顯示名稱（zh-TW） | 說明                                                         |
| ------------- | ----------------- | ------------------------------------------------------------ |
| `file:create` | 上傳檔案          | **所有資料夾**：登記上傳並取得直傳網址、確認上傳完成；建立資料夾（含上傳資料夾時建出的結構） |
| `file:read`   | 檢視檔案          | **所有資料夾**：檔案列表與詳情，並取得預覽／下載網址         |
| `file:update` | 編輯檔案          | **所有資料夾**：改名（內容不可改；要換內容就上傳新檔）；資料夾改名；移動檔案與資料夾 |
| `file:delete` | 刪除檔案          | **所有資料夾**：軟刪除紀錄並刪除物件儲存中的內容；遞迴刪除資料夾（連同其中的檔案與子資料夾） |
| `file:access` | 使用檔案管理器    | 進入檔案管理器；能看到、能做什麼 **由資料夾授權決定**（不含任何資料夾） |
| `file:share`  | 管理檔案授權      | **所有資料夾**：檢視與變更資料夾的授權、中斷繼承。**受反提權限制** |
| `file:listPersonal` | 看得到別人的個人資料夾 | 別人的個人資料夾在樹裡出現（鎖住、可申請存取）；讀內容另要授權或全域 `file:read`。沒有它時，別人的個人資料夾只在自己或子孫讀得到時出現（[`06-resource-grants.md`](./06-resource-grants.md) §12.1） |

> 上面四個 CRUD 鍵是 **全域** 的：持有者對所有資料夾（含中斷繼承的私人資料夾）都有該動作。
> 一般成員拿 `file:access`，再由資料夾授權（viewer / contributor / editor / manager）決定範圍，
> 另有「能上傳的人可以改名、移動、刪除自己上傳的東西」的擁有者規則。
> 模型、等級與解析規則見 [`06-resource-grants.md`](./06-resource-grants.md)（[`06-resource-grants.md`](06-resource-grants.md) §13）。
> 資料夾沿用同一組權限，不另設 `fileFolder:*`。還在上傳中（`pending`）的檔案只有上傳者本人看得到，見
> [`backend/09-file.md`](../backend/09-file.md) §4。

### 2.8 `job` — 背景工作

| 權限鍵      | 顯示名稱（zh-TW） | 說明                                                                 |
| ----------- | ----------------- | -------------------------------------------------------------------- |
| `job:read`  | 檢視背景工作      | 佇列狀態、工作列表與詳情（含工作資料與失敗原因）                     |
| `job:retry` | 重試背景工作      | 把重試用完、停在失敗的工作重新排入；寫稽核 `job.retry`               |

> 工作是系統自己產生的（排程、寄信、匯出），沒有 create / update / delete；
> 重試是具名動作，理由同 `approval:review`。工作資料不放機密（token、密碼），
> 因此 `job:read` 不會看到憑證，見 [`backend/10-jobs.md`](../backend/10-jobs.md) §4。

### 2.9 `identityProvider` — 外部 IdP 連線

| 權限鍵                     | 顯示名稱（zh-TW） | 說明 |
| -------------------------- | ----------------- | ---- |
| `identityProvider:create`  | 建立外部 IdP 連線 | 新增 OIDC 連線（issuer、client id／secret、網域、找不到帳號時的處理方式）；寫稽核 `identityProvider.create`（不含 secret） |
| `identityProvider:read`    | 檢視外部 IdP 連線 | 連線清單、網域與要登記在外部 IdP 的 redirect URI；**client secret 永遠不回傳**（[`architecture/04-sso.md`](../04-sso.md) §12.2 D11） |
| `identityProvider:update`  | 編輯外部 IdP 連線 | 改設定、網域、啟用狀態與輪替 secret；稽核只記「換過 secret」 |
| `identityProvider:delete`  | 刪除外部 IdP 連線 | 軟刪除並釋出網域；已連結的外部身分留著，但不能再以這個連線登入 |

> 網域設為「只允許 SSO」後，那個網域的帳號不能用密碼登入、不能申請重設密碼（[`architecture/04-sso.md`](../04-sso.md) §12.2 D9）。
> 連線屬於租戶（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D18），管理頁在 backstage 的 `/identity-provider`。

### 2.10 `group` — 群組

| 權限鍵             | 顯示名稱（zh-TW） | 說明 |
| ------------------ | ----------------- | ---- |
| `group:create`     | 建立群組          | 建立群組（名稱、說明） |
| `group:read`       | 檢視群組          | 群組列表與詳情、成員、群組持有的角色 |
| `group:update`     | 編輯群組          | 修改名稱與說明；**增減成員**（含把群組加進另一個群組）。加成員等於指派群組持有的角色，受反提權限制（[`01-model.md`](01-model.md) §9.3 D11） |
| `group:delete`     | 刪除群組          | 軟刪除群組；成員與持有角色的邊保留，還原時一起回來 |
| `group:assignRole` | 讓群組持有角色    | 增減群組持有的角色。**受反提權限制**；super-admin 不能由群組持有（D12） |
| `group:export` | 匯出群組 | 把群組與群組成員整批匯出（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.2）；成員帶 email，所以依賴 `user:read`。匯入沿用 `group:create`／`group:update` |

> 群組是「純分組」：授權給群組、群組持有角色，人員異動只改成員。群組可以巢狀（成員可以是另一個群組）。
> `group:update` 本身不列為受反提權限制的鍵：加成員時檢查的是 **那個群組帶來的能力**（群組與它所有上層群組持有的角色），
> 操作者全部都有才放行，所以「能編輯群組」不會等於「能指派任何角色」。

### 2.11 `authz` — 授權說明

| 權限鍵          | 顯示名稱（zh-TW） | 說明 |
| --------------- | ----------------- | ---- |
| `authz:explain` | 檢視授權來源      | 查看 **別人** 的有效權限與每個權限的來源、某人為什麼能（不能）存取某個資料夾（[`01-model.md`](01-model.md) §9.3 D14）。查自己不需要權限 |

> 說明的路徑會經過使用者、群組、角色，所以依賴這三種的 `read`；路徑上操作者讀不到的節點（例：讀不到的資料夾）只顯示種類，不顯示名稱。

### 2.12 `serviceAccount` — 服務帳號

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `serviceAccount:create` | 建立服務帳號      | 建立租戶內的非人類帳號（[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D1） |
| `serviceAccount:read`   | 檢視服務帳號      | 服務帳號列表與詳情、持有的角色、它的 API token（不含 secret） |
| `serviceAccount:update` | 編輯服務帳號      | 修改名稱、停用與啟用、**增減持有的角色**、**建立與撤銷它的 API token**。角色與 token 都受反提權限制（D4） |
| `serviceAccount:delete` | 刪除服務帳號      | 軟刪除；它的 token 一併失效，不進回收桶、不能還原 |
| `serviceAccount:export` | 匯出服務帳號 | 把服務帳號（角色、有效的 token 數）整批匯出（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.6）；token 本身不匯出 |

> `serviceAccount:update` 不列為受反提權限制的鍵：指派角色時檢查的是 **那些角色帶來的能力**，建立 token 時檢查的是
> **token 取得的有效權限**（服務帳號的權限 ∩ token 的 scope），操作者全部都有才放行。

### 2.13 `webhook` — Webhook

| 權限鍵           | 顯示名稱（zh-TW） | 說明 |
| ---------------- | ----------------- | ---- |
| `webhook:create` | 建立 Webhook      | 訂閱對外事件，事件發生時 POST 到指定網址（[`backend/17-webhook.md`](../backend/17-webhook.md) §9） |
| `webhook:read`   | 檢視 Webhook      | 訂閱列表與詳情、投遞紀錄（狀態碼、耗時、回應開頭）；不含密鑰 |
| `webhook:update` | 編輯 Webhook      | 修改網址與事件、停用與啟用、**輪替密鑰**、送測試事件、手動重送 |
| `webhook:delete` | 刪除 Webhook      | 硬刪除；投遞紀錄一併刪除，不進回收桶 |

> 事件不依訂閱者的權限過濾（D5）：payload 只帶 id，接收端以 API token 回查時才套用權限。
> 能管 webhook 等於能讓租戶內所有符合類型的事件送到外部，所以只給管理者。

### 2.14 `tag` — 標籤

| 權限鍵       | 顯示名稱（zh-TW） | 說明 |
| ------------ | ----------------- | ---- |
| `tag:create` | 建立標籤          | 在某個標籤組（檔案、使用者）新增標籤定義（[`backend/18-tag.md`](../backend/18-tag.md) §7.2 D5） |
| `tag:update` | 編輯標籤          | 改標籤的名稱與顏色 |
| `tag:delete` | 刪除標籤          | 硬刪除；所有資源上的這個標籤一併移除 |
| `tag:export` | 匯出標籤 | 把一個標籤組的標籤定義整批匯出（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.4）；仍要進得了該標籤組。匯入沿用 `tag:create`／`tag:update` |

> 沒有 `tag:read`：定義對「進得了那個標籤組」的人都可讀（檔案組：`file:access` 或 `file:read`；使用者組：`user:read`）。
> **貼與移除標籤不需要權限鍵**，跟著目標的編輯權限：檔案、資料夾是能改名，使用者是 `user:update`。

### 2.15 `notification` — 站內通知

| 權限鍵              | 顯示名稱（zh-TW） | 說明 |
| ------------------- | ----------------- | ---- |
| `notification:read` | 檢視所有通知      | 通知總覽：租戶內 **所有人** 的站內通知，依類型、收件人、觸發者、時間、已讀篩選（[`backend/19-announcement.md`](../backend/19-announcement.md) §9.2 D1） |

> 每個人看自己的通知不需要這個鍵（§2.21）。通知的參數帶申請人名稱、角色名稱等，所以只預設給 `admin`，`auditor` 不預設（D2）。

### 2.16 `announcement` — 公告

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `announcement:create`   | 建立公告          | 建立草稿（[`backend/19-announcement.md`](../backend/19-announcement.md) §9.2 D15） |
| `announcement:read`     | 檢視公告          | 公告列表與詳情、發送紀錄（人數、已讀數） |
| `announcement:update`   | 編輯公告          | 修改草稿的標題、內文、受眾、時間；預覽受眾人數。排程中、暫停中的公告另要 `announcement:publish` |
| `announcement:delete`   | 刪除公告          | 軟刪除（進回收桶）與還原；排程中的刪除時改成暫停 |
| `announcement:publish`  | 發送公告          | 送出（立即或排程）、暫停與恢復排程、修改已送出的公告、撤回一次發送 |

> `publish` 獨立於 `update`：能寫草稿的人不一定能對全租戶發話。收件人讀自己收到的公告不需要權限（§2.21）。

### 2.17 `mfaPolicy` — MFA 政策

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `mfaPolicy:read`        | 檢視 MFA 政策     | 允許的方式、全員或指定角色必須啟用、不符合政策的人數；預覽變更的影響（[`backend/21-mfa.md`](../backend/21-mfa.md) §6） |
| `mfaPolicy:update`      | 修改 MFA 政策     | 修改上述政策（樂觀鎖、稽核 `mfaPolicy.update`）。預設只給 super-admin：放寬 MFA 等於削弱所有人的保護（D11） |

> 自己的驗證方式（設定、移除、備用碼）屬於個人範圍（§2.21）；管理員檢視與重設別人的 MFA 用 `user:read`／`user:update`。

### 2.18 `orgUnit` — 組織

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `orgUnit:create`        | 建立部門          | 建立部門（[`backend/23-organization.md`](../backend/23-organization.md)） |
| `orgUnit:read`          | 檢視組織          | 部門樹、部門詳情與成員、使用者所屬的部門 |
| `orgUnit:update`        | 編輯組織          | 改名、搬移、排序；**增減成員、設定主管與主要部門**。不能改自己的成員資格與主管身分（D6） |
| `orgUnit:delete`        | 刪除部門          | 軟刪除（進回收桶）與還原；還有下層部門時不能刪 |
| `orgUnit:export`        | 匯出組織          | 把部門樹與部門成員整批匯出（[`backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.3）；成員帶 email，所以依賴 `user:read`。匯入沿用 `orgUnit:create`／`orgUnit:update` |

> 部門不是授權來源：成員資格不帶任何權限鍵，所以 `orgUnit:update` 不受反提權限制。但「誰是主管」決定多階段審批的審核者，
> 不能改自己的那一條擋住「把自己設成主管」。

### 2.19 `approvalFlow` — 審批流程

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `approvalFlow:read`     | 檢視審批流程      | 多階段審批的流程設定、試算（[`backend/20-approval.md`](../backend/20-approval.md) §9） |
| `approvalFlow:update`   | 設定審批流程      | 建立、修改、停用流程。**受反提權限制**：要持有該類型核准所需的權限（D11） |

> 設定流程等於決定「誰可以代為執行某操作」，所以列進 §9.2 G4（不能被任何鍵包含）。

### 2.20 `comment` — 留言

| 權限鍵           | 顯示名稱（zh-TW） | 說明 |
| ---------------- | ----------------- | ---- |
| `comment:delete` | 刪除留言          | 刪除 **別人** 的留言（管理）；寫稽核 `comment.delete`（[`backend/24-comment.md`](../backend/24-comment.md) §8.2 D4） |

> 沒有 `comment:read`／`comment:create`：留言跟著所在的資源，**看得到資源就能讀留言、留言、關注**（使用者：`user:read`）。
> 編輯只有作者本人；刪除自己的留言不需要這個鍵。

### 2.21 `gallery` — 圖片庫

| 權限鍵           | 顯示名稱（zh-TW） | 說明 |
| ---------------- | ----------------- | ---- |
| `gallery:create` | 上傳圖片          | 上傳、從其他來源（檔案管理）加入、建立相簿（[`backend/26-gallery.md`](../backend/26-gallery.md) §10） |
| `gallery:read`   | 檢視圖片庫        | 瀏覽、檢視器、下載；選圖時看得到「圖片庫」分頁；讀標籤與留言 |
| `gallery:update` | 編輯圖片庫        | 編輯標題、說明、顯示方向；貼標籤；管理相簿（改名、封面、加入與移出圖片） |
| `gallery:delete` | 刪除圖片          | 刪除圖片與相簿（進回收桶）與還原 |

> `create`、`update`、`delete` 都包含 `read`（三者互不包含）。這一版只有 RBAC：整個圖片庫對 `gallery:read` 的人全部可見，沒有相簿層級的授權（D4）。
> 「從其他來源加入」另外由來源判斷讀取權限（例：檔案管理的資料夾授權），圖片庫不回頭問。

### 2.22 個人範圍（不需要權限）

以下操作 **任何已登入使用者都能做**，因為對象是自己，不進權限目錄：

- 檢視／編輯自己的個人資料（`GET|PATCH /auth/profile`）
- 變更自己的密碼（`POST /auth/change-password`）
- 管理自己的多重驗證：驗證方式的設定與移除、重新產生備用碼（`/auth/mfa/*`；[`backend/21-mfa.md`](../backend/21-mfa.md) §7）
- 檢視／修改自己的偏好設定（語系、時區）
- 檢視與修改自己的通知設定（`GET`／`PATCH /me/notification-preferences`；[`backend/16-notification-event.md`](../backend/16-notification-event.md) §9.2 D15）
- 檢視自己的站內通知、標為已讀、刪除（`GET /notifications`、`POST /notifications/:id/read`、`POST /notifications/read-all`、`DELETE /notifications/:id`；[`backend/15-notification.md`](../backend/15-notification.md) §12.2 D9）
- 閱讀自己收到的公告全文（`GET /me/announcement-messages/:dispatchId`；[`backend/19-announcement.md`](../backend/19-announcement.md) §9.2 D4）
- 檢視自己送出的審批與被指派要審的審批、撤回自己仍待審的申請、在被指派的關卡做決定
  （`GET /approvals?scope=mine|assigned`、`GET /approvals/:id`、`POST /approvals/:id/withdraw`、`POST /approvals/:id/steps/:ordinal/decisions`；
  [`backend/20-approval.md`](../backend/20-approval.md) §9.10）
- 建立、檢視、撤銷自己的個人 API token（`GET|POST /auth/api-tokens`、`DELETE /auth/api-tokens/:tokenId`；[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D14）。
  管理者檢視、撤銷別人的個人 token 用 `user:update`
- 編輯、刪除自己的留言；關注與取消關注看得到的資源（`PATCH`／`DELETE /comments/:id`、`PUT`／`DELETE /watches/:resourceType/:resourceId`；[`backend/24-comment.md`](../backend/24-comment.md) §3）
- 登出

---

## 3. 資源 × 動作矩陣

`✓` = 存在此權限；`—` = 不存在（不要為了對稱而補）

| resource \ action | create | read | update | delete | 具名動作                      |
| ----------------- | :----: | :--: | :----: | :----: | ----------------------------- |
| `user`            |   ✓    |  ✓   |   ✓    |   ✓    | `assignRole`, `resetPassword`, `resetMfa`, `export` |
| `role`            |   ✓    |  ✓   |   ✓    |   ✓    | `grantPermission`, `export`   |
| `permission`      |   —    |  ✓   |   —    |   —    | —                             |
| `auditLog`        |   —    |  ✓   |   —    |   —    | `export`                      |
| `system`          |   —    |  ✓   |   ✓    |   —    | —                             |
| `approval`        |   —    |  ✓   |   —    |   —    | `review`, `override`, `export` |
| `file`            |   ✓    |  ✓   |   ✓    |   ✓    | `access`, `share`             |
| `job`             |   —    |  ✓   |   —    |   —    | `retry`                       |
| `identityProvider`|   ✓    |  ✓   |   ✓    |   ✓    | —                             |
| `group`           |   ✓    |  ✓   |   ✓    |   ✓    | `assignRole`, `export`        |
| `authz`           |   —    |  —   |   —    |   —    | `explain`                     |
| `serviceAccount`  |   ✓    |  ✓   |   ✓    |   ✓    | `export`                      |
| `webhook`         |   ✓    |  ✓   |   ✓    |   ✓    | —                             |
| `tag`             |   ✓    |  —   |   ✓    |   ✓    | `export`                      |
| `notification`    |   —    |  ✓   |   —    |   —    | —                             |
| `announcement`    |   ✓    |  ✓   |   ✓    |   ✓    | `publish`                     |
| `mfaPolicy`       |   —    |  ✓   |   ✓    |   —    | —                             |
| `orgUnit`         |   ✓    |  ✓   |   ✓    |   ✓    | `export`                      |
| `approvalFlow`    |   —    |  ✓   |   ✓    |   —    | —                             |
| `comment`         |   —    |  —   |   —    |   ✓    | —                             |
| `gallery`         |   ✓    |  ✓   |   ✓    |   ✓    | —                             |

---

## 4. 預設角色 × 權限對照

| 權限鍵                 | `super-admin` | `admin` | `auditor` | `member` |
| ---------------------- | :-----------: | :-----: | :-------: | :------: |
| `user:create`          |      ✓*       |    ✓    |           |          |
| `user:read`            |      ✓*       |    ✓    |     ✓     |          |
| `user:update`          |      ✓*       |    ✓    |           |          |
| `user:delete`          |      ✓*       |    ✓    |           |          |
| `user:assignRole`      |      ✓*       |    ✓    |           |          |
| `user:resetPassword`   |      ✓*       |    ✓    |           |          |
| `user:resetMfa`        |      ✓*       |    ✓    |           |          |
| `user:export`          |      ✓*       |    ✓    |           |          |
| `role:create`          |      ✓*       |    ✓    |           |          |
| `role:read`            |      ✓*       |    ✓    |     ✓     |          |
| `role:update`          |      ✓*       |    ✓    |           |          |
| `role:delete`          |      ✓*       |    ✓    |           |          |
| `role:grantPermission` |      ✓*       |    ✓    |           |          |
| `role:export`          |      ✓*       |    ✓    |           |          |
| `permission:read`      |      ✓*       |    ✓    |     ✓     |          |
| `auditLog:read`        |      ✓*       |    ✓    |     ✓     |          |
| `auditLog:export`      |      ✓*       |    ✓    |     ✓     |          |
| `system:read`          |      ✓*       |    ✓    |     ✓     |          |
| `system:update`        |      ✓*       |         |           |          |
| `approval:read`        |      ✓*       |    ✓    |     ✓     |          |
| `approval:review`      |      ✓*       |    ✓    |           |          |
| `approval:override`    |      ✓*       |    ✓    |           |          |
| `approval:export`      |      ✓*       |    ✓    |     ✓     |          |
| `file:create`          |      ✓*       |    ✓    |           |          |
| `file:read`            |      ✓*       |    ✓    |     ✓     |          |
| `file:update`          |      ✓*       |    ✓    |           |          |
| `file:delete`          |      ✓*       |    ✓    |           |          |
| `file:access`          |      ✓*       |    ✓    |           |    ✓     |
| `file:share`           |      ✓*       |    ✓    |           |          |
| `file:listPersonal`    |      ✓*       |    ✓    |           |          |
| `job:read`             |      ✓*       |    ✓    |     ✓     |          |
| `job:retry`            |      ✓*       |    ✓    |           |          |
| `identityProvider:create` |   ✓*       |    ✓    |           |          |
| `identityProvider:read`   |   ✓*       |    ✓    |     ✓     |          |
| `identityProvider:update` |   ✓*       |    ✓    |           |          |
| `identityProvider:delete` |   ✓*       |    ✓    |           |          |
| `group:create`         |      ✓*       |    ✓    |           |          |
| `group:read`           |      ✓*       |    ✓    |     ✓     |          |
| `group:update`         |      ✓*       |    ✓    |           |          |
| `group:delete`         |      ✓*       |    ✓    |           |          |
| `group:assignRole`     |      ✓*       |    ✓    |           |          |
| `group:export`         |      ✓*       |    ✓    |           |          |
| `authz:explain`        |      ✓*       |    ✓    |     ✓     |          |
| `serviceAccount:create` |     ✓*       |    ✓    |           |          |
| `serviceAccount:read`   |     ✓*       |    ✓    |     ✓     |          |
| `serviceAccount:update` |     ✓*       |    ✓    |           |          |
| `serviceAccount:delete` |     ✓*       |    ✓    |           |          |
| `serviceAccount:export` |     ✓*       |    ✓    |           |          |
| `webhook:create`       |      ✓*       |    ✓    |           |          |
| `webhook:read`         |      ✓*       |    ✓    |     ✓     |          |
| `webhook:update`       |      ✓*       |    ✓    |           |          |
| `webhook:delete`       |      ✓*       |    ✓    |           |          |
| `tag:create`           |      ✓*       |    ✓    |           |          |
| `tag:update`           |      ✓*       |    ✓    |           |          |
| `tag:delete`           |      ✓*       |    ✓    |           |          |
| `tag:export`           |      ✓*       |    ✓    |           |          |
| `notification:read`    |      ✓*       |    ✓    |           |          |
| `announcement:create`  |      ✓*       |    ✓    |           |          |
| `announcement:read`    |      ✓*       |    ✓    |     ✓     |          |
| `announcement:update`  |      ✓*       |    ✓    |           |          |
| `announcement:delete`  |      ✓*       |    ✓    |           |          |
| `announcement:publish` |      ✓*       |    ✓    |           |          |
| `mfaPolicy:read`       |      ✓*       |    ✓    |     ✓     |          |
| `mfaPolicy:update`     |      ✓*       |         |           |          |
| `orgUnit:create`       |      ✓*       |    ✓    |           |          |
| `orgUnit:read`         |      ✓*       |    ✓    |     ✓     |          |
| `orgUnit:update`       |      ✓*       |    ✓    |           |          |
| `orgUnit:delete`       |      ✓*       |    ✓    |           |          |
| `orgUnit:export`       |      ✓*       |    ✓    |           |          |
| `approvalFlow:read`    |      ✓*       |    ✓    |     ✓     |          |
| `approvalFlow:update`  |      ✓*       |    ✓    |           |          |
| `comment:delete`       |      ✓*       |    ✓    |           |          |
| `gallery:create`       |      ✓*       |    ✓    |           |          |
| `gallery:read`         |      ✓*       |    ✓    |     ✓     |    ✓     |
| `gallery:update`       |      ✓*       |    ✓    |           |          |
| `gallery:delete`       |      ✓*       |    ✓    |           |          |

`*` super-admin 是 **隱含全集**，不逐筆登錄權限鍵的邊（只有 `tenant:self#superAdmin` 一條邊）；
`GET /auth/profile` 回傳時才展開成完整清單。

`member` 只有 `file:access` 與 `gallery:read`（圖片庫是租戶共用的素材庫，人人能看、少數人維護，[`backend/26-gallery.md`](../backend/26-gallery.md) D3）。`file:access` 讓他進得了檔案管理器，看得到資料夾但全部鎖住，被授權之後才讀得到。
`admin` 也持有 `file:access`：不擴大能力（已有全域 `file:*`），但指派 `member` 受反提權限制，要持有它的每個權限鍵。
其餘只能存取個人範圍的頁面（首頁、個人資料）。
這是刻意的：它是業務功能的權限掛載點——新功能的權限鍵授予 `member`（或自訂角色）即可開放給一般使用者。

---

## 5. 前端頁面 × 所需權限

| 頁面         | 路由                       | Page Key        | 進入所需權限                     | 判定  |
| ------------ | -------------------------- | --------------- | -------------------------------- | ----- |
| 首頁         | `/`                        | `HOME`          | 無                               | —     |
| 登入         | `/auth/login`（跳到 apps/platform 的 IdP）、`/auth/callback` | 不受管 | 無（未登入可進）   | —     |
| 個人資料     | `/profile`（含個人存取 token） | `PROFILE`   | 無                               | —     |
| 偏好設定     | `/preference`              | `PREFERENCE`    | 無                               | —     |
| 通知         | `/notification`（`?filter=unread`） | `NOTIFICATION` | 無（只看得到自己的；[`frontend/15-notification.md`](../frontend/15-notification.md) §4） | — |
| 我的匯入匯出 | `/data-transfer`（`?transfer=<id>`） | `DATA_TRANSFER` | 無（只看得到自己建立的；下載當下另看該資源的匯出權限，[`frontend/21-data-transfer.md`](../frontend/21-data-transfer.md)） | — |
| 使用者列表   | `/user`                    | `USER`          | `user:read`                      | EVERY |
| 建立使用者   | `/user/create`             | `USER_CREATE`   | `user:read` ＋ `user:create`     | EVERY |
| 匯入使用者   | `/user/import`（`?mode=create\|update`；頁內依權限決定可以切換的模式，新增模式要 `user:create`） | `USER_IMPORT` | `user:read` ＋ `user:update` | EVERY |
| 角色列表     | `/role`                    | `ROLE`          | `role:read`                      | EVERY |
| 建立角色     | `/role/create`             | `ROLE_CREATE`   | `role:read` ＋ `role:create`     | EVERY |
| 匯入角色     | `/role/import`（`?mode=create\|update`；新增模式要 `role:create`） | `ROLE_IMPORT` | `role:read` ＋ `role:update` | EVERY |
| 角色權限管理 | `/role/$roleId/permission` | （沿用 `ROLE`） | `role:read` ＋ `permission:read` | EVERY |
| 角色版本紀錄 | `/role/$roleId/revision`   | （沿用 `ROLE`） | `role:read`（「還原到這一版」另看 `role:update`） | EVERY |
| 群組列表     | `/group`（含 `/group/$groupId` 詳情；成員要 `user:read`、角色要 `role:read`） | `GROUP` | `group:read` | EVERY |
| 匯入群組     | `/group/import`（`?mode=create\|update`；新增模式要 `group:create`） | `GROUP_IMPORT` | `group:read` ＋ `group:update` | EVERY |
| 匯入群組成員 | `/group/import-members`（只有新增模式） | `GROUP_MEMBER_IMPORT` | `group:read` ＋ `group:update` ＋ `user:read` | EVERY |
| 組織         | `/organization`（`?unitId=` 選中的部門；成員要 `user:read`） | `ORG_UNIT` | `orgUnit:read` | EVERY |
| 圖片庫       | `/gallery`（含 `/gallery/album/$albumId` 相簿頁、`?item=` 開著的檢視器；上傳要 `gallery:create`） | `GALLERY` | `gallery:read` | EVERY |
| 匯入部門     | `/organization/import`（`?mode=create\|update`；新增模式要 `orgUnit:create`） | `ORG_UNIT_IMPORT` | `orgUnit:read` ＋ `orgUnit:update` | EVERY |
| 匯入部門成員 | `/organization/import-members` | `ORG_UNIT_MEMBER_IMPORT` | `orgUnit:read` ＋ `orgUnit:update` ＋ `user:read` | EVERY |
| 建立群組     | `/group/create`            | `GROUP_CREATE`  | `group:read` ＋ `group:create`   | EVERY |
| 服務帳號列表 | `/service-account`（含 `/service-account/$serviceAccountId` 詳情；角色要 `role:read`，token 要 `serviceAccount:update`） | `SERVICE_ACCOUNT` | `serviceAccount:read` | EVERY |
| 建立服務帳號 | `/service-account/create`  | `SERVICE_ACCOUNT_CREATE` | `serviceAccount:read` ＋ `serviceAccount:create` | EVERY |
| Webhook 列表 | `/webhook`（含 `/webhook/$webhookId` 詳情與投遞紀錄；編輯、重送要 `webhook:update`） | `WEBHOOK` | `webhook:read` | EVERY |
| 建立 Webhook | `/webhook/create`          | `WEBHOOK_CREATE` | `webhook:read` ＋ `webhook:create` | EVERY |
| 標籤管理     | `/tag`（`?scope=file\|user`） | `TAG`        | `tag:create`、`tag:update`、`tag:delete` 任一 | SOME |
| 權限目錄     | `/permission`              | `PERMISSION`    | `permission:read`                | EVERY |
| 稽核日誌     | `/audit-log`               | `AUDIT_LOG`     | `auditLog:read`                  | EVERY |
| 審批         | `/approval`（含 `/approval/$approvalId` 對話框） | `APPROVAL` | `approval:read`           | EVERY |
| 我的審批     | `/my-approvals`（含 `/my-approvals/$approvalId` 對話框；看得到哪些由後端依申請人與候選人決定） | `MY_APPROVAL` | 無 | — |
| 審批流程     | `/approval-flow`（含編輯頁；儲存要 `approvalFlow:update`） | `APPROVAL_FLOW` | `approvalFlow:read` | EVERY |
| 背景工作     | `/job`（含 `/job/$jobId` 對話框） | `JOB` | `job:read`                      | EVERY |
| 檔案         | `/file`（含 `?preview=<id>` 的 LightBox） | `FILE` | `file:access` 或 `file:read`（按鈕層級看後端回傳的 `capabilities`，見 [`06-resource-grants.md`](./06-resource-grants.md) §7） | SOME |
| 外部 IdP 連線 | `/identity-provider`      | `IDENTITY_PROVIDER` | `identityProvider:read`        | EVERY |
| 系統設定（入口） | `/system`：導向第一個看得到的分頁（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §4.5） | `SYSTEM` | `system:read`、`mfaPolicy:read` 任一 | SOME |
| 系統設定：一般 | `/system/settings`（`system:update` 才能修改） | `SETTING` | `system:read`             | EVERY |
| 通知總覽     | `/notification/all`        | `NOTIFICATION_OVERVIEW` | `notification:read`           | EVERY |
| 系統設定：事件通知 | `/system/notification-events`（`system:update` 才能修改） | `NOTIFICATION_EVENT` | `system:read` | EVERY |
| 公告列表     | `/announcement`（含 `/announcement/$announcementId` 詳情與發送紀錄） | `ANNOUNCEMENT` | `announcement:read` | EVERY |
| 建立公告     | `/announcement/create`     | `ANNOUNCEMENT_CREATE` | `announcement:read` ＋ `announcement:create` | EVERY |
| 公告全文     | `/announcement/message/$dispatchId` | `ANNOUNCEMENT_MESSAGE` | 無（只看得到自己收到的） | — |
| 系統設定：安全性（MFA 政策） | `/system/security`（`mfaPolicy:update` 才能修改） | `SECURITY_MFA` | `mfaPolicy:read` | EVERY |
| 回收桶       | `/trash`（分頁依各類型的 `<resource>:delete` 過濾） | `TRASH` | 任一種 `<resource>:delete`（`user:delete`、`role:delete`、`group:delete`、`file:delete`、`announcement:delete`；[`frontend/13-trash.md`](../frontend/13-trash.md) §3） | SOME |

apps/platform 只給平台管理者登入（[`04-sso.md`](../04-sso.md) §1.1、§6.2），這個目錄的權限不適用；
平台管理者的權限目錄在交付順序第 4 步加上租戶管理時建立。帳號流程（申請帳號、啟用、重設密碼）也在 apps/platform，未登入可進。

> 頁面內的 **按鈕層級** gating 另由 `usePagePermission()` 派生的
> `canCreate/canRead/canUpdate/canDelete` 決定，見
> [`frontend/06-permission.md`](../frontend/06-permission.md)。

---

## 6. Seed 資料格式

`apps/api/src/db/seeds/permissions.ts`：

```ts
export const PERMISSION_SEED = [
  // resource, action, i18n key, sort
  ["user", "create", "permission.user.create", 100],
  ["user", "read", "permission.user.read", 101],
  ["user", "update", "permission.user.update", 102],
  ["user", "delete", "permission.user.delete", 103],
  ["user", "assignRole", "permission.user.assignRole", 104],
  ["user", "resetPassword", "permission.user.resetPassword", 105],
  ["user", "resetMfa", "permission.user.resetMfa", 106],

  ["role", "create", "permission.role.create", 200],
  ["role", "read", "permission.role.read", 201],
  ["role", "update", "permission.role.update", 202],
  ["role", "delete", "permission.role.delete", 203],
  ["role", "grantPermission", "permission.role.grantPermission", 204],

  ["permission", "read", "permission.permission.read", 300],
  ["auditLog", "read", "permission.auditLog.read", 400],
  ["system", "read", "permission.system.read", 500],
  ["system", "update", "permission.system.update", 501],

  ["approval", "read", "permission.approval.read", 600],
  ["approval", "review", "permission.approval.review", 601],
  ["approval", "override", "permission.approval.override", 602],

  ["file", "create", "permission.file.create", 700],
  ["file", "read", "permission.file.read", 701],
  ["file", "update", "permission.file.update", 702],
  ["file", "delete", "permission.file.delete", 703],
  ["file", "access", "permission.file.access", 704],
  ["file", "share", "permission.file.share", 705],

  ["job", "read", "permission.job.read", 800],
  ["job", "retry", "permission.job.retry", 801],

  ["identityProvider", "create", "permission.identityProvider.create", 1100],
  ["identityProvider", "read", "permission.identityProvider.read", 1101],
  ["identityProvider", "update", "permission.identityProvider.update", 1102],
  ["identityProvider", "delete", "permission.identityProvider.delete", 1103],

  ["group", "create", "permission.group.create", 1200],
  ["group", "read", "permission.group.read", 1201],
  ["group", "update", "permission.group.update", 1202],
  ["group", "delete", "permission.group.delete", 1203],
  ["group", "assignRole", "permission.group.assignRole", 1204],

  ["authz", "explain", "permission.authz.explain", 1300],
] as const;
```

Seed 行為：

1. **Upsert**（依 `key`）— 重複執行安全。
2. seed 中不存在、DB 中存在的權限 → **不自動刪除**，只印出警告。刪除權限需要
   明確的 migration（同時清掉 `relation_tuples` 上以該鍵為關係的邊），避免誤刪授權。
3. seed 對 `relation_tuples` 的寫入讓 `authz_revision` +1，但 seed 是另一個程序、不送失效廣播：執行中的 api 以權限快取的 TTL（60 秒）反映。

---

## 7. 新增一個權限的流程

1. 在本文件 §2 對應的資源區塊加一列。
2. 在 `db/seeds/permissions.ts` 加一筆。
3. 在 `apps/api/src/modules/<module>/<module>.constants.ts` 加常數。
4. 在 controller 用 `@RequirePermissions(...)` 宣告。
5. 在前端語系檔 `permission.<resource>.<action>` 加上 zh-TW / en-US 顯示名稱。
6. `pnpm db:seed` → `pnpm sdk:generate`。
7. 若這個權限會影響某個頁面的進入條件，更新該 feature 的 `permission.ts` 與本文件 §5。
8. 更新 §4 的預設角色對照表，並在 seed 中把它加進該角色。
9. 決定它在依賴樹（§9）的位置：它包含哪些子能力、依賴哪些 read；同時改 §9.1 與 `PERMISSION_DEPENDENCIES`。

---

## 8. 平台的權限目錄（apps/platform 的平台管理者）

平台管理者（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D5）與租戶的使用者是兩份帳號，權限目錄也是兩份：
上面 §1–§7 是 **租戶** 的目錄（存在每個租戶的 DB）；這一節是 **平台** 的目錄，只在 apps/platform 的網域有效。

- 端點以 `@RequirePlatformPermissions(...)` 宣告（所有鍵都要有），租戶網域上一律 `404 PLATFORM_ONLY`；
  拒絕寫平台稽核 `platform_audit_logs`（`authz.denied`）。
- 平台的權限 **不寫進資料庫**：角色固定三種（`platform_admins.role`），角色 × 權限的對照在
  `apps/api/src/db/seeds/platform-permissions.ts`。平台的權限範圍很小，每個管理者一個角色就夠，不提供自訂角色。
- 前端從 `GET /platform/auth/profile` 的 `permissions` 取得目前管理者的權限。

### 8.1 權限清單（共 14 項）

| 權限鍵                  | 顯示名稱（zh-TW） | 說明 |
| ----------------------- | ----------------- | ---- |
| `tenant:read`           | 檢視租戶          | 租戶清單、狀態、網域、佈建失敗的原因（不含連線字串）、用量 |
| `tenant:create`         | 建立租戶          | 建立並佈建新租戶（database、migration、第一位管理員與啟用信）、重試失敗的佈建 |
| `tenant:update`         | 編輯租戶          | 改名稱、新增／移除網域、停用與啟用（停用會撤銷該租戶的所有 session）、是否允許外部 IdP、啟用的 feature、feature flag 的租戶層覆寫 |
| `tenant:delete`         | 刪除租戶          | 標記刪除並釋出網域；database 與 bucket 由 `pnpm db:drop-tenant` 手動清除（D13） |
| `platformAdmin:read`    | 檢視平台管理者    | 管理者清單、角色與狀態 |
| `platformAdmin:create`  | 新增平台管理者    | 建立成 `pending`，寄啟用信讓本人設定密碼（不接受密碼） |
| `platformAdmin:update`  | 管理平台管理者    | 改名、換角色、停用／啟用（停用即撤銷 session，`locked` 改回 `active` 即解鎖）、寄設定密碼的連結；不能改自己的角色與狀態 |
| `platformAdmin:resetMfa` | 重設平台管理者的 MFA | 刪除別的平台管理者的驗證方式與備用碼、結束他的 session；不能重設自己（[`backend/21-mfa.md`](../backend/21-mfa.md) §8） |
| `platformAuditLog:read` | 檢視平台稽核      | `platform_audit_logs`：平台管理者做過的事（D19）；看不到租戶的稽核 |
| `platformJob:read`      | 檢視背景工作      | 所有租戶與平台自己的工作（D23）；租戶的後台只看得到自己的 |
| `platformJob:retry`     | 重試背景工作      | 把重試用完、停在失敗的工作重新排入；寫平台稽核 `platformJob.retry` |
| `featureFlag:read`      | 檢視試行開關      | feature flag 的目錄、全平台覆寫、各有幾個租戶覆寫（[`architecture/05-tenancy.md`](../05-tenancy.md) §11） |
| `featureFlag:update`    | 切換試行開關      | 全平台層的覆寫：全面開放（`on`）、緊急關閉（`off`）、回到預設；寫平台稽核 `featureFlag.update` |
| `mfaMethod:read`        | 檢視 MFA 方式     | MFA 驗證方式的目錄、全平台狀態、覆寫的租戶數、已設定的因子數、關閉的影響人數（[`backend/21-mfa.md`](../backend/21-mfa.md) §5） |
| `mfaMethod:update`      | 切換 MFA 方式     | 全平台層的開關（`on`／`off`／回到預設）；寫平台稽核 `mfaMethod.update`。租戶層的開關屬於 `tenant:update` |

### 8.2 角色 × 權限

| 權限                    | `super-admin` | `operator` | `auditor` |
| ----------------------- | :-----------: | :--------: | :-------: |
| `tenant:read`           | ✅ | ✅ | ✅ |
| `tenant:create`         | ✅ | ✅ |    |
| `tenant:update`         | ✅ | ✅ |    |
| `tenant:delete`         | ✅ |    |    |
| `platformAdmin:read`    | ✅ | ✅ | ✅ |
| `platformAdmin:create`  | ✅ |    |    |
| `platformAdmin:update`  | ✅ |    |    |
| `platformAdmin:resetMfa` | ✅ |    |    |
| `platformAuditLog:read` | ✅ | ✅ | ✅ |
| `platformJob:read`      | ✅ | ✅ | ✅ |
| `platformJob:retry`     | ✅ | ✅ |    |
| `featureFlag:read`      | ✅ | ✅ | ✅ |
| `featureFlag:update`    | ✅ | ✅ |    |
| `mfaMethod:read`        | ✅ | ✅ | ✅ |
| `mfaMethod:update`      | ✅ |    |    |

只有 `super-admin` 能管理平台管理者，所以不需要反提權規則（`operator` 不能把自己升成 `super-admin`）。
`db:seed` 依 `PLATFORM_ADMIN_EMAIL` 建立的第一位平台管理者是 `super-admin`；之後新增的管理者預設是 `auditor`。

---

## 9. 權限依賴樹（租戶的目錄）

權限鍵之間有包含關係：**沒有 read 的 edit 沒有意義；沒有 edit 的 create、delete 也不合理**。
持有一個鍵，就同時持有它（遞迴）帶來的鍵——guard、`GET /auth/profile`、反提權看到的都是 **閉包**。
決策見 [`01-model.md`](01-model.md) §9.2 D6；程式碼是 `db/seeds/permissions.ts` 的 `PERMISSION_DEPENDENCIES`。

| 邊 | 意思 | 範圍 |
| --- | --- | --- |
| **子能力** | 上層的能力包含它；它也可以單獨授予 | 同一個資源 |
| **依賴** | 少了它就無法完整操作 | 可以跨資源，只能指向 read |

- `delete ⇒ update ⇒ read`。
- 規則 A：`create ⇒ 編輯自己建立的 ⇒ read`。「編輯自己建立的」不是權限鍵，是資源上的關係（檔案的擁有者規則，
  [`06-resource-grants.md`](./06-resource-grants.md) §4）；沒有擁有者概念的資源（`user`、`role`、`identityProvider`、`group`）退化成 `create ⇒ update`。
- 角色只儲存 **明確授予** 的鍵，包含的鍵是算出來的；同時是明確與隱含的鍵保持明確。

### 9.1 清單

| 權限鍵 | 子能力 | 依賴 |
| --- | --- | --- |
| `user:create` | `user:update` | |
| `user:delete` | `user:update` | |
| `user:update` | `user:resetPassword`、`user:read` | |
| `user:resetPassword` | `user:read` | |
| `user:resetMfa` | `user:read` | |
| `user:assignRole` | `user:read` | `role:read` |
| `user:export` | `user:read` | |
| `auditLog:export` | `auditLog:read` | |
| `role:create` | `role:update` | |
| `role:delete` | `role:update` | |
| `role:update` | `role:read` | |
| `role:grantPermission` | `role:read` | `permission:read` |
| `role:export` | `role:read` | |
| `system:update` | `system:read` | |
| `approval:review` | `approval:read` | |
| `approval:override` | `approval:read` | |
| `approval:export` | `approval:read` | |
| `file:create` | `file:read` | |
| `file:delete` | `file:update` | |
| `file:update` | `file:read` | |
| `file:share` | `file:read` | |
| `file:read` | `file:access` | |
| `file:listPersonal` | `file:access` | |
| `job:retry` | `job:read` | |
| `identityProvider:create` | `identityProvider:update` | |
| `identityProvider:delete` | `identityProvider:update` | |
| `identityProvider:update` | `identityProvider:read` | |
| `group:create` | `group:update` | |
| `group:delete` | `group:update` | |
| `group:update` | `group:read` | `user:read` |
| `group:assignRole` | `group:read` | `role:read` |
| `group:export` | `group:read` | `user:read` |
| `authz:explain` | | `user:read`、`role:read`、`group:read` |
| `serviceAccount:create` | `serviceAccount:update` | |
| `serviceAccount:delete` | `serviceAccount:update` | |
| `serviceAccount:update` | `serviceAccount:read` | `role:read` |
| `serviceAccount:export` | `serviceAccount:read` | |
| `webhook:create` | `webhook:update` | |
| `webhook:delete` | `webhook:update` | |
| `webhook:update` | `webhook:read` | |
| `tag:create` | `tag:update` | |
| `tag:delete` | `tag:update` | |
| `notification:read` | | `user:read` |
| `announcement:create` | `announcement:update` | |
| `announcement:delete` | `announcement:update` | |
| `announcement:update` | `announcement:read` | `user:read`、`group:read`、`role:read` |
| `announcement:publish` | `announcement:update` | |
| `mfaPolicy:update` | `mfaPolicy:read` | `role:read` |
| `orgUnit:create` | `orgUnit:update` | |
| `orgUnit:delete` | `orgUnit:update` | |
| `orgUnit:update` | `orgUnit:read` | `user:read` |
| `orgUnit:export` | `orgUnit:read` | `user:read` |
| `approvalFlow:update` | `approvalFlow:read` | `user:read`、`group:read`、`role:read`、`orgUnit:read` |
| `gallery:create` | `gallery:read` | |
| `gallery:update` | `gallery:read` | |
| `gallery:delete` | `gallery:read` | |

沒有列出的鍵是葉節點（`permission:read`、`auditLog:read`、各資源的 `read`、`file:access`）。

### 9.2 不變條件

啟動時驗證（`assertPermissionDependencies()`，與路由稽核同一個時機），違反就啟動失敗：

| # | 條件 | 理由 |
| --- | --- | --- |
| G1 | 沒有循環 | 閉包要有定義 |
| G2 | 子能力只能在同一個資源內 | 跨資源的關係一律是「依賴」 |
| G3 | 依賴只能指向 `<r>:read`（或閘門 `file:access`） | 依賴是為了完整操作而補上的，不能因此多出寫入能力 |
| G4 | 受反提權限制的鍵（`user:assignRole`、`role:grantPermission`、`file:share`、`group:assignRole`、`approvalFlow:update`）不能被任何鍵包含 | 否則「能編輯使用者」會悄悄等於「能指派角色」 |

### 9.3 對預設角色的影響

`admin` 本來就持有每個被包含的鍵；`auditor` 多出 `file:access`（由 `file:read`），沒有行為變化（檔案路由本來就接受 `file:access` 或 `file:read`）；`member` 不變。
租戶自訂的角色可能多出鍵：有 `user:update` 的角色多出 `user:resetPassword`；有 `file:create` 或 `file:share` 而沒有 `file:read` 的角色取得 **全域讀取**（含中斷繼承的私人資料夾）。
seed 會為這些角色寫一筆稽核 `role.permissionsImplied`。

### 9.4 在畫面上檢視

同一份依賴樹在後台畫成兩個地方，版面共用 `apps/backstage/src/core/permission-graph/`
（每個資源一組、基礎權限在上、跨資源的依賴是虛線）。它刻意不放在 `core/permission`：每個 feature 的 `permission.ts`
在同步階段就會 import `core/permission`，放在一起會把 `@xyflow/react` 與 `@dagrejs/dagre` 帶進首屏。

| 位置 | 用途 |
| --- | --- |
| 角色詳情 · 權限分頁（`features/role/components/PermissionSkillTree.tsx`） | 可勾選的技能樹，互鎖見 [`03-flows.md`](./03-flows.md) |
| 權限目錄（`features/permission/pages/PermissionList/`） | 唯讀。「一覽表／樹狀圖」分頁切換；節點以「你持有／未持有」著色，滑過強調前置路徑，點選在右側面板顯示說明、包含的子能力、依賴、被哪些鍵包含或依賴，以及持有它就等於持有的全部鍵（閉包）；面板裡的權限可以點，跳到那個節點 |

權限目錄的篩選（關鍵字比對名稱與權限鍵、資源可複選、是否持有）同時作用在兩種檢視；樹狀圖只畫符合的節點，
說明面板的關係仍以完整目錄計算。檢視、篩選與選取的權限都放在網址（`?view=tree&key=user:update&resource=user`），可以直接分享。

