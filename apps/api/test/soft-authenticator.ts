import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * 整合測試用的軟體驗證器（WebAuthn）：產生 P-256 金鑰、做出瀏覽器 `navigator.credentials` 的回應
 * （`@simplewebauthn/browser` 的 JSON 形狀），讓 api 以真的 `@simplewebauthn/server` 驗證。
 * 註冊用 attestation `none`；每次簽章計數 +1（同步型的通行金鑰是 0，可以用 `syncedCounter` 模擬）。
 */

// ── 最小的 CBOR 編碼（attestationObject 與 COSE 公鑰要用到的型別）──────────────

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue> | CborObject;
interface CborObject {
  [key: string]: CborValue;
}

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = (major << 5) | 25;
    buffer.writeUInt16BE(length, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = (major << 5) | 26;
  buffer.writeUInt32BE(length, 1);
  return buffer;
}

function cbor(value: CborValue): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)]),
  ]);
}

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

export interface SoftCredential {
  id: string;
  privateKey: KeyObject;
  userHandle: string;
  counter: number;
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
  user: { id: string };
}

export interface AuthenticationOptions {
  challenge: string;
  rpId?: string;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

function authData(rpId: string, flags: number, counter: number, attested?: Buffer): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter, 0);
  return Buffer.concat([
    createHash('sha256').update(rpId).digest(),
    Buffer.from([flags]),
    count,
    ...(attested ? [attested] : []),
  ]);
}

export class SoftAuthenticator {
  readonly credentials: SoftCredential[] = [];

  constructor(
    private readonly origin: string,
    private readonly options: { userVerified?: boolean; syncedCounter?: boolean } = {},
  ) {}

  private flags(): number {
    return FLAG_UP | (this.options.userVerified === false ? 0 : FLAG_UV);
  }

  /** `navigator.credentials.create` 的回應（`startRegistration` 的結果）。 */
  register(options: RegistrationOptions): Record<string, unknown> {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = randomBytes(16);
    const cose = cbor(
      new Map<CborValue, CborValue>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credentialId.length, 0);
    const attested = Buffer.concat([Buffer.alloc(16), idLength, credentialId, cose]);
    const data = authData(options.rp.id, this.flags() | FLAG_AT, 0, attested);
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: this.origin,
      crossOrigin: false,
    });
    const id = b64url(credentialId);
    this.credentials.push({ id, privateKey, userHandle: options.user.id, counter: 0 });
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(cbor({ fmt: 'none', attStmt: {}, authData: data })),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /**
   * `navigator.credentials.get` 的回應（`startAuthentication` 的結果）。沒指定憑證時用最後註冊的那一個；
   * 回應帶 user handle（discoverable credential 的流程靠它找帳號），`userHandle` 可以覆寫來模擬竄改。
   */
  authenticate(
    options: AuthenticationOptions,
    rpId: string,
    override: { credential?: SoftCredential; userHandle?: string } = {},
  ): Record<string, unknown> {
    const credential = override.credential ?? this.credentials.at(-1);
    if (!credential) throw new Error('還沒有註冊任何憑證');
    if (!this.options.syncedCounter) credential.counter += 1;
    const data = authData(options.rpId ?? rpId, this.flags(), credential.counter);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const signature = sign(
      'sha256',
      Buffer.concat([data, createHash('sha256').update(clientDataJSON).digest()]),
      credential.privateKey,
    );
    return {
      id: credential.id,
      rawId: credential.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(data),
        signature: b64url(signature),
        userHandle: override.userHandle ?? credential.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
