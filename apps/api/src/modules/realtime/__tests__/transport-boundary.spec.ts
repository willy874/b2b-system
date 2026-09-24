import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '../../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

const sources = walk(srcDir).map((file) => ({
  path: relative(srcDir, file),
  source: readFileSync(file, 'utf8'),
}));

/**
 * 推播傳輸層的邊界（docs/architecture/backend/08-realtime.md §2）：
 * Socket.io 的型別只在 `realtime.types.ts` 宣告，只有傳輸層的三個檔案使用；
 * listener、audience 經由 `RealtimePublisher`，`common/` 的 guard 經由 `WsClient`。
 */
describe('推播傳輸層的邊界（docs/architecture/backend/08-realtime.md §2）', () => {
  it('只有 realtime.types.ts import socket.io', () => {
    const offenders = sources
      .filter(({ source }) => /from ['"]socket\.io['"]/.test(source))
      .map(({ path }) => path)
      .filter((path) => path !== 'modules/realtime/realtime.types.ts');
    expect(offenders, `直接 import socket.io：${offenders.join(', ')}`).toEqual([]);
  });

  it('只有 gateway、publisher、expiry 使用 Socket.io 的伺服器與連線型別', () => {
    const allowed = new Set([
      'modules/realtime/realtime.gateway.ts',
      'modules/realtime/realtime.publisher.ts',
      'modules/realtime/realtime.expiry.ts',
    ]);
    const offenders = sources
      .filter(({ source }) =>
        /from ['"](\.\/|@\/modules\/realtime\/)realtime\.types['"]/.test(source),
      )
      .map(({ path }) => path)
      .filter((path) => !allowed.has(path));
    expect(offenders, `使用 realtime.types：${offenders.join(', ')}`).toEqual([]);
  });
});
