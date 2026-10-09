/**
 * BlurHash 解碼（後端以同一個演算法編碼，docs/architecture/backend/26-gallery.md §5）：約 30 字元 → 小張的 RGBA 像素，
 * 以 canvas 放大成模糊的預覽。只在格子進到可視範圍時才解碼（虛擬捲動只渲染看得到的格子）。
 */

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function decode83(value: string): number {
  let result = 0;
  for (const char of value) {
    const digit = BASE83.indexOf(char);
    if (digit < 0) throw new RangeError('不是 BlurHash');
    result = result * 83 + digit;
  }
  return result;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308
    ? Math.trunc(v * 12.92 * 255 + 0.5)
    : Math.trunc((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5);
}

function signPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

/** 解碼成 `width × height` 的 RGBA；字串不合法時回 undefined（只是佔位，失敗就只顯示主色）。 */
export function decodeBlurHash(
  hash: string,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> | undefined {
  try {
    if (hash.length < 6) return undefined;
    const sizeFlag = decode83(hash.slice(0, 1));
    const componentsY = Math.floor(sizeFlag / 9) + 1;
    const componentsX = (sizeFlag % 9) + 1;
    if (hash.length !== 4 + 2 * componentsX * componentsY) return undefined;
    const maximumValue = (decode83(hash.slice(1, 2)) + 1) / 166;
    const colors: Array<[number, number, number]> = [];
    for (let index = 0; index < componentsX * componentsY; index += 1) {
      if (index === 0) {
        const value = decode83(hash.slice(2, 6));
        colors.push([
          srgbToLinear(value >> 16),
          srgbToLinear((value >> 8) & 255),
          srgbToLinear(value & 255),
        ]);
      } else {
        const value = decode83(hash.slice(4 + index * 2, 6 + index * 2));
        const quantR = Math.floor(value / (19 * 19));
        const quantG = Math.floor(value / 19) % 19;
        const quantB = value % 19;
        colors.push([
          signPow((quantR - 9) / 9, 2) * maximumValue,
          signPow((quantG - 9) / 9, 2) * maximumValue,
          signPow((quantB - 9) / 9, 2) * maximumValue,
        ]);
      }
    }
    const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let j = 0; j < componentsY; j += 1) {
          for (let i = 0; i < componentsX; i += 1) {
            const basis =
              Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
            const color = colors[i + j * componentsX];
            if (!color) continue;
            r += color[0] * basis;
            g += color[1] * basis;
            b += color[2] * basis;
          }
        }
        const offset = 4 * (x + y * width);
        pixels[offset] = linearToSrgb(r);
        pixels[offset + 1] = linearToSrgb(g);
        pixels[offset + 2] = linearToSrgb(b);
        pixels[offset + 3] = 255;
      }
    }
    return pixels;
  } catch {
    // 不是 BlurHash：只顯示主色
    return undefined;
  }
}
