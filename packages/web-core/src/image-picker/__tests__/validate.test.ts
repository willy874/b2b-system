import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImageUsage } from '../types';
import {
  firstImageFile,
  isLargeEnough,
  largestCrop,
  sniffImageType,
  validateImageFile,
} from '../validate';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const AVATAR: ImageUsage = {
  id: 'user.avatar',
  maxSize: 1024,
  contentTypes: ['image/jpeg', 'image/png'],
  minWidth: 128,
  minHeight: 128,
  aspectRatio: 1,
  presets: { sm: 32 },
  sources: null,
};

function file(bytes: number[], type = 'image/png', size = bytes.length): File {
  const body = new Uint8Array(size);
  body.set(bytes);
  return new File([body], 'a.png', { type });
}

describe('sniffImageType（以檔頭判斷，與 api 的規則相同）', () => {
  it.each([
    [[0xff, 0xd8, 0xff], 'image/jpeg'],
    [PNG_HEAD, 'image/png'],
    [[...Buffer.from('<svg xmlns=')], 'image/svg+xml'],
    [[...Buffer.from('hello')], undefined],
  ])('%j → %s', (bytes, expected) => {
    expect(sniffImageType(Uint8Array.from(bytes))).toBe(expected);
  });
});

describe('largestCrop／isLargeEnough（用途的最小尺寸以裁切之後最大的範圍判斷）', () => {
  it('有比例時取中央照比例的那一塊', () => {
    expect(largestCrop({ width: 400, height: 200 }, 1)).toEqual({ width: 200, height: 200 });
    expect(largestCrop({ width: 400, height: 200 }, null)).toEqual({ width: 400, height: 200 });
  });

  it('300 × 100 的圖裁成正方形只有 100：不夠 128', () => {
    expect(isLargeEnough({ width: 300, height: 100 }, AVATAR)).toBe(false);
    expect(isLargeEnough({ width: 300, height: 200 }, AVATAR)).toBe(true);
  });
});

describe('validateImageFile（上傳前的檢查，docs/architecture/frontend/23-image-picker.md §4）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('不信任 File.type：宣告 PNG 但其實是 SVG → type', async () => {
    const result = await validateImageFile(file([...Buffer.from('<svg>')]), AVATAR);
    expect(result.issue).toMatchObject({
      reason: 'type',
      messageKey: 'imagePicker.validation.type',
    });
  });

  it('超過用途的大小上限 → size（帶 MB）', async () => {
    const result = await validateImageFile(file(PNG_HEAD, 'image/png', 2048), {
      ...AVATAR,
      maxSize: 1024 * 1024,
      contentTypes: ['image/png'],
    });
    expect(result.issue).toBeUndefined();
    const tooLarge = await validateImageFile(file(PNG_HEAD, 'image/png', 2048), AVATAR);
    expect(tooLarge.issue).toMatchObject({ reason: 'size', params: { max: 0 } });
  });

  it('解得出尺寸時擋掉太小的；以檔頭判斷的型別一起帶回', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 300, height: 100, close: vi.fn() })),
    );
    const result = await validateImageFile(file(PNG_HEAD, ''), AVATAR);
    expect(result).toMatchObject({
      contentType: 'image/png',
      size: { width: 300, height: 100 },
      issue: { reason: 'small', params: { width: 128, height: 128 } },
    });
  });

  it('瀏覽器解不了（沒有尺寸）→ 放行，交給後端判斷', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('nope'))),
    );
    const result = await validateImageFile(file(PNG_HEAD), AVATAR);
    expect(result).toEqual({ contentType: 'image/png', size: undefined });
  });
});

describe('firstImageFile', () => {
  it('只取第一張圖片，回報總共幾個檔案', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });
    const image = file(PNG_HEAD);
    expect(firstImageFile([text, image, image])).toEqual({ file: image, count: 3 });
    expect(firstImageFile([text])).toEqual({ file: undefined, count: 1 });
  });
});
