import { lazy } from 'react';

import type { MfaMethodUi } from '../../registry';

/** 內建的方式：Email 驗證碼。兩個 app 在 `app/plugin.ts` 以 `registerMfaMethod(emailMethod)` 登記。 */
export const emailMethod: MfaMethodUi = {
  id: 'email',
  labelKey: 'mfa.method.email.label',
  descriptionKey: 'mfa.method.email.description',
  icon: 'mail',
  Enroll: lazy(() => import('./EmailEnroll')),
  Challenge: lazy(() => import('./EmailChallenge')),
};
