import type { ChipTone } from '@/components/Chip';
import type { ApprovalStatus, ApprovalType } from '@/shared/api-sdk';

/**
 * 狀態 → 語系鍵。key 以完整字面量寫在表裡（docs/conventions/06-literal-strings.md §3.1）；
 * `satisfies` 讓後端新增狀態或類型時編譯失敗，而不是畫面上出現原始 key。
 */
export const APPROVAL_STATUS_LABEL_KEY = {
  pending: 'approval.status.pending',
  approved: 'approval.status.approved',
  rejected: 'approval.status.rejected',
} as const satisfies Record<ApprovalStatus, string>;

export const APPROVAL_STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const satisfies Record<ApprovalStatus, ChipTone>;

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
