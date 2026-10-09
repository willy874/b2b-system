/** 通訊軟體訊息的內容（帳號語系是中文時用中文）。 */
export function messagingCodeText(input: {
  locale: string;
  issuer: string;
  code: string;
  minutes: number;
}): string {
  if (input.locale.toLowerCase().startsWith('zh')) {
    return `【${input.issuer}】驗證碼：${input.code}\n${input.minutes} 分鐘內有效。請勿提供給任何人；如果不是你本人在登入，請立即變更密碼。`;
  }
  return `[${input.issuer}] Verification code: ${input.code}\nIt expires in ${input.minutes} minutes. Never share it. If you are not signing in, change your password now.`;
}

/** webhook 回覆使用者的訊息：此時不知道帳號的語系，中英並列。 */
export const LINKED_REPLY =
  '已完成綁定，請回到網頁按「傳送驗證碼」。\nLinked. Go back to the page and request a verification code.';
export const LINK_INVALID_REPLY =
  '綁定碼無效或已過期，請回到網頁重新開始設定。\nThis link code is invalid or expired. Start the setup again.';
