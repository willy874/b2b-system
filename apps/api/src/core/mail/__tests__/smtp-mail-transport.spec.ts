import type { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import { MAIL_JOB_OPTIONS } from '../mail-transport';
import { SmtpMailTransport, smtpOptionsOf } from '../smtp-mail-transport';

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

/** nodemailer 的 `Mail` 底下真正送信的連線池；換成假的，不連 SMTP。 */
interface PoolLike {
  send: (
    mail: { data: Record<string, unknown> },
    callback: (error: Error | null, info?: { messageId: string }) => void,
  ) => void;
  close: () => void;
}

function smtpTransport() {
  const config = {
    get: vi.fn(
      (key: string) =>
        ({
          MAIL_SMTP_URL: 'smtp://user:pass@smtp.example.com:587',
          MAIL_SMTP_POOL_SIZE: 2,
          MAIL_FROM: 'B2B System <no-reply@example.com>',
        })[key],
    ),
  } as unknown as ConfigService<Env, true>;
  const transport = new SmtpMailTransport(config);
  const pool = (transport as unknown as { transporter: { transporter: PoolLike } }).transporter
    .transporter;
  const sent: Array<Record<string, unknown>> = [];
  vi.spyOn(pool, 'send').mockImplementation((mail, callback) => {
    sent.push(mail.data);
    callback(null, { messageId: '<smtp-1@example.com>' });
  });
  const close = vi.spyOn(pool, 'close');
  return { transport, sent, close };
}

describe('SmtpMailTransport（docs/architecture/backend/11-mail.md §9.2 D1）', () => {
  const message = { to: 'alice@example.com', subject: '主旨', html: '<p>hi</p>', text: 'hi' };

  it('send() 交出收件人、主旨、HTML 與純文字，寄件者用 MAIL_FROM', async () => {
    const { transport, sent } = smtpTransport();
    try {
      await transport.send(message);
      expect(sent[0]).toMatchObject({ ...message, from: 'B2B System <no-reply@example.com>' });
    } finally {
      transport.onApplicationShutdown();
    }
  });

  it('send() 回傳 SMTP 的 Message-ID', async () => {
    const { transport } = smtpTransport();
    try {
      await expect(transport.send(message)).resolves.toEqual({
        messageId: '<smtp-1@example.com>',
      });
    } finally {
      transport.onApplicationShutdown();
    }
  });

  it('SMTP 失敗時 send() 拒絕（寄信工作據此重試）', async () => {
    const { transport } = smtpTransport();
    const pool = (transport as unknown as { transporter: { transporter: PoolLike } }).transporter
      .transporter;
    vi.mocked(pool.send).mockImplementation((_mail, callback) => callback(new Error('421')));
    try {
      await expect(transport.send(message)).rejects.toThrow('421');
    } finally {
      transport.onApplicationShutdown();
    }
  });

  it('程序關閉時關掉連線池', () => {
    const { transport, close } = smtpTransport();
    transport.onApplicationShutdown();
    expect(close).toHaveBeenCalled();
  });
});
