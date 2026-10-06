import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Env } from '../../config/env.schema';
import { defineSetting, resolveSetting, SettingCategory } from '../setting-definition';
import type { EnvReader } from '../setting-definition';

/** 只認得 `FILE_UPLOAD_MAX_SIZE` 的 env。 */
function envWith(maxSize: number): EnvReader & ReturnType<typeof vi.fn> {
  return vi.fn(<K extends keyof Env>(key: K) =>
    key === 'FILE_UPLOAD_MAX_SIZE' ? (maxSize as Env[K]) : (undefined as Env[K]),
  ) as unknown as EnvReader & ReturnType<typeof vi.fn>;
}

const STATIC = defineSetting({
  key: 'auth.loginMaxAttempts',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(3).max(20),
  defaultValue: 5,
  isPublic: false,
});

const ENV_DEPENDENT = defineSetting({
  key: 'file.uploadMaxSize',
  category: SettingCategory.FILE,
  schema: (env) => z.number().int().min(1).max(env('FILE_UPLOAD_MAX_SIZE')),
  defaultValue: (env) => env('FILE_UPLOAD_MAX_SIZE'),
  isPublic: true,
});

describe('resolveSetting（docs/architecture/backend/12-settings.md §2）', () => {
  it('靜態定義：schema 與預設值原樣帶出，key／分類／公開與否不變', () => {
    const resolved = resolveSetting(STATIC, envWith(1000));
    expect(resolved).toMatchObject({
      key: 'auth.loginMaxAttempts',
      category: 'auth',
      defaultValue: 5,
      isPublic: false,
    });
    expect(resolved.schema).toBe(STATIC.schema);
  });

  it('env 相依的預設值取自 env', () => {
    expect(resolveSetting(ENV_DEPENDENT, envWith(1000)).defaultValue).toBe(1000);
  });

  it.each([
    [1, true],
    [1000, true],
    [1001, false],
    [0, false],
    [1.5, false],
  ])('env 相依的範圍：上限取自 env（%s → %s）', (value, ok) => {
    const { schema } = resolveSetting(ENV_DEPENDENT, envWith(1000));
    expect(schema.safeParse(value).success).toBe(ok);
  });

  it('不同的 env 算出不同的範圍', () => {
    expect(resolveSetting(ENV_DEPENDENT, envWith(50)).schema.safeParse(100).success).toBe(false);
    expect(resolveSetting(ENV_DEPENDENT, envWith(500)).schema.safeParse(100).success).toBe(true);
  });

  it('預設值不符合 schema → 拋錯，訊息含設定的 key', () => {
    const broken = defineSetting({ ...STATIC, key: 'auth.broken', defaultValue: 99 });
    expect(() => resolveSetting(broken, envWith(1000))).toThrow(/auth\.broken/);
  });

  it('env 的上限比預設值小 → 拋錯（啟動時就失敗）', () => {
    const tight = defineSetting({ ...ENV_DEPENDENT, defaultValue: 2000 });
    expect(() => resolveSetting(tight, envWith(1000))).toThrow(/file\.uploadMaxSize/);
  });

  it('預設值經過 schema 的轉換（例：trim）後才存進定義', () => {
    const trimmed = defineSetting({
      key: 'general.name',
      category: SettingCategory.GENERAL,
      schema: z.string().trim().min(1),
      defaultValue: '  Acme  ',
      isPublic: true,
    });
    expect(resolveSetting(trimmed, envWith(0)).defaultValue).toBe('Acme');
  });

  it('不是 env 相依的定義不讀 env', () => {
    const env = envWith(1000);
    resolveSetting(STATIC, env);
    expect(env).not.toHaveBeenCalled();
  });
});

describe('defineSetting', () => {
  it('原樣回傳定義（只用來推導值的型別）', () => {
    expect(defineSetting(STATIC)).toBe(STATIC);
  });
});
