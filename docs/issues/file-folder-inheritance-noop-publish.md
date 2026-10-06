# 資料夾的繼承設定沒有改變時仍推播一次更新

## 現況

`apps/api/src/modules/file/file-folder-grant.service.ts` 的 `setInheritance()`（L137–170）：

- 交易裡，`folder.inheritGrants === dto.inheritGrants` 時提早 `return`（L145），不寫入、不記稽核。
- 交易外的 `this.publish(folderId)`（L167）卻無條件執行，所以沒有改變也會推播 `RESOURCE_CHANGED`（fileFolder update）。

## 影響

沒有錯誤結果。開著這個資料夾的其他使用者會多收到一次推播，然後重新抓一次資料夾和授權列表。

## 修正方式

讓 `writeGrants` 的 callback 回傳有沒有寫入，只在有寫入時才 `publish`。
`set()`、`revoke()` 的推播條件也照同樣的寫法檢查一次。

## 驗證方式

`file-folder-grant.service.spec.ts` 的「與目前狀態相同 → 不寫入、不寫稽核」再斷言 `events.publish` 沒被呼叫。
