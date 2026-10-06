import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { IDP_SECRET_PURPOSE, SecretBox, TENANT_SECRET_PURPOSE } from '../secret-box';

describe('SecretBox（docs/architecture/04-sso.md §12.2 D11、0020 D4）', () => {
  const key = randomBytes(32).toString('base64');
  const box = (secret: string | undefined, seed = 'unused', purpose = IDP_SECRET_PURPOSE) =>
    SecretBox.fromConfig(secret, seed, purpose);

  it('加密後解得回原文；同一個原文每次的密文都不同', () => {
    const a = box(key).encrypt('client-secret');
    const b = box(key).encrypt('client-secret');
    expect(a).not.toBe(b);
    expect(box(key).decrypt(a)).toBe('client-secret');
  });

  it('密文被竄改或換了金鑰就解不開', () => {
    const sealed = box(key).encrypt('client-secret');
    const [iv, tag, data] = sealed.split('.');
    const tampered = [iv, tag, `${data!.slice(0, -2)}AA`].join('.');
    expect(() => box(key).decrypt(tampered)).toThrow();
    expect(() => box(randomBytes(32).toString('base64')).decrypt(sealed)).toThrow();
  });

  it('沒有主金鑰時由 seed 推導固定金鑰（重啟後仍解得開）', () => {
    const sealed = box(undefined, 'jwt-secret-seed').encrypt('x');
    expect(box(undefined, 'jwt-secret-seed').decrypt(sealed)).toBe('x');
  });

  it('沒有主金鑰、也不允許推導（production）：建立時不失敗，加解密時指出缺哪個環境變數', () => {
    const locked = SecretBox.fromConfig(undefined, null, IDP_SECRET_PURPOSE);
    expect(() => locked.encrypt('x')).toThrow(/IDP_SECRET_KEY/);
    expect(() => locked.decrypt(box(key).encrypt('x'))).toThrow(/IDP_SECRET_KEY/);
  });

  it('不同用途推導出不同的金鑰：IdP 的金鑰解不開租戶的密文', () => {
    const sealed = box(undefined, 'jwt-secret-seed', TENANT_SECRET_PURPOSE).encrypt('x');
    expect(() => box(undefined, 'jwt-secret-seed', IDP_SECRET_PURPOSE).decrypt(sealed)).toThrow();
  });

  it('金鑰長度不對時啟動失敗，訊息指出是哪個環境變數', () => {
    expect(() => box(randomBytes(16).toString('base64'), 'x', TENANT_SECRET_PURPOSE)).toThrow(
      /TENANT_SECRET_KEY 必須是 32 bytes/,
    );
  });
});
