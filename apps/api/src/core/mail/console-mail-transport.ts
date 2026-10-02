import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { MailTransport } from './mail-transport';
import type { MailMessage, SentMail } from './mail-transport';

/**
 * 不寄出，只把收件人、主旨與純文字內容寫進日誌。內容含啟用／重設連結，
 * 所以只能用在測試與開發；正式環境一律 `smtp`，日誌不會出現能登入的 token
 * （docs/architecture/backend/11-mail.md §9.2 D7）。
 */
@Injectable()
export class ConsoleMailTransport extends MailTransport {
  private readonly logger = new Logger(ConsoleMailTransport.name);

  send(message: MailMessage): Promise<SentMail> {
    const messageId = `<${randomUUID()}@console>`;
    this.logger.log(`寄給 ${message.to}：${message.subject}\n${message.text}`);
    return Promise.resolve({ messageId });
  }
}
