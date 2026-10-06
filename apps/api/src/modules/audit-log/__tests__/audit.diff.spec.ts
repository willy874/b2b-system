import { describe, expect, it } from 'vitest';

import { AUDIT_EXCLUDED_FIELDS, diff } from '../audit.diff';

interface Row {
  name: string;
  description: string | null;
  permissions: string[];
  updatedAt: Date;
  settings: { theme: string } | null;
  passwordHash: string;
  tokenHash: string;
  tokenVersion: number;
  count: number;
  enabled: boolean;
}

const BEFORE: Row = {
  name: 'Alice',
  description: null,
  permissions: ['user:read', 'role:read'],
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  settings: { theme: 'dark' },
  passwordHash: '$argon2id$old',
  tokenHash: 'hash-old',
  tokenVersion: 1,
  count: 0,
  enabled: true,
};

const ALL_FIELDS = Object.keys(BEFORE) as (keyof Row)[];

describe('diff（docs/architecture/backend/06-audit-log.md §5）', () => {
  it.each<[string, Partial<Row>, ReturnType<typeof diff<Row>>]>([
    ['沒有變更 → null', {}, null],
    ['值相同 → null', { name: 'Alice', count: 0, enabled: true }, null],
    [
      '字串改變 → 只記該欄位',
      { name: 'Bob' },
      { before: { name: 'Alice' }, after: { name: 'Bob' } },
    ],
    [
      'null → 值',
      { description: 'hi' },
      { before: { description: null }, after: { description: 'hi' } },
    ],
    [
      '值 → null',
      { settings: null },
      { before: { settings: { theme: 'dark' } }, after: { settings: null } },
    ],
    ['0 → 1（falsy 的舊值也要記）', { count: 1 }, { before: { count: 0 }, after: { count: 1 } }],
    ['true → false', { enabled: false }, { before: { enabled: true }, after: { enabled: false } }],
    [
      '同一個時間的不同 Date 物件 → 視為相同',
      { updatedAt: new Date('2026-10-01T00:00:00.000Z') },
      null,
    ],
    [
      '不同時間 → 記錄',
      { updatedAt: new Date('2026-10-02T00:00:00.000Z') },
      {
        before: { updatedAt: new Date('2026-10-01T00:00:00.000Z') },
        after: { updatedAt: new Date('2026-10-02T00:00:00.000Z') },
      },
    ],
    ['內容相同的陣列（不同參照）→ 視為相同', { permissions: ['user:read', 'role:read'] }, null],
    [
      '陣列多了一項 → 記完整的前後清單（§5.2）',
      { permissions: ['user:read', 'role:read', 'user:create'] },
      {
        before: { permissions: ['user:read', 'role:read'] },
        after: { permissions: ['user:read', 'role:read', 'user:create'] },
      },
    ],
    [
      '陣列順序不同 → 視為改變（清單依原樣記錄）',
      { permissions: ['role:read', 'user:read'] },
      {
        before: { permissions: ['user:read', 'role:read'] },
        after: { permissions: ['role:read', 'user:read'] },
      },
    ],
    ['內容相同的物件 → 視為相同', { settings: { theme: 'dark' } }, null],
    [
      '多個欄位同時改變 → 都記，沒變的不記',
      { name: 'Bob', count: 0, enabled: false },
      { before: { name: 'Alice', enabled: true }, after: { name: 'Bob', enabled: false } },
    ],
  ])('%s', (_label, after, expected) => {
    expect(diff(BEFORE, after, ALL_FIELDS)).toEqual(expected);
  });

  it('不在 fields 裡的欄位即使改變也不記', () => {
    expect(diff(BEFORE, { name: 'Bob', count: 9 }, ['count'])).toEqual({
      before: { count: 0 },
      after: { count: 9 },
    });
  });

  it('after 沒有帶的欄位不比較（部分更新）', () => {
    expect(diff(BEFORE, { name: 'Bob' }, ALL_FIELDS)?.after).not.toHaveProperty('description');
  });

  it('after 明確帶 undefined 而原本是 null → 視為改變', () => {
    expect(diff(BEFORE, { description: undefined }, ['description'])).toEqual({
      before: { description: null },
      after: { description: undefined },
    });
  });

  it('敏感欄位清單：passwordHash、tokenHash、tokenVersion', () => {
    expect([...AUDIT_EXCLUDED_FIELDS].toSorted()).toEqual([
      'passwordHash',
      'tokenHash',
      'tokenVersion',
    ]);
  });

  it.each([['passwordHash'], ['tokenHash'], ['tokenVersion']] as const)(
    '%s 即使列在 fields 而且改變了，也絕不進 changes（§5.1）',
    (field) => {
      const after: Partial<Row> = { passwordHash: 'new', tokenHash: 'new', tokenVersion: 2 };
      expect(diff(BEFORE, after, [field])).toBeNull();
    },
  );

  it('敏感欄位與一般欄位一起改變 → 只記一般欄位', () => {
    const changes = diff(
      BEFORE,
      { name: 'Bob', passwordHash: '$argon2id$new', tokenVersion: 2 },
      ALL_FIELDS,
    );
    expect(changes).toEqual({ before: { name: 'Alice' }, after: { name: 'Bob' } });
    expect(JSON.stringify(changes)).not.toMatch(/argon2id|passwordHash|tokenVersion/);
  });
});
