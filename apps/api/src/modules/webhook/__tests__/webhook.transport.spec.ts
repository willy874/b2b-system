import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';

import { WebhookEventCatalog } from '../webhook-event.catalog';
import { WEBHOOK_PING_EVENT } from '../webhook.constants';
import { defineWebhookEvent } from '../webhook.definition';
import { generateWebhookSecret, signWebhook } from '../webhook.signature';
import { WebhookTransport } from '../webhook.transport';

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
