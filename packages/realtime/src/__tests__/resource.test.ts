import { describe, expect, it } from 'vitest';

import {
  ChangeKind,
  ChangeSource,
  coarsenChanges,
  exceedsChangeLimit,
  limitChanges,
  MAX_CHANGES_PER_EVENT,
  ResourceChangedSchema,
} from '../resource.js';
import type { ResourceChangeWire } from '../resource.js';

const ids = (count: number) => Array.from({ length: count }, (_, index) => `id-${index}`);

describe('推播變更的上限（docs/architecture/backend/08-realtime.md §9）', () => {
  it('coarsenChanges：同一個來源與種類只留一筆，拿掉 id 與 refs，依第一次出現的順序', () => {
    const changes: ResourceChangeWire[] = [
      { resource: ChangeSource.ROLE, kind: ChangeKind.CREATE, id: 'r1' },
      {
        resource: ChangeSource.USER_ROLE,
        kind: ChangeKind.UPDATE,
        id: 'u1',
        refs: { role: ['r1'] },
      },
      {
        resource: ChangeSource.USER_ROLE,
        kind: ChangeKind.UPDATE,
        id: 'u2',
        refs: { role: ['r1'] },
      },
    ];
    expect(coarsenChanges(changes)).toEqual([
      { resource: ChangeSource.ROLE, kind: ChangeKind.CREATE },
      { resource: ChangeSource.USER_ROLE, kind: ChangeKind.UPDATE },
    ]);
  });

  it('沒超過上限時原樣回傳', () => {
    const changes = ids(MAX_CHANGES_PER_EVENT).map((id) => ({
      resource: ChangeSource.FILE,
      kind: ChangeKind.UPDATE,
      id,
    }));
    expect(exceedsChangeLimit(changes)).toBe(false);
    expect(limitChanges(changes)).toEqual(changes);
  });

  it('超過 100 筆：退化成不帶 id 的版本，通過合約的驗證', () => {
    const changes = ids(150).map((id) => ({
      resource: ChangeSource.FILE,
      kind: ChangeKind.UPDATE,
      id,
    }));
    expect(ResourceChangedSchema.safeParse({ changes }).success).toBe(false);
    const limited = limitChanges(changes);
    expect(limited).toEqual([{ resource: ChangeSource.FILE, kind: ChangeKind.UPDATE }]);
    expect(ResourceChangedSchema.safeParse({ changes: limited }).success).toBe(true);
  });

  it('任一個 refs 陣列超過 100：同樣退化', () => {
    const changes: ResourceChangeWire[] = [
      { resource: ChangeSource.USER, kind: ChangeKind.DELETE, id: 'u1', refs: { role: ids(101) } },
    ];
    expect(exceedsChangeLimit(changes)).toBe(true);
    expect(limitChanges(changes)).toEqual([
      { resource: ChangeSource.USER, kind: ChangeKind.DELETE },
    ]);
  });
});
