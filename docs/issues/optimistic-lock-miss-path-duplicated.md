# 服務帳號更新的樂觀鎖沒命中時帶舊版本、被刪除也回 409；同一段判斷在 7 個 service 各寫一份

## 現況

[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 規定，條件式 UPDATE 沒命中時，要在同一個交易內重讀一次：

- 列還在 → `409 <RESOURCE>_VERSION_CONFLICT`，`details.current` 是重讀到的版本。
- 列已刪除 → `404 <RESOURCE>_NOT_FOUND`。

`apps/api/src/modules/service-account/service-account.service.ts` 的 `update()`（L120–159）沒有重讀：

```ts
const row = await this.repo.update(id, values, dto.version, deactivating, tx);   // L134
if (!row) {
  throw new AppException('SERVICE_ACCOUNT_VERSION_CONFLICT', { current: current.version });   // L136
}
```

- `current` 是交易前（L125）讀到的列。在讀取（L125）和寫入（L134）之間被別人改過時，`details.current` 會是舊版本。
- 在同一段時間被刪除時，因為 `repo.update()` 的條件含 `notDeleted`，回的是 409，不是 404。
- `ServiceAccountRepository` 沒有 `findVersion()`。`user`、`role`、`group`、`file`、`announcement` 的 repository 都有。

其他模組照規格做，但各自寫了一份相同的判斷：

- 抽成私有方法 `missedUpdate()`：`user.service.ts`（L624 起）、`role.service.ts`（L598 起）、`group.service.ts`（L458 起）、`announcement.service.ts`（L540 起）。
- 寫在流程裡：`file.service.ts`（L395–400）、`webhook.service.ts`（L232–237）、`tag.service.ts`（L160–165）。後兩個用 `findById(id, tx)` 讀整列，而不是 `findVersion()`。

## 影響

- 前提：兩個人幾乎同時編輯同一個服務帳號。單純帶舊版本送出時，L125 讀到的已是最新版本，回應正確。
- 碰上時：
  - 照 `details.current` 重送，還是衝突。
  - 被刪除的帳號顯示成「版本衝突」，而不是「不存在」。
- 七份複本日後容易再分歧，服務帳號就是漏掉的那一個。

## 修正方式

1. `ServiceAccountRepository` 加 `findVersion(id, tx)`。`update()` 沒命中時在交易內重讀：
   - `undefined` → `SERVICE_ACCOUNT_NOT_FOUND`。
   - 否則 → `SERVICE_ACCOUNT_VERSION_CONFLICT { current }`。
2. 抽出共用的 helper，放在 `core/database` 或 `core/errors`，例：

```ts
export async function missedUpdate(
  findVersion: () => Promise<number | undefined>,
  codes: { notFound: ErrorCode; conflict: ErrorCode },
): Promise<AppException>
```

   八個地方都改用它。`webhook`、`tag` 順便改成用 `findVersion()`，不必讀整列。

## 驗證方式

`apps/api/test/optimistic-lock.spec.ts` 已經有 `raceAfterRead()`（L80–102），用來模擬「讀到之後、寫入之前」。照使用者的兩個案例（L189、L208）補服務帳號的版本：

- 讀到之後被搶先改成 v2，再用 v1 送出：`409 SERVICE_ACCOUNT_VERSION_CONFLICT`，`details.current` 是 2。
- 讀到之後被刪除，再送出：`404 SERVICE_ACCOUNT_NOT_FOUND`。
