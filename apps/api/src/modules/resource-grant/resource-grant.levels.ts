import { GRANT_LEVELS } from '@/db/schema';
import type { GrantLevel } from '@/db/schema';

/**
 * 每種資源自己定義「等級蘊含哪些動作」（docs/rbac/07-resource-grants.md §2、§10.1）；
 * 等級的全序與反提權的比對方式是共通的，寫在這裡。
 */
export type LevelActions<Action extends string> = Record<GrantLevel, readonly Action[]>;

/** 這個等級蘊含 `action` 嗎；null（沒有等級）一律否。 */
export function levelAllows<Action extends string>(
  levels: LevelActions<Action>,
  level: GrantLevel | null,
  action: Action,
): boolean {
  return level !== null && levels[level].includes(action);
}

/**
 * 反提權（§6.1）：授予、變更或移除這些等級時，它們蘊含、而操作者沒有的動作。
 * `can` 是操作者在該資源上的能力（全域權限 ∪ 資源等級），由呼叫端提供；
 * 結果依 `order` 排序，錯誤訊息穩定。
 */
export function missingActions<Action extends string>(
  levels: LevelActions<Action>,
  granted: readonly GrantLevel[],
  order: readonly Action[],
  can: (action: Action) => boolean,
): Action[] {
  const required = new Set(granted.flatMap((level) => levels[level]));
  return order.filter((action) => required.has(action) && !can(action));
}

/** 操作者授予得起的等級：每個等級蘊含的動作操作者都有。 */
export function assignableLevels<Action extends string>(
  levels: LevelActions<Action>,
  order: readonly Action[],
  can: (action: Action) => boolean,
): GrantLevel[] {
  return GRANT_LEVELS.filter((level) => missingActions(levels, [level], order, can).length === 0);
}
