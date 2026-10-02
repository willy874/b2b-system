import { Injectable } from '@nestjs/common';

import { AuthzService } from '@/core/authz';
import type { AnnouncementAudienceValue } from '@/db/schema';
import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
} from '@/db/schema';

import { AnnouncementRepository } from './announcement.repository';

/** 解析的結果：收件人（排序過、不重複）與略過的來源。 */
export interface ResolvedAudience {
  userIds: string[];
  skipped: { userIds: string[]; groupIds: string[]; roleIds: string[] };
}

/** 受眾一個都沒選（`all` 為 false 且三種來源都空）。 */
export function isEmptyAudience(audience: AnnouncementAudienceValue): boolean {
  return (
    !audience.all &&
    audience.userIds.length === 0 &&
    audience.groupIds.length === 0 &&
    audience.roleIds.length === 0
  );
}

/**
 * 受眾 → 收件人（docs/adr/0031-announcements.md D5）：指定的人 ∪ 群組的成員（含巢狀）∪ 角色的持有者（含經由群組）
 * ∪（`all` 時）全部，最後只留可登入的使用者。群組與角色沿關係圖反向展開（`AuthzService.usersInSubjectSets`），
 * 不在公告模組自己查 `relation_tuples`。在發送的當下呼叫：結果是快照，之後才加入群組的人不會補收。
 */
@Injectable()
export class AnnouncementAudienceResolver {
  constructor(
    private readonly repo: AnnouncementRepository,
    private readonly authz: AuthzService,
  ) {}

  async resolve(audience: AnnouncementAudienceValue): Promise<ResolvedAudience> {
    const [groupIds, roleIds, directUsers] = await Promise.all([
      this.repo.activeGroupIds(audience.groupIds),
      this.repo.activeRoleIds(audience.roleIds),
      this.repo.filterRecipients(audience.userIds),
    ]);
    const skipped = {
      userIds: without(audience.userIds, directUsers),
      groupIds: without(audience.groupIds, groupIds),
      roleIds: without(audience.roleIds, roleIds),
    };

    if (audience.all) return { userIds: await this.repo.allRecipients(), skipped };

    const expanded = await this.authz.usersInSubjectSets([
      ...groupIds.map((id) => ({ type: GROUP_OBJECT_TYPE, id, relation: GROUP_MEMBER_RELATION })),
      ...roleIds.map((id) => ({ type: ROLE_OBJECT_TYPE, id, relation: ROLE_HOLDER_RELATION })),
    ]);
    const members = await this.repo.filterRecipients(expanded);
    const userIds = [...new Set([...directUsers, ...members])].toSorted();
    return { userIds, skipped };
  }
}

function without(all: readonly string[], kept: readonly string[]): string[] {
  const keep = new Set(kept);
  return all.filter((id) => !keep.has(id));
}
