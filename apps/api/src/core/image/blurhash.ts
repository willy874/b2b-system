/**
 * BlurHash 編碼（https://github.com/woltapp/blurhash 的演算法；docs/architecture/backend/26-gallery.md §5）：
 * 約 30 字元的字串，前端解碼成模糊的預覽圖。輸入是縮小過的 RGBA 像素（例：32 × 32），不必是原尺寸。
 */

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function encode83(value: number, length: number): string {
  let result = '';
  for (let digit = 1; digit <= length; digit += 1) {
    const index = Math.floor(value / 83 ** (length - digit)) % 83;
    result += BASE83[index] ?? '0';
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

export interface RawPixels {
  /** RGBA，每個像素 4 個位元組。 */
  data: Uint8Array;
  width: number;
  height: number;
}

/** 以 `componentsX × componentsY`（1～9）個餘弦分量編碼；預設 4 × 3 適合大多數照片的比例。 */
export function encodeBlurHash(pixels: RawPixels, componentsX = 4, componentsY = 3): string {
  const { data, width, height } = pixels;
  if (componentsX < 1 || componentsX > 9 || componentsY < 1 || componentsY > 9) {
    throw new RangeError('BlurHash 的分量必須是 1～9');
  }
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    throw new RangeError('像素資料與尺寸不符');
  }

  const factors: Array<[number, number, number]> = [];
  for (let y = 0; y < componentsY; y += 1) {
    for (let x = 0; x < componentsX; x += 1) {
      const normalisation = x === 0 && y === 0 ? 1 : 2;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
          const basis =
            normalisation *
            Math.cos((Math.PI * x * px) / width) *
            Math.cos((Math.PI * y * py) / height);
          const index = 4 * (px + py * width);
          r += basis * srgbToLinear(data[index] ?? 0);
          g += basis * srgbToLinear(data[index + 1] ?? 0);
          b += basis * srgbToLinear(data[index + 2] ?? 0);
        }
      }
      const scale = 1 / (width * height);
      factors.push([r * scale, g * scale, b * scale]);
    }
  }

  const [dc = [0, 0, 0], ...ac] = factors;
  let hash = encode83(componentsX - 1 + (componentsY - 1) * 9, 1);

  let maximumValue = 1;
  if (ac.length > 0) {
    const actualMaximum = Math.max(...ac.flatMap((factor) => factor.map(Math.abs)));
    const quantised = Math.max(0, Math.min(82, Math.floor(actualMaximum * 166 - 0.5)));
    maximumValue = (quantised + 1) / 166;
    hash += encode83(quantised, 1);
  } else {
    hash += encode83(0, 1);
  }

  const dcValue = (linearToSrgb(dc[0]) << 16) + (linearToSrgb(dc[1]) << 8) + linearToSrgb(dc[2]);
  hash += encode83(dcValue, 4);

  for (const [r, g, b] of ac) {
    const quant = (value: number) =>
      Math.max(0, Math.min(18, Math.floor(signPow(value / maximumValue, 0.5) * 9 + 9.5)));
    hash += encode83(quant(r) * 19 * 19 + quant(g) * 19 + quant(b), 2);
  }
  return hash;
}

function hexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

/** `{ r, g, b }`（0～255）→ `#rrggbb`。 */
export function toHexColor(color: { r: number; g: number; b: number }): string {
  return `#${hexChannel(color.r)}${hexChannel(color.g)}${hexChannel(color.b)}`;
}
