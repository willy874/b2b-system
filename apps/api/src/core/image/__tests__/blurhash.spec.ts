import { describe, expect, it } from 'vitest';

import { encodeBlurHash, toHexColor } from '../blurhash';

function solid(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([...rgb, 255], index * 4);
  }
  return { data, width, height };
}

describe('encodeBlurHash', () => {
  it('4 × 3 分量的字串長度是 28，第一個字元編碼分量數', () => {
    const hash = encodeBlurHash(solid(8, 6, [255, 0, 0]));
    expect(hash).toHaveLength(28);
    expect(hash[0]).toBe('L');
  });

  it('純色的圖：DC 是那個顏色，AC 都是中間值', () => {
    // 1 × 1 分量：分量數、最大值、4 位的 DC（參考實作對純黑的輸出）
    expect(encodeBlurHash(solid(4, 4, [0, 0, 0]), 1, 1)).toBe('000000');
  });

  it('分量超出範圍、像素不足時拋 RangeError', () => {
    expect(() => encodeBlurHash(solid(2, 2, [0, 0, 0]), 10, 1)).toThrow(RangeError);
    expect(() => encodeBlurHash({ data: new Uint8Array(4), width: 2, height: 2 })).toThrow(
      RangeError,
    );
  });
});

describe('toHexColor', () => {
  it.each([
    [{ r: 0, g: 0, b: 0 }, '#000000'],
    [{ r: 255, g: 128.4, b: 15 }, '#ff800f'],
    [{ r: 300, g: -5, b: 1 }, '#ff0001'],
  ])('%o → %s', (color, hex) => {
    expect(toHexColor(color)).toBe(hex);
  });
});
