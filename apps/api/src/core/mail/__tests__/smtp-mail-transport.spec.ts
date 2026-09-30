import { createTransport } from 'nodemailer';
import { describe, expect, it } from 'vitest';

import { MAIL_JOB_OPTIONS } from '../mail-transport';
import { smtpOptionsOf } from '../smtp-mail-transport';

describe('SMTP 連線池（docs/architecture/backend/11-mail.md §2）', () => {
  it('以 pool 模式連線，連線數取自設定；網址裡的主機與帳密照常解析', () => {
    const transporter = createTransport(smtpOptionsOf('smtps://user:pass@smtp.example.com:465', 3));
    const pool = transporter.transporter as unknown as {
      name: string;
      options: { maxConnections: number; host: string; secure: boolean };
    };
    try {
      expect(pool.name).toBe('SMTP (pool)');
      expect(pool.options).toMatchObject({
        maxConnections: 3,
        host: 'smtp.example.com',
        secure: true,
      });
    } finally {
      transporter.close();
    }
  });

  it('寄信工作的並行數不超過連線池的預設大小', () => {
    expect(MAIL_JOB_OPTIONS.concurrency).toBeGreaterThan(1);
    expect(MAIL_JOB_OPTIONS.concurrency).toBeLessThanOrEqual(5);
  });
});
