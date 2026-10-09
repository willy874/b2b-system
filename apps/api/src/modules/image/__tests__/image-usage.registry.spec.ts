import { describe, expect, it } from 'vitest';

import { ImageUsageRegistry, RASTER_IMAGE_TYPES } from '../image-usage.registry';
import type { ImageUsageDefinition } from '../image-usage.registry';

const AVATAR: ImageUsageDefinition = {
  id: 'user.avatar',
  maxSize: 1024,
  contentTypes: RASTER_IMAGE_TYPES,
  minWidth: 128,
  minHeight: 128,
  aspectRatio: 1,
  presets: { sm: 32, md: 96 },
  urlTtl: 3600,
  visibility: 'signed',
};

describe('ImageUsageRegistry（用途的登記，docs/architecture/backend/25-image.md §15.3）', () => {
  it('登記之後找得到；沒有登記的 find 回 undefined、get 拋錯', () => {
    const registry = new ImageUsageRegistry();
    registry.register(AVATAR);
    expect(registry.find('user.avatar')).toBe(AVATAR);
    expect(registry.find('nope.nope')).toBeUndefined();
    expect(() => registry.get('nope.nope')).toThrow('沒有登記');
    expect(registry.list()).toEqual([AVATAR]);
  });

  it.each([
    ['名稱不是 <模組>.<名稱>', { id: 'avatar' }, '必須是'],
    ['效期超出範圍', { urlTtl: 10 }, 'urlTtl'],
    ['沒有尺寸', { presets: {} }, '沒有任何尺寸'],
    ['尺寸不合法', { presets: { Big: 10 } }, '不合法'],
    ['收 SVG', { contentTypes: ['image/svg+xml'] }, 'SVG'],
  ])('%s → 啟動失敗', (_name, override, message) => {
    const registry = new ImageUsageRegistry();
    expect(() => registry.register({ ...AVATAR, ...override })).toThrow(message);
  });

  it('同一個用途登記兩次 → 啟動失敗', () => {
    const registry = new ImageUsageRegistry();
    registry.register(AVATAR);
    expect(() => registry.register(AVATAR)).toThrow('重複登記');
  });

  it('allowsSource：沒有限制時全部允許，有限制時只允許列出的', () => {
    const registry = new ImageUsageRegistry();
    expect(registry.allowsSource(AVATAR, 'file')).toBe(true);
    expect(registry.allowsSource({ ...AVATAR, sources: ['upload'] }, 'file')).toBe(false);
  });
});
