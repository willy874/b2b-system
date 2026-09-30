import { describe, expect, it } from 'vitest';

import { permissionKeysDiffer, toRoleRevisionRowVM } from '../adapter';

const snapshot = (permissionKeys: string[]) => ({ name: 'n', description: null, permissionKeys });

describe('RoleDetailRevision adapter', () => {
  it('作者不在（系統或已永久刪除）時 actorName 是 null；帶過大未保存的標記', () => {
    expect(
      toRoleRevisionRowVM({
        version: 2,
        createdAt: '2026-09-30T00:00:00.000Z',
        actor: null,
        tooLarge: true,
      }),
    ).toMatchObject({ version: 2, actorName: null, tooLarge: true });
    expect(
      toRoleRevisionRowVM({
        version: 3,
        createdAt: '2026-09-30T00:00:00.000Z',
        actor: { id: 'u', name: 'Alice' },
        tooLarge: false,
      }).actorName,
    ).toBe('Alice');
  });

  it.each([
    [['a', 'b'], ['b', 'a'], false],
    [['a'], ['a', 'b'], true],
    [['a', 'b'], ['a', 'c'], true],
    [[], [], false],
  ])('permissionKeysDiffer(%j, %j) = %s（不看順序）', (left, right, expected) => {
    expect(permissionKeysDiffer(snapshot(left), snapshot(right))).toBe(expected);
  });

  it('任一邊沒有內容時視為相同（交給後端判斷）', () => {
    expect(permissionKeysDiffer(null, snapshot(['a']))).toBe(false);
    expect(permissionKeysDiffer(snapshot(['a']), undefined)).toBe(false);
  });
});
