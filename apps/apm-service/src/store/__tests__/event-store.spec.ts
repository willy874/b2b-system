import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventStore } from '../event-store';
import type { StoredEvent } from '../types';

function storedEvent(
  eventId: string,
  receivedAt: string,
  overrides: Partial<StoredEvent> = {},
): StoredEvent {
  return {
    eventId,
    project: 'backstage',
    groupId: '0123456789abcdef',
    title: 'Error: x',
    culprit: '',
    level: 'error',
    platform: 'javascript',
    timestamp: receivedAt,
    receivedAt,
    exceptions: [],
    breadcrumbs: [],
    tags: {},
    ...overrides,
  };
}

let dataDir: string;
let store: EventStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'apm-events-'));
  store = await EventStore.open(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function collect(iterable: AsyncIterable<StoredEvent>): Promise<string[]> {
  const ids: string[] = [];
  for await (const event of iterable) ids.push(event.eventId);
  return ids;
}

describe('EventStore（每專案每天一個 NDJSON，設計決策 D6）', () => {
  it('依收到的日期分檔，scan 由新的檔案讀起', async () => {
    await store.append(storedEvent('a', '2026-10-05T10:00:00.000Z'));
    await store.append(storedEvent('b', '2026-10-06T10:00:00.000Z'));
    await store.append(storedEvent('c', '2026-10-06T11:00:00.000Z'));
    expect(await readdir(join(dataDir, 'events', 'backstage'))).toEqual([
      '2026-10-05.ndjson',
      '2026-10-06.ndjson',
    ]);
    expect(await collect(store.scan('backstage', new Date('2026-10-01T00:00:00Z')))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('scan 只回 since 之後收到的事件', async () => {
    await store.append(storedEvent('old', '2026-10-06T09:00:00.000Z'));
    await store.append(storedEvent('new', '2026-10-06T11:00:00.000Z'));
    expect(await collect(store.scan('backstage', new Date('2026-10-06T10:00:00Z')))).toEqual([
      'new',
    ]);
  });

  it('並行寫入不會交錯成壞掉的行', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        store.append(
          storedEvent(`e${index}`, '2026-10-06T10:00:00.000Z', { title: 'x'.repeat(5000) }),
        ),
      ),
    );
    expect(await collect(store.scan('backstage', new Date('2026-10-01T00:00:00Z')))).toHaveLength(
      50,
    );
  });

  it('略過寫到一半的行', async () => {
    await store.append(storedEvent('ok', '2026-10-06T10:00:00.000Z'));
    await writeFile(
      join(dataDir, 'events', 'backstage', '2026-10-06.ndjson'),
      '{"eventId":"broken',
      {
        flag: 'a',
      },
    );
    expect(await collect(store.scan('backstage', new Date('2026-10-01T00:00:00Z')))).toEqual([
      'ok',
    ]);
  });

  it('findById', async () => {
    await store.append(storedEvent('x1', '2026-10-06T10:00:00.000Z'));
    await store.append(storedEvent('x2', '2026-10-06T10:00:00.000Z'));
    expect((await store.findById('backstage', 'x2', new Date('2026-10-01')))?.eventId).toBe('x2');
    expect(await store.findById('backstage', 'nope', new Date('2026-10-01'))).toBeUndefined();
  });

  it('purgeOlderThan 刪掉超過保留天數的檔案', async () => {
    await store.append(storedEvent('old', '2026-09-01T10:00:00.000Z'));
    await store.append(storedEvent('new', '2026-10-06T10:00:00.000Z'));
    expect(await store.purgeOlderThan(30, new Date('2026-10-07T00:00:00Z'))).toBe(1);
    expect(await readdir(join(dataDir, 'events', 'backstage'))).toEqual(['2026-10-06.ndjson']);
  });
});
