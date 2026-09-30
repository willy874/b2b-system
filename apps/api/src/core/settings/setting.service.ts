import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema';
import type { DbOrTx } from '../database';
import { currentTenant } from '../tenant';
import { resolveSetting } from './setting-definition';
import type {
  EnvReader,
  ResolvedSetting,
  SettingDefinition,
  SettingValue,
} from './setting-definition';
import { SettingRepository } from './setting.repository';

/** 覆寫值的一列；`updatedAt` 給設定頁顯示「最後修改」。 */
export interface StoredSetting {
  value: unknown;
  updatedAt: Date;
}

/**
 * 修改後本程序立即失效；TTL 只是保險（例如直接改了資料庫）。
 * 多實例部署前，其他執行個體最慢在這個時間後看到新值（docs/features/multi-instance.md）。
 */
const TTL_MS = 30_000;

interface Entry {
  rows: Map<string, StoredSetting>;
  expiresAt: number;
}

/** 沒有租戶脈絡時（單元測試）歸在同一組，與權限快取相同。 */
function tenantKey(): string {
  return currentTenant()?.id ?? '-';
}

/**
 * 執行期可調的設定（docs/architecture/backend/12-settings.md）。
 *
 * - 定義在程式碼：各模組以 `register()` 登記自己的設定，`core/settings` 不認識任何模組。
 * - 資料庫只存覆寫值；讀取走「每個租戶一份」的快取，寫入的交易提交後呼叫 `invalidate()`。
 * - 存的值不合目前的 schema（例：之後收緊了範圍）時退回預設值並記 warn，不讓請求失敗。
 */
@Injectable()
export class SettingService {
  private readonly logger = new Logger(SettingService.name);
  private readonly env: EnvReader;
  private readonly definitions = new Map<string, ResolvedSetting>();
  private readonly cache = new Map<string, Entry>();

  constructor(
    private readonly repo: SettingRepository,
    config: ConfigService<Env, true>,
  ) {
    this.env = (key) => config.get(key, { infer: true });
  }

  /** 模組在自己的 `*.module.ts` 建構時登記；重複的 key 是程式錯誤，啟動就失敗。 */
  register(definitions: readonly SettingDefinition[]): void {
    for (const definition of definitions) {
      if (this.definitions.has(definition.key)) {
        throw new Error(`設定 ${definition.key} 重複登記`);
      }
      this.definitions.set(definition.key, resolveSetting(definition, this.env));
    }
  }

  /** 所有已登記的設定（登記順序）。 */
  list(): ResolvedSetting[] {
    return [...this.definitions.values()];
  }

  find(key: string): ResolvedSetting | undefined {
    return this.definitions.get(key);
  }

  /** 目前租戶的生效值。 */
  async get<T extends SettingValue>(definition: SettingDefinition<T>): Promise<T> {
    const resolved = this.definitions.get(definition.key);
    if (!resolved)
      throw new Error(`設定 ${definition.key} 沒有登記（模組的 constructor 要呼叫 register）`);
    return this.effectiveValue(resolved as ResolvedSetting<T>, await this.stored());
  }

  /** 覆寫值（沒有列的 key 不在裡面）。 */
  async stored(): Promise<Map<string, StoredSetting>> {
    const key = tenantKey();
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.rows;

    const rows = new Map<string, StoredSetting>(
      (await this.repo.listAll()).map((row) => [
        row.key,
        { value: row.value, updatedAt: row.updatedAt },
      ]),
    );
    this.cache.set(key, { rows, expiresAt: Date.now() + TTL_MS });
    return rows;
  }

  effectiveValue<T extends SettingValue>(
    definition: ResolvedSetting<T>,
    stored: Map<string, StoredSetting>,
  ): T {
    const row = stored.get(definition.key);
    if (!row) return definition.defaultValue;
    const parsed = definition.schema.safeParse(row.value);
    if (parsed.success) return parsed.data;
    this.logger.warn(
      { key: definition.key, tenantId: currentTenant()?.id },
      '存的設定值不符合目前的 schema，改用預設值',
    );
    return definition.defaultValue;
  }

  /** 寫入覆寫值；呼叫端負責驗證、稽核與交易後的 `invalidate()`。 */
  async save(key: string, value: SettingValue, actorId: string, tx?: DbOrTx): Promise<void> {
    await this.repo.upsert(key, value, actorId, tx);
  }

  /** 刪掉覆寫值（還原預設）。 */
  async reset(key: string, tx?: DbOrTx): Promise<void> {
    await this.repo.remove(key, tx);
  }

  /** 目前租戶的快取；寫入的交易 **提交後** 呼叫。 */
  invalidate(): void {
    this.cache.delete(tenantKey());
  }
}
