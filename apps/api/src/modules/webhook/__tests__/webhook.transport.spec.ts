import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import * as http from '@/core/http';
import { OutboundRequestError } from '@/core/http';

import { WebhookEventCatalog } from '../webhook-event.catalog';
import {
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_PING_EVENT,
  WEBHOOK_RESPONSE_EXCERPT_BYTES,
} from '../webhook.constants';
import { defineWebhookEvent } from '../webhook.definition';
import { generateWebhookSecret, signWebhook } from '../webhook.signature';
import { WebhookTransport } from '../webhook.transport';

// 只換掉送出與 DNS 檢查的出口，預設行為與真的相同（其他測試仍走真的 SSRF 判斷）
vi.mock('@/core/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/http')>();
  return {
    ...actual,
    sendOutboundRequest: vi.fn(actual.sendOutboundRequest),
    assertPublicDestination: vi.fn(actual.assertPublicDestination),
  };
});

function transport(nodeEnv: Env['NODE_ENV']): WebhookTransport {
  const values: Partial<Env> = {
    NODE_ENV: nodeEnv,
    JWT_SECRET: 'test-secret-that-is-long-enough-32ch',
    WEBHOOK_SECRET_KEY: undefined,
  };
  return new WebhookTransport({
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>);
}

async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe('WEBHOOK_URL_NOT_ALLOWED');
  return (error as AppException).details?.reason;
}

describe('WebhookTransport.normalizeUrl（docs/architecture/backend/17-webhook.md §9.2 D15）', () => {
  it('production：只接受 https', async () => {
    expect(await reasonOf(transport('production').normalizeUrl('http://hooks.example.com'))).toBe(
      'protocol',
    );
    expect(await reasonOf(transport('production').normalizeUrl('ftp://hooks.example.com'))).toBe(
      'protocol',
    );
  });

  it('production：解析到內網位址的網址擋下', async () => {
    expect(await reasonOf(transport('production').normalizeUrl('https://127.0.0.1/hook'))).toBe(
      'blocked',
    );
    expect(await reasonOf(transport('production').normalizeUrl('https://[::1]:8443/hook'))).toBe(
      'blocked',
    );
  });

  it('開發環境：允許 http 與本機，才能打本機的接收端', async () => {
    expect(await transport('development').normalizeUrl('http://localhost:4000/hook')).toBe(
      'http://localhost:4000/hook',
    );
  });

  it('帶帳密的網址不接受；格式不對回 invalid', async () => {
    expect(
      await reasonOf(transport('development').normalizeUrl('https://user:pass@hooks.example.com')),
    ).toBe('credentials');
    expect(await reasonOf(transport('development').normalizeUrl('not a url'))).toBe('invalid');
  });

  it('密鑰加密後存放，解得回來', () => {
    const box = transport('development');
    const sealed = box.encryptSecret('whsec_abc');
    expect(sealed).not.toContain('whsec_abc');
    expect(box.decryptSecret(sealed)).toBe('whsec_abc');
  });

  it('production 沒有 WEBHOOK_SECRET_KEY（對外 API 的程序）：不以 JWT_SECRET 推導，用到時才失敗', () => {
    expect(() => transport('production').encryptSecret('whsec_abc')).toThrow('WEBHOOK_SECRET_KEY');
  });
});

describe('簽章（D11、D14）', () => {
  it('HMAC-SHA256(secret, "{timestamp}.{body}")，hex', () => {
    // echo -n '1700000000.{"a":1}' | openssl dgst -sha256 -hmac whsec_test
    expect(signWebhook('whsec_test', 1_700_000_000, '{"a":1}')).toBe(
      'sha256=38877139021993b830af32feea6e18a8da83eb2f6e49ee50bd9e4cf4ca4d3789',
    );
  });

  it('密鑰：whsec_ ＋ 32 bytes base64url，每次不同', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(a);
  });
});

describe('對外事件的目錄（D1）', () => {
  it('名稱格式與版本在宣告時檢查', () => {
    expect(() => defineWebhookEvent('UserCreated', { version: 1 })).toThrow('<資源>.<動作>');
    expect(() => defineWebhookEvent('user.created', { version: 0 })).toThrow('正整數');
  });

  it('重複登記讓啟動失敗', () => {
    const catalog = new WebhookEventCatalog();
    catalog.register([WEBHOOK_PING_EVENT]);
    expect(() => catalog.register([WEBHOOK_PING_EVENT])).toThrow('重複登記');
  });

  it('webhook.ping 登記了但不能訂閱', () => {
    const catalog = new WebhookEventCatalog();
    catalog.register([WEBHOOK_PING_EVENT]);
    expect(() => catalog.assertRegistered('webhook.ping')).not.toThrow();
    expect(catalog.isSubscribable('webhook.ping')).toBe(false);
    expect(catalog.subscribable(['webhook'])).toEqual([]);
  });
});

describe('WebhookTransport.normalizeUrl：DNS（docs/architecture/backend/17-webhook.md §9.2 D15）', () => {
  beforeEach(() => {
    vi.mocked(http.assertPublicDestination).mockClear();
  });

  it('production：解析不到的主機 → unresolvable', async () => {
    vi.mocked(http.assertPublicDestination).mockRejectedValueOnce(new Error('ENOTFOUND'));
    expect(await reasonOf(transport('production').normalizeUrl('https://nowhere.invalid/'))).toBe(
      'unresolvable',
    );
  });

  it('production：公開位址 → 回傳正規化後的網址', async () => {
    vi.mocked(http.assertPublicDestination).mockResolvedValueOnce(undefined as never);
    expect(await transport('production').normalizeUrl('https://Hooks.Example.com')).toBe(
      'https://hooks.example.com/',
    );
  });

  it('開發環境：不做 DNS 檢查', async () => {
    await transport('development').normalizeUrl('https://hooks.example.com/');
    expect(http.assertPublicDestination).not.toHaveBeenCalled();
  });
});

describe('WebhookTransport.send（docs/architecture/backend/17-webhook.md §9.2 D11、D15）', () => {
  const send = vi.mocked(http.sendOutboundRequest);

  beforeEach(() => {
    send.mockReset();
  });

  it('POST、10 秒逾時、回應只讀前 1 KB；production 才擋私有位址', async () => {
    send.mockResolvedValue({ status: 204, body: '' });
    await transport('production').send('https://hooks.example.com/b2b', { a: 'b' }, '{}');
    await transport('development').send('http://localhost:4000/hook', {}, '{}');
    expect(send).toHaveBeenNthCalledWith(1, {
      method: 'POST',
      url: new URL('https://hooks.example.com/b2b'),
      headers: { a: 'b' },
      body: '{}',
      timeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
      maxResponseBytes: WEBHOOK_RESPONSE_EXCERPT_BYTES,
      blockPrivateNetworks: true,
    });
    expect(send.mock.calls[1]?.[0]).toMatchObject({ blockPrivateNetworks: false });
  });

  it('有回應（不論狀態碼）→ received: true 帶回應', async () => {
    send.mockResolvedValue({ status: 500, body: 'boom' });
    await expect(transport('development').send('https://h.example.com', {}, '{}')).resolves.toEqual(
      { received: true, response: { status: 500, body: 'boom' } },
    );
  });

  it.each([
    ['連線層的已知失敗', new OutboundRequestError('TIMEOUT', 'timeout'), 'TIMEOUT'],
    ['投遞時才發現指向內網', new OutboundRequestError('BLOCKED', 'blocked'), 'BLOCKED'],
    ['其他例外', new Error('socket hang up'), 'REQUEST_FAILED'],
  ])('%s → 不拋出，回傳原因代碼 %s', async (_label, error, code) => {
    send.mockRejectedValue(error);
    await expect(transport('development').send('https://h.example.com', {}, '{}')).resolves.toEqual(
      { received: false, error: code },
    );
  });
});
