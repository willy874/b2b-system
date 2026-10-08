import { describe, expect, it } from 'vitest';

import type { FileFolder, StoredFile } from '@/shared/api-sdk';

import {
  earliestUrlExpiry,
  isFileItem,
  isFolderItem,
  mergePages,
  toFileItemVM,
  toFolderItemVM,
} from '../adapter';

const file = (overrides: Partial<StoredFile> = {}): StoredFile => ({
  id: 'f1',
  name: 'hero.png',
  contentType: 'image/png',
  size: 1024,
  status: 'ready',
  folderId: null,
  url: 'http://s/f1?inline',
  downloadUrl: 'http://s/f1?attachment',
  thumbnailUrl: null,
  image: null,
  urlExpiresAt: '2026-09-27T00:15:00.000Z',
  version: 1,
  uploader: { id: 'u1', displayName: 'Alice' },
  capabilities: { canUpdate: true, canDelete: false },
  tags: [],
  uploadedAt: '2026-09-27T00:00:00.000Z',
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  ...overrides,
});

describe('toFileItemVM', () => {
  it('縮圖優先；沒有縮圖的小圖直接用原檔', () => {
    expect(toFileItemVM(file({ thumbnailUrl: 'http://s/t1' })).previewUrl).toBe('http://s/t1');
    expect(toFileItemVM(file()).previewUrl).toBe('http://s/f1?inline');
  });

  it('LightBox 顯示伺服器產生的全螢幕預覽；還沒產生時為 null（改用原檔）', () => {
    const image = {
      width: 800,
      height: 600,
      originalUrl: '/api/files/f1/image/original?sig',
      previewUrl: '/api/files/f1/image/preview?sig',
      thumbnailUrl: '/api/files/f1/image/thumbnail?sig',
      expiresAt: '2026-09-27T00:10:00.000Z',
    };
    expect(toFileItemVM(file({ image })).displayUrl).toBe(image.previewUrl);
    expect(toFileItemVM(file()).displayUrl).toBeNull();
  });

  it('沒有縮圖的大圖、非圖片 → 沒有預覽圖（顯示類型圖示）', () => {
    expect(toFileItemVM(file({ size: 50 * 1024 * 1024 })).previewUrl).toBeNull();
    const text = toFileItemVM(file({ name: 'a.json', contentType: 'application/json' }));
    expect(text).toMatchObject({ previewUrl: null, kind: 'code', icon: 'file-code' });
  });

  it('大小與上傳者', () => {
    expect(toFileItemVM(file())).toMatchObject({ sizeLabel: '1.0 KB', uploaderName: 'Alice' });
    expect(toFileItemVM(file({ uploader: null })).uploaderName).toBeNull();
  });

  it('還沒有網址（未就緒）的小圖 → 沒有預覽圖', () => {
    expect(toFileItemVM(file({ url: null })).previewUrl).toBeNull();
  });

  it('能力旗標來自後端的 capabilities', () => {
    expect(toFileItemVM(file())).toMatchObject({ type: 'file', canUpdate: true, canDelete: false });
  });
});

describe('toFolderItemVM', () => {
  const folder: FileFolder = {
    id: 'd1',
    name: '合約',
    parentId: 'root',
    kind: 'normal',
    inheritGrants: true,
    hasPendingAccessRequest: true,
    capabilities: {
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canShare: false,
    },
    tags: [],
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };

  it('攤平 capabilities、帶上子資料夾數與待審申請（鎖住的資料夾）', () => {
    expect(toFolderItemVM(folder, 3)).toEqual({
      type: 'folder',
      id: 'd1',
      name: '合約',
      parentId: 'root',
      kind: 'normal',
      folderCount: 3,
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canShare: false,
      hasPendingAccessRequest: true,
      tags: [],
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
  });

  it('isFileItem／isFolderItem 依種類區分格子', () => {
    const folderItem = toFolderItemVM(folder, 0);
    const fileItem = toFileItemVM(file());
    expect([isFolderItem(folderItem), isFileItem(folderItem)]).toEqual([true, false]);
    expect([isFolderItem(fileItem), isFileItem(fileItem)]).toEqual([false, true]);
  });
});

describe('mergePages（無限捲動的多頁合併）', () => {
  it('以 id 去重並保留先出現的', () => {
    const merged = mergePages([
      { items: [file({ id: 'a' }), file({ id: 'b' })] },
      { items: [file({ id: 'b', name: 'dup' }), file({ id: 'c' })] },
    ]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1]?.name).toBe('hero.png');
  });
});

describe('earliestUrlExpiry', () => {
  it('取最早失效的時間；沒有網址回 undefined', () => {
    expect(
      earliestUrlExpiry([
        file({ urlExpiresAt: '2026-09-27T00:20:00.000Z' }),
        file({ urlExpiresAt: '2026-09-27T00:10:00.000Z' }),
      ]),
    ).toBe(Date.parse('2026-09-27T00:10:00.000Z'));
    expect(earliestUrlExpiry([file({ urlExpiresAt: null })])).toBeUndefined();
  });

  it('略過無法解析的時間', () => {
    expect(
      earliestUrlExpiry([
        file({ urlExpiresAt: 'not-a-date' }),
        file({ urlExpiresAt: '2026-09-27T00:30:00.000Z' }),
      ]),
    ).toBe(Date.parse('2026-09-27T00:30:00.000Z'));
  });
});
