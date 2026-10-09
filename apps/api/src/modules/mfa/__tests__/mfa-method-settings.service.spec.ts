import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { MfaMethodSettings } from '@/core/mfa';
import type { MfaMethodSettingsSpec, MfaSettingsCheck } from '@/core/mfa';
import type { MfaMethodSettingsRow } from '@/db/platform/schema';

import { MfaMethodSettingsService } from '../mfa-method-settings.service';
import { method, registryOf } from './mfa.fixture';

const ACTOR: AuthUser = { id: 'admin-1', email: 'root@example.com', status: 'active' };

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
    { key: 'botName', type: 'text', required: false },
  ],
};

function setup(options: { row?: MfaMethodSettingsRow; check?: MfaSettingsCheck } = {}) {
  const checkSettings = vi.fn(async () => options.check ?? ({ ok: true } as MfaSettingsCheck));
  const sms = method(
    'sms',
    { settings: SPEC, defaultEnabled: false, challenge: 'server' },
    { checkSettings },
  );
  const registry = registryOf(method('totp'), sms);
  let rows = options.row ? [options.row] : [];
  const repo = {
    list: vi.fn(async () => rows),
    find: vi.fn(async () => rows[0]),
    save: vi.fn(
      async (
        id: string,
        input: { values: Record<string, string>; secretsEncrypted: string | null },
      ) => {
        rows = [
          {
            method: id,
            values: input.values,
            secretsEncrypted: input.secretsEncrypted,
            version: (rows[0]?.version ?? 0) + 1,
            updatedBy: ACTOR.id,
            updatedAt: new Date('2026-10-09T00:00:00.000Z'),
          },
        ];
        return true;
      },
    ),
    delete: vi.fn(async () => {
      rows = [];
    }),
  };
  const settings = new MfaMethodSettings();
  // 假的加密：明文前面加前綴，測試可以看出存了什麼
  const secrets = {
    encrypt: vi.fn((plain: string) => `enc:${plain}`),
    decrypt: vi.fn((sealed: string) => sealed.replace(/^enc:/, '')),
  };
  const publish = vi.fn(async () => undefined);
  const broadcast = { channel: vi.fn(() => publish) };
  const audit = { record: vi.fn(async () => undefined) };
  const tx = { name: 'platform-tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const config = { get: vi.fn(() => 0) };
  const service = new MfaMethodSettingsService(
    db as never,
    repo as never,
    registry,
    settings,
    secrets as never,
    broadcast as never,
    audit as never,
    config as never,
  );
  service.onModuleInit();
  return { service, repo, settings, secrets, audit, publish, checkSettings, sms };
}

function existing(
  values: Record<string, string>,
  secrets: Record<string, string>,
): MfaMethodSettingsRow {
  return {
    method: 'sms',
    values,
    secretsEncrypted: `enc:${JSON.stringify(secrets)}`,
    version: 3,
    updatedBy: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('MfaMethodSettingsService（docs/architecture/backend/21-mfa.md §5.1）', () => {
  it('啟動時載入並解密；方式以 core 的 MfaMethodSettings 讀到合在一起的值', async () => {
    const { service, settings, sms } = setup({
      row: existing({ provider: 'twilio', sid: 'AC1' }, { token: 'secret-token' }),
    });
    await service.onApplicationBootstrap();
    expect(settings.get('sms')).toEqual({ provider: 'twilio', sid: 'AC1', token: 'secret-token' });
    expect(settings.isConfigured(sms)).toBe(true);
  });

  it('view：一般欄位回傳值，機密只回傳有沒有設定', async () => {
    const { service } = setup({
      row: existing({ provider: 'twilio', sid: 'AC1' }, { token: 'x' }),
    });
    await service.reload();
    expect(service.view('sms')).toEqual({
      method: 'sms',
      values: { provider: 'twilio', sid: 'AC1' },
      secrets: { token: true },
      configured: true,
      version: 3,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('第一次儲存：檢查通過才寫入，機密加密成一段 JSON；稽核不含機密的值', async () => {
    const { service, repo, audit, checkSettings, publish, settings, sms } = setup({
      check: { ok: true, derived: { botName: 'bot', unknownKey: 'ignored', token: 'no' } },
    });
    await service.reload();
    expect(settings.isConfigured(sms)).toBe(false);

    const view = await service.save(
      'sms',
      { values: { provider: 'twilio', sid: ' AC1 ' }, secrets: { token: 'tok' }, version: null },
      ACTOR,
    );

    expect(checkSettings).toHaveBeenCalledWith({ provider: 'twilio', sid: 'AC1', token: 'tok' });
    expect(repo.save).toHaveBeenCalledWith(
      'sms',
      {
        // 檢查時取得的值只存進定義過的一般欄位
        values: { provider: 'twilio', sid: 'AC1', botName: 'bot' },
        secretsEncrypted: `enc:${JSON.stringify({ token: 'tok' })}`,
        updatedBy: ACTOR.id,
      },
      null,
      expect.anything(),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('tok"');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mfaMethod.configure',
        metadata: expect.objectContaining({ secretsChanged: ['token'], severity: 'high' }),
      }),
      expect.anything(),
    );
    expect(publish).toHaveBeenCalled();
    expect(view.configured).toBe(true);
    expect(settings.isConfigured(sms)).toBe(true);
  });

  it('機密沒帶 = 沿用；空字串 = 清除（清掉必填的就存不進去）', async () => {
    const { service, repo } = setup({
      row: existing({ provider: 'twilio', sid: 'AC1' }, { token: 'old' }),
    });
    await service.save(
      'sms',
      { values: { provider: 'twilio', sid: 'AC2' }, secrets: {}, version: 3 },
      ACTOR,
    );
    expect(repo.save.mock.calls[0]![1].secretsEncrypted).toBe(
      `enc:${JSON.stringify({ token: 'old' })}`,
    );

    const error = await rejection(
      service.save(
        'sms',
        { values: { provider: 'twilio', sid: 'AC2' }, secrets: { token: '' }, version: 4 },
        ACTOR,
      ),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({ fields: { token: 'MFA_SETTING_REQUIRED' } });
  });

  it('換供應商時不需要的機密可以清除', async () => {
    const { service, repo } = setup({
      row: existing({ provider: 'twilio', sid: 'AC1' }, { token: 'old' }),
    });
    await service.save(
      'sms',
      { values: { provider: 'webhook' }, secrets: { token: '' }, version: 3 },
      ACTOR,
    );
    expect(repo.save.mock.calls[0]![1].secretsEncrypted).toBeNull();
  });

  it('版本不符 → MFA_METHOD_SETTINGS_VERSION_CONFLICT（不呼叫供應商）', async () => {
    const { service, checkSettings } = setup({ row: existing({ provider: 'webhook' }, {}) });
    const error = await rejection(
      service.save('sms', { values: { provider: 'webhook' }, secrets: {}, version: 2 }, ACTOR),
    );
    expect(error.code).toBe('MFA_METHOD_SETTINGS_VERSION_CONFLICT');
    expect(checkSettings).not.toHaveBeenCalled();
  });

  it('不認得的欄位、機密放在一般欄位 → VALIDATION_FAILED', async () => {
    const { service } = setup();
    const error = await rejection(
      service.save(
        'sms',
        {
          values: { provider: 'twilio', token: 'x', extra: '1' },
          secrets: { sid: 'y' },
          version: null,
        },
        ACTOR,
      ),
    );
    expect(error.details).toEqual({
      fields: {
        token: 'MFA_SETTING_UNKNOWN',
        extra: 'MFA_SETTING_UNKNOWN',
        sid: 'MFA_SETTING_UNKNOWN',
      },
    });
  });

  it('方式的檢查不通過 → MFA_METHOD_SETTINGS_CHECK_FAILED（欄位與原因），不寫入', async () => {
    const { service, repo } = setup({
      check: { ok: false, fields: { token: 'MFA_SETTING_REJECTED' }, reason: 'MFA_PROVIDER_ERROR' },
    });
    const error = await rejection(
      service.save(
        'sms',
        { values: { provider: 'twilio', sid: 'AC1' }, secrets: { token: 'bad' }, version: null },
        ACTOR,
      ),
    );
    expect(error.code).toBe('MFA_METHOD_SETTINGS_CHECK_FAILED');
    expect(error.details).toEqual({
      fields: { token: 'MFA_SETTING_REJECTED' },
      reason: 'MFA_PROVIDER_ERROR',
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('不需要參數的方式、不存在的方式 → MFA_METHOD_NOT_FOUND', async () => {
    const { service } = setup();
    expect(() => service.view('totp')).toThrow(AppException);
    expect(() => service.view('nope')).toThrow(AppException);
  });

  it.each([
    ['全平台開啟', { globalOn: true, tenantsOn: 0, platformAdmins: false }],
    ['有租戶覆寫成開', { globalOn: false, tenantsOn: 2, platformAdmins: false }],
    ['平台管理者可用', { globalOn: false, tenantsOn: 0, platformAdmins: true }],
  ])('方式還開著（%s）→ 不能刪除參數', async (_label, usage) => {
    const { service, repo } = setup({ row: existing({ provider: 'webhook' }, {}) });
    const error = await rejection(service.clear('sms', usage, ACTOR));
    expect(error.code).toBe('MFA_METHOD_SETTINGS_IN_USE');
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('沒有在用時刪除參數並寫稽核', async () => {
    const { service, repo, audit, settings, sms } = setup({
      row: existing({ provider: 'webhook' }, {}),
    });
    await service.reload();
    await service.clear('sms', { globalOn: false, tenantsOn: 0, platformAdmins: false }, ACTOR);
    expect(repo.delete).toHaveBeenCalledWith('sms', expect.anything());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mfaMethod.unconfigure' }),
      expect.anything(),
    );
    expect(settings.isConfigured(sms)).toBe(false);
  });

  it('解不開的列（換了 MFA_SECRET_KEY）只略過那一列：方式視為沒有設定', async () => {
    const { service, secrets, settings, sms } = setup({
      row: existing({ provider: 'twilio', sid: 'AC1' }, { token: 'x' }),
    });
    secrets.decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });
    await service.reload();
    expect(settings.get('sms')).toBeNull();
    expect(settings.isConfigured(sms)).toBe(false);
  });
});
