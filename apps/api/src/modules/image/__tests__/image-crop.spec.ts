import { describe, expect, it } from 'vitest';

import { centerCrop, croppedSize, isValidCrop, toPixelRegion } from '../image-crop';

describe('裁切的換算（docs/architecture/backend/25-image.md §15.5）', () => {
  it.each([
    [{ x: 0, y: 0, width: 1, height: 1 }, true],
    [{ x: 0.2, y: 0.1, width: 0.5, height: 0.5 }, true],
    // 浮點數的誤差
    [{ x: 0.5, y: 0, width: 0.5000000002, height: 1 }, true],
    [{ x: 0.6, y: 0, width: 0.5, height: 1 }, false],
    [{ x: 0, y: 0, width: 0, height: 1 }, false],
    [{ x: -0.1, y: 0, width: 0.5, height: 1 }, false],
    [{ x: Number.NaN, y: 0, width: 0.5, height: 1 }, false],
  ])('isValidCrop(%j) → %s', (crop, expected) => {
    expect(isValidCrop(crop)).toBe(expected);
  });

  it('沒有裁切也沒有比例 → 整張（undefined）', () => {
    expect(toPixelRegion(null, { width: 400, height: 300 })).toBeUndefined();
  });

  it('沒有裁切但有比例 → 取中央最大的範圍', () => {
    expect(toPixelRegion(null, { width: 400, height: 300 }, 1)).toEqual({
      left: 50,
      top: 0,
      width: 300,
      height: 300,
    });
    expect(toPixelRegion(null, { width: 300, height: 500 }, 1)).toEqual({
      left: 0,
      top: 100,
      width: 300,
      height: 300,
    });
  });

  it('比例換算成主檔的像素；用途有比例時修正成剛好那個比例（以寬為準）', () => {
    const region = toPixelRegion(
      { x: 0.1, y: 0.1, width: 0.5, height: 0.6667 },
      { width: 1000, height: 750 },
      1,
    );
    expect(region).toEqual({ left: 100, top: 75, width: 500, height: 500 });
  });

  it('以寬為準放不下時改以高為準，範圍不超出圖片', () => {
    const region = toPixelRegion(
      { x: 0, y: 0.5, width: 1, height: 0.5 },
      { width: 1000, height: 500 },
      1,
    );
    expect(region).toEqual({ left: 0, top: 250, width: 250, height: 250 });
  });

  it('centerCrop 回比例；croppedSize 回裁切之後的尺寸', () => {
    expect(centerCrop({ width: 200, height: 100 }, 1)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(croppedSize(null, { width: 200, height: 100 }, 1)).toEqual({ width: 100, height: 100 });
    expect(croppedSize(null, { width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
  });
});
