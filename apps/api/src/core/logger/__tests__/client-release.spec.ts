import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { clientReleaseOf } from '../client-release';

const request = (headers: IncomingMessage['headers']) => ({ headers }) as IncomingMessage;

describe('clientReleaseOf（x-client-release，docs/architecture/frontend/19-observability.md §3）', () => {
  it('commit 或 dev 照原樣記錄', () => {
    expect(clientReleaseOf(request({ 'x-client-release': '1a2b3c4' }))).toBe('1a2b3c4');
    expect(clientReleaseOf(request({ 'x-client-release': 'dev' }))).toBe('dev');
  });

  it('沒有或格式不對時不記', () => {
    expect(clientReleaseOf(request({}))).toBeUndefined();
    expect(clientReleaseOf(request({ 'x-client-release': 'a b\nfake=1' }))).toBeUndefined();
    expect(clientReleaseOf(request({ 'x-client-release': 'x'.repeat(41) }))).toBeUndefined();
  });
});
