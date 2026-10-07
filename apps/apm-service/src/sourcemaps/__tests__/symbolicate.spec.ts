import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { transform } from 'esbuild';

import { SourcemapStore } from '../sourcemap-store';
import { sourcemapPathFor, Symbolicator } from '../symbolicate';

const SOURCE = ['export function loadUser(user) {', '  return user.profile.id;', '}', ''].join(
  '\n',
);

/** 壓縮後的程式碼裡 `.profile` 那個位置（1 起算的行、欄）。 */
function locate(code: string, needle: string): { lineno: number; colno: number } {
  const lines = code.split('\n');
  for (const [index, line] of lines.entries()) {
    const column = line.indexOf(needle);
    if (column !== -1) return { lineno: index + 1, colno: column + 1 };
  }
  throw new Error(`找不到 ${needle}`);
}

describe('sourcemapPathFor', () => {
  it.each([
    ['https://acme.example.com/assets/index-abc.js', 'assets/index-abc.js.map'],
    ['~/assets/index-abc.js', 'assets/index-abc.js.map'],
    ['https://acme.example.com/', undefined],
  ])('%s → %s', (input, expected) => {
    expect(sourcemapPathFor(input)).toBe(expected);
  });
});

describe('Symbolicator（查詢時以 sourcemap 還原，docs/architecture/frontend/19-observability.md §9.2 D5）', () => {
  let dataDir: string;
  let store: SourcemapStore;
  let minified: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'apm-symbolicate-'));
    store = await SourcemapStore.open(dataDir);
    const result = await transform(SOURCE, {
      minify: true,
      sourcemap: 'external',
      sourcefile: 'src/features/user/load.ts',
      sourcesContent: true,
      format: 'esm',
    });
    minified = result.code;
    await store.save('backstage', 'r1', '~/assets/index-abc.js.map', Buffer.from(result.map));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('還原成原始檔名、行號，並附上那一行原始碼', async () => {
    const position = locate(minified, '.profile');
    const frame = await new Symbolicator(store).frame('backstage', 'r1', {
      filename: 'https://acme.example.com/assets/index-abc.js',
      function: 'o',
      ...position,
    });
    expect(frame).toMatchObject({
      symbolicated: true,
      filename: 'src/features/user/load.ts',
      lineno: 2,
      context_line: 'return user.profile.id;',
      raw_filename: 'https://acme.example.com/assets/index-abc.js',
      raw_function: 'o',
      in_app: true,
    });
  });

  it('沒有 sourcemap 或沒有 release 時原樣回傳', async () => {
    const symbolicator = new Symbolicator(store);
    const frame = { filename: 'https://acme.example.com/assets/other.js', lineno: 1, colno: 1 };
    expect(await symbolicator.frame('backstage', 'r1', frame)).toEqual({
      ...frame,
      symbolicated: false,
    });
    expect(await symbolicator.frame('backstage', undefined, frame)).toEqual({
      ...frame,
      symbolicated: false,
    });
  });

  it('sourcemap 比事件晚上傳也能還原（沒找到時不快取）', async () => {
    const symbolicator = new Symbolicator(store);
    const position = locate(minified, '.profile');
    const frame = { filename: 'https://acme.example.com/assets/late.js', ...position };
    expect((await symbolicator.frame('backstage', 'r1', frame)).symbolicated).toBe(false);
    const map = await store.read('backstage', 'r1', 'assets/index-abc.js.map');
    await store.save('backstage', 'r1', '~/assets/late.js.map', Buffer.from(map ?? ''));
    expect((await symbolicator.frame('backstage', 'r1', frame)).symbolicated).toBe(true);
  });
});
