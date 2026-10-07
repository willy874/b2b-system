import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApmError } from '@/http/errors';

import { SourcemapStore, toRelativePath } from '../sourcemap-store';

describe('toRelativePath（上傳時的檔名）', () => {
  it.each([
    ['~/assets/index-abc.js.map', 'assets/index-abc.js.map'],
    ['/assets/index-abc.js.map', 'assets/index-abc.js.map'],
    ['https://acme.example.com/assets/index-abc.js.map', 'assets/index-abc.js.map'],
  ])('%s → %s', (input, expected) => {
    expect(toRelativePath(input)).toBe(expected);
  });

  it.each(['~/../secret', '~/assets/../../x', '~/assets//x', '~/a b.js'])('拒絕 %s', (input) => {
    expect(() => toRelativePath(input)).toThrow(ApmError);
  });
});

describe('SourcemapStore（.data/sourcemaps，docs/architecture/frontend/19-observability.md §9.2 D4）', () => {
  let dataDir: string;
  let store: SourcemapStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'apm-maps-'));
    store = await SourcemapStore.open(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('存、列出、讀回', async () => {
    const saved = await store.save('backstage', '1a2b3c4', '~/assets/a.js.map', Buffer.from('{}'));
    expect(saved).toMatchObject({ name: '~/assets/a.js.map', size: 2 });
    expect((await store.list('backstage', '1a2b3c4')).map((file) => file.name)).toEqual([
      '~/assets/a.js.map',
    ]);
    expect(await store.read('backstage', '1a2b3c4', 'assets/a.js.map')).toBe('{}');
  });

  it('同名檔案 → 409', async () => {
    await store.save('backstage', 'r1', '~/a.js.map', Buffer.from('{}'));
    await expect(
      store.save('backstage', 'r1', '~/a.js.map', Buffer.from('{}')),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('release 名稱不合法 → 400', async () => {
    await expect(
      store.save('backstage', '../x', '~/a.js.map', Buffer.from('{}')),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('沒有的檔案或 release 讀回 undefined', async () => {
    expect(await store.read('backstage', 'none', 'assets/a.js.map')).toBeUndefined();
    expect(await store.list('backstage', 'none')).toEqual([]);
  });
});
