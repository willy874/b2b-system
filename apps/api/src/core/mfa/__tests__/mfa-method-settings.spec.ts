import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MfaMethod, MfaMethodDefinition, MfaMethodSettingsSpec } from '../mfa-method';
import {
  assertSettingsSpec,
  isSettingRequired,
  MfaMethodSettings,
  validateSettingValues,
} from '../mfa-method-settings';
import { MfaMethodRegistry } from '../mfa-method.registry';

const SPEC: MfaMethodSettingsSpec = {
  fields: [
    { key: 'provider', type: 'select', required: true, options: ['twilio', 'webhook'] },
    {
      key: 'sid',
      type: 'text',
      required: true,
      requiredWhen: { key: 'provider', equals: 'twilio' },
    },
    {
      key: 'token',
      type: 'secret',
      required: true,
      requiredWhen: { key: 'provider', equals: 'twilio' },
    },
    {
      key: 'url',
      type: 'url',
      required: true,
      requiredWhen: { key: 'provider', equals: 'webhook' },
    },
    { key: 'note', type: 'text', required: false, maxLength: 5 },
  ],
};

function method(definition: Partial<MfaMethodDefinition> = {}): MfaMethod {
  return {
    definition: {
      id: 'sms',
      amr: 'sms',
      realms: ['tenant', 'platform'],
      maxFactorsPerAccount: 1,
      challenge: 'server',
      enrollAt: 'anywhere',
      defaultEnabled: false,
      assurance: 'messaging',
      settings: SPEC,
      ...definition,
    },
    verifySchema: z.object({}),
    beginEnrollment: async () => ({ publicData: {} }),
    verify: async () => ({ ok: true }),
    describe: () => ({ label: null, hint: null }),
  };
}

describe('MFA 方式的平台參數（docs/architecture/backend/21-mfa.md §5.1）', () => {
  describe('validateSettingValues', () => {
    it('填齊（依條件必填）時沒有錯誤', () => {
      expect(validateSettingValues(SPEC, { provider: 'twilio', sid: 'AC1', token: 't' })).toEqual(
        {},
      );
      expect(validateSettingValues(SPEC, { provider: 'webhook', url: 'https://sms.test' })).toEqual(
        {},
      );
    });

    it('依條件必填：選了 twilio 才要 sid 與 token，不要 url', () => {
      expect(validateSettingValues(SPEC, { provider: 'twilio' })).toEqual({
        sid: 'MFA_SETTING_REQUIRED',
        token: 'MFA_SETTING_REQUIRED',
      });
    });

    it('select 不在選項、網址不是 http(s)、超過長度', () => {
      expect(
        validateSettingValues(SPEC, { provider: 'sns', url: 'ftp://x', note: 'toolong' }),
      ).toEqual({
        provider: 'MFA_SETTING_INVALID_OPTION',
        url: 'MFA_SETTING_INVALID_URL',
        note: 'MFA_SETTING_TOO_LONG',
      });
    });

    it('空字串等同沒有填', () => {
      expect(validateSettingValues(SPEC, { provider: '' })).toEqual({
        provider: 'MFA_SETTING_REQUIRED',
      });
    });

    it('isSettingRequired 看條件', () => {
      const sid = SPEC.fields[1]!;
      expect(isSettingRequired(sid, { provider: 'twilio' })).toBe(true);
      expect(isSettingRequired(sid, { provider: 'webhook' })).toBe(false);
    });
  });

  describe('assertSettingsSpec', () => {
    it.each([
      [
        '鍵不是 camelCase',
        { fields: [{ key: 'Bad-Key', type: 'text', required: true }] },
        'camelCase',
      ],
      [
        '鍵重複',
        {
          fields: [
            { key: 'a', type: 'text', required: true },
            { key: 'a', type: 'text', required: true },
          ],
        },
        '重複',
      ],
      ['select 沒有選項', { fields: [{ key: 'a', type: 'select', required: true }] }, 'options'],
      [
        'requiredWhen 指向不存在的欄位',
        {
          fields: [
            { key: 'a', type: 'text', required: true, requiredWhen: { key: 'b', equals: 'x' } },
          ],
        },
        'requiredWhen',
      ],
    ] as const)('%s → 啟動失敗', (_label, spec, message) => {
      expect(() => assertSettingsSpec('sms', spec as MfaMethodSettingsSpec)).toThrow(message);
    });
  });

  it('需要參數的方式不能預設開啟：登記時拒絕', () => {
    const registry = new MfaMethodRegistry();
    expect(() => registry.register(method({ defaultEnabled: true }))).toThrow('defaultEnabled');
    expect(() => registry.register(method())).not.toThrow();
  });

  describe('MfaMethodSettings', () => {
    it('沒有參數定義的方式一律算已設定；需要的要必填欄位都有值', () => {
      const settings = new MfaMethodSettings();
      const values = new Map<string, Record<string, string>>();
      settings.bind({ get: (id) => values.get(id) ?? null });
      expect(settings.isConfigured(method({ settings: undefined }))).toBe(true);
      expect(settings.isConfigured(method())).toBe(false);
      values.set('sms', { provider: 'twilio', sid: 'AC1' });
      expect(settings.isConfigured(method())).toBe(false);
      values.set('sms', { provider: 'twilio', sid: 'AC1', token: 't' });
      expect(settings.isConfigured(method())).toBe(true);
    });

    it('require：沒有參數時丟例外；只能 bind 一次', () => {
      const settings = new MfaMethodSettings();
      expect(() => settings.get('sms')).toThrow('modules/mfa');
      settings.bind({ get: () => null });
      expect(() => settings.require('sms')).toThrow('沒有設定參數');
      expect(() => settings.bind({ get: () => null })).toThrow('已經接上');
    });
  });
});
