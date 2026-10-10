import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** 以值 import `@sentry/*` 的檔案：兩個都只被 `telemetry.ts` 動態載入（docs/architecture/frontend/19-observability.md §9.2 D13）。 */
const SDK_MODULES = new Set(['telemetry/sdk.ts', 'telemetry/tracing.ts']);
/** `import … from '@sentry/…'`，排除 `import type`。 */
const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*?from\s+['"]@sentry\//m;
/** 靜態 import 這兩個模組（含 `import type` 以外的轉出）。 */
const STATIC_SDK_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]\.{1,2}\/(?:[\w-]+\/)*(?:sdk|tracing)['"]/m;

describe('Sentry SDK 的邊界（docs/architecture/frontend/19-observability.md §9.2 D13）', () => {
  const files = walk(srcDir).map((file) => ({
    path: relative(srcDir, file),
    source: readFileSync(file, 'utf8'),
  }));

  it('只有 telemetry/sdk.ts、tracing.ts 以值 import @sentry/*', () => {
    const offenders = files
      .filter(({ path, source }) => !SDK_MODULES.has(path) && VALUE_IMPORT.test(source))
      .map(({ path }) => path);
    expect(offenders, `以值 import @sentry：${offenders.join(', ')}`).toEqual([]);
  });

  it('sdk.ts、tracing.ts 只被動態載入，不會進入首頁的初始載入', () => {
    const offenders = files
      .filter(({ source }) => STATIC_SDK_IMPORT.test(source))
      .map(({ path }) => path);
    expect(offenders, `靜態 import sdk／tracing：${offenders.join(', ')}`).toEqual([]);
  });
});
