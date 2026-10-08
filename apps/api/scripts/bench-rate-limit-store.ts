/**
 * `PostgresRateLimitStore.hit` 的壓測（docs/architecture/01-system.md §7.4、D10）：在一個 **暫用的** 平台 DB 上，
 * 以固定的並行度打 `hit`，量吞吐與延遲分位。驗收門檻：p99 < 5 ms。
 *
 *   BENCH_DATABASE_URL=postgres://… pnpm --filter @b2b-system/api bench:rate-limit
 *
 * 只建 `rate_limit_counters`（與 migration 相同的 DDL），不跑整套 migration；結束時刪掉這張表。
 * 不要指向共用或正式的 DB：結束時會 DROP TABLE。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { PlatformDatabase } from '../src/core/database';
import { PostgresRateLimitStore } from '../src/core/rate-limit/postgres-rate-limit-store';
import * as platformSchema from '../src/db/platform/schema';

const url = process.env.BENCH_DATABASE_URL;
const TOTAL = Number(process.env.BENCH_TOTAL ?? 20_000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 32);
/** 不同的 key 數：每個使用者一個 key，熱門的少數 key 另外模擬（同一間公司的 NAT 出口 IP）。 */
const KEYS = Number(process.env.BENCH_KEYS ?? 1_000);
const POOL_MAX = Number(process.env.BENCH_POOL_MAX ?? 10);

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function main(): Promise<void> {
  if (!url) throw new Error('請設定 BENCH_DATABASE_URL（暫用的 database，結束時會 DROP TABLE）');
  const client = postgres(url, { max: POOL_MAX, onnotice: () => {} });
  const db = drizzle(client, { schema: platformSchema });
  await client`DROP TABLE IF EXISTS rate_limit_counters`;
  await client`CREATE UNLOGGED TABLE rate_limit_counters (
    key text PRIMARY KEY, count integer NOT NULL,
    reset_at timestamptz NOT NULL, last_at timestamptz NOT NULL)`;
  await client`CREATE INDEX rate_limit_counters_reset_at_idx ON rate_limit_counters (reset_at)`;
  const store = new PostgresRateLimitStore(db as unknown as PlatformDatabase);

  const latencies: number[] = [];
  let next = 0;
  const started = performance.now();
  async function worker(): Promise<void> {
    while (next < TOTAL) {
      const index = next;
      next += 1;
      // 一成落在 5 個熱門 key（NAT 出口的 IP 桶），其餘分散
      const key = index % 10 === 0 ? `ip:hot-${index % 5}` : `user:${index % KEYS}`;
      const begin = performance.now();
      // oxlint-disable-next-line no-await-in-loop -- 每個 worker 依序送，並行度由 worker 數決定
      await store.hit(key, 60_000);
      latencies.push(performance.now() - begin);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsedSeconds = (performance.now() - started) / 1000;

  const sorted = latencies.toSorted((x, y) => x - y);
  const report = {
    total: TOTAL,
    concurrency: CONCURRENCY,
    hitsPerSecond: Math.round(TOTAL / elapsedSeconds),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    p99Ms: Number(percentile(sorted, 99).toFixed(2)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
  };
  console.log(JSON.stringify(report, null, 2));
  await client`DROP TABLE rate_limit_counters`;
  await client.end();
  if (report.p99Ms >= 5) {
    console.error(`p99 ${report.p99Ms} ms ≥ 5 ms：未達 docs/architecture/01-system.md §7.4 的門檻`);
    process.exitCode = 1;
  }
}

void main();
