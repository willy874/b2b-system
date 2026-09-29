/** 一封已經產生好內容的信。 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** 純文字版本：不支援 HTML 的收信端、以及 console 傳輸的日誌都用它。 */
  text: string;
}

export interface SentMail {
  /** 傳輸層回傳的訊息 id（SMTP 的 Message-ID）；追查退信時用。 */
  messageId: string;
}

/**
 * 寄信的抽象層（同時是 DI token），與 `ObjectStorage` 同構：實作由 `MAIL_TRANSPORT` 決定，
 * 注入端只認這個類別（docs/architecture/backend/11-mail.md §2）。
 */
export abstract class MailTransport {
  abstract send(message: MailMessage): Promise<SentMail>;
}
