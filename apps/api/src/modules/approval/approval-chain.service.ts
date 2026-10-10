import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { requireTenant } from '@/core/tenant';
import type {
  ApprovalAssigneeRule,
  ApprovalFlowRow,
  ApprovalFlowStep,
  ApprovalRequestRow,
  ApprovalStepInsert,
  ApprovalStepRow,
} from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalAssigneeRegistry } from './approval-assignee.registry';
import { ApprovalChainRepository } from './approval-chain.repository';
import { ApprovalFinalizer } from './approval-finalizer.service';
import { conditionsMet } from './approval-flow.rules';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_PERMISSIONS } from './approval.constants';
import type { ApprovalType } from './approval.constants';
import {
  APPROVAL_PENDING_NOTIFICATION,
  APPROVAL_PROGRESS_NOTIFICATION,
  APPROVAL_UNASSIGNED_NOTIFICATION,
  approvalTaskLink,
} from './approval.notifications';
import { ApprovalRepository } from './approval.repository';
import type { ApprovalContext, ApprovalHandler, ApprovalOutcome } from './approval.types';
import type {
  ApprovalRequestDetailDto,
  ApprovalStepDto,
  ApprovalViewerDto,
  DecideApprovalStepDto,
  OverrideApprovalStepDto,
} from './dto/approval.dto';

type StepShortage = 'noCandidate' | 'insufficient' | null;

/** 一次決定的結果：交易之後要不要 `afterApply`、推給哪些人。 */
export interface ChainDecisionResult {
  request: ApprovalRequestRow;
  /** 最終核准時才有：交易後呼叫 `handler.afterApply`。 */
  applied?: { ctx: ApprovalContext; outcome: ApprovalOutcome };
  /** 推播的受眾：申請人與（新、舊）關卡的候選人。 */
  affectedUserIds: string[];
}

/** 展開候選人時的申請：真的請求（啟動、refresh），或試算時假設的申請人（`row` 為 null）。 */
export interface CandidateRequest {
  requesterId: string | null;
  row: ApprovalRequestRow | null;
}

/** 一關的候選人與短缺（啟動、refresh、試算共用）。 */
export interface StepCandidates {
  candidates: string[];
  required: number;
  shortage: StepShortage;
}

/**
 * 多階段審批的狀態機（docs/architecture/backend/20-approval.md §9）：送出時複製關卡、關卡的啟動、做出決定、
 * 卡住時的 override／refresh、停用期間的單關定案。最終的核准與駁回交給 `ApprovalFinalizer`（與單關共用同一段交易）。
 */
@Injectable()
export class ApprovalChainService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ApprovalChainRepository,
    private readonly requests: ApprovalRepository,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly assignees: ApprovalAssigneeRegistry,
    private readonly finalizer: ApprovalFinalizer,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** 目前的租戶是否啟用多階段審批（D12）。 */
  isEnabled(): boolean {
    return requireTenant().features.includes('approvalChain');
  }

  /**
   * 送出時要不要走流程（§9.5）：handler 宣告了 `flow`、`approvalChain` 已啟用、該類型有啟用中的流程。
   * 否則是單關（今天的行為）。
   */
  async flowFor(handler: ApprovalHandler): Promise<ApprovalFlowRow | undefined> {
    if (!handler.flow || !this.isEnabled()) return undefined;
    const flow = await this.repo.findFlow(handler.type);
    return flow?.enabled ? flow : undefined;
  }

  /** 持有 `approval:override` 的人（短缺時通知）。在交易之前取：它會用連線池另查權限。 */
  overrideHolders(): Promise<string[]> {
    return this.permissionService.findActiveUserIdsWithPermission(APPROVAL_PERMISSIONS.OVERRIDE);
  }

  /**
   * 在送出的交易內：複製關卡（條件不符的標 `skipped`）、啟動第一個要執行的關卡。
   * 全部略過 → 不啟動任何關卡，請求退回單關的審核方式（`current_step` 為 null，§9.5）。
   * 回傳略過的關卡 key、有沒有啟動任何關卡、第一關的候選人。
   */
  async start(
    request: ApprovalRequestRow,
    flow: ApprovalFlowRow,
    handler: ApprovalHandler,
    overrideHolders: readonly string[],
    tx: Transaction,
  ): Promise<{ skipped: string[]; activated: boolean; candidates: string[] }> {
    const support = handler.flow;
    if (!support) return { skipped: [], activated: false, candidates: [] };
    const now = new Date();
    const inserts: ApprovalStepInsert[] = [];
    for (const [ordinal, step] of flow.steps.entries()) {
      const met = conditionsMet(step.conditions, support, request.payload);
      inserts.push({
        requestId: request.id,
        ordinal,
        key: step.key,
        name: step.name,
        // oxlint-disable-next-line no-await-in-loop -- 一個流程最多 10 關，每關一次名稱查詢
        assignee: { ...step.assignee, label: await this.labelOf(step.assignee) },
        requiredMode: step.requiredApprovals === 'all' ? 'all' : 'count',
        requiredApprovals: step.requiredApprovals === 'all' ? null : step.requiredApprovals,
        conditions: step.conditions,
        status: met ? 'waiting' : 'skipped',
        closedAt: met ? null : now,
      });
    }
    const steps = await this.repo.insertSteps(inserts, tx);
    const skipped = steps.filter((step) => step.status === 'skipped').map((step) => step.key);
    const first = steps.find((step) => step.status === 'waiting');
    if (!first) return { skipped, activated: false, candidates: [] };
    const candidates = await this.activate(request, first, steps, handler, overrideHolders, tx);
    return { skipped, activated: true, candidates };
  }

  // ── 做出決定 ─────────────────────────────────────────

  /** 候選人在目前的關卡同意或駁回（§9.7）。 */
  async decide(
    id: string,
    ordinal: number,
    dto: DecideApprovalStepDto,
    actor: AuthUser,
  ): Promise<ChainDecisionResult> {
    const request = await this.getChainRequest(id);
    const handler = this.handlers.get(request.type);
    const overrideHolders = await this.overrideHolders();

    return withTransaction(this.db, async (tx) => {
      const { locked, steps, step } = await this.lockCurrentStep(id, ordinal, actor, tx);
      const assigned = await this.repo.assigneeIdsOf(step.id, tx);
      const reviewable = await this.repo.filterReviewableUsers([actor.id], tx);
      if (!assigned.includes(actor.id) || !reviewable.length) {
        throw new AppException('APPROVAL_NOT_ASSIGNED');
      }
      if (await this.repo.hasDecided(step.id, actor.id, tx)) {
        throw new AppException('APPROVAL_STEP_ALREADY_DECIDED');
      }
      return this.applyDecision(
        {
          request: locked,
          steps,
          step,
          handler,
          actor,
          overrideHolders,
          route: 'POST /approvals/:id/steps/:ordinal/decisions',
        },
        {
          decision: dto.decision,
          comment: dto.comment ?? null,
          roleIds: dto.roleIds,
          via: 'assignee',
        },
        tx,
      );
    });
  }

  /**
   * 強制定案目前的關卡（`approval:override`，§9.8、D10）：意見必填；核准直接結束這一關（不管同意數），駁回結束整筆。
   * 四眼原則照舊；最後一關的核准照舊要 handler 的權限。
   */
  async override(
    id: string,
    ordinal: number,
    dto: OverrideApprovalStepDto,
    actor: AuthUser,
  ): Promise<ChainDecisionResult> {
    const request = await this.getChainRequest(id);
    const handler = this.handlers.get(request.type);
    const overrideHolders = await this.overrideHolders();

    return withTransaction(this.db, async (tx) => {
      const { locked, steps, step } = await this.lockCurrentStep(id, ordinal, actor, tx);
      if (await this.repo.hasDecided(step.id, actor.id, tx)) {
        throw new AppException('APPROVAL_STEP_ALREADY_DECIDED');
      }
      return this.applyDecision(
        {
          request: locked,
          steps,
          step,
          handler,
          actor,
          overrideHolders,
          route: 'POST /approvals/:id/steps/:ordinal/override',
        },
        { decision: dto.decision, comment: dto.comment, roleIds: dto.roleIds, via: 'override' },
        tx,
      );
    });
  }

  /**
   * 重新展開目前關卡的審核者（§9.8）：依快照的規則重新解析，**只增不減**；新加入的人收到待審通知；重新計算短缺。
   */
  async refresh(id: string, ordinal: number, actor: AuthUser): Promise<ChainDecisionResult> {
    const request = await this.getChainRequest(id);
    const handler = this.handlers.get(request.type);
    const overrideHolders = await this.overrideHolders();

    return withTransaction(this.db, async (tx) => {
      const { locked, steps, step } = await this.lockCurrentStep(id, ordinal, actor, tx, {
        allowRequester: true,
      });
      const before = await this.repo.assigneeIdsOf(step.id, tx);
      const resolved = await this.candidatesOf(
        { requesterId: locked.requesterId, row: locked },
        step,
        steps,
        handler,
        tx,
      );
      const added = await this.repo.addAssignees(
        step.id,
        locked.id,
        resolved.candidates,
        'refresh',
        tx,
      );
      const all = [...new Set([...before, ...added])];
      const approvals = await this.repo.approvalsOf(step.id, tx);
      const required = step.requiredMode === 'all' ? all.length : (step.requiredApprovals ?? 0);
      const shortage = this.shortageOf(all.length, required, approvals);
      await this.repo.updateStep(step.id, { shortage, requiredApprovals: required }, tx);
      await this.notifyPending(locked, step, handler, added, tx);
      if (shortage)
        await this.notifyUnassigned(locked, step, handler, shortage, overrideHolders, tx);
      await this.audit.record(
        {
          action: 'approval.stepRefresh',
          resourceType: 'approval',
          resourceId: locked.id,
          resourceName: locked.requesterName,
          changes: { before: { candidates: before }, after: { candidates: all } },
          metadata: { stepOrdinal: step.ordinal, stepName: step.name, added },
        },
        tx,
      );
      return { request: locked, affectedUserIds: this.audience(locked, all) };
    });
  }

  /**
   * 停用期間以單關端點定案一筆多關請求（D12）：在 `ApprovalFinalizer` 的同一個交易內呼叫。
   * 目前的關卡記一筆 `legacy` 的決定，剩下的關卡 `cancelled`（`chainDisabled`）。
   */
  async closeByLegacy(
    request: ApprovalRequestRow,
    reviewer: AuthUser,
    decision: 'approve' | 'reject',
    comment: string | null,
    tx: Transaction,
  ): Promise<void> {
    const steps = await this.repo.stepsOf(request.id, tx);
    const current = steps.find((step) => step.status === 'active');
    if (current) {
      await this.repo.insertDecision(
        {
          requestId: request.id,
          stepId: current.id,
          reviewerId: reviewer.id,
          reviewerName: reviewer.email,
          decision,
          via: 'legacy',
          comment,
        },
        tx,
      );
    }
    await this.repo.cancelOpenSteps(request.id, 'chainDisabled', tx);
    await this.repo.setCurrentStep(request.id, null, tx);
  }

  /** 撤回：所有還沒結束的關卡 `cancelled`（`withdrawn`）。回傳目前關卡的候選人（推播用）。 */
  async closeByWithdraw(request: ApprovalRequestRow, tx: Transaction): Promise<string[]> {
    const steps = await this.repo.stepsOf(request.id, tx);
    const current = steps.find((step) => step.status === 'active');
    const candidates = current ? await this.repo.assigneeIdsOf(current.id, tx) : [];
    await this.repo.cancelOpenSteps(request.id, 'withdrawn', tx);
    await this.repo.setCurrentStep(request.id, null, tx);
    return candidates;
  }

  // ── 讀取 ─────────────────────────────────────────────

  /** 請求的關卡、候選人、決定，以及目前的登入者能做什麼。 */
  async detail(
    request: ApprovalRequestRow,
    actor: AuthUser,
  ): Promise<Pick<ApprovalRequestDetailDto, 'steps' | 'viewer'>> {
    const steps = await this.repo.stepsOf(request.id);
    const [assignees, decisions] = await Promise.all([
      this.repo.assigneesOf(steps.map((step) => step.id)),
      this.repo.decisionsOf(request.id),
    ]);
    const stepDtos: ApprovalStepDto[] = steps.map((step) => ({
      ordinal: step.ordinal,
      key: step.key,
      name: step.name,
      assignee: step.assignee,
      requiredMode: step.requiredMode,
      required: step.requiredApprovals,
      status: step.status,
      shortage: step.shortage ?? null,
      closeReason: step.closeReason ?? null,
      conditions: step.conditions,
      activatedAt: step.activatedAt?.toISOString() ?? null,
      closedAt: step.closedAt?.toISOString() ?? null,
      candidates: assignees.get(step.id) ?? [],
      decisions: decisions
        .filter((decision) => decision.stepId === step.id)
        .map((decision) => ({
          reviewerId: decision.reviewerId,
          reviewerName: decision.reviewerName,
          decision: decision.decision,
          via: decision.via,
          comment: decision.comment,
          decidedAt: decision.decidedAt.toISOString(),
        })),
    }));
    return { steps: stepDtos, viewer: await this.viewerOf(request, stepDtos, actor) };
  }

  private async viewerOf(
    request: ApprovalRequestRow,
    stepDtos: readonly ApprovalStepDto[],
    actor: AuthUser,
  ): Promise<ApprovalViewerDto> {
    const pending = request.status === 'pending';
    const inChain = pending && request.currentStep !== null;
    const enabled = this.isEnabled();
    const permissions = await this.permissionService.getPermissionSet(actor.id);
    const has = (key: PermissionKey) =>
      permissions.isSuperAdmin || permissions.permissions.has(key);
    const isRequester = request.requesterId === actor.id;

    const current = stepDtos.find((step) => step.status === 'active');
    const isCandidate = Boolean(current?.candidates.some((c) => c.userId === actor.id));
    const decided = Boolean(current?.decisions.some((d) => d.reviewerId === actor.id));
    return {
      canDecide: inChain && enabled && isCandidate && !decided && !isRequester,
      canOverride:
        inChain && enabled && !isRequester && !decided && has(APPROVAL_PERMISSIONS.OVERRIDE),
      // 單關請求，或多階段停用期間的多關請求（D12）
      canReviewSingle:
        pending && !isRequester && (!inChain || !enabled) && has(APPROVAL_PERMISSIONS.REVIEW),
      canWithdraw: pending && isRequester,
    };
  }

  /**
   * 請求的可見性（§9.10）：`approval:read`、申請人、任一關的候選人。
   * 看不到時回 false，由呼叫端回 404（不透露請求存在）。
   */
  async canView(request: ApprovalRequestRow, actor: AuthUser): Promise<boolean> {
    if (request.requesterId === actor.id) return true;
    const permissions = await this.permissionService.getPermissionSet(actor.id);
    if (permissions.isSuperAdmin || permissions.permissions.has(APPROVAL_PERMISSIONS.READ)) {
      return true;
    }
    return this.repo.isCandidateOfRequest(request.id, actor.id);
  }

  // ── 關卡的啟動與候選人（§9.6） ───────────────────────

  /**
   * 啟動一關：展開候選人並落地、計算同意數與短缺、改成 `active`、推進 `current_step`、通知。
   * 候選人在啟動當下展開（D4），之後群組或主管異動不會自動改變名單。回傳候選人。
   */
  private async activate(
    request: ApprovalRequestRow,
    step: ApprovalStepRow,
    steps: readonly ApprovalStepRow[],
    handler: ApprovalHandler,
    overrideHolders: readonly string[],
    tx: Transaction,
  ): Promise<string[]> {
    const { candidates, required, shortage } = await this.candidatesOf(
      { requesterId: request.requesterId, row: request },
      step,
      steps,
      handler,
      tx,
    );
    await this.repo.addAssignees(step.id, request.id, candidates, 'activation', tx);
    await this.repo.updateStep(
      step.id,
      { status: 'active', activatedAt: new Date(), requiredApprovals: required, shortage },
      tx,
    );
    await this.repo.setCurrentStep(request.id, step.ordinal, tx);
    await this.notifyPending(request, step, handler, candidates, tx);
    if (shortage)
      await this.notifyUnassigned(request, step, handler, shortage, overrideHolders, tx);
    return candidates;
  }

  /**
   * 依關卡的規則展開候選人：扣掉申請人（四眼）、不能審的帳號、前面關卡做過決定的人（D6，流程允許時不扣）；
   * 最後一關只留下持有 handler `requiredPermissions` 的人（D3）。
   */
  async candidatesOf(
    request: CandidateRequest,
    step: Pick<ApprovalStepRow, 'ordinal' | 'assignee' | 'requiredMode' | 'requiredApprovals'>,
    steps: ReadonlyArray<Pick<ApprovalStepRow, 'ordinal' | 'status'>>,
    handler: ApprovalHandler,
    tx?: DbOrTx,
  ): Promise<StepCandidates> {
    const resolved = await this.assignees.resolve(
      this.ruleOf(step.assignee),
      { requesterId: request.requesterId },
      tx,
    );
    let candidates = await this.repo.filterReviewableUsers(
      [...new Set(resolved)].filter((userId) => userId !== request.requesterId),
      tx,
    );
    if (request.row && !request.row.allowRepeatApprover) {
      const deciders = new Set(await this.repo.deciderIdsOf(request.row.id, tx));
      candidates = candidates.filter((userId) => !deciders.has(userId));
    }
    const isLast = !steps.some(
      (other) => other.ordinal > step.ordinal && other.status === 'waiting',
    );
    if (isLast) {
      const keys = handler.requiredPermissions({ request: request.row, options: { roleIds: [] } });
      if (keys.length) {
        const allowed: string[] = [];
        for (const userId of candidates) {
          // oxlint-disable-next-line no-await-in-loop -- 交易內逐人以同一個交易查（不從連線池另取連線，PermissionService.getPermissionSet）
          const set = await this.permissionService.getPermissionSet(userId, tx);
          if (set.isSuperAdmin || keys.every((key) => set.permissions.has(key)))
            allowed.push(userId);
        }
        candidates = allowed;
      }
    }
    const sorted = candidates.toSorted();
    const required = step.requiredMode === 'all' ? sorted.length : (step.requiredApprovals ?? 0);
    return {
      candidates: sorted,
      required,
      shortage: this.shortageOf(candidates.length, required, 0),
    };
  }

  /** 候選人為 0 → `noCandidate`；剩下還沒決定的人不夠補足同意數 → `insufficient`。 */
  private shortageOf(candidates: number, required: number, approvals: number): StepShortage {
    if (candidates === 0) return 'noCandidate';
    return candidates < required && approvals < required ? 'insufficient' : null;
  }

  // ── 決定的交易（§9.7、D16） ───────────────────────────

  private async applyDecision(
    state: {
      request: ApprovalRequestRow;
      steps: ApprovalStepRow[];
      step: ApprovalStepRow;
      handler: ApprovalHandler;
      actor: AuthUser;
      overrideHolders: readonly string[];
      /** 最後一關權限不足時 `authz.denied` 稽核的路由。 */
      route: string;
    },
    decision: {
      decision: 'approve' | 'reject';
      comment: string | null;
      roleIds: string[];
      via: 'assignee' | 'override';
    },
    tx: Transaction,
  ): Promise<ChainDecisionResult> {
    const { request, steps, step, handler, actor } = state;
    const stepMeta = { stepOrdinal: step.ordinal, stepName: step.name, via: decision.via };
    const candidatesBefore = await this.repo.assigneeIdsOf(step.id, tx);

    await this.repo.insertDecision(
      {
        requestId: request.id,
        stepId: step.id,
        reviewerId: actor.id,
        reviewerName: actor.email,
        decision: decision.decision,
        via: decision.via,
        comment: decision.comment,
      },
      tx,
    );

    if (decision.decision === 'reject') {
      await this.recordStep(
        request,
        decision.via === 'override' ? 'approval.override' : 'approval.stepReject',
        {
          ...stepMeta,
          decision: 'reject',
          comment: decision.comment,
        },
        tx,
      );
      await this.repo.updateStep(
        step.id,
        {
          status: 'rejected',
          closedAt: new Date(),
          ...(decision.via === 'override' && { closeReason: 'override' as const }),
        },
        tx,
      );
      await this.repo.cancelOpenSteps(request.id, 'rejected', tx);
      await this.repo.setCurrentStep(request.id, null, tx);
      const row = await this.finalizer.reject(
        request,
        { reviewer: actor, comment: decision.comment, metadata: stepMeta },
        tx,
      );
      return { request: row, affectedUserIds: this.audience(request, candidatesBefore) };
    }

    const approvals = await this.repo.approvalsOf(step.id, tx);
    const required = step.requiredApprovals ?? 0;
    await this.recordStep(
      request,
      decision.via === 'override' ? 'approval.override' : 'approval.stepApprove',
      {
        ...stepMeta,
        decision: 'approve',
        comment: decision.comment,
        approvals,
        required,
      },
      tx,
    );
    if (decision.via === 'assignee' && approvals < required) {
      return { request, affectedUserIds: this.audience(request, candidatesBefore) };
    }

    await this.repo.updateStep(
      step.id,
      {
        status: 'approved',
        closedAt: new Date(),
        ...(decision.via === 'override' && { closeReason: 'override' as const }),
      },
      tx,
    );
    const next = steps.find((other) => other.ordinal > step.ordinal && other.status === 'waiting');
    if (next) {
      const nextCandidates = await this.activate(
        request,
        next,
        steps.map((other) =>
          other.id === step.id ? { ...other, status: 'approved' as const } : other,
        ),
        handler,
        state.overrideHolders,
        tx,
      );
      await this.notifyProgress(request, handler, step, next, actor, tx);
      return {
        request,
        affectedUserIds: this.audience(request, [...candidatesBefore, ...nextCandidates]),
      };
    }

    // 最後一關：核准等同代為執行（§3.2）。「是不是最後一關」要在鎖之內才知道，權限也在這裡檢查（D16）
    const ctx: ApprovalContext = {
      request,
      reviewer: actor,
      options: { roleIds: decision.roleIds },
    };
    await this.permissionService.assertHasAll(actor, handler.requiredPermissions(ctx), {
      route: state.route,
      metadata: { approvalId: request.id, type: request.type, stepOrdinal: step.ordinal },
      tx,
    });
    await handler.assertApprovable(ctx);
    await this.repo.setCurrentStep(request.id, null, tx);
    const { row, outcome } = await this.finalizer.approve(
      ctx,
      { reviewer: actor, comment: decision.comment, metadata: stepMeta },
      tx,
    );
    return {
      request: row,
      applied: { ctx: { ...ctx, request: row }, outcome },
      affectedUserIds: this.audience(request, candidatesBefore),
    };
  }

  private recordStep(
    request: ApprovalRequestRow,
    action: string,
    metadata: Record<string, unknown>,
    tx: Transaction,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'approval',
        resourceId: request.id,
        resourceName: request.requesterName,
        metadata,
      },
      tx,
    );
  }

  /**
   * 鎖住請求列並確認狀態（D16）：仍待審、目前的關卡就是畫面上的那一關、不是申請人本人（四眼）。
   * refresh 不是審核，申請人以外的 override 持有者都能做；`allowRequester` 只放寬四眼。
   */
  private async lockCurrentStep(
    id: string,
    ordinal: number,
    actor: AuthUser,
    tx: Transaction,
    options: { allowRequester?: boolean } = {},
  ): Promise<{ locked: ApprovalRequestRow; steps: ApprovalStepRow[]; step: ApprovalStepRow }> {
    const locked = await this.repo.lockRequest(id, tx);
    if (!locked) throw new AppException('APPROVAL_NOT_FOUND');
    if (locked.status !== 'pending') throw new AppException('APPROVAL_ALREADY_REVIEWED');
    if (locked.currentStep !== ordinal) {
      throw new AppException('APPROVAL_STEP_STALE', { currentStep: locked.currentStep });
    }
    if (!options.allowRequester && locked.requesterId === actor.id) {
      throw new AppException('APPROVAL_SELF_REVIEW');
    }
    const steps = await this.repo.stepsOf(id, tx);
    const step = steps.find((candidate) => candidate.ordinal === ordinal);
    if (!step || step.status !== 'active') {
      throw new AppException('APPROVAL_STEP_STALE', { currentStep: locked.currentStep });
    }
    return { locked, steps, step };
  }

  /** 多關請求（送出時走了流程）；單關請求沒有關卡可以決定。 */
  private async getChainRequest(id: string): Promise<ApprovalRequestRow> {
    const request = await this.requests.findById(id);
    // 所屬 feature 沒有開放的類型當作不存在（docs/architecture/05-tenancy.md §15.2 D3）
    if (!request || this.handlers.hiddenTypes().includes(request.type as ApprovalType)) {
      throw new AppException('APPROVAL_NOT_FOUND');
    }
    if (request.status !== 'pending') throw new AppException('APPROVAL_ALREADY_REVIEWED');
    if (request.currentStep === null)
      throw new AppException('APPROVAL_STEP_STALE', { currentStep: null });
    return request;
  }

  // ── 通知 ─────────────────────────────────────────────

  private async notifyPending(
    request: ApprovalRequestRow,
    step: Pick<ApprovalStepRow, 'name'>,
    handler: ApprovalHandler,
    recipients: readonly string[],
    tx: Transaction,
  ): Promise<void> {
    if (!recipients.length) return;
    await this.notifications.notify(
      recipients.map((recipientId) =>
        notification(APPROVAL_PENDING_NOTIFICATION, {
          recipientId,
          actorId: request.requesterId,
          params: {
            approvalType: request.type as ApprovalType,
            requesterName: request.requesterName,
            subject: handler.summarize(request.payload),
            stepName: step.name,
          },
          link: approvalTaskLink(request.id),
        }),
      ),
      tx,
    );
  }

  private async notifyUnassigned(
    request: ApprovalRequestRow,
    step: Pick<ApprovalStepRow, 'name'>,
    handler: ApprovalHandler,
    shortage: NonNullable<StepShortage>,
    overrideHolders: readonly string[],
    tx: Transaction,
  ): Promise<void> {
    const recipients = overrideHolders.filter((userId) => userId !== request.requesterId);
    if (!recipients.length) return;
    await this.notifications.notify(
      recipients.map((recipientId) =>
        notification(APPROVAL_UNASSIGNED_NOTIFICATION, {
          recipientId,
          actorId: null,
          params: {
            approvalType: request.type as ApprovalType,
            subject: handler.summarize(request.payload),
            stepName: step.name,
            shortage,
          },
          link: approvalTaskLink(request.id),
        }),
      ),
      tx,
    );
  }

  private async notifyProgress(
    request: ApprovalRequestRow,
    handler: ApprovalHandler,
    step: Pick<ApprovalStepRow, 'name'>,
    next: Pick<ApprovalStepRow, 'name'>,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<void> {
    if (!request.requesterId) return;
    await this.notifications.notify(
      notification(APPROVAL_PROGRESS_NOTIFICATION, {
        recipientId: request.requesterId,
        actorId: actor.id,
        params: {
          approvalType: request.type as ApprovalType,
          subject: handler.summarize(request.payload),
          stepName: step.name,
          nextStepName: next.name,
        },
        link: approvalTaskLink(request.id),
      }),
      tx,
    );
  }

  // ── 小工具 ───────────────────────────────────────────

  /** 推播的受眾：申請人 ＋ 這些候選人（`approval:read` 的人由 perm room 收到）。 */
  private audience(request: ApprovalRequestRow, candidates: readonly string[]): string[] {
    return [...new Set([...(request.requesterId ? [request.requesterId] : []), ...candidates])];
  }

  /** 關卡快照的 `assignee` 帶著 `label`；解析時只要規則本身。 */
  private ruleOf(
    assignee: ApprovalStepRow['assignee'] | ApprovalAssigneeRule,
  ): ApprovalAssigneeRule {
    switch (assignee.kind) {
      case 'manager':
        return { kind: 'manager', level: assignee.level };
      case 'user':
      case 'group':
      case 'role':
      case 'orgUnit':
        return { kind: assignee.kind, id: assignee.id };
    }
  }

  /** 送出當下的顯示名稱快照（對象已刪除時是空字串，前端改顯示規則本身）。 */
  async labelOf(rule: ApprovalFlowStep['assignee']): Promise<string> {
    return (await this.assignees.describe(rule))?.label ?? '';
  }
}
