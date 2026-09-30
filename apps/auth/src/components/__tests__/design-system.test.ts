import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const componentsDir = resolve(__dirname, '..');

function walk(dir: string, predicate: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, predicate);
    return predicate(full) ? [full] : [];
  });
}

const componentDirs = readdirSync(componentsDir).filter(
  (entry) => statSync(resolve(componentsDir, entry)).isDirectory() && entry !== '__tests__',
);
const cssFiles = walk(componentsDir, (file) => file.endsWith('.css'));
const tsxFiles = walk(
  componentsDir,
  (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
);

/**
 * docs/architecture/frontend/07-ui-system.md §8 的驗收條件，用測試守住。
 * 複製自 apps/backstage；「每個元件都有 story」這條不適用：Storybook 只在 backstage（docs/adr/0019-sso-identity-platform.md D14）。
 */
describe('設計系統的結構規則', () => {
  it('每個元件資料夾都有 index.ts 與測試', () => {
    const missing = componentDirs.filter((dir) => {
      const files = readdirSync(resolve(componentsDir, dir));
      return !files.includes('index.ts') || !files.some((file) => file.endsWith('.test.tsx'));
    });
    expect(missing, `缺少 index.ts 或測試：${missing.join(', ')}`).toEqual([]);
  });

  it('CSS 不出現十六進位色碼、rgb()、hsl()（顏色與陰影一律走 Design Token）', () => {
    const offenders = cssFiles
      .map((file) => ({
        file,
        matches: /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/gi.exec(readFileSync(file, 'utf8')),
      }))
      .filter((entry) => entry.matches)
      .map(
        (entry) =>
          `${entry.file.split('/components/')[1] as string}: ${entry.matches?.[0] as string}`,
      );
    expect(offenders, `發現寫死的色碼：${offenders.join(', ')}`).toEqual([]);
  });

  it('CSS 的顏色與陰影只引用 alias 層，不直接用 seed 色（換主題只換 alias，docs/architecture/frontend/07-ui-system.md §4.1）', () => {
    const offenders = cssFiles.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/var\(--seed-(?!space-|radius-|font-)[\w-]+\)/g)].map(
        (match) => `${file.split('/components/')[1] as string}: ${match[0]}`,
      ),
    );
    expect(offenders, `發現直接引用 seed 色：${offenders.join(', ')}`).toEqual([]);
  });

  it('樣式一律是 CSS Module，整份包在 @layer components（07-ui-system.md §3.4）', () => {
    const offenders = cssFiles
      .filter((file) => {
        if (!file.endsWith('.module.css')) return true;
        const source = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .trim();
        return !source.startsWith('@layer components {') || !source.endsWith('}');
      })
      .map((file) => file.split('/components/')[1] as string);
    expect(offenders, `不是包在 @layer components 的 CSS Module：${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('元件不再使用全域 ge- class（改用 CSS Module 的 styles.xxx）', () => {
    const offenders = tsxFiles
      .filter((file) => /['"`]ge-[a-z]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.split('/components/')[1] as string);
    expect(offenders, `仍使用全域 class：${offenders.join(', ')}`).toEqual([]);
  });

  it('不匯出 Base UI 的型別（換底層時 props 不變）', () => {
    const offenders = tsxFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /export\s+(type\s+)?\{[^}]*\}\s+from\s+'@base-ui-components/.test(source);
      })
      .map((file) => file.split('/components/')[1] as string);
    expect(offenders, `洩漏 Base UI 型別：${offenders.join(', ')}`).toEqual([]);
  });

  it('元件的 props 介面都支援 className 與 data-testid 透傳', () => {
    const offenders = tsxFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (!/export interface \w+Props/.test(source)) return false;
        // 繼承原生屬性或其他元件的 Props 就已經帶到 className / data-testid
        const extendsNative = /extends\s+(Omit<)?[\w<>, ']*(HTMLAttributes|Props)/.test(source);
        return (
          !extendsNative && !(source.includes('className?') && source.includes("'data-testid'?"))
        );
      })
      .map((file) => file.split('/components/')[1] as string);
    expect(offenders, `未支援透傳：${offenders.join(', ')}`).toEqual([]);
  });

  it('features/ 不直接 import Base UI（只能透過 components/）', () => {
    const featuresDir = resolve(componentsDir, '../features');
    const offenders = walk(featuresDir, (file) => file.endsWith('.tsx') || file.endsWith('.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('@base-ui-components/react'))
      .map((file) => file.split('/features/')[1] as string);
    expect(offenders, `feature 直接用了 Base UI：${offenders.join(', ')}`).toEqual([]);
  });
});
