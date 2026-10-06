import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { render, Text } from 'react-email';
import { describe, expect, it } from 'vitest';

import { MailLayout } from '../mail-layout';
import { MAIL_FOOTER } from '../mail-locale';
import type { MailLocale } from '../mail-locale';

/** 測試檔是 .ts（vitest 只收 *.spec.ts），不用 JSX；children 走 createElement 的第三個參數。 */
function layout(locale: MailLocale): Promise<string> {
  return render(
    createElement(
      MailLayout,
      { locale, preview: '收信匣摘要', footer: MAIL_FOOTER[locale] } as ComponentProps<
        typeof MailLayout
      >,
      createElement(Text, null, '信件內文'),
    ),
  );
}

describe('MailLayout（所有信共用的外框）', () => {
  it.each(['zh-TW', 'en-US'] as const)('html 與 body 都標上收件人的語系 %s', async (locale) => {
    const html = await layout(locale);
    expect(html).toMatch(new RegExp(`<html[^>]*lang="${locale}"`));
    expect(html).toMatch(new RegExp(`<body[^>]*lang="${locale}"`));
  });

  it('包含內文、摘要與頁尾', async () => {
    const html = await layout('zh-TW');
    expect(html).toContain('信件內文');
    expect(html).toContain('收信匣摘要');
    expect(html).toContain(MAIL_FOOTER['zh-TW']);
  });

  it('樣式寫成行內（收信端多半不支援 <style>）', async () => {
    const html = await layout('en-US');
    expect(html).toMatch(/<body[^>]*style="[^"]*background-color/);
  });
});
