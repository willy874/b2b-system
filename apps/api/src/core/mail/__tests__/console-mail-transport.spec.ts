import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleMailTransport } from '../console-mail-transport';
import type { MailMessage } from '../mail-transport';

const message: MailMessage = {
  to: 'alice@example.com',
  subject: '重設密碼',
  html: '<p>請點連結</p>',
  text: '請點連結 https://example.com/reset?token=abc',
};

describe('ConsoleMailTransport（docs/architecture/backend/11-mail.md §9.2 D7）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('不寄出，把收件人、主旨與純文字內容寫進日誌', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    await new ConsoleMailTransport().send(message);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain('alice@example.com');
    expect(line).toContain('重設密碼');
    expect(line).toContain('https://example.com/reset?token=abc');
  });

  it('日誌不含 HTML 版本', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    await new ConsoleMailTransport().send(message);
    expect(String(log.mock.calls[0]?.[0])).not.toContain('<p>');
  });

  it('回傳 Message-ID 形狀的 id，每封都不同', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const transport = new ConsoleMailTransport();
    const [first, second] = await Promise.all([transport.send(message), transport.send(message)]);
    expect(first.messageId).toMatch(/^<[0-9a-f-]{36}@console>$/);
    expect(first.messageId).not.toBe(second.messageId);
  });
});
