import { describe, expect, it } from 'vitest';

import { platformAdminFixture } from '../../../test-fixtures';
import { matchesPlatformAdminKeyword, toPlatformAdminRowVM } from '../adapter';

describe('toPlatformAdminRowVM', () => {
  it('轉出列表需要的欄位；最後登入轉成 Date', () => {
    const admin = platformAdminFixture();
    expect(toPlatformAdminRowVM(admin, undefined)).toEqual({
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      status: admin.status,
      lastLoginAt: new Date('2026-09-30T00:00:00.000Z'),
      isSelf: false,
    });
  });

  it('沒有登入過 → lastLoginAt 為 null', () => {
    expect(toPlatformAdminRowVM(platformAdminFixture({ lastLoginAt: null }), undefined)).toEqual(
      expect.objectContaining({ lastLoginAt: null }),
    );
  });

  it('id 與登入中的管理者相同 → isSelf', () => {
    const admin = platformAdminFixture();
    expect(toPlatformAdminRowVM(admin, admin.id).isSelf).toBe(true);
  });
});

describe('matchesPlatformAdminKeyword（前端篩選）', () => {
  const row = toPlatformAdminRowVM(
    platformAdminFixture({ email: 'operator@platform.test', displayName: '營運小明' }),
    undefined,
  );

  it.each([
    { keyword: undefined, expected: true },
    { keyword: '小明', expected: true },
    { keyword: 'OPERATOR@', expected: true },
    { keyword: 'auditor', expected: false },
  ])('關鍵字 $keyword → $expected', ({ keyword, expected }) => {
    expect(matchesPlatformAdminKeyword(row, keyword)).toBe(expected);
  });
});
