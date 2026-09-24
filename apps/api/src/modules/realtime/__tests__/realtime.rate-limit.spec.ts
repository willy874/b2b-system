import type { IncomingMessage } from 'node:http';

import proxyaddr from 'proxy-addr';
import { describe, expect, it } from 'vitest';

import { clientIpOf, FixedWindowCounter } from '../realtime.rate-limit';

function requestFrom(remoteAddress: string | undefined, forwardedFor?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    connection: { remoteAddress },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  } as unknown as IncomingMessage;
}

describe('clientIpOf（與 Express req.ip 相同的判定）', () => {
  it('不信任代理：只看連線對端，忽略 X-Forwarded-For', () => {
    const req = requestFrom('172.18.0.5', '203.0.113.9');
    expect(clientIpOf(req, () => false)).toBe('172.18.0.5');
  });

  it('信任私有網段的代理（nginx 在 docker 網路）：取 X-Forwarded-For 的真實客戶端', () => {
    const req = requestFrom('172.18.0.5', '203.0.113.9');
    expect(clientIpOf(req, proxyaddr.compile('uniquelocal'))).toBe('203.0.113.9');
  });

  it('不信任的來源自帶 X-Forwarded-For 無法偽造 IP', () => {
    const req = requestFrom('198.51.100.7', '10.0.0.1');
    expect(clientIpOf(req, proxyaddr.compile('uniquelocal'))).toBe('198.51.100.7');
  });

  it('沒有對端位址 → unknown', () => {
    expect(clientIpOf(requestFrom(undefined), () => false)).toBe('unknown');
  });
});

describe('FixedWindowCounter', () => {
  it('同一視窗內累計，視窗過後重新計數', () => {
    const counter = new FixedWindowCounter(1_000);
    expect(counter.hit('ip', 0)).toBe(1);
    expect(counter.hit('ip', 500)).toBe(2);
    expect(counter.hit('ip', 1_000)).toBe(1);
  });
});
