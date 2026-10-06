import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Tokens = Map<string, string>;

/**
 * 解析 tokens.css：`:root` 區塊是淺色主題，`:root[data-theme='dark']` 以覆寫的方式疊在淺色之上
 * （與瀏覽器的層疊結果相同）。
 */
function readThemes(): Record<'light' | 'dark', Tokens> {
  const css = readFileSync(resolve(__dirname, './tokens.css'), 'utf8').replaceAll(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const light: Tokens = new Map();
  const darkOverrides: Tokens = new Map();
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (block[1] as string).trim();
    const target =
      selector === ':root' ? light : selector === ":root[data-theme='dark']" ? darkOverrides : null;
    if (!target) continue;
    for (const match of (block[2] as string).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      // 格式化工具會把長的值（例：color-mix）拆成多行：空白一律收成一個
      target.set(`--${match[1] as string}`, (match[2] as string).trim().replaceAll(/\s+/g, ' '));
    }
  }
  return { light, dark: new Map([...light, ...darkOverrides]) };
}

function resolveToken(tokens: Tokens, name: string, depth = 0): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`token 不存在：${name}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference && depth < 5) return resolveToken(tokens, reference[1] as string, depth + 1);
  return value;
}

/** `color-mix(in srgb, var(--a) 90%, var(--b))`：在 gamma 編碼的 sRGB 上線性內插（與瀏覽器相同）。 */
const COLOR_MIX =
  /^color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\((--[\w-]+)\)\s*\)$/;

function toRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** 解析到十六進位色碼；支援 `var()` 參照與 `color-mix(in srgb, …)`（hover 色）。 */
function resolveColor(tokens: Tokens, name: string): string {
  const value = resolveToken(tokens, name);
  const mix = COLOR_MIX.exec(value);
  if (!mix) return value;
  const weight = Number(mix[2]) / 100;
  const first = toRgb(resolveColor(tokens, mix[1] as string));
  const second = toRgb(resolveColor(tokens, mix[3] as string));
  return `#${first
    .map((channelValue, index) =>
      Math.round(channelValue * weight + (second[index] as number) * (1 - weight))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.039_28 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const themes = readThemes();
const SURFACES = ['--color-bg', '--color-surface'];
/** 內文與圖示的前景色：WCAG AA 要求 4.5:1（大字與圖示 3:1）。 */
const TEXT_TOKENS = [
  '--color-fg',
  '--color-fg-muted',
  '--color-brand',
  '--color-danger-text',
  '--color-success-text',
  '--color-warning-text',
];

describe.each(Object.entries(themes))('Design Token 對比度（WCAG AA）：%s', (_theme, tokens) => {
  for (const surface of SURFACES) {
    for (const text of TEXT_TOKENS) {
      it(`${text} 在 ${surface} 上 >= 4.5:1`, () => {
        const ratio = contrast(resolveToken(tokens, text), resolveToken(tokens, surface));
        expect(ratio, `${text} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // WCAG 1.4.11：辨識控制項所需的邊界 >= 3:1
  for (const surface of [...SURFACES, '--color-fill-subtle']) {
    it(`控制項邊框 --color-border-control 在 ${surface} 上 >= 3:1`, () => {
      const ratio = contrast(
        resolveToken(tokens, '--color-border-control'),
        resolveToken(tokens, surface),
      );
      expect(ratio, `border-control on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        3,
      );
    });
  }

  // 停用欄位、中性 Chip 等以填色為底的次要文字
  for (const fill of ['--color-fill-subtle', '--color-fill']) {
    it(`--color-fg-muted 在 ${fill} 上 >= 4.5:1`, () => {
      const ratio = contrast(resolveToken(tokens, '--color-fg-muted'), resolveToken(tokens, fill));
      expect(ratio, `fg-muted on ${fill} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('主色按鈕的前景／背景 >= 4.5:1', () => {
    const ratio = contrast(
      resolveToken(tokens, '--color-brand-fg'),
      resolveToken(tokens, '--color-brand'),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('Tooltip 的前景／背景 >= 4.5:1', () => {
    const ratio = contrast(
      resolveToken(tokens, '--color-tooltip-fg'),
      resolveToken(tokens, '--color-tooltip-bg'),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // 按鈕文字是一般文字（14px／13px、字重 500），WCAG AA 要求 4.5:1，不是大字的 3:1
  for (const tone of ['danger', 'success', 'warning']) {
    it(`${tone} 按鈕的 -on 前景在 --color-${tone}-fill 上 >= 4.5:1`, () => {
      const ratio = contrast(
        resolveToken(tokens, `--color-${tone}-on`),
        resolveColor(tokens, `--color-${tone}-fill`),
      );
      expect(ratio, `${tone} fill = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${tone} 按鈕 hover 時（--button-${tone}-hover-bg）-on 前景仍 >= 4.5:1`, () => {
      const ratio = contrast(
        resolveToken(tokens, `--color-${tone}-on`),
        resolveColor(tokens, `--button-${tone}-hover-bg`),
      );
      expect(ratio, `${tone} hover = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('深色主題的對照表', () => {
  it('確實解析到深色區塊（否則上面的深色案例只是在重測淺色）', () => {
    expect(resolveToken(themes.dark, '--color-bg')).not.toBe(
      resolveToken(themes.light, '--color-bg'),
    );
  });

  it('只覆寫淺色主題已有的 alias token（不在深色區塊發明新 token）', () => {
    const extra = [...themes.dark.keys()].filter((name) => !themes.light.has(name));
    expect(extra).toEqual([]);
  });
});
