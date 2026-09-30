import { beforeEach, describe, expect, it } from 'vitest';

import {
  createThumbnail,
  registerFilePreviewer,
  registerFileValidator,
  registerThumbnailGenerator,
  resetFileRegistry,
  resolveFilePreviewer,
  validateFile,
} from '../registry';

const source = (contentType: string) => ({
  id: 'f',
  name: 'a',
  contentType,
  size: 1,
  url: 'http://x',
});
const Noop = () => null;

beforeEach(() => resetFileRegistry());

describe('檔案擴充點的註冊表', () => {
  it('預覽：能處理且優先順序最高的解析器勝出；都不能處理回 undefined', () => {
    registerFilePreviewer({
      id: 'image',
      canPreview: (f) => f.contentType.startsWith('image/'),
      component: Noop,
    });
    registerFilePreviewer({
      id: 'svg',
      priority: 10,
      canPreview: (f) => f.contentType === 'image/svg+xml',
      component: Noop,
    });
    expect(resolveFilePreviewer(source('image/svg+xml'))?.id).toBe('svg');
    expect(resolveFilePreviewer(source('image/png'))?.id).toBe('image');
    expect(resolveFilePreviewer(source('video/mp4'))).toBeUndefined();
  });

  it('同一個 id 重複註冊會拋錯', () => {
    registerFilePreviewer({ id: 'x', canPreview: () => true, component: Noop });
    expect(() =>
      registerFilePreviewer({ id: 'x', canPreview: () => true, component: Noop }),
    ).toThrow();
  });

  it('驗證：收集所有問題；驗證器自己拋錯視為通過', async () => {
    registerFileValidator({
      id: 'size',
      validate: (file, { maxSize }) =>
        maxSize !== undefined && file.size > maxSize
          ? { validatorId: 'size', messageKey: 'file.validation.tooLarge' }
          : undefined,
    });
    registerFileValidator({
      id: 'broken',
      validate: () => {
        throw new Error('boom');
      },
    });
    const file = new File(['12345'], 'a.bin');
    await expect(validateFile(file, { maxSize: 3 })).resolves.toEqual([
      { validatorId: 'size', messageKey: 'file.validation.tooLarge' },
    ]);
    await expect(validateFile(file, {})).resolves.toEqual([]);
  });

  it('縮圖：失敗或太大就換下一個產生器；都不行回 undefined', async () => {
    registerThumbnailGenerator({
      id: 'big',
      priority: 10,
      canGenerate: () => true,
      generate: async () => new Blob(['way too large']),
    });
    const small = new Blob(['ok']);
    registerThumbnailGenerator({
      id: 'small',
      canGenerate: () => true,
      generate: async () => small,
    });
    const blob = await createThumbnail(new File(['x'], 'a.png'), { maxDimension: 64, maxBytes: 4 });
    expect(blob).toBe(small);
  });
});
