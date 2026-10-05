import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

/** docs/architecture/frontend/07-ui-system.md §8：Base UI 只在設計系統（`@b2b-system/ui`）裡出現。 */
describe('設計系統的使用規則', () => {
  it('features/ 不直接 import Base UI（只能透過 @b2b-system/ui）', () => {
    const featuresDir = resolve(__dirname, '../../features');
    const offenders = walk(featuresDir)
      .filter((file) => readFileSync(file, 'utf8').includes('@base-ui/react'))
      .map((file) => file.split('/features/')[1] as string);
    expect(offenders, `feature 直接用了 Base UI：${offenders.join(', ')}`).toEqual([]);
  });
});
