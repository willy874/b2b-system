# 七個後端檔案超過 600 行，UserService 同時是使用者管理與 AuthModule 的帳號 API

## 現況

`apps/api/src` 超過 600 行的檔案（不含測試與 migration）：

| 檔案（`apps/api/src/modules/`） | 行數 |
| --- | --- |
| `user/user.service.ts` | 746 |
| `file/file-folder.service.ts` | 732 |
| `file/file-folder.repository.ts` | 704 |
| `file/file.service.ts` | 686 |
| `role/role.service.ts` | 639 |
| `auth/auth.service.ts` | 617 |
| `group/group.repository.ts` | 602 |

最值得先拆的兩個：

- `UserService`：
  - L710 起是「帳號狀態與憑證：供 AuthModule 使用」的一組方法：`findAccountById()`、`findAccountByEmail()`、`updateAccount()`、`incrementTokenVersion()`、`recordFailedLogin()`、`listRoleSummaries()`。
  - 另有 `createAccount()`、`assertCreatable()`、`emitStatusChanged()`、`publishCreated()`。
  - 這些方法由 `AuthService`、`SsoService`、`ExternalLoginService`、`OidcProviderService`、`UserRegistrationApprovalHandler` 使用，卻和管理端點（`create`、`update`、`remove`、`restore`、`replaceRoles`…）放在同一個類別。建構子注入 14 個依賴。
- `FileFolderService`：`ensurePaths()`（L181 起，約 100 行）、`move()`（L319 起，約 80 行）、`restore()`（L455 起，約 100 行）是三段獨立的流程，和列表、建立、改名放在一起。

## 影響

- 改登入流程用到的帳號規則時，得讀懂整個使用者管理；改管理流程時，也可能動到登入。review 的範圍和依賴一起變大。
- 沒有錯誤的結果，屬於開發體驗。

## 修正方式

1. 從 `UserService` 拆出 `UserAccountService`，同一個模組、一起匯出：
   - 放登入流程用的讀寫與 `createAccount()` 那一組。
   - `UserService` 只留管理端點。
   - AuthModule、OidcProviderModule 與審批的 handler 改注入它。
2. `FileFolderService` 拆出 `FileFolderMoveService`、`FileFolderRestoreService`，或把 `ensurePaths()` 歸到上傳流程。共用的檢查（`assertDepth()`、`assertMovable()`）留在原處，或抽成純函式。
3. 只搬程式，不改行為。

## 驗證方式

- 拆分前後 `pnpm typecheck`、`pnpm test` 都通過。
- 測試的斷言不需要改，只改注入的 provider。
