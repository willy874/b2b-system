import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { resolveRequestId } from '../request-id.middleware';

function request(
  headers: Record<string, string> = {},
  id?: unknown,
): IncomingMessage & { id?: unknown } {
  return { headers, id } as unknown as IncomingMessage & { id?: unknown };
}

describe('resolveRequestId（日誌與回應標頭共用同一個 requestId）', () => {
  it('pino-http 已指派的 req.id 優先：中介層與日誌拿到同一個值', () => {
    expect(resolveRequestId(request({ 'x-request-id': 'from-header' }, 'assigned'))).toBe(
      'assigned',
    );
  });

  it('沿用客戶端帶來的 x-request-id（64 字以內）', () => {
    expect(resolveRequestId(request({ 'x-request-id': 'from-header' }))).toBe('from-header');
  });

  it('沒帶、空字串或超過 64 字 → 產生新的 uuid', () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(request())).toMatch(uuid);
    expect(resolveRequestId(request({ 'x-request-id': '' }))).toMatch(uuid);
    expect(resolveRequestId(request({ 'x-request-id': 'x'.repeat(65) }))).toMatch(uuid);
  });
});
