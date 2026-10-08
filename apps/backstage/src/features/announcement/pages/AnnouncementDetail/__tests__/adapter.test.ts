import { describe, expect, it } from 'vitest';

import type { AnnouncementAudience } from '@/shared/api-sdk';

import { audienceSummary } from '../adapter';

const audience = (overrides: Partial<AnnouncementAudience> = {}): AnnouncementAudience => ({
  all: false,
  userIds: [],
  groupIds: [],
  roleIds: [],
  ...overrides,
});

describe('audienceSummary（受眾的摘要）', () => {
  it('全部 → 只有一段「全部」，忽略個別指定', () => {
    expect(audienceSummary(audience({ all: true, userIds: ['u1'] }))).toEqual([
      { key: 'announcement.audience.summary.all' },
    ]);
  });

  it('使用者、群組、角色各一段並帶數量，依序排列', () => {
    expect(
      audienceSummary(
        audience({ userIds: ['u1', 'u2', 'u3'], groupIds: ['g1'], roleIds: ['r1', 'r2'] }),
      ),
    ).toEqual([
      { key: 'announcement.audience.summary.users', args: { count: 3 } },
      { key: 'announcement.audience.summary.groups', args: { count: 1 } },
      { key: 'announcement.audience.summary.roles', args: { count: 2 } },
    ]);
  });

  it('沒有的來源不顯示', () => {
    expect(audienceSummary(audience({ roleIds: ['r1'] }))).toEqual([
      { key: 'announcement.audience.summary.roles', args: { count: 1 } },
    ]);
  });

  it('什麼都沒選 → none 的摘要', () => {
    expect(audienceSummary(audience())).toEqual([{ key: 'announcement.audience.summary.none' }]);
  });
});
