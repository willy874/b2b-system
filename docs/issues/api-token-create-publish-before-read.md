# 建立 API token 時，推播早於讀回剛建立的列

## 現況

`apps/api/src/modules/api-token/api-token.service.ts` 的 `create()`（L159 起）在交易提交後依序：

1. `this.publish(ChangeKind.CREATE, account, row.id)`：推播 `RESOURCE_CHANGED`（L221）。
2. `this.repo.findOne(account.id, row.id)`：讀回剛建立的列（L222）。
3. 讀不到時 `throw new Error('剛建立的 API token 讀不到')`（L223）。

讀不到時推播已經送出，API 卻回 500，而且 secret 原文只會在這個回應裡出現一次。

## 影響

實務上幾乎不會發生，因為同一個程序剛提交的列一定讀得到。真的發生時（例如讀到 replica 的延遲），會出現兩個問題：

- 其他分頁收到推播後重新整理列表，看到一把新的 token。
- 建立的人拿到 500，沒有拿到 secret，只能撤銷這把 token 再建一把。

## 修正方式

把 `publish` 移到 `findOne` 成功之後，只在整個操作成功時才推播。精神同 [`conventions/03-backend.md`](../conventions/03-backend.md) §1 第 6 條：不推出呼叫端沒拿到的變更。
也可以把讀回這一步移進交易，用 `RETURNING` 取回需要的欄位，就不必再查一次。

## 驗證方式

`api-token.service.spec.ts` 已經測了 begin → insert → audit → commit → publish 的順序。補一個測試：`findOne` 回 undefined 時不推播。
