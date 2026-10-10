import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import type { ApprovalAssigneeKind, ApprovalFlowRow, ApprovalFlowStep } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalAssigneeRegistry } from './approval-assignee.registry';
import { ApprovalChainRepository } from './approval-chain.repository';
import { ApprovalChainService } from './approval-chain.service';
import { conditionsMetByValues, validateFlowSteps } from './approval-flow.rules';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_ASSIGNEE_KINDS } from './approval.constants';
import type { ApprovalHandler } from './approval.types';
import type {
  ApprovalFlowDto,
  ApprovalFlowListDto,
  ApprovalFlowStatsDto,
  ApprovalFlowPreviewDto,
  ApprovalFlowStepInputDto,
  PreviewApprovalFlowDto,
  PutApprovalFlowDto,
  ResetApprovalFlowDto,
} from './dto/approval-flow.dto';

/** 流程頁的「實際運作」看幾天（§12 D9）。 */
const FLOW_STATS_DAYS = 30;

/**
 * 審批流程的設定（docs/architecture/backend/20-approval.md §9、D1、D11）：每一種宣告了 `flow` 的審批類型最多一個流程。
 * 版本以 `version`（樂觀鎖）遞增，完整的前後內容在稽核 `approvalFlow.update`；停用保留設定，重設（§12 D10）刪掉流程、
 * 整份設定留在稽核 `approvalFlow.reset`。
 */
interface FlowDtoContext {
  /** 權限鍵 → 名稱的 i18n key。 */
  names: Map<string, string>;
  /** 流程 id → 進行中的請求數。 */
  inFlight: Map<string, number>;
}

@Injectable()
export class ApprovalFlowService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ApprovalChainRepository,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly assignees: ApprovalAssigneeRegistry,
    private readonly chain: ApprovalChainService,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  /** 支援流程的類型，各自帶流程（若有）與欄位定義；另回各種規則目前能不能用。 */
  async list(): Promise<ApprovalFlowListDto> {
    const flows = new Map((await this.repo.listFlows()).map((flow) => [flow.type, flow]));
    const hidden = this.handlers.hiddenTypes();
    // 所屬 feature 沒有開放的類型不列（docs/architecture/05-tenancy.md §15.2 D3）
    const handlers = this.handlers.all().filter((h) => h.flow && !hidden.includes(h.type));
    const context = await this.loadDtoContext(
      handlers.flatMap((handler) => flows.get(handler.type)?.id ?? []),
    );
    const items: ApprovalFlowDto[] = [];
    for (const handler of handlers) {
      // oxlint-disable-next-line no-await-in-loop -- 支援流程的類型只有幾種；權限目錄與進行中的計數已一次查好
      items.push(await this.toDto(handler, flows.get(handler.type), context));
    }
    const assigneeKinds = Object.fromEntries(
      APPROVAL_ASSIGNEE_KINDS.map((kind) => [kind, this.assignees.isAvailable(kind)]),
    ) as Record<ApprovalAssigneeKind, boolean>;
    return { items, assigneeKinds };
  }

  async get(type: string): Promise<ApprovalFlowDto> {
    const handler = this.supportedHandler(type);
    const flow = await this.repo.findFlow(type);
    return this.toDto(handler, flow, await this.loadDtoContext(flow ? [flow.id] : []));
  }

  /**
   * 建立或取代流程。反提權（D11）：操作者要持有該類型 handler 的 `requiredPermissions`——能設定流程的人
   * 決定了「誰可以代為執行某操作」。新增或修改的關卡不能用目前不可用的規則（D14）；沒改到的關卡不擋，
   * 管理者仍能停用流程或修改其他部分。
   */
  async put(type: string, dto: PutApprovalFlowDto, actor: AuthUser): Promise<ApprovalFlowDto> {
    const handler = this.supportedHandler(type);
    const support = handler.flow;
    if (!support) throw new AppException('APPROVAL_FLOW_NOT_SUPPORTED');
    await this.permissionService.assertHasAll(
      actor,
      handler.requiredPermissions({ request: null, options: { roleIds: [] } }),
      { route: 'PUT /approval-flows/:type', metadata: { type } },
    );

    const steps = this.normalizeSteps(dto.steps);
    const errors = validateFlowSteps(steps, support);
    if (Object.keys(errors).length) throw new AppException('VALIDATION_FAILED', { fields: errors });

    const existing = await this.repo.findFlow(type);
    await this.assertAssigneesUsable(steps, existing);

    const saved = await withTransaction(this.db, async (tx) => {
      const locked = await this.repo.lockFlow(type, tx);
      let row: ApprovalFlowRow | undefined;
      if (!locked) {
        row = await this.repo.insertFlow(
          {
            type,
            enabled: dto.enabled,
            allowRepeatApprover: dto.allowRepeatApprover,
            steps,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
      } else {
        if (dto.version === undefined || dto.version !== locked.version) {
          throw new AppException('APPROVAL_FLOW_VERSION_CONFLICT', { current: locked.version });
        }
        row = await this.repo.updateFlow(
          type,
          {
            enabled: dto.enabled,
            allowRepeatApprover: dto.allowRepeatApprover,
            steps,
            updatedBy: actor.id,
          },
          locked.version,
          tx,
        );
        if (!row) {
          throw new AppException('APPROVAL_FLOW_VERSION_CONFLICT', { current: locked.version });
        }
      }
      await this.audit.record(
        {
          action: 'approvalFlow.update',
          resourceType: RESOURCE_TYPE.APPROVAL_FLOW,
          resourceId: row.id,
          resourceName: type,
          changes: {
            before: locked
              ? {
                  enabled: locked.enabled,
                  allowRepeatApprover: locked.allowRepeatApprover,
                  steps: locked.steps,
                }
              : null,
            after: {
              enabled: row.enabled,
              allowRepeatApprover: row.allowRepeatApprover,
              steps: row.steps,
            },
          },
          metadata: { version: row.version },
        },
        tx,
      );
      return row;
    });

    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.APPROVAL_FLOW,
          kind: existing ? ChangeKind.UPDATE : ChangeKind.CREATE,
          id: type,
        },
      ],
    });
    return this.toDto(handler, saved, await this.loadDtoContext([saved.id]));
  }

  /**
   * 重設成未設定（§9.3、§12 D10）：刪掉流程，這個類型回到單關審批；下次設定從範本開始。
   * 已送出的請求帶著關卡的快照照舊走完。與修改同樣受反提權限制（D11），版本不符 409；已經沒有流程時不做任何事。
   * 稽核 `approvalFlow.reset` 帶整份被刪掉的流程，需要時可以照著重建。
   */
  async reset(type: string, dto: ResetApprovalFlowDto, actor: AuthUser): Promise<void> {
    const handler = this.supportedHandler(type);
    await this.permissionService.assertHasAll(
      actor,
      handler.requiredPermissions({ request: null, options: { roleIds: [] } }),
      { route: 'DELETE /approval-flows/:type', metadata: { type } },
    );

    const removed = await withTransaction(this.db, async (tx) => {
      const locked = await this.repo.lockFlow(type, tx);
      if (!locked) return undefined;
      if (locked.version !== dto.version) {
        throw new AppException('APPROVAL_FLOW_VERSION_CONFLICT', { current: locked.version });
      }
      await this.repo.deleteFlow(type, tx);
      await this.audit.record(
        {
          action: 'approvalFlow.reset',
          resourceType: RESOURCE_TYPE.APPROVAL_FLOW,
          resourceId: locked.id,
          resourceName: type,
          changes: {
            before: {
              enabled: locked.enabled,
              allowRepeatApprover: locked.allowRepeatApprover,
              steps: locked.steps,
            },
            after: null,
          },
          metadata: { version: locked.version },
        },
        tx,
      );
      return locked;
    });
    if (!removed) return;

    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.APPROVAL_FLOW, kind: ChangeKind.DELETE, id: type }],
    });
  }

  /**
   * 試算（§9.13）：給定申請人與欄位值，每一關會不會略過、候選人、短缺。唯讀，與關卡啟動共用同一段解析；
   * 沒有前面關卡的決定，所以 D6 的排除不適用。
   */
  async preview(type: string, dto: PreviewApprovalFlowDto): Promise<ApprovalFlowPreviewDto> {
    const handler = this.supportedHandler(type);
    const support = handler.flow;
    if (!support) throw new AppException('APPROVAL_FLOW_NOT_SUPPORTED');
    const steps = dto.steps
      ? this.normalizeSteps(dto.steps)
      : (await this.repo.findFlow(type))?.steps;
    if (!steps) return { steps: [] };
    if (dto.steps) {
      const errors = validateFlowSteps(steps, support);
      if (Object.keys(errors).length)
        throw new AppException('VALIDATION_FAILED', { fields: errors });
    }

    const requesterId = support.requester === 'anonymous' ? null : (dto.requesterId ?? null);
    const statuses = steps.map((step, ordinal) => ({
      ordinal,
      status: conditionsMetByValues(step.conditions, dto.fields)
        ? ('waiting' as const)
        : ('skipped' as const),
    }));
    const result: ApprovalFlowPreviewDto['steps'] = [];
    for (const [ordinal, step] of steps.entries()) {
      const skipped = statuses[ordinal]?.status === 'skipped';
      if (skipped) {
        result.push({
          key: step.key,
          name: step.name,
          skipped,
          candidates: [],
          required: null,
          shortage: null,
        });
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- 最多 10 關；每關的規則各自解析
      const resolved = await this.chain.candidatesOf(
        { requesterId, row: null },
        {
          ordinal,
          assignee: { ...step.assignee, label: '' },
          requiredMode: step.requiredApprovals === 'all' ? 'all' : 'count',
          requiredApprovals: step.requiredApprovals === 'all' ? null : step.requiredApprovals,
        },
        statuses,
        handler,
      );
      // oxlint-disable-next-line no-await-in-loop -- 同上
      const names = await this.repo.userNames(resolved.candidates);
      result.push({
        key: step.key,
        name: step.name,
        skipped,
        candidates: resolved.candidates.map((userId) => ({
          userId,
          name: names.get(userId)?.name ?? '',
        })),
        required: resolved.required,
        shortage: resolved.shortage,
      });
    }
    return { steps: result };
  }

  /** 近 30 天的實際運作（§9.16、§12 D9）：送出、定案、平均時間；目前進行中的停在哪一關。 */
  async stats(type: string): Promise<ApprovalFlowStatsDto> {
    this.supportedHandler(type);
    const since = new Date(Date.now() - FLOW_STATS_DAYS * 24 * 60 * 60 * 1000);
    const stats = await this.repo.flowStats(type, since);
    const count = (status: string) => stats.byStatus.get(status) ?? 0;
    return {
      days: FLOW_STATS_DAYS,
      submitted: [...stats.byStatus.values()].reduce((sum, value) => sum + value, 0),
      approved: count('approved'),
      rejected: count('rejected'),
      withdrawn: count('withdrawn'),
      averageHours: stats.averageHours,
      pending: stats.pending,
      currentSteps: stats.currentSteps,
    };
  }

  /** 平台關閉 `approvalChain`、`organization` 前的確認框列出的數量。 */
  countImpact(): Promise<{ flows: number; inChain: number; usingOrg: number }> {
    return this.repo.countImpact();
  }

  // ── 小工具 ───────────────────────────────────────────

  private supportedHandler(type: string): ApprovalHandler {
    const handler = this.handlers.find(type);
    if (!handler?.flow || this.handlers.hiddenTypes().includes(handler.type)) {
      throw new AppException('APPROVAL_FLOW_NOT_SUPPORTED');
    }
    return handler;
  }

  /** 新的關卡產生 key；條件補上預設的空陣列。 */
  private normalizeSteps(steps: readonly ApprovalFlowStepInputDto[]): ApprovalFlowStep[] {
    return steps.map((step) => ({
      key: step.key ?? randomUUID(),
      name: step.name,
      assignee: step.assignee,
      requiredApprovals: step.requiredApprovals,
      conditions: step.conditions,
    }));
  }

  /**
   * 新增或改了規則的關卡：規則的種類要可用（組織管理、群組已啟用）、指到的對象要存在（D14）。
   * 規則沒變的關卡不檢查。違反時 `422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE`（`details.steps` 是關卡的索引）。
   */
  private async assertAssigneesUsable(
    steps: readonly ApprovalFlowStep[],
    existing: ApprovalFlowRow | undefined,
  ): Promise<void> {
    const before = new Map((existing?.steps ?? []).map((step) => [step.key, step]));
    const unusable: number[] = [];
    for (const [index, step] of steps.entries()) {
      const previous = before.get(step.key);
      if (previous && JSON.stringify(previous.assignee) === JSON.stringify(step.assignee)) continue;
      if (!this.assignees.isAvailable(step.assignee.kind)) {
        unusable.push(index);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- 最多 10 關
      const target = await this.assignees.describe(step.assignee);
      if (target?.deleted) unusable.push(index);
    }
    if (unusable.length) {
      throw new AppException('APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE', { steps: unusable });
    }
  }

  /** `toDto` 需要、與單一類型無關的資料：權限鍵的名稱、各流程進行中的請求數。列表一次查好，不逐類型查。 */
  private async loadDtoContext(flowIds: readonly string[]): Promise<FlowDtoContext> {
    const [catalog, inFlight] = await Promise.all([
      this.permissionService.getCatalog(),
      this.repo.countInFlight(flowIds),
    ]);
    return { names: new Map(catalog.items.map((item) => [item.key, item.nameI18nKey])), inFlight };
  }

  private async toDto(
    handler: ApprovalHandler,
    flow: ApprovalFlowRow | undefined,
    { names, inFlight }: FlowDtoContext,
  ): Promise<ApprovalFlowDto> {
    const support = handler.flow;
    const steps = [];
    for (const step of flow?.steps ?? []) {
      // oxlint-disable-next-line no-await-in-loop -- 最多 10 關
      const target = await this.assignees.describe(step.assignee);
      steps.push({
        ...step,
        assigneeStatus: {
          label: target?.label ?? '',
          available: this.assignees.isAvailable(step.assignee.kind),
          deleted: target?.deleted ?? false,
        },
      });
    }
    const inFlightCount = flow ? (inFlight.get(flow.id) ?? 0) : 0;
    return {
      type: handler.type,
      requester: support?.requester ?? 'user',
      fields: (support?.fields ?? []).map((field) => ({
        key: field.key,
        type: field.type,
        options: field.options ? [...field.options] : null,
        example: field.example ?? null,
      })),
      // 不含依選項而定的部分（例：核准時一併指派角色），與反提權的檢查相同（D11）
      requiredPermissions: handler
        .requiredPermissions({ request: null, options: { roleIds: [] } })
        .map((key) => ({ key, nameI18nKey: names.get(key) ?? key })),
      inFlightCount,
      flow: flow
        ? {
            id: flow.id,
            enabled: flow.enabled,
            allowRepeatApprover: flow.allowRepeatApprover,
            steps,
            version: flow.version,
            updatedAt: flow.updatedAt.toISOString(),
          }
        : null,
    };
  }
}
