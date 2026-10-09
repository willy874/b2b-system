import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { MfaMethodRegistry, MfaMethodSettings } from '@/core/mfa';
import type { MfaFactor, MfaMethod, MfaRealm } from '@/core/mfa';
import type { MfaPolicyRow } from '@/db/schema';
import { UserAccountService } from '@/modules/user/user-account.service';

import type { MfaAccountStore, MfaStoredAccount } from './mfa-account.store';
import { MfaMethodOverrideService } from './mfa-method-override.service';
import { MfaPolicyRepository } from './mfa-policy.repository';

export type MfaPolicyState = Pick<
  MfaPolicyRow,
  'requireAll' | 'requiredRoleIds' | 'allowedMethods' | 'version'
>;

/** 沒有列時的政策：不要求、允許平台開放的全部。 */
export const DEFAULT_MFA_POLICY: MfaPolicyState = {
  requireAll: false,
  requiredRoleIds: [],
  allowedMethods: null,
  version: 1,
};

/**
 * 「誰能用哪些方式、誰必須啟用」（docs/architecture/backend/21-mfa.md §4.1、§5、§6）。與流程分開：
 * 政策與開關改變時不動 `MfaService`／`MfaLoginService` 的流程。
 *
 * - 租戶的使用者：註冊表 ∩ 平台層生效為開（全平台 ＋ 租戶兩級，`resolveToggle`）∩ 租戶政策允許；
 *   必須啟用 = `require_all` 或持有 `required_role_ids` 中任一角色（含經由群組、巢狀群組）。
 * - 平台管理者：註冊表 ∩ `PLATFORM_MFA_METHODS`；必須啟用 = `PLATFORM_MFA_REQUIRED`（D10）。
 */
@Injectable()
export class MfaAvailability implements OnApplicationBootstrap {
  private readonly platformMethods: ReadonlySet<string>;
  private readonly platformRequired: boolean;

  constructor(
    private readonly registry: MfaMethodRegistry,
    private readonly overrides: MfaMethodOverrideService,
    private readonly policies: MfaPolicyRepository,
    private readonly users: UserAccountService,
    private readonly settings: MfaMethodSettings,
    config: ConfigService<Env, true>,
  ) {
    this.platformMethods = new Set(config.get('PLATFORM_MFA_METHODS', { infer: true }));
    this.platformRequired =
      config.get('PLATFORM_MFA_REQUIRED', { infer: true }) ??
      config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /** 方式在 `onModuleInit` 登記：全部登記完才檢查 env 指定的方式存在。 */
  onApplicationBootstrap(): void {
    const unknown = [...this.platformMethods].filter(
      (id) => !this.registry.get(id)?.definition.realms.includes('platform'),
    );
    if (unknown.length) {
      throw new Error(
        `PLATFORM_MFA_METHODS 有不存在或不能給平台管理者用的方式：${unknown.join(', ')}`,
      );
    }
  }

  /** 這個身分範圍現在可以用的方式（租戶的要在租戶脈絡裡呼叫）。 */
  async methodsFor(realm: MfaRealm): Promise<MfaMethod[]> {
    if (realm === 'platform') {
      // 需要平台參數而還沒填齊的方式，即使 env 列了也不能用（§5.1）
      return this.registry
        .list('platform')
        .filter(
          (method) =>
            this.platformMethods.has(method.definition.id) && this.settings.isConfigured(method),
        );
    }
    const allowed = (await this.policy()).allowedMethods;
    return this.platformEnabled().filter(
      (method) => allowed === null || allowed.includes(method.definition.id),
    );
  }

  /** 平台管理者可用的方式 id（`PLATFORM_MFA_METHODS`）。 */
  platformAdminMethodIds(): ReadonlySet<string> {
    return this.platformMethods;
  }

  /**
   * 平台層（兩級覆寫）在目前的租戶開放的方式；政策頁的選項。需要平台參數而還沒填齊的方式一律不算開放（§5.1）：
   * 開關會擋下這種狀態，這裡是第二道防線（例：參數解不開）。
   */
  platformEnabled(): MfaMethod[] {
    return this.registry
      .list('tenant')
      .filter((method) => this.overrides.isEnabled(method) && this.settings.isConfigured(method));
  }

  /** 政策是否要求這個帳號啟用 MFA。 */
  async isRequired(store: MfaAccountStore, stored: MfaStoredAccount): Promise<boolean> {
    if (store.realm === 'platform') return this.platformRequired;
    return this.isRequiredBy(await this.policy(), stored.account.id);
  }

  /** 以指定的政策判斷（政策頁計算「不符合政策的人數」）。 */
  async isRequiredBy(
    policy: Pick<MfaPolicyRow, 'requireAll' | 'requiredRoleIds'>,
    userId: string,
  ): Promise<boolean> {
    if (policy.requireAll) return true;
    if (policy.requiredRoleIds.length === 0) return false;
    // 經由群組（含巢狀）持有的角色也算：取自權限解析的主體閉包
    const roles = await this.users.listEffectiveRoles(userId);
    return roles.some((role) => policy.requiredRoleIds.includes(role.id));
  }

  /** 移除因子之前：必須啟用的人不能移除最後一個可用的因子（`409 MFA_LAST_FACTOR`）。 */
  async assertCanRemove(
    store: MfaAccountStore,
    stored: MfaStoredAccount,
    _factor: MfaFactor,
    remaining: readonly MfaFactor[],
  ): Promise<void> {
    if (!(await this.isRequired(store, stored))) return;
    const available = new Set((await this.methodsFor(store.realm)).map((m) => m.definition.id));
    if (!remaining.some((factor) => available.has(factor.method))) {
      throw new AppException('MFA_LAST_FACTOR');
    }
  }

  /** 租戶目前的政策；沒有列時是預設值。讀政策不做快取（§6）。 */
  async policy(): Promise<MfaPolicyState> {
    return (await this.policies.find()) ?? DEFAULT_MFA_POLICY;
  }
}
