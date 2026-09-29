import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretBox } from '../secret-box';

describe('SecretBox（docs/adr/0019-sso-identity-platform.md D11）', () => {
  const key = randomBytes(32).toString('base64');

  it('加密後解得回原文；同一個原文每次的密文都不同', () => {
    const box = SecretBox.fromConfig(key, 'unused');
    const a = box.encrypt('client-secret');
    const b = box.encrypt('client-secret');
    expect(a).not.toBe(b);
    expect(box.decrypt(a)).toBe('client-secret');
  });

  it('密文被竄改或換了金鑰就解不開', () => {
    const sealed = SecretBox.fromConfig(key, 'unused').encrypt('client-secret');
    const [iv, tag, data] = sealed.split('.');
    const tampered = [iv, tag, `${data!.slice(0, -2)}AA`].join('.');
    expect(() => SecretBox.fromConfig(key, 'unused').decrypt(tampered)).toThrow();
    const other = SecretBox.fromConfig(randomBytes(32).toString('base64'), 'unused');
    expect(() => other.decrypt(sealed)).toThrow();
  });

  it('沒有 IDP_SECRET_KEY 時由 seed 推導固定金鑰（重啟後仍解得開）', () => {
    const sealed = SecretBox.fromConfig(undefined, 'jwt-secret-seed').encrypt('x');
    expect(SecretBox.fromConfig(undefined, 'jwt-secret-seed').decrypt(sealed)).toBe('x');
  });

  it('金鑰長度不對時啟動失敗', () => {
    expect(() => SecretBox.fromConfig(randomBytes(16).toString('base64'), 'x')).toThrow(/32 bytes/);
  });
});
