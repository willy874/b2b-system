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
  private readonly authAppUrl: string;

  constructor(
    private readonly transport: MailTransport,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true });
    this.authAppUrl = config.get('AUTH_APP_URL', { infer: true });
  }

  /** 信裡連到產品的連結：`APP_PUBLIC_URL` ＋ 前端路徑 ＋ 查詢字串。 */
  link(path: string, query: Record<string, string> = {}): string {
    return this.build(this.appUrl, path, query);
  }

  /**
   * 帳號流程的連結（啟用、重設密碼、接受邀請）：`AUTH_APP_URL` ＋ 路徑。帳號屬於平台，
   * 這些頁面在 apps/auth（docs/adr/0019-sso-identity-platform.md D1）。
   */
  accountLink(path: string, query: Record<string, string> = {}): string {
    return this.build(this.authAppUrl, path, query);
  }

  private build(base: string, path: string, query: Record<string, string>): string {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  async send(to: string, { subject, body }: MailContent): Promise<SentMail> {
    const [html, text] = await Promise.all([render(body), render(body, { plainText: true })]);
    return this.transport.send({ to, subject, html, text });
  }
}
