import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '../../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** 唯一可以 import `socket.io-client` 的檔案（docs/architecture/frontend/11-realtime.md §2）。 */
const ALLOWED = new Set(['core/realtime/socketIoTransport.ts']);

describe('推播傳輸層的邊界（docs/architecture/frontend/11-realtime.md §2）', () => {
  it('只有 socketIoTransport.ts import socket.io-client；其他地方經由 RealtimeTransport', () => {
    const offenders = walk(srcDir)
      .filter((file) => /from ['"]socket\.io-client['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcDir, file))
      .filter((file) => !ALLOWED.has(file));
    expect(offenders, `直接 import socket.io-client：${offenders.join(', ')}`).toEqual([]);
  });
});
