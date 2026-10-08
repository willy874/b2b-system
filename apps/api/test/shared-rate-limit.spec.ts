import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PlatformDatabase } from '@/core/database';
import { PostgresRateLimitStore } from '@/core/rate-limit';
import { rateLimitCounters } from '@/db/platform/schema';

import type { PlatformTestDatabase } from './db';
import { createPlatformTestDatabase } from './db';
import { listenOnLoopback } from './http';

const JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
const ANONYMOUS_LIMIT = 4;

let platformDb: PlatformTestDatabase;
let closeDb: () => Promise<void>;
let store: PostgresRateLimitStore;

beforeAll(() => {
  const created = createPlatformTestDatabase();
  platformDb = created.db;
  closeDb = async () => created.client.end();
  store = new PostgresRateLimitStore(platformDb as unknown as PlatformDatabase);
});

afterAll(async () => {
  await closeDb?.();
});

describe('PostgresRateLimitStore（docs/features/multi-instance.md D6）', () => {
  it('同一個時間窗內累加，時間窗的結束時刻不變', async () => {
    const first = await store.hit('test:accumulate', 60_000);
    const second = await store.hit('test:accumulate', 60_000);
    expect([first.count, second.count]).toEqual([1, 2]);
    expect(second.resetAt).toBe(first.resetAt);
    expect(first.resetAt - Date.now()).toBeGreaterThan(50_000);
  });

  it('時間窗結束後重新從 1 開始', async () => {
    await store.hit('test:expired', 60_000);
    await store.hit('test:expired', 60_000);
    await platformDb
      .update(rateLimitCounters)
      .set({ resetAt: sql`now() - interval '1 second'` })
      .where(eq(rateLimitCounters.key, 'test:expired'));

    expect((await store.hit('test:expired', 60_000)).count).toBe(1);
  });

  it('同時計數不會少算：50 次並行得到 1…50', async () => {
    const records = await Promise.all(
      Array.from({ length: 50 }, () => store.hit('test:concurrent', 60_000)),
    );
    expect(records.map((record) => record.count).toSorted((x, y) => x - y)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
  });

  it('peek 不計數；過期或沒有時回 undefined；reset 清掉', async () => {
    expect(await store.peek('test:peek')).toBeUndefined();
    await store.hit('test:peek', 60_000);
    expect((await store.peek('test:peek'))?.count).toBe(1);
    expect((await store.peek('test:peek'))?.count).toBe(1);
    await store.reset('test:peek');
    expect(await store.peek('test:peek')).toBeUndefined();
  });

  it('deleteExpired 只刪過期的列', async () => {
    await store.hit('test:cleanup-live', 60_000);
    await store.hit('test:cleanup-dead', 60_000);
    await platformDb
      .update(rateLimitCounters)
      .set({ resetAt: sql`now() - interval '1 second'` })
      .where(eq(rateLimitCounters.key, 'test:cleanup-dead'));

    expect(await store.deleteExpired()).toBeGreaterThanOrEqual(1);

    const keys = (
      await platformDb.select({ key: rateLimitCounters.key }).from(rateLimitCounters)
    ).map((row) => row.key);
    expect(keys).toContain('test:cleanup-live');
    expect(keys).not.toContain('test:cleanup-dead');
  });
});

interface Process {
  app: INestApplication;
  http: App;
}

async function startProcess(): Promise<Process> {
  const { AppModule } = await import('@/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const http = await listenOnLoopback(app);
  expect((app.getHttpServer().address() as AddressInfo).port).toBeGreaterThan(0);
  return { app, http };
}

describe('兩個程序共用計數（RATE_LIMIT_STORE=postgres）', () => {
  let a: Process;
  let b: Process;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.RATE_LIMIT_STORE = 'postgres';
    process.env.ANONYMOUS_RATE_LIMIT = String(ANONYMOUS_LIMIT);
    await platformDb.delete(rateLimitCounters);
    a = await startProcess();
    b = await startProcess();
  });

  afterAll(async () => {
    await a?.app.close();
    await b?.app.close();
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.ANONYMOUS_RATE_LIMIT;
  });

  it('未登入的 IP 額度在兩個程序合計：A、B 各打一半之後，下一次被擋', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < ANONYMOUS_LIMIT; index += 1) {
      const target = index % 2 === 0 ? a : b;
      // oxlint-disable-next-line no-await-in-loop -- 依序計數
      statuses.push((await request(target.http).get('/system/settings/public')).status);
    }
    expect(statuses).toEqual(Array.from({ length: ANONYMOUS_LIMIT }, () => 200));

    const blocked = await request(b.http).get('/system/settings/public');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
