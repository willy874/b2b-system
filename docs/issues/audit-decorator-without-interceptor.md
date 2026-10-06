# `@Audit()` 標上去不會寫任何稽核：文件描述的 AuditInterceptor 不存在

## 現況

- `apps/api/src/common/decorators/audit.decorator.ts`（L12–16）只設定 metadata，註解說稽核由 `AuditInterceptor` 寫入：

```ts
/**
 * 單純 CRUD 的稽核可以宣告在 handler 上由 `AuditInterceptor` 寫入；
 * 需要 before/after 差異或交易一致性的，仍由 service 主動寫。
 */
export const Audit = (options: AuditMetadataOptions) => SetMetadata(AUDIT_METADATA, options);
```

- 它經 `common/decorators/index.ts`（L2）匯出，任何 controller 都 import 得到。
- 整個 `apps/api` 沒有 `AuditInterceptor`，也沒有程式讀 `AUDIT_METADATA`。全域只註冊了 `TransformInterceptor`（`app.module.ts` L138、`external-api.module.ts` L98）。目前沒有任何地方用 `@Audit(`。
- 文件仍把它寫成請求管線的一步：
  - [`backend/01-architecture.md`](../architecture/backend/01-architecture.md) §2 的目錄（L105，`audit.decorator.ts`）與 §3 的第 ⑦ 步（L187–189）。
  - [`architecture/01-system.md`](../architecture/01-system.md) 的管線圖（L33）。
  - [`architecture/02-repository-structure.md`](../architecture/02-repository-structure.md)（L183）。

## 影響

- 照文件替新端點標 `@Audit({...})`：能編譯、測試照過，但稽核表沒有任何紀錄，也不會有錯誤提醒。
- interceptor 要等 handler 回傳之後才寫，不可能和業務寫入在同一個交易。這和「稽核在交易內」（[`conventions/03-backend.md`](../conventions/03-backend.md) §1 第 6 條）衝突，所以不應該補做出來。
- 目前沒有端點用它，沒有實際遺失的稽核。

## 修正方式

建議刪除：

1. 刪掉 `audit.decorator.ts`，以及 `decorators/index.ts` 的匯出。
2. 從上面三份文件拿掉 `AuditInterceptor` 與 `@Audit`。01-architecture §3 改寫成「稽核一律由 service 在交易內寫入」。

如果要保留宣告式稽核：先說明它怎麼滿足「稽核在交易內」，再實作 interceptor 與測試；在那之前不要匯出 decorator。

## 驗證方式

- `pnpm typecheck` 通過。
- `git grep -n "AUDIT_METADATA\|AuditInterceptor" -- apps docs ':!docs/issues'` 沒有結果。
