import { describe, expect, it } from 'vitest';

import type { FileFolder } from '@/shared/api-sdk';

import {
  buildFolderIndex,
  canMoveFoldersTo,
  childFolders,
  folderPath,
  isWithin,
} from '../folderTree';

function folder(id: string, name: string, parentId: string | null = null): FileFolder {
  return { id, name, parentId, createdAt: '', updatedAt: '' };
}

const index = buildFolderIndex([
  folder('a', 'art'),
  folder('b', 'ui', 'a'),
  folder('c', 'icons', 'b'),
  folder('d', 'img10', 'a'),
  folder('e', 'img2', 'a'),
  folder('z', 'Audio'),
  folder('orphan', 'lost', 'gone'),
]);

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
