import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

import type { Env } from '../config';
import { MailTransport } from './mail-transport';
import type { MailMessage, SentMail } from './mail-transport';

/**
 * 經 SMTP 寄出（nodemailer）。只講 SMTP、不綁服務商的 SDK：換 SES、Postmark、Mailpit 只改
 * `MAIL_SMTP_URL`（docs/adr/0017-mail-delivery.md D1、D2）。
 */
@Injectable()
export class SmtpMailTransport extends MailTransport implements OnApplicationShutdown {
  private readonly transporter;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.transporter = createTransport(config.get('MAIL_SMTP_URL', { infer: true }), {
      from: config.get('MAIL_FROM', { infer: true }),
    });
  }

  async send(message: MailMessage): Promise<SentMail> {
    const info = await this.transporter.sendMail(message);
    return { messageId: info.messageId };
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
