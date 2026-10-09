import { lazy } from 'react';

import type { MfaMethodUi } from '../../registry';

/** 內建的方式：簡訊驗證碼（docs/architecture/backend/21-mfa.md §9.4）。兩個 app 在 `app/plugin.ts` 登記。 */
export const smsMethod: MfaMethodUi = {
  id: 'sms',
  labelKey: 'mfa.method.sms.label',
  descriptionKey: 'mfa.method.sms.description',
  icon: 'smartphone',
  EnrollStart: lazy(() => import('./SmsEnrollStart')),
  Enroll: lazy(() => import('./SmsEnroll')),
  Challenge: lazy(() => import('./SmsChallenge')),
};
