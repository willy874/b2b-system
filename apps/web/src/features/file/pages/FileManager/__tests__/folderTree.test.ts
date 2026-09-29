import { describe, expect, it } from 'vitest';

import type { FileFolder } from '@/shared/api-sdk';

import {
  buildFolderIndex,
  canCreateIn,
  canMoveFoldersTo,
  childFolders,
  folderPath,
  isWithin,
} from '../folderTree';

const CAN_ALL = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canShare: true,
};

function folder(
  id: string,
  name: string,
  parentId: string | null = null,
  overrides: Partial<FileFolder> = {},
): FileFolder {
  return {
    id,
    name,
    parentId,
    kind: 'normal',
    inheritGrants: true,
    hasPendingAccessRequest: false,
    capabilities: CAN_ALL,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const index = buildFolderIndex(
  [
    folder('a', 'art'),
    folder('b', 'ui', 'a'),
    folder('c', 'icons', 'b'),
    folder('d', 'img10', 'a'),
    folder('e', 'img2', 'a'),
    folder('z', 'Audio'),
    folder('orphan', 'lost', 'gone'),
  ],
  { canCreate: true },
);

describe('folderTree（docs/architecture/frontend/12-file-manager.md §12）', () => {
  it('子資料夾依名稱自然排序、不分大小寫', () => {
    expect(childFolders(index, undefined).map((f) => f.name)).toEqual(['art', 'Audio']);
    expect(childFolders(index, 'a').map((f) => f.name)).toEqual(['img2', 'img10', 'ui']);
  });

  it('上層不在清單裡的資料夾不掛到根目錄', () => {
    expect(childFolders(index, undefined).some((f) => f.id === 'orphan')).toBe(false);
  });

  it('folderPath 從根目錄排到自己；不存在時為空', () => {
    expect(folderPath(index, 'c').map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(folderPath(index, 'missing')).toEqual([]);
    expect(folderPath(index, undefined)).toEqual([]);
  });

  it('isWithin：自己與子孫都算', () => {
    expect(isWithin(index, 'c', 'a')).toBe(true);
    expect(isWithin(index, 'a', 'a')).toBe(true);
    expect(isWithin(index, 'a', 'c')).toBe(false);
  });

  it.each([
    [['a'], 'c', false],
    [['a'], 'a', false],
    [['b'], 'd', true],
    [['a', 'z'], undefined, true],
    [['c'], 'a', true],
  ] as const)('canMoveFoldersTo(%j → %s) = %s', (ids, target, expected) => {
    expect(canMoveFoldersTo(index, ids, target)).toBe(expected);
  });
});

describe('folderTree 的資料夾層級授權（§13）', () => {
  const LOCKED = {
    ...CAN_ALL,
    canRead: false,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  };
  const scoped = buildFolderIndex(
    [
      // 鎖住的上層仍然列出，樹照常組起來
      folder('hidden', 'hidden', null, { capabilities: LOCKED }),
      folder('art', 'art', 'hidden'),
      folder('ui', 'ui', 'art'),
      folder('view', 'view', null, { capabilities: { ...CAN_ALL, canCreate: false } }),
      folder('orphan', 'lost', 'gone'),
    ],
    { canCreate: false },
  );

  it('鎖住的資料夾照常在樹裡；上層剛被刪除的孤兒仍不顯示', () => {
    expect(childFolders(scoped, undefined).map((f) => f.id)).toEqual(['hidden', 'view']);
    expect(folderPath(scoped, 'ui').map((f) => f.id)).toEqual(['hidden', 'art', 'ui']);
  });

  it('canCreateIn 看目的地的 canCreate；根目錄看 rootCapabilities', () => {
    expect(canCreateIn(scoped, 'art')).toBe(true);
    expect(canCreateIn(scoped, 'hidden')).toBe(false);
    expect(canCreateIn(scoped, 'view')).toBe(false);
    expect(canCreateIn(scoped, undefined)).toBe(false);
    expect(canCreateIn(scoped, 'missing')).toBe(false);
  });

  it('移動的目的地不能放東西時不合法（檔案也一樣）', () => {
    expect(canMoveFoldersTo(scoped, [], 'view')).toBe(false);
    expect(canMoveFoldersTo(scoped, [], undefined)).toBe(false);
    expect(canMoveFoldersTo(scoped, [], 'ui')).toBe(true);
  });
});
