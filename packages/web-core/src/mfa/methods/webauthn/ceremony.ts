import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import type { MfaChallengeInfo } from '../../types';

/**
 * 瀏覽器 API 的封裝（docs/architecture/backend/21-mfa.md §9.3）：`@simplewebauthn/browser` 只在這個方式的元件載入。
 * 伺服器在 challenge 的 `publicData.options` 給 options，結果原樣送回（`payload.response`），由伺服器驗證。
 */
function optionsOf<T>(challenge: MfaChallengeInfo | null): T | undefined {
  const options = challenge?.publicData?.options;
  return options && typeof options === 'object' ? (options as T) : undefined;
}

export async function register(challenge: MfaChallengeInfo | null): Promise<unknown> {
  const optionsJSON = optionsOf<PublicKeyCredentialCreationOptionsJSON>(challenge);
  if (!optionsJSON) throw new Error('missing registration options');
  const { startRegistration } = await import('@simplewebauthn/browser');
  return startRegistration({ optionsJSON });
}

export async function authenticate(challenge: MfaChallengeInfo | null): Promise<unknown> {
  const optionsJSON = optionsOf<PublicKeyCredentialRequestOptionsJSON>(challenge);
  if (!optionsJSON) throw new Error('missing authentication options');
  const { startAuthentication } = await import('@simplewebauthn/browser');
  return startAuthentication({ optionsJSON });
}

/** challenge 已過期或還沒有：要先向伺服器重新取得。 */
export function isExpired(challenge: MfaChallengeInfo | null): challenge is null {
  return !challenge || new Date(challenge.expiresAt).getTime() <= Date.now();
}

export function supportsWebAuthn(): boolean {
  return typeof globalThis.PublicKeyCredential === 'function';
}

/** 瀏覽器回報的錯誤 → 語系 key：使用者取消或逾時、這把金鑰已經註冊過、其他。 */
export function ceremonyErrorKey(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'mfa.webauthn.cancelled';
  if (name === 'InvalidStateError') return 'mfa.webauthn.alreadyRegistered';
  return 'mfa.webauthn.failed';
}
