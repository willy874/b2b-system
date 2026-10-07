import { randomBytes } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';

import { AccessTokenKeys } from '../access-token.keys';

const LEGACY = 'legacy-secret-that-is-long-enough-32ch!!';
const key = () => randomBytes(48).toString('base64');

function keysWith(env: Record<string, string | undefined>): AccessTokenKeys {
  const values: Record<string, string | undefined> = {
    API_SURFACE: 'internal',
    NODE_ENV: 'production',
    ...env,
  };
  const config = { get: (name: string) => values[name] } as unknown as ConfigService<never, true>;
  return new AccessTokenKeys(new JwtService(), config);
}

const PAYLOAD = { sub: 'user-1', ver: 0, jti: 'j', tid: 'tenant-1' };

describe('AccessTokenKeys（docs/architecture/backend/04-auth.md §11）', () => {
  it('簽發時 header 帶第一把的 kid；同一組金鑰環驗得過', async () => {
    const keys = keysWith({
      JWT_SIGNING_KEYS: `k2:${key()},k1:${key()}`,
      PLATFORM_JWT_SIGNING_KEYS: `p1:${key()}`,
    });
    const token = await keys.sign('tenant', PAYLOAD, 60);
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()) as {
      kid: string;
      alg: string;
    };
    expect(header).toMatchObject({ kid: 'k2', alg: 'HS256' });
    await expect(keys.verify('tenant', token)).resolves.toMatchObject(PAYLOAD);
  });

  it('輪替：舊金鑰排到第二把仍驗得過；從金鑰環拿掉之後就不行', async () => {
    const oldKey = key();
    const before = keysWith({
      JWT_SIGNING_KEYS: `old:${oldKey}`,
      PLATFORM_JWT_SIGNING_KEYS: `p1:${key()}`,
    });
    const token = await before.sign('tenant', PAYLOAD, 60);
    const rotating = keysWith({
      JWT_SIGNING_KEYS: `new:${key()},old:${oldKey}`,
      PLATFORM_JWT_SIGNING_KEYS: `p1:${key()}`,
    });
    await expect(rotating.verify('tenant', token)).resolves.toMatchObject(PAYLOAD);
    const rotated = keysWith({
      JWT_SIGNING_KEYS: `new:${key()}`,
      PLATFORM_JWT_SIGNING_KEYS: `p1:${key()}`,
    });
    await expect(rotated.verify('tenant', token)).resolves.toBeUndefined();
  });

  it('租戶的金鑰簽的 token 在平台的金鑰環驗不過（即使 kid 相同）', async () => {
    const keys = keysWith({
      JWT_SIGNING_KEYS: `same:${key()}`,
      PLATFORM_JWT_SIGNING_KEYS: `same:${key()}`,
    });
    const token = await keys.sign('tenant', PAYLOAD, 60);
    await expect(keys.verify('platform', token)).resolves.toBeUndefined();
  });

  it('未知的 kid、alg: none 一律拒絕', async () => {
    const keys = keysWith({
      JWT_SIGNING_KEYS: `k1:${key()}`,
      PLATFORM_JWT_SIGNING_KEYS: `p1:${key()}`,
    });
    const unknown = await new JwtService().signAsync(PAYLOAD, { secret: key(), keyid: 'nope' });
    await expect(keys.verify('tenant', unknown)).resolves.toBeUndefined();
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'k1' })).toString('base64url')}.${Buffer.from(JSON.stringify(PAYLOAD)).toString('base64url')}.`;
    await expect(keys.verify('tenant', none)).resolves.toBeUndefined();
  });

  it('過渡期：沒有 kid 的舊 token 以 JWT_SECRET 驗證；拿掉 JWT_SECRET 之後拒絕', async () => {
    const legacyToken = await new JwtService().signAsync(PAYLOAD, { secret: LEGACY });
    const ring = { JWT_SIGNING_KEYS: `k1:${key()}`, PLATFORM_JWT_SIGNING_KEYS: `p1:${key()}` };
    await expect(
      keysWith({ ...ring, JWT_SECRET: LEGACY }).verify('tenant', legacyToken),
    ).resolves.toMatchObject(PAYLOAD);
    await expect(keysWith(ring).verify('tenant', legacyToken)).resolves.toBeUndefined();
  });

  it('開發環境沒設金鑰環 → 由 JWT_SECRET 推導，租戶與平台各一把', async () => {
    const keys = keysWith({ NODE_ENV: 'development', JWT_SECRET: LEGACY });
    const tenant = await keys.sign('tenant', PAYLOAD, 60);
    await expect(keys.verify('tenant', tenant)).resolves.toMatchObject(PAYLOAD);
    await expect(keys.verify('platform', tenant)).resolves.toBeUndefined();
    // 推導出的金鑰不是 JWT_SECRET 本身
    await expect(new JwtService().verifyAsync(tenant, { secret: LEGACY })).rejects.toThrow();
  });

  it('對外 API 的程序沒有金鑰：不能簽，舊 token 與新 token 都驗不過', async () => {
    const keys = keysWith({ API_SURFACE: 'external', NODE_ENV: 'development', JWT_SECRET: LEGACY });
    await expect(keys.sign('tenant', PAYLOAD, 60)).rejects.toThrow();
    const legacyToken = await new JwtService().signAsync(PAYLOAD, { secret: LEGACY });
    await expect(keys.verify('tenant', legacyToken)).resolves.toBeUndefined();
  });
});
