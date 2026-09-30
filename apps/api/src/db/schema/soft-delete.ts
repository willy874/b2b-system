import { isNotNull, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** 有軟刪除欄位的表（或它的 `alias()`）。 */
export interface SoftDeletable {
  deletedAt: AnyPgColumn;
}

/**
 * 還沒被軟刪除的列（docs/architecture/backend/02-database.md §1、ADR-0025 D8）。ADR 寫的位置是 `db/soft-delete.ts`，
 * 放在 `db/schema/` 是因為 `isActiveRole()`（roles.ts）要用它、而 `db/schema/` 只依賴同層（登記在 CLAUDE.md）。
 * `modules/`、`core/` 一律用它，不手寫 `isNull(x.deletedAt)`（🔒 `soft-delete-scan.spec.ts`）：
 * 軟刪除的語意改了只改這裡。沒有「預設排除」：每個查詢自己決定要不要加這個條件。
 */
export function notDeleted(table: SoftDeletable): SQL {
  return isNull(table.deletedAt);
}

/**
 * 已被軟刪除的列。**故意** 讀已刪除資料的查詢（回收桶、還原、永久刪除）用它，
 * 讓讀的人一眼看出這裡不是漏了 `notDeleted`。
 */
export function isDeleted(table: SoftDeletable): SQL {
  return isNotNull(table.deletedAt);
}
