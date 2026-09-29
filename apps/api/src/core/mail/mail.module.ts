import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { ConsoleMailTransport } from './console-mail-transport';
import { MailTransport } from './mail-transport';
import { MailService } from './mail.service';
import { SmtpMailTransport } from './smtp-mail-transport';

/** 全域提供 `MailService`；傳輸層依 `MAIL_TRANSPORT` 選定，注入端只認抽象類別。 */
@Global()
@Module({
  providers: [
    {
      provide: MailTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailTransport =>
        config.get('MAIL_TRANSPORT', { infer: true }) === 'smtp'
          ? new SmtpMailTransport(config)
          : new ConsoleMailTransport(),
    },
    MailService,
  ],
  exports: [MailService, MailTransport],
})
export class MailModule {}
