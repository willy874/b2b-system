import type { ChipTone } from '@b2b-system/ui/Chip';

import type {
  ApprovalAssigneeRule,
  ApprovalDecision,
  ApprovalStep,
  ApprovalStatus,
  ApprovalStepStatus,
  ApprovalType,
} from '@/shared/api-sdk';
import { TenantFeature } from '@/shared/api-sdk';

/**
 * 狀態 → 語系鍵。key 以完整字面量寫在表裡（docs/coding-standards/06-literal-strings.md §3.1）；
 * `satisfies` 讓後端新增狀態或類型時編譯失敗，而不是畫面上出現原始 key。
 */
export const APPROVAL_STATUS_LABEL_KEY = {
  pending: 'approval.status.pending',
  approved: 'approval.status.approved',
  rejected: 'approval.status.rejected',
  withdrawn: 'approval.status.withdrawn',
} as const satisfies Record<ApprovalStatus, string>;

export const APPROVAL_STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
} as const satisfies Record<ApprovalStatus, ChipTone>;

/** 審批類型（後端 `ApprovalType`）：網址的篩選與類型選單用它；新增類型時與 `APPROVAL_TYPE_LABEL_KEY`、`APPROVAL_TYPE_FEATURE` 一起補。 */
export const APPROVAL_TYPES = [
  'user.register',
  'fileFolder.access',
] as const satisfies readonly ApprovalType[];

/**
 * 類型屬於哪個可啟用的 feature（`null`：常駐）。平台沒有啟用那個 feature 時，類型選單不列出它
 * （docs/architecture/frontend/02-plugin-system.md §7）；`satisfies` 讓新增類型時一定要決定它屬於誰。
 */
export const APPROVAL_TYPE_FEATURE = {
  'user.register': null,
  'fileFolder.access': TenantFeature.file,
} as const satisfies Record<ApprovalType, TenantFeature | null>;

/**
 * 審批列表的狀態切換（docs/architecture/backend/20-approval.md §11.2）：預設待審；`all` 是不篩選。
 */
export const APPROVAL_LIST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'all',
] as const;
export type ApprovalListStatus = (typeof APPROVAL_LIST_STATUSES)[number];

export const APPROVAL_LIST_STATUS_LABEL_KEY = {
  pending: 'approval.status.pending',
  approved: 'approval.status.approved',
  rejected: 'approval.status.rejected',
  withdrawn: 'approval.status.withdrawn',
  all: 'approval.status.all',
} as const satisfies Record<ApprovalListStatus, string>;

/** 列表的空狀態：依目前的狀態切換說明為什麼是空的。 */
export const APPROVAL_LIST_EMPTY_KEY = {
  pending: 'approval.list.empty.pending',
  approved: 'approval.list.empty.other',
  rejected: 'approval.list.empty.other',
  withdrawn: 'approval.list.empty.other',
  all: 'approval.list.empty.all',
} as const satisfies Record<ApprovalListStatus, string>;

/**
 * 核准的結果句（docs/architecture/backend/20-approval.md §11.3、§12 D7）：`pending` 是「核准後會怎樣」，`done` 是「已經怎樣」。
 * 參數由詳情的 adapter 依類型取出（`outcomeParams`）。新增類型時 `satisfies` 讓編譯失敗，提醒補句子。
 */
export const APPROVAL_OUTCOME_KEY = {
  'user.register': {
    pending: 'approval.outcome.userRegister.pending',
    done: 'approval.outcome.userRegister.done',
  },
  'fileFolder.access': {
    pending: 'approval.outcome.fileFolderAccess.pending',
    done: 'approval.outcome.fileFolderAccess.done',
  },
} as const satisfies Record<ApprovalType, { pending: string; done: string }>;

/** 「我的審批」的分頁：待我審核、我的申請（docs/architecture/backend/20-approval.md §9.10）。 */
export const MY_APPROVAL_TABS = ['assigned', 'mine'] as const;
export type MyApprovalTab = (typeof MY_APPROVAL_TABS)[number];

export const MY_APPROVAL_TAB_LABEL_KEY = {
  assigned: 'approval.my.tab.assigned',
  mine: 'approval.my.tab.mine',
} as const satisfies Record<MyApprovalTab, string>;

// ── 多階段（docs/architecture/backend/20-approval.md §9） ──

/**
 * 多階段審批在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`）。審批本身常駐，關卡的操作與「待我審核」以
 * `useIsFeatureReady` 跟著它顯示；流程設定頁是另一個 feature（`features/approval-flow`）。
 */
export const APPROVAL_CHAIN_FEATURE = 'approvalChain';

export const APPROVAL_STEP_STATUS_LABEL_KEY = {
  waiting: 'approval.step.status.waiting',
  active: 'approval.step.status.active',
  approved: 'approval.step.status.approved',
  rejected: 'approval.step.status.rejected',
  skipped: 'approval.step.status.skipped',
  cancelled: 'approval.step.status.cancelled',
} as const satisfies Record<ApprovalStepStatus, string>;

export const APPROVAL_STEP_STATUS_TONE = {
  waiting: 'neutral',
  active: 'warning',
  approved: 'success',
  rejected: 'danger',
  skipped: 'neutral',
  cancelled: 'neutral',
} as const satisfies Record<ApprovalStepStatus, ChipTone>;

export const APPROVAL_SHORTAGE_LABEL_KEY = {
  noCandidate: 'approval.step.shortage.noCandidate',
  insufficient: 'approval.step.shortage.insufficient',
} as const satisfies Record<NonNullable<ApprovalStep['shortage']>, string>;

export const APPROVAL_CLOSE_REASON_LABEL_KEY = {
  rejected: 'approval.step.closeReason.rejected',
  withdrawn: 'approval.step.closeReason.withdrawn',
  chainDisabled: 'approval.step.closeReason.chainDisabled',
  override: 'approval.step.closeReason.override',
} as const satisfies Record<NonNullable<ApprovalStep['closeReason']>, string>;

export const APPROVAL_DECISION_LABEL_KEY = {
  approve: 'approval.step.decision.approve',
  reject: 'approval.step.decision.reject',
} as const satisfies Record<ApprovalDecision['decision'], string>;

export const APPROVAL_DECISION_VIA_LABEL_KEY = {
  assignee: 'approval.step.via.assignee',
  override: 'approval.step.via.override',
  legacy: 'approval.step.via.legacy',
} as const satisfies Record<ApprovalDecision['via'], string>;

/** 規則的種類；`manager` 另外帶層數（`approval.step.assignee.manager` 用 `{{level}}`）。 */
export const APPROVAL_ASSIGNEE_KIND_LABEL_KEY = {
  user: 'approval.step.assignee.user',
  group: 'approval.step.assignee.group',
  role: 'approval.step.assignee.role',
  manager: 'approval.step.assignee.manager',
  orgUnit: 'approval.step.assignee.orgUnit',
} as const satisfies Record<ApprovalAssigneeRule['kind'], string>;

export const APPROVAL_TYPE_LABEL_KEY = {
  'user.register': 'approval.type.userRegister',
  'fileFolder.access': 'approval.type.fileFolderAccess',
} as const satisfies Record<ApprovalType, string>;

/** `fileFolder.access` 申請的等級（後端 `grant_level`）；不跨 feature 引用檔案管理器的語系。 */
export const FILE_ACCESS_LEVELS = ['viewer', 'contributor', 'editor', 'manager'] as const;
export type FileAccessLevel = (typeof FILE_ACCESS_LEVELS)[number];

export const FILE_ACCESS_LEVEL_LABEL_KEY = {
  viewer: 'approval.fileAccess.level.viewer',
  contributor: 'approval.fileAccess.level.contributor',
  editor: 'approval.fileAccess.level.editor',
  manager: 'approval.fileAccess.level.manager',
} as const satisfies Record<FileAccessLevel, string>;
