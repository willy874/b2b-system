import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, constraintNameOf, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { ApprovalRequestRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalAssigneeRegistry } from './approval-assignee.registry';
import { ApprovalChainRepository } from './approval-chain.repository';
import type { CurrentStepSummary } from './approval-chain.repository';
import { ApprovalChainService } from './approval-chain.service';
import type { ChainDecisionResult } from './approval-chain.service';
import { ApprovalFinalizer } from './approval-finalizer.service';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_PERMISSIONS, PENDING_SUBJECT_CONSTRAINT } from './approval.constants';
import type { ApprovalType } from './approval.constants';
import { APPROVAL_PENDING_NOTIFICATION, approvalDetailLink } from './approval.notifications';
import { ApprovalRepository } from './approval.repository';
import type { ApprovalContext, ApprovalHandler, SubmitApprovalInput } from './approval.types';
import type {
  ApprovalCountsDto,
  ApprovalRequestDetailDto,
  ApprovalRequestDto,
  ApproveApprovalDto,
  DecideApprovalStepDto,
  ListApprovalDto,
  OverrideApprovalStepDto,
  RejectApprovalDto,
} from './dto/approval.dto';

function toDto(
  row: ApprovalRequestRow,
  summary: { current?: CurrentStepSummary; count?: number } = {},
): ApprovalRequestDto {
  return {
    id: row.id,
    type: row.type as ApprovalType,
    status: row.status,
    payload: row.payload,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    reason: row.reason,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    resultResourceId: row.resultResourceId,
    flowVersion: row.flowVersion,
    currentStep: row.status === 'pending' ? (summary.current ?? null) : null,
    stepCount: summary.count ?? 0,
    resubmittedFrom: row.resubmittedFrom,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 審批請求的狀態機：`pending` → `approved` | `rejected` | `withdrawn`，只能走一次（docs/architecture/backend/20-approval.md §3）。
 * 「核准之後做什麼」交給各類型的 `ApprovalHandler`；這裡負責權限、交易、稽核與推播。
 * 多階段（§9）：送出時有流程就複製關卡，關卡的決定由 `ApprovalChainService` 處理；最終的核准與駁回都經 `ApprovalFinalizer`。
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ApprovalRepository,
    private readonly chainRepo: ApprovalChainRepository,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly assignees: ApprovalAssigneeRegistry,
    private readonly chain: ApprovalChainService,
    private readonly finalizer: ApprovalFinalizer,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly notifications: NotificationService,
  ) {}

  /** 擁有資源的模組在 `onModuleInit` 呼叫，登記自己負責的審批類型。 */
  registerHandler(handler: ApprovalHandler): void {
    this.handlers.register(handler);
  }

  /**
   * 擁有者模組登記一種審核者規則（docs/architecture/backend/20-approval.md §9.2、D15；例：組織管理的 `manager`）。
   */
  registerAssigneeResolver: ApprovalAssigneeRegistry['register'] = (resolver) =>
    this.assignees.register(resolver);

  /**
   * 建立一筆待審請求。同類型同對象已有待審請求時不再建立，回傳 `undefined`——
   * 要不要把「重複」告訴申請人由呼叫端決定（註冊為了防帳號列舉而不說）。
   *
   * 該類型有啟用中的流程（且 `approvalChain` 已啟用）時走多階段：複製關卡、啟動第一關、通知那一關的候選人。
   * 否則是單關：送出當下持有 `approval:review` 的人收到通知。關卡全部略過時也退回單關（§9.5）。
   */
  async submit(input: SubmitApprovalInput): Promise<ApprovalRequestDto | undefined> {
    if (input.resubmittedFrom) await this.assertResubmittable(input.resubmittedFrom, input);
    if (await this.repo.findPending(input.type, input.subjectKey)) return undefined;
    const handler = this.handlers.get(input.type);
    const flow = await this.chain.flowFor(handler);
    // 審核者與 override 持有者都是送出當下的快照（docs/architecture/backend/15-notification.md §12.2 D5）。
    // 在交易之前查：它們會用連線池另取連線
    const [reviewers, overrideHolders] = await Promise.all([
      this.permissionService.findActiveUserIdsWithPermission(APPROVAL_PERMISSIONS.REVIEW),
      flow ? this.chain.overrideHolders() : Promise.resolve([]),
    ]);

    let created: { row: ApprovalRequestRow; affected: string[] };
    try {
      created = await withTransaction(this.db, async (tx) => {
        const row = await this.repo.create(
          {
            type: input.type,
            subjectKey: input.subjectKey,
            payload: input.payload,
            privatePayload: input.privatePayload ?? null,
            requesterId: input.requester.id,
            requesterName: input.requester.name,
            reason: input.reason ?? null,
            resubmittedFrom: input.resubmittedFrom ?? null,
            ...(flow && {
              flowId: flow.id,
              flowVersion: flow.version,
              allowRepeatApprover: flow.allowRepeatApprover,
            }),
          },
          tx,
        );
        const started = flow
          ? await this.chain.start(row, flow, handler, overrideHolders, tx)
          : { skipped: [], activated: false, candidates: [] };
        await this.audit.record(
          {
            action: 'approval.submit',
            resourceType: 'approval',
            resourceId: row.id,
            resourceName: input.requester.name,
            actorId: input.requester.id,
            actorEmail: input.requester.name,
            // private_payload 永不進稽核
            changes: { after: { type: input.type, payload: input.payload } },
            ...(flow && {
              metadata: {
                flowId: flow.id,
                flowVersion: flow.version,
                skippedSteps: started.skipped,
              },
            }),
          },
          tx,
        );
        if (!started.activated) {
          // 申請人自己也有審核權限時不通知他（操作者＝收件人，D7）；匿名的註冊沒有操作者
          await this.notifications.notify(
            reviewers.map((recipientId) =>
              notification(APPROVAL_PENDING_NOTIFICATION, {
                recipientId,
                actorId: input.requester.id,
                params: {
                  approvalType: input.type,
                  requesterName: input.requester.name,
                  subject: handler.summarize(input.payload),
                },
                link: approvalDetailLink(row.id),
              }),
            ),
            tx,
          );
        }
        return { row, affected: started.candidates };
      });
    } catch (error) {
      // 預檢查與 INSERT 之間被併發的同一筆搶先：結果等同「已有待審」
      if (isUniqueViolation(error) && constraintNameOf(error) === PENDING_SUBJECT_CONSTRAINT) {
        return undefined;
      }
      throw error;
    }

    this.publishChanged(created.row.id, ChangeKind.CREATE, created.row, created.affected);
    return this.findDto(created.row.id);
  }

  /**
   * 列表（§9.13）：`all` 需要 `approval:read`；`assigned` 是我目前要審的；`mine` 是我送出的。
   * 路由只宣告 `@Authenticated()`，`all` 的權限在這裡檢查（含 `authz.denied` 稽核）。
   */
  async list(query: ListApprovalDto, actor: AuthUser) {
    if (query.scope === 'all') {
      await this.permissionService.assertHasAll(actor, [APPROVAL_PERMISSIONS.READ], {
        route: 'GET /approvals',
      });
    }
    // 停用期間沒有「待我審核」：那些請求改由 approval:review 一次定案（D12）
    if (query.scope === 'assigned' && !this.chain.isEnabled()) {
      return paginated([], 0, query);
    }
    const { items, total } = await this.repo.list(
      { ...query, excludeTypes: this.handlers.hiddenTypes() },
      actor.id,
    );
    const summaries = await this.chainRepo.summariesOf(items.map((item) => item.id));
    return paginated(
      items.map((item) =>
        toDto(item, {
          current: summaries.current.get(item.id),
          count: summaries.counts.get(item.id),
        }),
      ),
      total,
      query,
    );
  }

  /**
   * 待審數（側欄的徽章、首頁的待辦）：`assigned` 同「待我審核」的總數；`pending`（全部的待審）只給 `approval:read`。
   * 不夠權限時回 null 而不是 403：每個登入的人都會查，拒絕不該留下 `authz.denied` 稽核。
   */
  async counts(actor: AuthUser): Promise<ApprovalCountsDto> {
    const permissions = await this.permissionService.getPermissionSet(actor.id);
    const canReadAll =
      permissions.isSuperAdmin || permissions.permissions.has(APPROVAL_PERMISSIONS.READ);
    const excludeTypes = this.handlers.hiddenTypes();
    const [assigned, pending] = await Promise.all([
      // 停用期間沒有「待我審核」（D12），與列表一致
      this.chain.isEnabled() ? this.repo.count({ scope: 'assigned', excludeTypes }, actor.id) : 0,
      canReadAll
        ? this.repo.count({ scope: 'all', status: ['pending'], excludeTypes }, actor.id)
        : null,
    ]);
    return { assigned, pending };
  }

  /** 某類型的待審請求（依去重鍵前綴或申請人篩選）；讀取權限由呼叫端決定。 */
  async listPendingBy(
    type: ApprovalType,
    filter: { subjectKeyPrefix?: string; requesterId?: string },
  ): Promise<ApprovalRequestDto[]> {
    return (await this.repo.findPendingBy(type, filter)).map((row) => toDto(row));
  }

  /** 單一請求（不含關卡）；讀取權限由呼叫端決定（例：資料夾的管理者審核存取申請）。 */
  get(id: string): Promise<ApprovalRequestDto> {
    return this.findDto(id);
  }

  /** 詳情：`approval:read`、申請人、任一關的候選人看得到（§9.10）；其他人 404。 */
  async findOne(id: string, actor: AuthUser): Promise<ApprovalRequestDetailDto> {
    const request = await this.getExisting(id);
    if (!(await this.chain.canView(request, actor))) throw new AppException('APPROVAL_NOT_FOUND');
    const [dto, detail, resubmittedTo] = await Promise.all([
      this.findDto(id),
      this.chain.detail(request, actor),
      request.requesterId && request.status !== 'pending'
        ? this.repo.findResubmission(id, request.requesterId)
        : Promise.resolve(null),
    ]);
    return { ...dto, ...detail, resubmittedTo };
  }

  /**
   * 單關的核准（§3.4）。多關請求在 `approvalChain` 啟用時要用關卡的端點（`409 APPROVAL_CHAIN_IN_PROGRESS`）；
   * 停用期間一次定案，剩下的關卡 `cancelled`（D12）。
   */
  async approve(
    id: string,
    dto: ApproveApprovalDto,
    reviewer: AuthUser,
  ): Promise<ApprovalRequestDto> {
    const request = await this.getPending(id, reviewer);
    const inChain = this.assertSingleStepAllowed(request);
    const handler = this.handlers.get(request.type);
    const ctx: ApprovalContext = { request, reviewer, options: { roleIds: dto.roleIds } };

    // 核准的權限依審批類型而定（例：註冊要 user:create），路由只宣告了 approval:review
    await this.permissionService.assertHasAll(reviewer, handler.requiredPermissions(ctx), {
      route: 'POST /approvals/:id/approve',
      metadata: { approvalId: id, type: request.type },
    });
    await handler.assertApprovable(ctx);

    const affected = inChain ? await this.currentCandidates(request) : [];
    const { row, outcome } = await withTransaction(this.db, async (tx) => {
      const result = await this.finalizer.approve(
        ctx,
        {
          reviewer,
          comment: dto.comment ?? null,
          ...(inChain && { metadata: { chainDisabled: true } }),
        },
        tx,
      );
      if (inChain) {
        await this.chain.closeByLegacy(request, reviewer, 'approve', dto.comment ?? null, tx);
      }
      return result;
    });

    await handler.afterApply(ctx, outcome);
    this.publishChanged(id, ChangeKind.UPDATE, request, affected);
    // 多關請求要帶上關卡的摘要；單關的直接用交易回傳的列
    return inChain ? this.findDto(id) : toDto(row);
  }

  async reject(
    id: string,
    dto: RejectApprovalDto,
    reviewer: AuthUser,
  ): Promise<ApprovalRequestDto> {
    const request = await this.getPending(id, reviewer);
    const inChain = this.assertSingleStepAllowed(request);
    const affected = inChain ? await this.currentCandidates(request) : [];

    const row = await withTransaction(this.db, async (tx) => {
      const rejected = await this.finalizer.reject(
        request,
        {
          reviewer,
          comment: dto.comment ?? null,
          ...(inChain && { metadata: { chainDisabled: true } }),
        },
        tx,
      );
      if (inChain) {
        await this.chain.closeByLegacy(request, reviewer, 'reject', dto.comment ?? null, tx);
      }
      return rejected;
    });

    this.publishChanged(id, ChangeKind.UPDATE, request, affected);
    return inChain ? this.findDto(id) : toDto(row);
  }

  // ── 多階段（§9） ─────────────────────────────────────

  async decideStep(
    id: string,
    ordinal: number,
    dto: DecideApprovalStepDto,
    actor: AuthUser,
  ): Promise<ApprovalRequestDetailDto> {
    return this.afterChain(await this.chain.decide(id, ordinal, dto, actor), actor);
  }

  async overrideStep(
    id: string,
    ordinal: number,
    dto: OverrideApprovalStepDto,
    actor: AuthUser,
  ): Promise<ApprovalRequestDetailDto> {
    return this.afterChain(await this.chain.override(id, ordinal, dto, actor), actor);
  }

  async refreshStep(
    id: string,
    ordinal: number,
    actor: AuthUser,
  ): Promise<ApprovalRequestDetailDto> {
    return this.afterChain(await this.chain.refresh(id, ordinal, actor), actor);
  }

  /** 申請人撤回自己仍待審的請求（§9.9）。單關與多關都可以；多關的剩餘關卡 `cancelled`（`withdrawn`）。 */
  async withdraw(id: string, actor: AuthUser): Promise<ApprovalRequestDetailDto> {
    const request = await this.getExisting(id);
    if (request.requesterId !== actor.id) {
      // 看不到的請求不透露存在
      if (!(await this.chain.canView(request, actor))) throw new AppException('APPROVAL_NOT_FOUND');
      throw new AppException('APPROVAL_NOT_REQUESTER');
    }
    if (request.status !== 'pending') throw new AppException('APPROVAL_ALREADY_REVIEWED');

    const candidates = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.review(
        id,
        {
          status: 'withdrawn',
          reviewerId: null,
          reviewerName: null,
          reviewComment: null,
          reviewedAt: new Date(),
        },
        tx,
      );
      if (!row) throw new AppException('APPROVAL_ALREADY_REVIEWED');
      const affected = request.flowId ? await this.chain.closeByWithdraw(request, tx) : [];
      await this.audit.record(
        {
          action: 'approval.withdraw',
          resourceType: 'approval',
          resourceId: id,
          resourceName: request.requesterName,
          changes: { before: { status: 'pending' }, after: { status: 'withdrawn' } },
        },
        tx,
      );
      return affected;
    });

    this.publishChanged(id, ChangeKind.UPDATE, request, candidates);
    return this.findOne(id, actor);
  }

  // ── 業務規則 ─────────────────────────────────────────────

  /**
   * 重新送出（§9.9、D7）：前一筆要是同一個申請人、同類型、已駁回或撤回的請求。
   * 否則 `422 APPROVAL_RESUBMIT_INVALID`——不能拿別人的、還在審的、或已核准的請求當前一筆。
   */
  private async assertResubmittable(previousId: string, input: SubmitApprovalInput): Promise<void> {
    const previous = await this.repo.findById(previousId);
    const valid =
      previous !== undefined &&
      previous.type === input.type &&
      input.requester.id !== null &&
      previous.requesterId === input.requester.id &&
      (previous.status === 'rejected' || previous.status === 'withdrawn');
    if (!valid) {
      throw new AppException('APPROVAL_RESUBMIT_INVALID', { resubmittedFrom: previousId });
    }
  }

  /**
   * 單關的端點能不能用在這筆請求：單關請求一律可以；多關請求只在 `approvalChain` 停用期間可以（D12）。
   * 回傳是不是多關請求（停用期間的定案要關掉剩下的關卡）。
   */
  private assertSingleStepAllowed(request: ApprovalRequestRow): boolean {
    const inChain = request.currentStep !== null;
    if (inChain && this.chain.isEnabled()) throw new AppException('APPROVAL_CHAIN_IN_PROGRESS');
    return inChain;
  }

  private async currentCandidates(request: ApprovalRequestRow): Promise<string[]> {
    const steps = await this.chainRepo.stepsOf(request.id);
    const current = steps.find((step) => step.status === 'active');
    return current ? this.chainRepo.assigneeIdsOf(current.id) : [];
  }

  private async afterChain(
    result: ChainDecisionResult,
    actor: AuthUser,
  ): Promise<ApprovalRequestDetailDto> {
    if (result.applied) {
      const handler = this.handlers.get(result.request.type);
      await handler.afterApply(result.applied.ctx, result.applied.outcome);
    }
    this.publishChanged(
      result.request.id,
      ChangeKind.UPDATE,
      result.request,
      result.affectedUserIds,
    );
    return this.findOne(result.request.id, actor);
  }

  private async findDto(id: string): Promise<ApprovalRequestDto> {
    const row = await this.getExisting(id);
    const summaries = await this.chainRepo.summariesOf([id]);
    return toDto(row, { current: summaries.current.get(id), count: summaries.counts.get(id) });
  }

  /** 所屬 feature 沒有開放的類型當作不存在（docs/architecture/05-tenancy.md §15.2 D3）：看不到也審不了。 */
  private async getExisting(id: string): Promise<ApprovalRequestRow> {
    const request = await this.repo.findById(id);
    if (!request || this.handlers.hiddenTypes().includes(request.type as ApprovalType)) {
      throw new AppException('APPROVAL_NOT_FOUND');
    }
    return request;
  }

  private async getPending(id: string, reviewer: AuthUser): Promise<ApprovalRequestRow> {
    const request = await this.getExisting(id);
    if (request.status !== 'pending') throw new AppException('APPROVAL_ALREADY_REVIEWED');
    // 四眼原則：自己送出的請求要由別人審
    if (request.requesterId === reviewer.id) throw new AppException('APPROVAL_SELF_REVIEW');
    return request;
  }

  /** 推播：`approval:read` 的人（perm room）、申請人與相關的候選人（user room，§9.15）。 */
  private publishChanged(
    id: string,
    kind: ChangeKind,
    request: Pick<ApprovalRequestRow, 'requesterId'>,
    candidates: readonly string[] = [],
  ): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.APPROVAL, kind, id }],
      affectedUserIds: [
        ...new Set([...(request.requesterId ? [request.requesterId] : []), ...candidates]),
      ],
    });
  }
}
