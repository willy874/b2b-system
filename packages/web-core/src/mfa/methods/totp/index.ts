import { lazy } from 'react';

import type { MfaMethodUi } from '../../registry';

/** 內建的方式：驗證器 App（TOTP）。兩個 app 在 `app/plugin.ts` 以 `registerMfaMethod(totpMethod)` 登記。 */
export const totpMethod: MfaMethodUi = {
  id: 'totp',
  labelKey: 'mfa.method.totp.label',
  descriptionKey: 'mfa.method.totp.description',
  icon: 'smartphone',
  Enroll: lazy(() => import('./TotpEnroll')),
  Challenge: lazy(() => import('./TotpChallenge')),
};
