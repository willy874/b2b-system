import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import { BroadcastService } from '@/core/broadcast';
import type { BroadcastPublisher } from '@/core/broadcast';
import type { Env } from '@/core/config';
import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { AppException } from '@/core/errors';
import {
  MfaMethodRegistry,
  MfaMethodSettings,
  MfaSecretService,
  validateSettingValues,
} from '@/core/mfa';
import type { MfaMethod, MfaMethodSettingsSpec, MfaSettingValues } from '@/core/mfa';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  MfaMethodSettingsDto,
  PlatformMfaMethodDto,
  UpdateMfaMethodSettingsDto,
} from './dto/mfa.dto';
import { MfaMethodSettingsRepository } from './mfa-method-settings.repository';

/** 參數變更時通知其他程序重新讀取。 */
export const MFA_METHOD_SETTINGS_CHANNEL = 'mfa_method_settings';

interface CachedSettings {
  /** 一般欄位與解密後的機密欄位合在一起（方式讀取用）。 */
  values: MfaSettingValues;
  version: number;
  updatedAt: Date;
}

/** 參數「在用」的判斷（不能刪除）由呼叫端提供：全平台開啟、有租戶覆寫成開、或平台管理者可用。 */
export interface MfaSettingsUsage {
  globalOn: boolean;
  tenantsOn: number;
  platformAdmins: boolean;
}

/**
 * MFA 方式的平台參數（docs/architecture/backend/21-mfa.md §5.1）：簡訊供應商的金鑰、Bot token、WebAuthn 的 RP 名稱。
 *
 * - 儲存：平台 DB 的 `mfa_method_settings`；機密欄位以 `MFA_SECRET_KEY` 加密，API 只回傳「有沒有設定」。
 * - 檢查：框架先檢查必填與格式，再交給方式的 `checkSettings`（例：以金鑰呼叫供應商、向 Telegram 登記 webhook）；
 *   任一項不通過就不儲存，所以 **存得進去的參數一定是填齊的**。
 * - 讀取：全部快取在記憶體（每次登入都要判斷可用的方式），變更時本機立即重讀並廣播，另有 TTL 兜底。
 *   以 `MfaMethodSettings`（`core/mfa`）提供給方式與租戶模組。
 */
@Injectable()
export class MfaMethodSettingsService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MfaMethodSettingsService.name);
  private readonly ttlMs: number;
  private cache = new Map<string, CachedSettings>();
  private refreshTimer?: NodeJS.Timeout;
  private publish?: BroadcastPublisher<Record<string, never>>;

  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly repo: MfaMethodSettingsRepository,
    private readonly registry: MfaMethodRegistry,
    private readonly settings: MfaMethodSettings,
    private readonly secrets: MfaSecretService,
    private readonly broadcast: BroadcastService,
    private readonly audit: PlatformAuditService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('TENANT_CACHE_TTL', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    this.settings.bind({ get: (methodId) => this.cache.get(methodId)?.values ?? null });
    this.publish = this.broadcast.channel(MFA_METHOD_SETTINGS_CHANNEL, {
      parse: (value) => (typeof value === 'object' && value !== null ? {} : null),
      onMessage: () => this.reload(),
      onReconnect: () => this.reload(),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    if (this.ttlMs > 0) {
      this.refreshTimer = setInterval(() => void this.reload(), this.ttlMs);
      this.refreshTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  /** 讀取失敗時沿用上一份；某一列解不開（換了 `MFA_SECRET_KEY`）只略過那一列，該方式視為沒有設定。 */
  async reload(): Promise<void> {
    let rows;
    try {
      rows = await this.repo.list();
    } catch (error) {
      this.logger.error({ err: error }, '載入 MFA 方式的參數失敗');
      return;
    }
    const next = new Map<string, CachedSettings>();
    for (const row of rows) {
      try {
        next.set(row.method, {
          values: { ...row.values, ...this.decryptSecrets(row.secretsEncrypted) },
          version: row.version,
          updatedAt: row.updatedAt,
        });
      } catch (error) {
        this.logger.error({ err: error, method: row.method }, 'MFA 方式的機密參數解不開');
      }
    }
    this.cache = next;
  }

  /** 平台開關頁的摘要：參數的定義與是否已填齊。不需要參數的方式是 null。 */
  summaryOf(method: MfaMethod): PlatformMfaMethodDto['settings'] {
    const spec = method.definition.settings;
    if (!spec) return null;
    return {
      fields: spec.fields.map(({ options, ...field }) => ({
        ...field,
        ...(options && { options: [...options] }),
      })),
      configured: this.settings.isConfigured(method),
    };
  }

  /** 參數的目前值：一般欄位回傳值，機密欄位只回傳有沒有設定。 */
  view(methodId: string): MfaMethodSettingsDto {
    const { method, spec } = this.requireSpec(methodId);
    const cached = this.cache.get(methodId);
    const values: Record<string, string> = {};
    const secrets: Record<string, boolean> = {};
    for (const field of spec.fields) {
      const value = cached?.values[field.key];
      if (field.type === 'secret') secrets[field.key] = Boolean(value);
      else if (value !== undefined) values[field.key] = value;
    }
    return {
      method: methodId,
      values,
      secrets,
      configured: this.settings.isConfigured(method),
      version: cached?.version ?? null,
      updatedAt: cached?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * 儲存參數：一般欄位整份取代；機密欄位沒帶 = 沿用、空字串 = 清除、其他 = 換新。必填、格式與方式自己的檢查全部通過才寫入，
   * 稽核只記一般欄位的前後值與「哪些機密換了」，不記機密的值。
   */
  async save(
    methodId: string,
    dto: UpdateMfaMethodSettingsDto,
    actor: AuthUser,
  ): Promise<MfaMethodSettingsDto> {
    const { method, spec } = this.requireSpec(methodId);
    const fieldOf = new Map(spec.fields.map((field) => [field.key, field]));
    const unknown = [
      ...Object.keys(dto.values).filter(
        (key) => fieldOf.get(key)?.type === 'secret' || !fieldOf.has(key),
      ),
      ...Object.keys(dto.secrets).filter((key) => fieldOf.get(key)?.type !== 'secret'),
    ];
    if (unknown.length) {
      throw new AppException('VALIDATION_FAILED', {
        fields: Object.fromEntries(unknown.map((key) => [key, 'MFA_SETTING_UNKNOWN'])),
      });
    }

    const current = await this.repo.find(methodId);
    if ((current?.version ?? null) !== dto.version) {
      throw new AppException('MFA_METHOD_SETTINGS_VERSION_CONFLICT');
    }
    const currentSecrets = current ? this.decryptSecrets(current.secretsEncrypted) : {};
    const plain = compact(dto.values);
    const nextSecrets: Record<string, string> = {};
    const rotated: string[] = [];
    for (const field of spec.fields) {
      if (field.type !== 'secret') continue;
      const given = dto.secrets[field.key];
      if (given === undefined) {
        const kept = currentSecrets[field.key];
        if (kept) nextSecrets[field.key] = kept;
        continue;
      }
      const trimmed = given.trim();
      if (trimmed) nextSecrets[field.key] = trimmed;
      if (trimmed !== (currentSecrets[field.key] ?? '')) rotated.push(field.key);
    }
    const combined = { ...plain, ...nextSecrets };

    const formatErrors = validateSettingValues(spec, combined);
    if (Object.keys(formatErrors).length) {
      throw new AppException('VALIDATION_FAILED', { fields: formatErrors });
    }
    const check = method.checkSettings
      ? await method.checkSettings(combined)
      : { ok: true as const };
    if (!check.ok) {
      throw new AppException('MFA_METHOD_SETTINGS_CHECK_FAILED', {
        ...(check.fields && { fields: check.fields }),
        ...(check.reason && { reason: check.reason }),
      });
    }
    // 檢查時從供應商取得的值（例：Bot 的 username）只存進一般欄位，而且只存定義過的欄位
    const values = { ...plain };
    for (const [key, value] of Object.entries(check.derived ?? {})) {
      if (fieldOf.get(key) && fieldOf.get(key)?.type !== 'secret') values[key] = value;
    }

    await withTransaction(this.db, async (tx) => {
      const saved = await this.repo.save(
        methodId,
        {
          values,
          secretsEncrypted: Object.keys(nextSecrets).length
            ? this.secrets.encrypt(JSON.stringify(nextSecrets))
            : null,
          updatedBy: actor.id,
        },
        current?.version ?? null,
        tx,
      );
      if (!saved) throw new AppException('MFA_METHOD_SETTINGS_VERSION_CONFLICT');
      await this.audit.record(
        {
          action: 'mfaMethod.configure',
          resourceType: 'mfaMethod',
          resourceId: methodId,
          actorId: actor.id,
          actorEmail: actor.email,
          metadata: {
            before: current?.values ?? null,
            after: values,
            ...(rotated.length && { secretsChanged: rotated }),
            severity: 'high',
          },
        },
        tx,
      );
    });
    await this.changed();
    return this.view(methodId);
  }

  /** 刪除參數：方式還開著（全平台、任一租戶或平台管理者）時不能刪，否則已設定的人登入時方式會突然消失。 */
  async clear(
    methodId: string,
    usage: MfaSettingsUsage,
    actor: AuthUser,
  ): Promise<MfaMethodSettingsDto> {
    this.requireSpec(methodId);
    if (usage.globalOn || usage.tenantsOn > 0 || usage.platformAdmins) {
      throw new AppException('MFA_METHOD_SETTINGS_IN_USE', { ...usage });
    }
    await withTransaction(this.db, async (tx) => {
      const current = await this.repo.find(methodId, tx);
      if (!current) return;
      await this.repo.delete(methodId, tx);
      await this.audit.record(
        {
          action: 'mfaMethod.unconfigure',
          resourceType: 'mfaMethod',
          resourceId: methodId,
          actorId: actor.id,
          actorEmail: actor.email,
          metadata: { before: current.values, severity: 'high' },
        },
        tx,
      );
    });
    await this.changed();
    return this.view(methodId);
  }

  private requireSpec(methodId: string): { method: MfaMethod; spec: MfaMethodSettingsSpec } {
    const method = this.registry.get(methodId);
    if (!method) throw new AppException('MFA_METHOD_NOT_FOUND');
    const spec = method.definition.settings;
    if (!spec) throw new AppException('MFA_METHOD_NOT_FOUND', { reason: 'noSettings' });
    return { method, spec };
  }

  private async changed(): Promise<void> {
    await this.reload();
    await this.publish?.({});
  }

  private decryptSecrets(sealed: string | null): Record<string, string> {
    if (!sealed) return {};
    const parsed: unknown = JSON.parse(this.secrets.decrypt(sealed));
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
}

/** 去掉空白與空值：空字串等同沒有填。 */
function compact(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value !== ''),
  );
}
