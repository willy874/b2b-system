import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';

/** 樂觀鎖的條件式 UPDATE 沒命中時，兩種結果各自的錯誤碼。 */
export interface MissedUpdateCodes {
  /** 列已不在（刪除）：`<RESOURCE>_NOT_FOUND`。 */
  notFound: ErrorCode;
  /** 列還在、版本被搶先改過：`<RESOURCE>_VERSION_CONFLICT`。 */
  conflict: ErrorCode;
}

/**
 * 樂觀鎖的條件式 UPDATE（`id`、`version` 相符且未刪除才寫入）沒有命中時要拋的錯誤
 * （docs/architecture/backend/03-api-conventions.md §11）：重讀一次目前的版本——
 * 讀不到（已刪除）→ `404 <RESOURCE>_NOT_FOUND`；讀得到 → `409 <RESOURCE>_VERSION_CONFLICT`，`details.current` 是重讀到的版本。
 *
 * `findVersion` 要在 **UPDATE 的同一個交易內** 查，條件與 UPDATE 的「未刪除」一致：
 * 才看得到搶先的那一筆已提交的版本，`details.current` 照著重送就不會再衝突。
 *
 * ```ts
 * if (!updated) {
 *   throw await missedUpdate(() => this.repo.findVersion(id, tx), {
 *     notFound: 'ROLE_NOT_FOUND',
 *     conflict: 'ROLE_VERSION_CONFLICT',
 *   });
 * }
 * ```
 */
export async function missedUpdate(
  findVersion: () => Promise<number | undefined>,
  codes: MissedUpdateCodes,
): Promise<AppException> {
  const current = await findVersion();
  return current === undefined
    ? new AppException(codes.notFound)
    : new AppException(codes.conflict, { current });
}
