import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';

import type { UserRoleSummary } from './user.repository';

/** 使用者資料或狀態變更；帶上持有的角色，讓角色的持有者清單精準失效。 */
export function userUpdated(
  id: string,
  roles: readonly Pick<UserRoleSummary, 'id'>[],
): ResourceChangeWire {
  return {
    resource: ChangeSource.USER,
    kind: ChangeKind.UPDATE,
    id,
    refs: { [ChangeSource.ROLE]: roles.map((role) => role.id) },
  };
}
