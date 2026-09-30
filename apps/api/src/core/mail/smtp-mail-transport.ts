import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

import type { Env } from '../config';
import { MailTransport } from './mail-transport';
import type { MailMessage, SentMail } from './mail-transport';

/**
 * 連線池：沿用已建立（含 TLS 握手）的 SMTP 連線連續寄信，不必每封重新連線。
 * `poolSize` 是同時開著的連線數，配合寄信工作的並行數（`MAIL_JOB_OPTIONS.concurrency`）。
 */
export function smtpOptionsOf(url: string, poolSize: number) {
  return { url, pool: true, maxConnections: poolSize } as const;
}

/**
 * 經 SMTP 寄出（nodemailer）。只講 SMTP、不綁服務商的 SDK：換 SES、Postmark、Mailpit 只改
 * `MAIL_SMTP_URL`（docs/adr/0017-mail-delivery.md D1、D2）。
 */
@Injectable()
export class SmtpMailTransport extends MailTransport implements OnApplicationShutdown {
  private readonly transporter;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.transporter = createTransport(
      smtpOptionsOf(
        config.get('MAIL_SMTP_URL', { infer: true }),
        config.get('MAIL_SMTP_POOL_SIZE', { infer: true }),
      ),
      {
        from: config.get('MAIL_FROM', { infer: true }),
      },
    );
  }

  async send(message: MailMessage): Promise<SentMail> {
    const info = await this.transporter.sendMail(message);
    return { messageId: info.messageId };
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
