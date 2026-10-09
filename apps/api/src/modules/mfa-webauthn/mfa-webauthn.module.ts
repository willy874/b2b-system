import { Module } from '@nestjs/common';

import { WebAuthnMfaMethod } from './webauthn.method';

/** MFA 的方式：WebAuthn（安全金鑰、通行金鑰；docs/architecture/backend/21-mfa.md §9.3）。`AppModule` 匯入，啟動時登記進註冊表。 */
@Module({ providers: [WebAuthnMfaMethod] })
export class MfaWebAuthnModule {}
