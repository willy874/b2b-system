import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { SettingService } from '@/core/settings';
import type { ResolvedSetting, SettingValue, StoredSetting } from '@/core/settings';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  PublicSystemSettingsDto,
  SystemSettingDto,
  SystemSettingListDto,
  UpdateSystemSettingsDto,
} from './dto/system-setting.dto';

interface NumericRange {
  minimum: number | null;
  maximum: number | null;
}

/** 從定義的 schema 取出數值範圍，給前端表單先擋；非數值或 schema 表達不出範圍時為 `null`。 */
function rangeOf(definition: ResolvedSetting): NumericRange {
  if (typeof definition.defaultValue !== 'number') return { minimum: null, maximum: null };
  const json = z.toJSONSchema(definition.schema, { unrepresentable: 'any' });
  return {
    minimum: typeof json.minimum === 'number' ? json.minimum : null,
    maximum: typeof json.maximum === 'number' ? json.maximum : null,
  };
}

function typeOf(value: SettingValue): SystemSettingDto['type'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

interface SettingChange {
  key: string;
  /** `null`：還原預設。 */
  next: SettingValue | null;
  before: SettingValue;
  after: SettingValue;
}

/**
 * 設定頁的讀取與修改（docs/architecture/backend/12-settings.md §4）。
 * 定義、快取與讀取在 `core/settings`；這裡加上權限之外的業務規則：驗證、稽核、推播。
 */
@Injectable()
export class SystemSettingService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly settings: SettingService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async list(): Promise<SystemSettingListDto> {
    const stored = await this.settings.stored();
    return {
      items: this.settings.list().map((definition) => this.toDto(definition, stored)),
    };
  }

  async listPublic(): Promise<PublicSystemSettingsDto> {
    const stored = await this.settings.stored();
    return {
      values: Object.fromEntries(
        this.settings
          .list()
          .filter((definition) => definition.isPublic)
          .map((definition) => [definition.key, this.settings.effectiveValue(definition, stored)]),
      ),
    };
  }

  /**
   * 一次改多個 key（設定頁一個分類一次送出），全部通過驗證才寫入。
   * 值與目前相同的 key 略過；全部都沒變就不寫稽核、不推播。
   */
  async update(dto: UpdateSystemSettingsDto, actor: AuthUser): Promise<SystemSettingListDto> {
    const stored = await this.settings.stored();
    const changes = Object.entries(dto.values)
      .map(([key, value]) => this.toChange(key, value, stored))
      .filter((change): change is SettingChange => change !== undefined);
    if (!changes.length) return this.list();

    await withTransaction(this.db, async (tx) => {
      for (const change of changes) {
        if (change.next === null) await this.settings.reset(change.key, tx);
        else await this.settings.save(change.key, change.next, actor.id, tx);
      }
      await this.audit.record(
        {
          action: 'setting.update',
          resourceType: 'setting',
          resourceName: changes.map((change) => change.key).join(', '),
          changes: {
            before: Object.fromEntries(changes.map((change) => [change.key, change.before])),
            after: Object.fromEntries(changes.map((change) => [change.key, change.after])),
          },
        },
        tx,
      );
    });

    this.settings.invalidate();
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: changes.map((change) => ({
        resource: ChangeSource.SETTING,
        kind: ChangeKind.UPDATE,
        id: change.key,
      })),
    });
    return this.list();
  }

  /** 驗證一個 key 的新值；與目前相同時回傳 `undefined`。 */
  private toChange(
    key: string,
    value: SettingValue | null,
    stored: Map<string, StoredSetting>,
  ): SettingChange | undefined {
    const definition = this.settings.find(key);
    if (!definition) throw new AppException('SETTING_NOT_FOUND', { key });

    const before = this.settings.effectiveValue(definition, stored);
    const isOverridden = stored.has(key);
    if (value === null) {
      return isOverridden ? { key, next: null, before, after: definition.defaultValue } : undefined;
    }

    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      // 與 ZodValidationPipe 的 details.fields 同一個形狀：前端表單依 key 回填
      throw new AppException('VALIDATION_FAILED', {
        fields: { [`values.${key}`]: parsed.error.issues[0]?.message ?? 'invalid' },
      });
    }
    // 與生效值相同就不寫：沒有覆寫時等於預設值，存一列只會讓之後調整預設值時這個租戶跟不上
    if (Object.is(parsed.data, before)) return undefined;
    return { key, next: parsed.data, before, after: parsed.data };
  }

  private toDto(definition: ResolvedSetting, stored: Map<string, StoredSetting>): SystemSettingDto {
    const row = stored.get(definition.key);
    return {
      key: definition.key,
      category: definition.category,
      type: typeOf(definition.defaultValue),
      value: this.settings.effectiveValue(definition, stored),
      defaultValue: definition.defaultValue,
      isOverridden: row !== undefined,
      isPublic: definition.isPublic,
      ...rangeOf(definition),
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }
}
