import { describe, expect, it } from 'vitest';

import { isChunkLoadError } from '../chunkLoad';

describe('isChunkLoadError（部署新版後舊 chunk 不見）', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://example.com/assets/Page-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/Page-abc.css',
  ])('「%s」是 chunk 載入失敗', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('name 是 ChunkLoadError 也算', () => {
    const error = new Error('whatever');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('其他錯誤、不是 Error 的值都不算', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});
