import { lazy } from 'react';

import type { MfaMethodUi } from '../../registry';

/**
 * 內建的方式：WebAuthn（安全金鑰、通行金鑰；docs/architecture/backend/21-mfa.md §9.3）。
 * 憑證綁 apps/platform 的網域：apps/platform 直接設定，backstage 經 `MfaSelfApi.enrollElsewhere` 改走「重新登入並新增」（§7.1）。
 */
export const webauthnMethod: MfaMethodUi = {
  id: 'webauthn',
  labelKey: 'mfa.method.webauthn.label',
  descriptionKey: 'mfa.method.webauthn.description',
  icon: 'key',
  Enroll: lazy(() => import('./WebAuthnEnroll')),
  Challenge: lazy(() => import('./WebAuthnChallenge')),
};
