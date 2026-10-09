import type { MfaSettingsCheck, MfaSettingValues } from '@/core/mfa';

/** 從 webhook 收到的一則訊息：誰（收件對象）、說了什麼。 */
export interface InboundMessage {
  /** 之後送驗證碼的對象（Telegram 的 chat id、LINE 的 user id）。 */
  recipient: string;
  /** 顯示名稱（Telegram 的 `@username`）；沒有時是 null。 */
  recipientName: string | null;
  text: string;
  /** 回覆用的權杖（LINE 的 reply token）；Telegram 直接以 chat id 回覆。 */
  replyToken?: string;
}

/** 設定頁要顯示的綁定方式：連結、QR code 的內容、要傳給 Bot 的綁定碼。 */
export interface LinkInstructions {
  /** 點了就開啟 App 並帶入綁定碼（Telegram 的 `t.me/<bot>?start=<碼>`、LINE 的 `oaMessage`）。 */
  linkUrl: string;
  /** 先加入好友的連結（LINE）；Telegram 不需要。 */
  addFriendUrl?: string;
  /** 手動輸入時要傳的文字。 */
  code: string;
  /** Bot 的名稱（`@b2b_bot`、LINE 的 `@123abcde`）。 */
  botName: string;
}

/**
 * 一種通訊軟體（docs/architecture/backend/21-mfa.md §9.5）：送訊息、產生綁定的說明、解析 webhook。
 * Telegram、LINE 各一個實作；綁定、送碼的流程在 `MessagingMfaMethod`，兩者共用。
 */
export interface MessagingChannel {
  readonly id: 'telegram' | 'line';
  /** 綁定碼：Telegram 的 start 參數只接受 `[A-Za-z0-9_-]`；LINE 要使用者手動傳，取短一點、好輸入的。 */
  newLinkCode(): string;
  /** 比對前的正規化（大小寫、連字號、容易混淆的字元）。 */
  normalizeLinkCode(text: string): string | null;
  linkInstructions(settings: MfaSettingValues, code: string): LinkInstructions;
  sendText(settings: MfaSettingValues, recipient: string, text: string): Promise<void>;
  reply(settings: MfaSettingValues, message: InboundMessage, text: string): Promise<void>;
  /** 儲存參數前的檢查：以 token 呼叫 API、登記 webhook；`derived` 是要一起存的 Bot 名稱。 */
  check(settings: MfaSettingValues, webhookUrl: string): Promise<MfaSettingsCheck>;
}

/** 通訊軟體 API 的錯誤：工作會重試。 */
export class MessagingDeliveryError extends Error {}

export const MESSAGING_REQUEST_TIMEOUT_MS = 10_000;
