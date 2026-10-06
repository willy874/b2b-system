import type { FactoryProvider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config';
import { ConsoleMailTransport } from '../console-mail-transport';
import { MailTransport } from '../mail-transport';
import { MailModule } from '../mail.module';
import { SmtpMailTransport } from '../smtp-mail-transport';

/** `MailModule` 登記的 `MailTransport` factory。 */
function transportFactory(): FactoryProvider<MailTransport> {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MailModule) as unknown[];
  const provider = providers.find(
    (candidate): candidate is FactoryProvider<MailTransport> =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as FactoryProvider).provide === MailTransport,
  );
  if (!provider) throw new Error('MailModule 沒有登記 MailTransport');
  return provider;
}

function configWith(transport: string): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    MAIL_TRANSPORT: transport,
    MAIL_SMTP_URL: 'smtp://smtp.example.com:587',
    MAIL_SMTP_POOL_SIZE: 1,
    MAIL_FROM: 'no-reply@example.com',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('MailModule：傳輸層依 MAIL_TRANSPORT 選定（docs/architecture/backend/11-mail.md §2）', () => {
  it('smtp → SmtpMailTransport', () => {
    const transport = transportFactory().useFactory(configWith('smtp')) as MailTransport;
    try {
      expect(transport).toBeInstanceOf(SmtpMailTransport);
    } finally {
      (transport as SmtpMailTransport).onApplicationShutdown();
    }
  });

  it('console → ConsoleMailTransport（只寫日誌）', () => {
    expect(transportFactory().useFactory(configWith('console'))).toBeInstanceOf(
      ConsoleMailTransport,
    );
  });
});
