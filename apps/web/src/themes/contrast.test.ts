import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** 解析 tokens.css 的 `--name: value;`（只取十六進位字面值）。 */
function readTokens(): Map<string, string> {
  const css = readFileSync(resolve(__dirname, './tokens.css'), 'utf8');
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens.set(`--${match[1] as string}`, (match[2] as string).trim());
  }
  return tokens;
}

function resolveToken(tokens: Map<string, string>, name: string, depth = 0): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`token 不存在：${name}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference && depth < 5) return resolveToken(tokens, reference[1] as string, depth + 1);
  return value;
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.039_28 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  ) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const tokens = readTokens();
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

describe('Design Token 對比度（WCAG AA）', () => {
  for (const surface of SURFACES) {
    for (const text of TEXT_TOKENS) {
      it(`${text} 在 ${surface} 上 >= 4.5:1`, () => {
        const ratio = contrast(resolveToken(tokens, text), resolveToken(tokens, surface));
        expect(ratio, `${text} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('主色按鈕的前景／背景 >= 4.5:1', () => {
    const ratio = contrast(
      resolveToken(tokens, '--color-brand-fg'),
      resolveToken(tokens, '--color-brand'),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('狀態色作為填色時，其 -on 前景 >= 3:1', () => {
    for (const tone of ['danger', 'success', 'warning']) {
      const ratio = contrast(
        resolveToken(tokens, `--color-${tone}-on`),
        resolveToken(tokens, `--color-${tone}`),
      );
      expect(ratio, `${tone} fill`).toBeGreaterThanOrEqual(3);
    }
  });
});
