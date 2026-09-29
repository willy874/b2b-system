import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

import type { Env } from '../config';
import { MailTransport } from './mail-transport';
import type { SentMail } from './mail-transport';

/** 範本產生的一封信：主旨 ＋ React Email 元素。 */
export interface MailContent {
  subject: string;
  body: ReactElement;
}

/**
 * 把範本轉成 HTML ＋ 純文字並交給傳輸層。範本本身屬於擁有它的模組
 * （`modules/<name>/mails/*.mail.tsx`），這裡不認識任何一封信。
 */
@Injectable()
export class MailService {
  private readonly appUrl: string;

  constructor(
    private readonly transport: MailTransport,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true });
  }

  /** 信裡的連結：`APP_PUBLIC_URL` ＋ 前端路徑 ＋ 查詢字串。 */
  link(path: string, query: Record<string, string> = {}): string {
    const url = new URL(`${this.appUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  async send(to: string, { subject, body }: MailContent): Promise<SentMail> {
    const [html, text] = await Promise.all([render(body), render(body, { plainText: true })]);
    return this.transport.send({ to, subject, html, text });
  }
}
