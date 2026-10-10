import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AuthzService } from '@/core/authz';
import { AppException } from '@/core/errors';
import { MfaMethodRegistry } from '@/core/mfa';
import { ROLE_HOLDER_RELATION, ROLE_OBJECT_TYPE } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { UserAccountService } from '@/modules/user/user-account.service';

import type { MfaPolicyDto, MfaPolicyImpactDto, UpdateMfaPolicyDto } from './dto/mfa.dto';
import { MfaAvailability } from './mfa-availability.service';
import type { MfaPolicyState } from './mfa-availability.service';
import { MfaPolicyRepository } from './mfa-policy.repository';
import type { MfaPolicyValues } from './mfa-policy.repository';
import { methodInfoOf } from './mfa.service';
import { TenantMfaRepository } from './tenant-mfa.repository';

/**
 * 租戶的 MFA 政策（docs/architecture/backend/21-mfa.md §6、D7、D11）：允許的方式、全員必須或指定角色必須。
 * 收緊立即生效、但不踢人：已登入的人下一次登入才被要求設定。
 */
@Injectable()
export class MfaPolicyService {
  constructor(
    private readonly repo: MfaPolicyRepository,
    private readonly availability: MfaAvailability,
    private readonly factors: TenantMfaRepository,
    private readonly registry: MfaMethodRegistry,
    private readonly users: UserAccountService,
    private readonly audit: AuditService,
    private readonly authz: AuthzService,
  ) {}

  async get(): Promise<MfaPolicyDto> {
    const row = await this.repo.find();
    const policy: MfaPolicyState = row ?? (await this.availability.policy());
    // 刪除的角色讀取時濾掉
    const existing = await this.repo.existingRoleIds(policy.requiredRoleIds);
    const requiredRoleIds = policy.requiredRoleIds.filter((id) => existing.has(id));
    const enabled = new Set(this.availability.platformEnabled().map((m) => m.definition.id));
    return {
      requireAll: policy.requireAll,
      requiredRoleIds,
      allowedMethods: policy.allowedMethods,
      version: policy.version,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      methods: this.registry.list('tenant').map((method) => ({
        ...methodInfoOf(method),
        platformEnabled: enabled.has(method.definition.id),
      })),
      nonCompliant: await this.countNonCompliant({ ...policy, requiredRoleIds }),
    };
  }

  /** 套用之前先看影響（§6：從允許清單拿掉某種方式時先顯示受影響的人數）。 */
  async preview(dto: UpdateMfaPolicyDto): Promise<MfaPolicyImpactDto> {
    const values = this.normalize(dto);
    return {
      nonCompliant: await this.countNonCompliant(values),
      stranded: await this.factors.countStranded(this.effectiveAllowed(values)),
    };
  }

  async update(dto: UpdateMfaPolicyDto, actor: AuthUser): Promise<MfaPolicyDto> {
    const values = this.normalize(dto);
    await this.users.assertRolesExist(values.requiredRoleIds);
    const required = values.requireAll || values.requiredRoleIds.length > 0;
    if (required && this.effectiveAllowed(values).length === 0) {
      // 要求啟用卻沒有可用的方式：所有被要求的人都會 AUTH_MFA_UNAVAILABLE
      throw new AppException('VALIDATION_FAILED', {
        fields: { allowedMethods: 'MFA_POLICY_NO_METHOD' },
      });
    }
    const before = await this.availability.policy();
    const saved = await this.repo.save(values, dto.version, actor.id);
    if (!saved) throw new AppException('MFA_POLICY_VERSION_CONFLICT');
    await this.audit.record({
      action: 'mfaPolicy.update',
      resourceType: 'mfaPolicy',
      resourceId: 'default',
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: {
        severity: 'high',
        before: {
          requireAll: before.requireAll,
          requiredRoleIds: before.requiredRoleIds,
          allowedMethods: before.allowedMethods,
        },
        after: values,
      },
    });
    return this.get();
  }

  /** 去掉重複、依註冊表的順序；`allowedMethods` 只接受能給租戶用的方式，空陣列不合法（要全部就是 null）。 */
  private normalize(dto: UpdateMfaPolicyDto): MfaPolicyValues {
    let allowedMethods: string[] | null = null;
    if (dto.allowedMethods !== null) {
      const unknown = dto.allowedMethods.filter(
        (id) => !this.registry.get(id)?.definition.realms.includes('tenant'),
      );
      if (unknown.length) {
        throw new AppException('VALIDATION_FAILED', {
          fields: { allowedMethods: 'MFA_METHOD_NOT_FOUND' },
          methods: unknown,
        });
      }
      allowedMethods = this.registry
        .list('tenant')
        .map((method) => method.definition.id)
        .filter((id) => dto.allowedMethods?.includes(id));
      if (allowedMethods.length === 0) {
        throw new AppException('VALIDATION_FAILED', {
          fields: { allowedMethods: 'MFA_POLICY_NO_METHOD' },
        });
      }
    }
    return {
      requireAll: dto.requireAll,
      requiredRoleIds: [...new Set(dto.requiredRoleIds)],
      allowedMethods,
    };
  }

  /** 平台開放 ∩ 政策允許。 */
  private effectiveAllowed(values: Pick<MfaPolicyValues, 'allowedMethods'>): string[] {
    return this.availability
      .platformEnabled()
      .map((method) => method.definition.id)
      .filter((id) => values.allowedMethods === null || values.allowedMethods.includes(id));
  }

  /**
   * 必須啟用卻還沒有任何驗證方式的人數：可登入、還沒設定的人，與「直接或經由群組（含巢狀）持有任一指定角色的人」取交集。
   * 持有者以關係圖的反向展開一次查出（與公告受眾同一個查詢），不逐人解析權限——沒設定的人多時逐人查會以秒計。
   * 登入時的單人判斷照舊用 `MfaAvailability.isRequiredBy`（同一張關係圖、同樣不算已刪除的角色與群組）。
   */
  private async countNonCompliant(
    policy: Pick<MfaPolicyValues, 'requireAll' | 'requiredRoleIds'>,
  ): Promise<number> {
    if (!policy.requireAll && policy.requiredRoleIds.length === 0) return 0;
    const candidates = await this.factors.listActiveUserIdsWithoutMfa();
    if (policy.requireAll) return candidates.length;
    const holders = new Set(
      await this.authz.usersInSubjectSets(
        policy.requiredRoleIds.map((id) => ({
          type: ROLE_OBJECT_TYPE,
          id,
          relation: ROLE_HOLDER_RELATION,
        })),
      ),
    );
    return candidates.filter((id) => holders.has(id)).length;
  }
}
