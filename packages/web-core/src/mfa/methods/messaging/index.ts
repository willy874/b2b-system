import { lazy } from 'react';

import type { MfaMethodUi } from '../../registry';

/** 內建的方式：Telegram 驗證碼（docs/architecture/backend/21-mfa.md §9.5）。兩個 app 在 `app/plugin.ts` 登記。 */
export const telegramMethod: MfaMethodUi = {
  id: 'telegram',
  labelKey: 'mfa.method.telegram.label',
  descriptionKey: 'mfa.method.telegram.description',
  icon: 'bot',
  Enroll: lazy(() => import('./TelegramEnroll')),
  Challenge: lazy(() => import('./TelegramChallenge')),
};

/** 內建的方式：LINE 驗證碼（docs/architecture/backend/21-mfa.md §9.5）。 */
export const lineMethod: MfaMethodUi = {
  id: 'line',
  labelKey: 'mfa.method.line.label',
  descriptionKey: 'mfa.method.line.description',
  icon: 'bot',
  Enroll: lazy(() => import('./LineEnroll')),
  Challenge: lazy(() => import('./LineChallenge')),
};
