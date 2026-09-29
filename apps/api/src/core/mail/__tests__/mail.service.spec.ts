import type { ConfigService } from '@nestjs/config';
import { Text } from '@react-email/components';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { runInTenantContext } from '@/core/tenant';
import type { TenantDirectory } from '@/core/tenant';

import { toMailLocale } from '../mail-locale';
import type { MailMessage, MailTransport } from '../mail-transport';
import { MailService } from '../mail.service';

function setup() {
  const sent: MailMessage[] = [];
  const transport = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
      return { messageId: '<m1@test>' };
    }),
  };
  const config = { get: vi.fn(() => 'https://editor.example.com') };
  const directory = {
    primaryDomainOf: (id: string) => (id === 't1' ? 'acme.example.com' : undefined),
  };
  const service = new MailService(
    transport as unknown as MailTransport,
    directory as unknown as TenantDirectory,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, sent };
}

describe('MailService（docs/architecture/backend/11-mail.md §3）', () => {
  const inTenant = <T>(fn: () => T) =>
    runInTenantContext(
      { id: 't1', code: 'acme', db: {} as Database, storageBucket: 'b2b-acme' },
      fn,
    );

  it('link() 在租戶裡以租戶的主要網域開頭（協定沿用 APP_PUBLIC_URL）', () => {
    const { service } = setup();
    expect(inTenant(() => service.link('/approval', { id: '1' }))).toBe(
      'https://acme.example.com/approval?id=1',
    );
  });

  it('accountLink() 帶上租戶代碼（apps/auth 的頁面以它指定租戶）', () => {
    const { service } = setup();
    expect(inTenant(() => service.accountLink('/setup', { token: 'x' }))).toBe(
      'https://editor.example.com/setup?token=x&tenant=acme',
    );
  });

  it('沒有租戶時 link() 以 APP_PUBLIC_URL 開頭並編碼查詢字串', () => {
    const { service } = setup();
    expect(service.link('/auth/setup', { token: 'a+b/c=' })).toBe(
      'https://editor.example.com/auth/setup?token=a%2Bb%2Fc%3D',
    );
  });

  it('send() 同時產生 HTML 與純文字', async () => {
    const { service, sent } = setup();
    const result = await service.send('alice@example.com', {
      subject: '主旨',
      // 測試檔是 .ts（vitest 只收 *.spec.ts），不用 JSX
      body: createElement(Text, null, '你好'),
    });
    expect(result).toEqual({ messageId: '<m1@test>' });
    expect(sent[0]).toMatchObject({ to: 'alice@example.com', subject: '主旨' });
    expect(sent[0]!.html).toContain('<p');
    expect(sent[0]!.text).toContain('你好');
    expect(sent[0]!.text).not.toContain('<p');
  });
});

describe('toMailLocale', () => {
  it('認得的語系原樣回傳，其他退回 zh-TW', () => {
    expect(toMailLocale('en-US')).toBe('en-US');
    expect(toMailLocale('ja-JP')).toBe('zh-TW');
    expect(toMailLocale(null)).toBe('zh-TW');
  });
});
