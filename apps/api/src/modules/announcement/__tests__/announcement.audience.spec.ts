import { describe, expect, it, vi } from 'vitest';

import type { AuthzService } from '@/core/authz';
import type { AnnouncementAudienceValue } from '@/db/schema';
import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
} from '@/db/schema';

import { AnnouncementAudienceResolver, isEmptyAudience } from '../announcement.audience';
import type { AnnouncementRepository } from '../announcement.repository';

interface Directory {
  /** 存在且未刪除的群組、角色。 */
  groups?: string[];
  roles?: string[];
  /** 可登入的使用者。 */
  users?: string[];
  /** 反向展開的結果（群組成員、角色持有者，可能含不可登入的人）。 */
  expanded?: string[];
  all?: string[];
}

/** 假的「只留存在的 id」查詢。 */
function keep(known: string[] | undefined) {
  return async (ids: readonly string[]) => ids.filter((id) => (known ?? []).includes(id));
}

function setup(directory: Directory = {}) {
  const repo = {
    activeGroupIds: vi.fn(keep(directory.groups)),
    activeRoleIds: vi.fn(keep(directory.roles)),
    filterRecipients: vi.fn(keep(directory.users)),
    allRecipients: vi.fn(async () => directory.all ?? []),
  };
  const authz = {
    usersInSubjectSets: vi.fn(
      async (_sets: ReadonlyArray<{ type: string; id: string; relation: string }>) =>
        directory.expanded ?? [],
    ),
  };
  const resolver = new AnnouncementAudienceResolver(
    repo as unknown as AnnouncementRepository,
    authz as unknown as AuthzService,
  );
  return { resolver, repo, authz };
}

function audience(values: Partial<AnnouncementAudienceValue>): AnnouncementAudienceValue {
  return { all: false, userIds: [], groupIds: [], roleIds: [], ...values };
}

describe('isEmptyAudience（docs/architecture/backend/19-announcement.md §3）', () => {
  it.each([
    ['一個都沒選', audience({}), true],
    ['全租戶', audience({ all: true }), false],
    ['只有指定的人', audience({ userIds: ['u'] }), false],
    ['只有群組', audience({ groupIds: ['g'] }), false],
    ['只有角色', audience({ roleIds: ['r'] }), false],
  ])('%s → %s', (_label, value, expected) => {
    expect(isEmptyAudience(value)).toBe(expected);
  });
});

describe('AnnouncementAudienceResolver.resolve（docs/architecture/backend/19-announcement.md §4、§9.2 D5）', () => {
  it('指定的人 ∪ 群組成員 ∪ 角色持有者，去重並排序', async () => {
    const { resolver } = setup({
      groups: ['g1'],
      roles: ['r1'],
      users: ['u3', 'u1', 'u2'],
      expanded: ['u2', 'u1'],
    });
    const result = await resolver.resolve(
      audience({ userIds: ['u3', 'u1'], groupIds: ['g1'], roleIds: ['r1'] }),
    );
    expect(result.userIds).toEqual(['u1', 'u2', 'u3']);
  });

  it('群組以 member、角色以 holder 沿關係圖反向展開，只展開存在的來源', async () => {
    const { resolver, authz } = setup({ groups: ['g1'], roles: ['r1'] });
    await resolver.resolve(audience({ groupIds: ['g1', 'g-gone'], roleIds: ['r1', 'r-gone'] }));
    expect(authz.usersInSubjectSets).toHaveBeenCalledWith([
      { type: GROUP_OBJECT_TYPE, id: 'g1', relation: GROUP_MEMBER_RELATION },
      { type: ROLE_OBJECT_TYPE, id: 'r1', relation: ROLE_HOLDER_RELATION },
    ]);
  });

  it('展開出來的人也只留可登入的（停用、已刪除的成員不收）', async () => {
    const { resolver, repo } = setup({
      groups: ['g1'],
      users: ['u1'],
      expanded: ['u1', 'u-disabled'],
    });
    const result = await resolver.resolve(audience({ groupIds: ['g1'] }));
    expect(repo.filterRecipients).toHaveBeenCalledWith(['u1', 'u-disabled']);
    expect(result.userIds).toEqual(['u1']);
  });

  it('不存在或已刪除的群組、角色與不可登入的指定使用者列入 skipped', async () => {
    const { resolver } = setup({ groups: ['g1'], roles: [], users: ['u1'] });
    const result = await resolver.resolve(
      audience({ userIds: ['u1', 'u-gone'], groupIds: ['g1', 'g-gone'], roleIds: ['r-gone'] }),
    );
    expect(result.skipped).toEqual({
      userIds: ['u-gone'],
      groupIds: ['g-gone'],
      roleIds: ['r-gone'],
    });
  });

  it('全租戶：收件人是所有可登入的使用者，不必展開群組與角色', async () => {
    const { resolver, authz } = setup({ all: ['u1', 'u2', 'u3'] });
    const result = await resolver.resolve(audience({ all: true, groupIds: ['g1'] }));
    expect(result.userIds).toEqual(['u1', 'u2', 'u3']);
    expect(authz.usersInSubjectSets).not.toHaveBeenCalled();
  });

  it('全租戶時仍回報略過的來源', async () => {
    const { resolver } = setup({ all: ['u1'] });
    const result = await resolver.resolve(audience({ all: true, groupIds: ['g-gone'] }));
    expect(result.skipped.groupIds).toEqual(['g-gone']);
  });

  it('來源都不存在：沒有收件人', async () => {
    const { resolver } = setup();
    const result = await resolver.resolve(audience({ userIds: ['u-gone'], groupIds: ['g-gone'] }));
    expect(result.userIds).toEqual([]);
  });
});
