import type { ReactNode } from 'react';
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from 'react-email';

import type { MailLocale } from './mail-locale';

interface MailLayoutProps {
  locale: MailLocale;
  /** 收信匣列表裡、主旨後面顯示的摘要 */
  preview: string;
  /** 頁尾（例：「這是系統自動寄出的信，請勿直接回覆。」） */
  footer: string;
  children: ReactNode;
}

/**
 * 所有信共用的外框。信件的 CSS 必須寫成行內樣式（多數收信端不支援 `<style>`），
 * 色碼也只能寫死——這裡不是瀏覽器，沒有 Design Token。
 */
export function MailLayout({ locale, preview, footer, children }: MailLayoutProps) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      {/* Body 沒給 lang 時會自己標成 en（react-email 6.5），要跟 Html 一樣用收件人的語系 */}
      <Body lang={locale} style={body}>
        <Container style={container}>
          <Text style={brand}>B2B System</Text>
          <Section>{children}</Section>
          <Hr style={divider} />
          <Text style={footerText}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: '#f4f5f7', fontFamily: 'system-ui, sans-serif', margin: 0 };
const container = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  margin: '32px auto',
  maxWidth: '520px',
  padding: '32px',
};
const brand = { color: '#1f2937', fontSize: '18px', fontWeight: 600, margin: '0 0 24px' };
// Hr 預設的 borderTop 寫在 borderColor 後面（react-email 6.1.1），只覆寫 borderColor 會被蓋掉，所以整條覆寫
const divider = { borderTop: '1px solid #e5e7eb', margin: '32px 0 16px' };
const footerText = { color: '#6b7280', fontSize: '12px', margin: 0 };

/** 範本共用的樣式：主要按鈕與內文。 */
export const MAIL_STYLES = {
  text: { color: '#1f2937', fontSize: '14px', lineHeight: '24px' },
  muted: { color: '#6b7280', fontSize: '12px', lineHeight: '20px' },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '10px 20px',
    textDecoration: 'none',
  },
} as const;
