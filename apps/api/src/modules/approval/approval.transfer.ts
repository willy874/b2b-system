import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '@/modules/data-transfer/data-transfer.constants';
import { defineTransferResource } from '@/modules/data-transfer/data-transfer.definition';
import type {
  ExportScope,
  LocalizedText,
  TransferEnumOption,
} from '@/modules/data-transfer/data-transfer.types';

import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_STATUSES, ApprovalType } from './approval.constants';
import type {
  ApprovalDecisionCursor,
  ApprovalDecisionExportRow,
  ApprovalExportCursor,
  ApprovalExportRow,
  ApprovalExportScope,
} from './approval.repository';
import { ApprovalRepository } from './approval.repository';
import { ListApprovalSchema } from './dto/approval.dto';

/** 匯出的篩選條件：列表的 query 去掉分頁、排序與 `scope`（匯出要 `approval:export`，看得到全部）。 */
const ApprovalExportFilterSchema = ListApprovalSchema.omit({
  offset: true,
  limit: true,
  sort: true,
  scope: true,
});
type ApprovalExportFilter = z.infer<typeof ApprovalExportFilterSchema>;

const UUID = z.string().uuid();

const TYPE_OPTIONS: TransferEnumOption[] = [
  {
    value: ApprovalType.USER_REGISTER,
    label: { 'zh-TW': '使用者註冊', 'en-US': 'User registration' },
  },
  {
    value: ApprovalType.FILE_FOLDER_ACCESS,
    label: { 'zh-TW': '資料夾存取', 'en-US': 'Folder access' },
  },
];

const STATUS_LABEL: Record<(typeof APPROVAL_STATUSES)[number], LocalizedText> = {
  pending: { 'zh-TW': '待審核', 'en-US': 'Pending' },
  approved: { 'zh-TW': '已核准', 'en-US': 'Approved' },
  rejected: { 'zh-TW': '已駁回', 'en-US': 'Rejected' },
  withdrawn: { 'zh-TW': '已撤回', 'en-US': 'Withdrawn' },
};
const STATUS_OPTIONS = APPROVAL_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }));

const DECISION_OPTIONS: TransferEnumOption[] = [
  { value: 'approve', label: { 'zh-TW': '核准', 'en-US': 'Approve' } },
  { value: 'reject', label: { 'zh-TW': '駁回', 'en-US': 'Reject' } },
];

const VIA_OPTIONS: TransferEnumOption[] = [
  { value: 'assignee', label: { 'zh-TW': '關卡審核者', 'en-US': 'Step reviewer' } },
  { value: 'override', label: { 'zh-TW': '強制定案', 'en-US': 'Override' } },
  {
    value: 'legacy',
    label: { 'zh-TW': '單關審核（多階段停用時）', 'en-US': 'Single review (chain off)' },
  },
  { value: 'single', label: { 'zh-TW': '單關審核', 'en-US': 'Single review' } },
];

/** 所屬 feature 沒有開放的類型不匯出（docs/architecture/05-tenancy.md §15.2 D3）。 */
function toScope(
  scope: ExportScope<ApprovalExportFilter>,
  excludeTypes: readonly string[],
): ApprovalExportScope {
  return scope.kind === 'ids'
    ? { ids: scope.ids, excludeTypes }
    : { filter: scope.filter, excludeTypes };
}

/**
 * 審批的匯出（docs/architecture/backend/22-data-transfer.md §12.5；只匯出）：合規查核要的是「誰申請、誰在哪一關核准或駁回、意見、時間」。
 * - `approvalRequest`：一筆請求一列；`payload` 照列表的內容輸出，`private_payload`（核准前的機密資料）一律不出現。
 * - `approvalDecision`：一個決定一列（多階段的每一關每一人；單關的請求以請求上的審核者表示）。
 * 兩者都要 `approval:export`（包含 `approval:read`：看得到全部，所以不套用申請人與候選人的可見性，§9.10）。
 */
@Injectable()
export class ApprovalTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: ApprovalRepository,
    private readonly handlers: ApprovalHandlerRegistry,
  ) {}

  private scopeOf(scope: ExportScope<ApprovalExportFilter>): ApprovalExportScope {
    return toScope(scope, this.handlers.hiddenTypes());
  }

  onModuleInit(): void {
    this.registry.register(
      defineTransferResource<ApprovalExportFilter, ApprovalExportRow>({
        type: 'approvalRequest',
        fileBaseName: 'approval-requests',
        label: { 'zh-TW': '審批請求', 'en-US': 'Approval requests' },
        columns: [
          {
            key: 'id',
            label: { 'zh-TW': 'ID', 'en-US': 'ID' },
            kind: 'string',
            export: { get: (row) => row.id },
          },
          {
            key: 'type',
            label: { 'zh-TW': '類型', 'en-US': 'Type' },
            kind: 'enum',
            enum: TYPE_OPTIONS,
            export: { get: (row) => row.type },
          },
          {
            key: 'status',
            label: { 'zh-TW': '狀態', 'en-US': 'Status' },
            kind: 'enum',
            enum: STATUS_OPTIONS,
            export: { get: (row) => row.status },
          },
          {
            key: 'requesterName',
            label: { 'zh-TW': '申請人', 'en-US': 'Requester' },
            kind: 'string',
            export: { get: (row) => row.requesterName },
          },
          {
            key: 'reason',
            label: { 'zh-TW': '申請理由', 'en-US': 'Reason' },
            kind: 'string',
            export: { get: (row) => row.reason },
          },
          {
            key: 'currentStep',
            label: { 'zh-TW': '目前關卡', 'en-US': 'Current step' },
            kind: 'string',
            export: { get: (row) => row.currentStepName },
          },
          {
            key: 'stepCount',
            label: { 'zh-TW': '關卡數', 'en-US': 'Steps' },
            kind: 'number',
            export: { get: (row) => row.stepCount },
          },
          {
            key: 'reviewerName',
            label: { 'zh-TW': '定案者', 'en-US': 'Decided by' },
            kind: 'string',
            export: { get: (row) => row.reviewerName },
          },
          {
            key: 'reviewComment',
            label: { 'zh-TW': '審核意見', 'en-US': 'Review comment' },
            kind: 'string',
            export: { get: (row) => row.reviewComment },
          },
          {
            key: 'createdAt',
            label: { 'zh-TW': '送出時間', 'en-US': 'Submitted at' },
            kind: 'datetime',
            export: { get: (row) => row.createdAt },
          },
          {
            key: 'reviewedAt',
            label: { 'zh-TW': '定案時間', 'en-US': 'Decided at' },
            kind: 'datetime',
            export: { get: (row) => row.reviewedAt },
          },
          {
            key: 'resultResourceId',
            label: { 'zh-TW': '結果資源 ID', 'en-US': 'Result resource ID' },
            kind: 'string',
            export: { get: (row) => row.resultResourceId },
          },
          {
            key: 'payload',
            label: { 'zh-TW': '申請內容', 'en-US': 'Payload' },
            kind: 'json',
            export: { get: (row) => row.payload },
          },
        ],
        exporter: {
          permissions: [PERMISSION.APPROVAL_EXPORT],
          filterSchema: ApprovalExportFilterSchema,
          idSchema: UUID,
          orderHint: { 'zh-TW': '依送出時間排序', 'en-US': 'Sorted by submission time' },
          iterate: (scope) => this.iterateRequests(scope),
          count: (scope) => this.repo.exportCount(this.scopeOf(scope)),
        },
      }),
    );

    this.registry.register(
      defineTransferResource<ApprovalExportFilter, ApprovalDecisionExportRow>({
        type: 'approvalDecision',
        fileBaseName: 'approval-decisions',
        label: { 'zh-TW': '審批決定', 'en-US': 'Approval decisions' },
        columns: [
          {
            key: 'requestId',
            label: { 'zh-TW': '請求 ID', 'en-US': 'Request ID' },
            kind: 'string',
            export: { get: (row) => row.requestId },
          },
          {
            key: 'type',
            label: { 'zh-TW': '類型', 'en-US': 'Type' },
            kind: 'enum',
            enum: TYPE_OPTIONS,
            export: { get: (row) => row.type },
          },
          {
            key: 'requesterName',
            label: { 'zh-TW': '申請人', 'en-US': 'Requester' },
            kind: 'string',
            export: { get: (row) => row.requesterName },
          },
          {
            key: 'stepOrdinal',
            label: { 'zh-TW': '關卡序', 'en-US': 'Step #' },
            kind: 'number',
            export: { get: (row) => row.stepOrdinal },
          },
          {
            key: 'stepName',
            label: { 'zh-TW': '關卡', 'en-US': 'Step' },
            kind: 'string',
            export: { get: (row) => row.stepName },
          },
          {
            key: 'reviewerName',
            label: { 'zh-TW': '審核者', 'en-US': 'Reviewer' },
            kind: 'string',
            export: { get: (row) => row.reviewerName },
          },
          {
            key: 'decision',
            label: { 'zh-TW': '決定', 'en-US': 'Decision' },
            kind: 'enum',
            enum: DECISION_OPTIONS,
            export: { get: (row) => row.decision },
          },
          {
            key: 'via',
            label: { 'zh-TW': '方式', 'en-US': 'Via' },
            kind: 'enum',
            enum: VIA_OPTIONS,
            export: { get: (row) => row.via },
          },
          {
            key: 'comment',
            label: { 'zh-TW': '意見', 'en-US': 'Comment' },
            kind: 'string',
            export: { get: (row) => row.comment },
          },
          {
            key: 'decidedAt',
            label: { 'zh-TW': '決定時間', 'en-US': 'Decided at' },
            kind: 'datetime',
            export: { get: (row) => row.decidedAt },
          },
        ],
        exporter: {
          permissions: [PERMISSION.APPROVAL_EXPORT],
          filterSchema: ApprovalExportFilterSchema,
          // 勾選的範圍是請求：匯出這些請求的決定
          idSchema: UUID,
          orderHint: { 'zh-TW': '依決定時間排序', 'en-US': 'Sorted by decision time' },
          iterate: (scope) => this.iterateDecisions(scope),
          count: (scope) => this.repo.exportDecisionCount(this.scopeOf(scope)),
        },
      }),
    );
  }

  private async *iterateRequests(
    scope: ExportScope<ApprovalExportFilter>,
  ): AsyncIterable<readonly ApprovalExportRow[]> {
    let after: ApprovalExportCursor | null = null;
    for (;;) {
      const page = await this.repo.exportPage(
        this.scopeOf(scope),
        after,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = { createdAt: last.createdAt, id: last.id };
    }
  }

  private async *iterateDecisions(
    scope: ExportScope<ApprovalExportFilter>,
  ): AsyncIterable<readonly ApprovalDecisionExportRow[]> {
    let after: ApprovalDecisionCursor | null = null;
    for (;;) {
      const page = await this.repo.exportDecisions(
        this.scopeOf(scope),
        after,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = { decidedAt: last.decidedAt, id: last.id };
    }
  }
}
