import type { IconName } from '@b2b-system/ui/Icon';

import type {
  FileCategory,
  FileGrantLevel,
  FileGrantSubjectType,
  FileSortField,
} from '@/apis/file/types';
import type { FileKind } from '@/core/file';
import type { FileFolder } from '@/shared/api-sdk';

/** 後端 `FILE_CATEGORIES`（篩選分類）。 */
export const FILE_CATEGORIES = [
  'image',
  'video',
  'audio',
  'text',
  'document',
  'archive',
  'other',
] as const satisfies readonly FileCategory[];

export const FILE_CATEGORY_LABEL_KEY = {
  image: 'file.category.image',
  video: 'file.category.video',
  audio: 'file.category.audio',
  text: 'file.category.text',
  document: 'file.category.document',
  archive: 'file.category.archive',
  other: 'file.category.other',
} as const satisfies Record<FileCategory, string>;

/** 列表可排序的欄位（後端白名單）。 */
export const FILE_SORT_FIELDS = [
  'createdAt',
  'name',
  'size',
] as const satisfies readonly FileSortField[];

export const FILE_SORT_LABEL_KEY = {
  createdAt: 'file.sort.createdAt',
  name: 'file.sort.name',
  size: 'file.sort.size',
} as const satisfies Record<FileSortField, string>;

export const FILE_KIND_LABEL_KEY = {
  image: 'file.kind.image',
  video: 'file.kind.video',
  audio: 'file.kind.audio',
  text: 'file.kind.text',
  code: 'file.kind.code',
  pdf: 'file.kind.pdf',
  spreadsheet: 'file.kind.spreadsheet',
  presentation: 'file.kind.presentation',
  document: 'file.kind.document',
  archive: 'file.kind.archive',
  font: 'file.kind.font',
  other: 'file.kind.other',
} as const satisfies Record<FileKind, string>;

/** 每頁筆數的選項（分頁模式）；無限捲動每次載入同樣的筆數。 */
export const FILE_PAGE_SIZES = [30, 60, 120] as const;

/** 縮圖的長邊（px）：卡片最寬約 240 px，2 倍像素密度仍清晰。 */
export const THUMBNAIL_MAX_DIMENSION = 480;
/** 後端 `THUMBNAIL_MAX_SIZE`；上傳政策還沒載入時的保守預設。 */
export const DEFAULT_THUMBNAIL_MAX_BYTES = 512 * 1024;
/** 同時上傳幾個檔案（全域佇列的 `concurrency`）；大檔另外在檔案內並行上傳分塊。 */
export const UPLOAD_CONCURRENCY = 3;
/** 沒有縮圖的圖片，小於這個大小才直接拿原檔當預覽，避免列表下載一堆大圖。 */
export const INLINE_PREVIEW_MAX_SIZE = 2 * 1024 * 1024;
/** 後端 `MAX_FOLDER_PATHS`：上傳資料夾時一次確保的路徑數，超過就分批送。 */
export const FOLDER_PATHS_PER_REQUEST = 1000;

/** 資料夾授權的等級，由低到高（docs/rbac/07-resource-grants.md §2）。 */
export const FILE_GRANT_LEVELS = [
  'viewer',
  'contributor',
  'editor',
  'manager',
] as const satisfies readonly FileGrantLevel[];

export const FILE_GRANT_LEVEL_LABEL_KEY = {
  viewer: 'file.share.levels.viewer',
  contributor: 'file.share.levels.contributor',
  editor: 'file.share.levels.editor',
  manager: 'file.share.levels.manager',
} as const satisfies Record<FileGrantLevel, string>;

export const FILE_GRANT_LEVEL_HINT_KEY = {
  viewer: 'file.share.levelHints.viewer',
  contributor: 'file.share.levelHints.contributor',
  editor: 'file.share.levelHints.editor',
  manager: 'file.share.levelHints.manager',
} as const satisfies Record<FileGrantLevel, string>;

export const FILE_GRANT_SUBJECT_TYPE_LABEL_KEY = {
  role: 'file.share.subjectType.role',
  user: 'file.share.subjectType.user',
  group: 'file.share.subjectType.group',
  everyone: 'file.share.subjectType.everyone',
} as const satisfies Record<FileGrantSubjectType, string>;

/** 移除授權的確認說明：對象是角色、群組或所有人時，影響的是一群人。 */
export const FILE_GRANT_REMOVE_CONFIRM_KEY = {
  role: 'file.share.removeConfirm.role',
  user: 'file.share.removeConfirm.user',
  group: 'file.share.removeConfirm.group',
  everyone: 'file.share.removeConfirm.everyone',
} as const satisfies Record<FileGrantSubjectType, string>;

/** 降低授權等級的確認說明（同上，依對象種類說明影響範圍）。 */
export const FILE_GRANT_DOWNGRADE_CONFIRM_KEY = {
  role: 'file.share.downgradeConfirm.role',
  user: 'file.share.downgradeConfirm.user',
  group: 'file.share.downgradeConfirm.group',
  everyone: 'file.share.downgradeConfirm.everyone',
} as const satisfies Record<FileGrantSubjectType, string>;

/** 對象種類 → 搜尋框的文案（完整字面量，docs/conventions/06-literal-strings.md）。 */
export const FILE_GRANT_SUBJECT_COPY_KEY = {
  role: {
    placeholder: 'file.share.subjectPlaceholder',
    search: 'file.share.subjectSearch',
    noMatch: 'file.share.noSubjects',
  },
  user: {
    placeholder: 'file.share.subjectPlaceholderUser',
    search: 'file.share.subjectSearchUser',
    noMatch: 'file.share.noSubjectsUser',
  },
  group: {
    placeholder: 'file.share.subjectPlaceholderGroup',
    search: 'file.share.subjectSearchGroup',
    noMatch: 'file.share.noSubjectsGroup',
  },
  // 所有人不必挑選對象：這組文案不會顯示，只為了型別完整
  everyone: {
    placeholder: 'file.share.everyone',
    search: 'file.share.everyone',
    noMatch: 'file.share.everyone',
  },
} as const satisfies Record<FileGrantSubjectType, Record<string, string>>;

/** 系統資料夾的圖示（docs/rbac/07-resource-grants.md §12）；一般資料夾是 `folder`。 */
export const FILE_FOLDER_KIND_ICON = {
  normal: 'folder',
  shared: 'users',
  privateRoot: 'user',
  personal: 'user',
} as const satisfies Record<FileFolder['kind'], IconName>;

/** `subject_type = everyone` 的 `subject_id`（後端 `EVERYONE_SUBJECT_ID`）。 */
export const EVERYONE_SUBJECT_ID = '00000000-0000-0000-0000-000000000000';
