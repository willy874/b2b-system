/** 安全通知信的事件（docs/architecture/backend/21-mfa.md §7）：本人會收到信，被盜用時才發現得了。 */
export type MfaSecurityEvent =
  | 'factorAdded'
  | 'factorRemoved'
  | 'recoveryCodesRegenerated'
  | 'recoveryCodeUsed'
  | 'reset';
