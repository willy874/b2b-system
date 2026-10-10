// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

export interface RichTextMark {
  type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link';
  attrs?: Record<string, unknown>;
}

export interface RichTextNode {
  type:
    | 'paragraph'
    | 'heading'
    | 'bulletList'
    | 'orderedList'
    | 'listItem'
    | 'blockquote'
    | 'codeBlock'
    | 'horizontalRule'
    | 'hardBreak'
    | 'text';
  attrs?: Record<string, unknown>;
  content?: Array<RichTextNode>;
  text?: string;
  marks?: Array<RichTextMark>;
}

export interface RichTextDocument {
  type: 'doc';
  content: Array<RichTextNode>;
}

export interface ImageSourceVariant {
  src: string;
  srcSet: string;
  sources: Array<{
    type: string;
    srcSet: string;
  }>;
  width: number;
  height: number;
}

export interface ImageSources {
  width: number;
  height: number;
  expiresAt: string;
  variants: Record<string, ImageSourceVariant>;
}

export const NotificationChannel = {
  inApp: 'inApp',
  email: 'email',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export interface NotificationEventChannel {
  channel: NotificationChannel;
  enabled: boolean;
  defaultEnabled: boolean;
  isOverridden: boolean;
  allowUserOverride: boolean;
  updatedAt: string | null;
}

export interface NotificationEvent {
  type: string;
  category: string;
  mandatory: boolean;
  channels: Array<NotificationEventChannel>;
}

export interface NotificationEventList {
  items: Array<NotificationEvent>;
}

export interface UpdateNotificationEventsRequest {
  changes: Array<{
    type: string;
    channel: NotificationChannel;
    enabled?: boolean | null;
    allowUserOverride?: boolean;
  }>;
}

export interface NotificationLink {
  route: string;
  params: Record<string, string>;
}

export interface Notification {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: NotificationLink | null;
  actor: {
    id: string;
    name: string;
  } | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: Array<Notification>;
  nextCursor: string | null;
}

export interface NotificationUnreadCount {
  count: number;
}

export interface NotificationReadAllResult {
  updated: number;
}

export interface NotificationOverviewItem {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: NotificationLink | null;
  actor: {
    id: string;
    name: string;
  } | null;
  readAt: string | null;
  createdAt: string;
  recipient: {
    id: string;
    name: string;
  };
}

export interface NotificationOverviewPage {
  items: Array<NotificationOverviewItem>;
  nextCursor: string | null;
}

export interface NotificationPreferenceChannel {
  channel: NotificationChannel;
  enabled: boolean;
  isOverridden: boolean;
  lock: ('mandatory' | 'tenantDisabled' | 'tenantRequired') | null;
}

export interface NotificationPreference {
  type: string;
  category: string;
  channels: Array<NotificationPreferenceChannel>;
}

export interface NotificationPreferenceList {
  items: Array<NotificationPreference>;
}

export interface UpdateNotificationPreferencesRequest {
  changes: Array<{
    type: string;
    channel: NotificationChannel;
    enabled: boolean | null;
  }>;
}

export const TrashResourceType = {
  user: 'user',
  role: 'role',
  group: 'group',
  file: 'file',
  fileFolder: 'fileFolder',
  announcement: 'announcement',
  orgUnit: 'orgUnit',
  galleryItem: 'galleryItem',
  galleryAlbum: 'galleryAlbum',
} as const;
export type TrashResourceType = (typeof TrashResourceType)[keyof typeof TrashResourceType];

export interface TrashItem {
  id: string;
  type: TrashResourceType;
  name: string;
  description: string | null;
  deletedAt: string;
  deletedBy: {
    id: string;
    name: string;
  } | null;
  purgeAt: string;
}

export interface AnnouncementAudience {
  all: boolean;
  userIds: Array<string>;
  groupIds: Array<string>;
  roleIds: Array<string>;
}

export type AnnouncementTrigger =
  | {
      kind: 'immediate';
    }
  | {
      kind: 'once';
      at: string;
    }
  | {
      kind: 'recurring';
      frequency: 'daily' | 'weekly' | 'monthly';
      interval: number;
      weekdays?: Array<number> | null;
      monthDay?: (number | 'last') | null;
      time: string;
      startsOn: string;
      endsOn?: string | null;
      maxOccurrences?: number | null;
    }
  | {
      kind: 'event';
      event: string;
      delayMinutes: number;
    };

export interface AnnouncementTriggerEventList {
  items: Array<{
    event: string;
    scope: 'audience' | 'group' | 'role';
  }>;
}

export interface AnnouncementRecurrencePreviewRequest {
  trigger: {
    kind: 'recurring';
    frequency: 'daily' | 'weekly' | 'monthly';
    interval: number;
    weekdays?: Array<number> | null;
    monthDay?: (number | 'last') | null;
    time: string;
    startsOn: string;
    endsOn?: string | null;
    maxOccurrences?: number | null;
  };
}

export interface AnnouncementRecurrencePreview {
  timeZone: string;
  occurrences: Array<string>;
}

export interface Announcement {
  id: string;
  title: string;
  body: RichTextDocument;
  audience: AnnouncementAudience;
  trigger: AnnouncementTrigger;
  status: 'draft' | 'scheduled' | 'paused' | 'completed';
  nextRunAt: string | null;
  lastDispatch: {
    id: string;
    status: 'pending' | 'sending' | 'sent' | 'failed' | 'revoked';
    scheduledFor: string;
    recipientCount: number | null;
    readCount: number;
  } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    displayName: string;
  } | null;
  updatedBy: {
    id: string;
    displayName: string;
  } | null;
}

export interface CreateAnnouncementRequest {
  title: string;
  body: RichTextDocument;
  audience: AnnouncementAudience;
  trigger: AnnouncementTrigger;
}

export interface UpdateAnnouncementRequest {
  title?: string;
  body?: RichTextDocument;
  audience?: AnnouncementAudience;
  trigger?: AnnouncementTrigger;
  version: number;
}

export interface AnnouncementActionRequest {
  version: number;
}

export interface AnnouncementAudiencePreview {
  count: number;
  skipped: {
    userIds: Array<string>;
    groupIds: Array<string>;
    roleIds: Array<string>;
  };
}

export interface AnnouncementDispatch {
  id: string;
  announcementId: string;
  scheduledFor: string;
  title: string;
  body: RichTextDocument;
  audience: AnnouncementAudience;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'revoked';
  recipientCount: number | null;
  readCount: number;
  details: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  revokedAt: string | null;
  createdBy: {
    id: string;
    displayName: string;
  } | null;
  revokedBy: {
    id: string;
    displayName: string;
  } | null;
}

export interface AnnouncementMessage {
  dispatchId: string;
  title: string;
  body: RichTextDocument;
  sentAt: string;
  sender: {
    id: string;
    displayName: string;
  } | null;
}

export const PermissionKey = {
  'user:create': 'user:create',
  'user:read': 'user:read',
  'user:update': 'user:update',
  'user:delete': 'user:delete',
  'user:assignRole': 'user:assignRole',
  'user:resetPassword': 'user:resetPassword',
  'user:resetMfa': 'user:resetMfa',
  'user:export': 'user:export',
  'role:create': 'role:create',
  'role:read': 'role:read',
  'role:update': 'role:update',
  'role:delete': 'role:delete',
  'role:grantPermission': 'role:grantPermission',
  'role:export': 'role:export',
  'permission:read': 'permission:read',
  'auditLog:read': 'auditLog:read',
  'auditLog:export': 'auditLog:export',
  'system:read': 'system:read',
  'system:update': 'system:update',
  'approval:read': 'approval:read',
  'approval:review': 'approval:review',
  'approval:override': 'approval:override',
  'approval:export': 'approval:export',
  'file:create': 'file:create',
  'file:read': 'file:read',
  'file:update': 'file:update',
  'file:delete': 'file:delete',
  'file:access': 'file:access',
  'file:share': 'file:share',
  'file:listPersonal': 'file:listPersonal',
  'job:read': 'job:read',
  'job:retry': 'job:retry',
  'identityProvider:create': 'identityProvider:create',
  'identityProvider:read': 'identityProvider:read',
  'identityProvider:update': 'identityProvider:update',
  'identityProvider:delete': 'identityProvider:delete',
  'group:create': 'group:create',
  'group:read': 'group:read',
  'group:update': 'group:update',
  'group:delete': 'group:delete',
  'group:assignRole': 'group:assignRole',
  'group:export': 'group:export',
  'authz:explain': 'authz:explain',
  'serviceAccount:create': 'serviceAccount:create',
  'serviceAccount:read': 'serviceAccount:read',
  'serviceAccount:update': 'serviceAccount:update',
  'serviceAccount:delete': 'serviceAccount:delete',
  'serviceAccount:export': 'serviceAccount:export',
  'webhook:create': 'webhook:create',
  'webhook:read': 'webhook:read',
  'webhook:update': 'webhook:update',
  'webhook:delete': 'webhook:delete',
  'tag:create': 'tag:create',
  'tag:update': 'tag:update',
  'tag:delete': 'tag:delete',
  'tag:export': 'tag:export',
  'notification:read': 'notification:read',
  'announcement:create': 'announcement:create',
  'announcement:read': 'announcement:read',
  'announcement:update': 'announcement:update',
  'announcement:delete': 'announcement:delete',
  'announcement:publish': 'announcement:publish',
  'mfaPolicy:read': 'mfaPolicy:read',
  'mfaPolicy:update': 'mfaPolicy:update',
  'orgUnit:create': 'orgUnit:create',
  'orgUnit:read': 'orgUnit:read',
  'orgUnit:update': 'orgUnit:update',
  'orgUnit:delete': 'orgUnit:delete',
  'orgUnit:export': 'orgUnit:export',
  'approvalFlow:read': 'approvalFlow:read',
  'approvalFlow:update': 'approvalFlow:update',
  'gallery:create': 'gallery:create',
  'gallery:read': 'gallery:read',
  'gallery:update': 'gallery:update',
  'gallery:delete': 'gallery:delete',
  'comment:delete': 'comment:delete',
} as const;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];

export interface Permission {
  id: string;
  key: PermissionKey;
  resource: string;
  action: string;
  nameI18nKey: string;
  description: string | null;
  sortOrder: number;
  includes: Array<PermissionKey>;
  requires: Array<PermissionKey>;
}

export interface PermissionSource {
  grantedKey: string;
  grantedNameI18nKey: string;
  via: Array<ExplainNode>;
}

export interface EffectivePermission {
  key: PermissionKey;
  source: PermissionSource;
  impliedBy: Array<PermissionKey>;
}

export interface PermissionGroup {
  resource: string;
  nameI18nKey: string;
  keys: Array<PermissionKey>;
}

export interface PermissionCatalog {
  items: Array<Permission>;
  groups: Array<PermissionGroup>;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: Array<PermissionKey> | null;
  status: 'active' | 'expired' | 'revoked' | 'invalidated';
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    displayName: string;
  } | null;
}

export interface ApiTokenList {
  items: Array<ApiToken>;
}

export interface CreateApiTokenRequest {
  name: string;
  expiresInDays: number;
  scopes?: Array<PermissionKey> | null;
}

export interface CreatedApiToken {
  token: string;
  apiToken: ApiToken;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageUsage {
  id: string;
  maxSize: number;
  contentTypes: Array<string>;
  minWidth: number;
  minHeight: number;
  aspectRatio: number | null;
  presets: Record<string, number>;
  sources: Array<string> | null;
}

export interface ImageUsageList {
  items: Array<ImageUsage>;
}

export interface ImageOriginal {
  url: string;
  width: number;
  height: number;
  expiresAt: string;
}

export interface ImageAsset {
  id: string;
  usage: string;
  status: 'pending' | 'ready' | 'failed';
  failureReason: ('notImage' | 'typeNotAllowed' | 'tooLarge' | 'tooSmall' | 'missing') | null;
  name: string;
  source: string;
  width: number | null;
  height: number | null;
  crop: ImageCrop | null;
  image: ImageSources | null;
  original: ImageOriginal | null;
  isInUse: boolean;
  createdAt: string;
}

export interface ImageAssetList {
  items: Array<ImageAsset>;
}

export interface CreateImageUploadRequest {
  usage: string;
  name: string;
  contentType: string;
  size: number;
}

export interface ImageUploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ImageUpload {
  asset: ImageAsset;
  upload: ImageUploadTarget;
}

export interface CompleteImageUploadRequest {
  crop?: ImageCrop;
}

export interface CreateImageFromSourceRequest {
  usage: string;
  source: string;
  refId: string;
  crop?: ImageCrop;
}

export interface CommentUser {
  id: string;
  displayName: string;
  email: string;
}

export interface Comment {
  id: string;
  resourceType: string;
  resourceId: string;
  body: string;
  author: CommentUser | null;
  authorAvatar: ImageSources | null;
  mentions: Array<CommentUser>;
  version: number;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CommentPage {
  items: Array<Comment>;
  nextCursor: string | null;
}

export interface CreateCommentRequest {
  body: string;
  mentionIds: Array<string>;
}

export interface UpdateCommentRequest {
  body: string;
  mentionIds: Array<string>;
  version: number;
}

export interface MentionableList {
  items: Array<CommentUser>;
}

export interface WatchState {
  watching: boolean;
  watcherCount: number;
}

export interface DataTransfer {
  id: string;
  direction: 'export' | 'import';
  type: string;
  mode: ('create' | 'update') | null;
  format: 'csv' | 'xlsx' | 'json' | 'yaml' | 'sql';
  status: 'queued' | 'running' | 'applying' | 'completed' | 'failed' | 'cancelled' | 'expired';
  scopeKind: ('ids' | 'filter') | null;
  columns: Array<string>;
  sourceName: string | null;
  outputName: string | null;
  outputSize: number | null;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  version: number;
  expiresAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CancelDataTransferRequest {
  version: number;
}

export interface DataTransferDownload {
  url: string;
  expiresAt: string;
  fileName: string;
}

export interface DataTransferOption {
  value: string;
  label: string;
}

export interface DataTransferExportColumn {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'reference' | 'json';
}

export interface DataTransferResource {
  type: string;
  label: string;
  export: {
    formats: Array<'csv' | 'xlsx' | 'json' | 'yaml' | 'sql'>;
    columns: Array<DataTransferExportColumn>;
    orderHint: string | null;
  } | null;
  importModes: Array<'create' | 'update'>;
}

export interface DataTransferResourceList {
  items: Array<DataTransferResource>;
}

export interface DataTransferImportColumn {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'reference' | 'json';
  required: boolean;
  multiple: boolean;
  matchKey: number | null;
  unique: boolean;
  nullable: boolean;
  suggest: boolean;
  hint: string | null;
  options: Array<DataTransferOption> | null;
  transitions: Record<string, Array<string>> | null;
  sameFile: string | null;
}

export interface DataTransferImportColumnList {
  items: Array<DataTransferImportColumn>;
  readOnly: Array<{
    key: string;
    label: string;
  }>;
}

export interface DataTransferReferenceOptionList {
  items: Array<{
    id: string;
    label: string;
  }>;
}

export interface DataTransferTargetOptionList {
  items: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
}

export interface DataTransferRowIssue {
  column: string | null;
  code: string;
  params?: Record<string, unknown>;
  severity: 'error' | 'warning';
}

export interface DataTransferImportTarget {
  id: string;
  label: string;
  version: number;
  current: Record<string, string>;
  expected?: Record<string, unknown>;
}

export interface DataTransferRowValidation {
  rowNo: number;
  issues: Array<DataTransferRowIssue>;
  target?: DataTransferImportTarget;
  changed?: Array<string>;
}

export interface DataTransferImportRow {
  rowNo: number;
  sourceRow: number | null;
  cells: Record<string, string>;
  targetId?: string | null;
}

export type DataTransferImportAnalysis =
  | {
      status: 'needsMapping';
      fileName: string;
      headers: Array<{
        index: number;
        text: string;
        suggestion: string | null;
      }>;
      samples: Array<Array<string>>;
      ignored: Array<{
        index: number;
        header: string;
        reason: 'readOnly' | 'forbidden';
      }>;
      columns: Array<DataTransferImportColumn>;
      sheets?: Array<string>;
    }
  | {
      status: 'ok';
      fileName: string;
      columns: Array<DataTransferImportColumn>;
      ignored: Array<{
        header: string;
        reason: 'readOnly' | 'forbidden' | 'unmapped';
      }>;
      rows: Array<DataTransferImportRow>;
      results: Array<DataTransferRowValidation>;
      sheets?: Array<string>;
    };

export interface ValidateImportRequest {
  mode: 'create' | 'update';
  rows: Array<{
    rowNo: number;
    cells: Record<string, string>;
    targetId?: string | null;
  }>;
  fileKeys?: Record<string, Array<string>>;
}

export interface ValidateImportResult {
  rows: Array<DataTransferRowValidation>;
}

export interface CreateImportRequest {
  type: string;
  mode: 'create' | 'update';
  fileName?: string;
  skipInvalid: boolean;
  rows: Array<{
    rowNo: number;
    sourceRow?: number | null;
    cells: Record<string, string>;
    targetId?: string | null;
    target?: {
      id: string;
      version: number;
      expected?: Record<string, unknown>;
    };
  }>;
}

export interface CreateExportRequest {
  type: string;
  format: 'csv' | 'xlsx' | 'json' | 'yaml' | 'sql';
  scope:
    | {
        kind: 'ids';
        ids: Array<string>;
      }
    | {
        kind: 'filter';
        filter: Record<string, unknown>;
      };
  columns?: Array<string>;
}

export interface DataTransferApplyRow {
  rowNo: number;
  sourceRow: number | null;
  cells: Record<string, string>;
  outcome: 'pending' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  error: Record<string, unknown> | null;
  changes: Record<string, Array<string | string>> | null;
  resultId: string | null;
}

export interface DataTransferApplyRowList {
  items: Array<DataTransferApplyRow>;
  nextRowNo: number | null;
}

export const AuditResourceType = {
  user: 'user',
  role: 'role',
  group: 'group',
  file: 'file',
  fileFolder: 'fileFolder',
  serviceAccount: 'serviceAccount',
  apiToken: 'apiToken',
  webhook: 'webhook',
  tag: 'tag',
  announcement: 'announcement',
  orgUnit: 'orgUnit',
  approval: 'approval',
  approvalFlow: 'approvalFlow',
  comment: 'comment',
  galleryItem: 'galleryItem',
  galleryAlbum: 'galleryAlbum',
  auth: 'auth',
  authz: 'authz',
  auditLog: 'auditLog',
  dataTransfer: 'dataTransfer',
  identityProvider: 'identityProvider',
  job: 'job',
  mfaPolicy: 'mfaPolicy',
  notificationPolicy: 'notificationPolicy',
  setting: 'setting',
} as const;
export type AuditResourceType = (typeof AuditResourceType)[keyof typeof AuditResourceType];

export interface AuditLogSummary {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  result: 'success' | 'failure';
  errorCode: string | null;
}

export interface AuditLogList {
  items: Array<AuditLogSummary>;
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
  nextCursor: string | null;
}

export interface AuditLog {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  result: 'success' | 'failure';
  errorCode: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface WebhookTarget {
  id: string;
  url: string;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
}

export interface Webhook {
  id: string;
  name: string;
  targets: Array<WebhookTarget>;
  events: Array<string>;
  status: 'active' | 'disabled';
  disabledReason: ('manual' | 'failing') | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    displayName: string;
  } | null;
}

export interface CreateWebhookRequest {
  name: string;
  urls: Array<string>;
  events: Array<string>;
}

export interface UpdateWebhookRequest {
  name?: string;
  urls?: Array<string>;
  events?: Array<string>;
  status?: 'active' | 'disabled';
  version: number;
}

export interface CreatedWebhook {
  secret: string;
  webhook: Webhook;
}

export interface WebhookSecret {
  secret: string;
  webhook: Webhook;
}

export interface WebhookEventList {
  items: Array<{
    type: string;
    version: number;
  }>;
}

export interface WebhookUrlLimit {
  max: number;
  available: number;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  occurredAt: string;
  targetId: string | null;
  url: string;
  attempt: number;
  trigger: 'auto' | 'manual';
  succeeded: boolean;
  responseStatus: number | null;
  durationMs: number;
  responseBody: string | null;
  error: string | null;
  createdAt: string;
}

export interface WebhookTestResult {
  items: Array<WebhookDelivery>;
}

export type ApprovalAssigneeRule =
  | {
      kind: 'user';
      id: string;
    }
  | {
      kind: 'group';
      id: string;
    }
  | {
      kind: 'role';
      id: string;
    }
  | {
      kind: 'manager';
      level: number;
    }
  | {
      kind: 'orgUnit';
      id: string;
    };

export interface ApprovalCondition {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: (number | string) | Array<number | string>;
}

export interface ApprovalFlowStepInput {
  key?: string;
  name: string;
  assignee: ApprovalAssigneeRule;
  requiredApprovals: number | 'all';
  conditions: Array<ApprovalCondition>;
}

export interface PutApprovalFlowRequest {
  enabled: boolean;
  allowRepeatApprover: boolean;
  steps: Array<ApprovalFlowStepInput>;
  version?: number;
}

export interface ApprovalAssigneeStatus {
  label: string;
  available: boolean;
  deleted: boolean;
}

export interface ApprovalFlowStep {
  key: string;
  name: string;
  assignee: ApprovalAssigneeRule;
  assigneeStatus: ApprovalAssigneeStatus;
  requiredApprovals: number | 'all';
  conditions: Array<ApprovalCondition>;
}

export interface ApprovalConditionField {
  key: string;
  type: 'number' | 'string' | 'enum';
  options: Array<string> | null;
  example: (number | string) | null;
}

export interface ApprovalFlow {
  type: string;
  requester: 'user' | 'anonymous';
  fields: Array<ApprovalConditionField>;
  requiredPermissions: Array<{
    key: string;
    nameI18nKey: string;
  }>;
  inFlightCount: number;
  flow: {
    id: string;
    enabled: boolean;
    allowRepeatApprover: boolean;
    steps: Array<ApprovalFlowStep>;
    version: number;
    updatedAt: string;
  } | null;
}

export interface ApprovalFlowList {
  items: Array<ApprovalFlow>;
  assigneeKinds: {
    user: boolean;
    group: boolean;
    role: boolean;
    manager: boolean;
    orgUnit: boolean;
  };
}

export interface ApprovalFlowStats {
  days: number;
  submitted: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  averageHours: number | null;
  pending: number;
  currentSteps: Array<{
    name: string;
    pending: number;
    shortage: number;
  }>;
}

export interface PreviewApprovalFlowRequest {
  steps?: Array<ApprovalFlowStepInput>;
  allowRepeatApprover?: boolean;
  requesterId?: string | null;
  fields: Record<string, (number | string) | null>;
}

export interface ApprovalCandidate {
  userId: string;
  name: string;
}

export interface ApprovalFlowPreview {
  steps: Array<{
    key: string;
    name: string;
    skipped: boolean;
    candidates: Array<ApprovalCandidate>;
    required: number | null;
    shortage: ('noCandidate' | 'insufficient') | null;
  }>;
}

export const ApprovalStatus = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ApprovalType = {
  'user.register': 'user.register',
  'fileFolder.access': 'fileFolder.access',
} as const;
export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  requesterId: string | null;
  requesterName: string;
  reason: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  resultResourceId: string | null;
  flowVersion: number | null;
  currentStep: {
    ordinal: number;
    name: string;
    approvals: number;
    required: number;
    shortage: ('noCandidate' | 'insufficient') | null;
    activatedAt: string | null;
    pendingReviewers: Array<string>;
    pendingCount: number;
  } | null;
  stepCount: number;
  resubmittedFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ApprovalStepStatus = {
  waiting: 'waiting',
  active: 'active',
  approved: 'approved',
  rejected: 'rejected',
  skipped: 'skipped',
  cancelled: 'cancelled',
} as const;
export type ApprovalStepStatus = (typeof ApprovalStepStatus)[keyof typeof ApprovalStepStatus];

export interface ApprovalDecision {
  reviewerId: string | null;
  reviewerName: string;
  decision: 'approve' | 'reject';
  via: 'assignee' | 'override' | 'legacy';
  comment: string | null;
  decidedAt: string;
}

export interface ApprovalStep {
  ordinal: number;
  key: string;
  name: string;
  assignee: ApprovalAssigneeRule & {
    label: string;
  };
  requiredMode: 'count' | 'all';
  required: number | null;
  status: ApprovalStepStatus;
  shortage: ('noCandidate' | 'insufficient') | null;
  closeReason: ('rejected' | 'withdrawn' | 'chainDisabled' | 'override') | null;
  conditions: Array<ApprovalCondition>;
  activatedAt: string | null;
  closedAt: string | null;
  candidates: Array<{
    userId: string;
    name: string;
  }>;
  decisions: Array<ApprovalDecision>;
}

export interface ApprovalViewer {
  canDecide: boolean;
  canOverride: boolean;
  canReviewSingle: boolean;
  canWithdraw: boolean;
}

export interface ApprovalRequestDetail {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  requesterId: string | null;
  requesterName: string;
  reason: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  resultResourceId: string | null;
  flowVersion: number | null;
  currentStep: {
    ordinal: number;
    name: string;
    approvals: number;
    required: number;
    shortage: ('noCandidate' | 'insufficient') | null;
    activatedAt: string | null;
    pendingReviewers: Array<string>;
    pendingCount: number;
  } | null;
  stepCount: number;
  resubmittedFrom: string | null;
  createdAt: string;
  updatedAt: string;
  steps: Array<ApprovalStep>;
  viewer: ApprovalViewer;
  resubmittedTo: string | null;
}

export interface ApprovalCounts {
  assigned: number;
  pending: number | null;
}

export interface ApproveApprovalRequest {
  comment?: string;
  roleIds: Array<string>;
}

export interface RejectApprovalRequest {
  comment?: string;
}

export interface DecideApprovalStepRequest {
  decision: 'approve' | 'reject';
  comment?: string;
  roleIds: Array<string>;
}

export interface OverrideApprovalStepRequest {
  decision: 'approve' | 'reject';
  comment: string;
  roleIds: Array<string>;
}

export interface IdentityProviderDomain {
  domain: string;
  ssoOnly: boolean;
}

export interface SamlCertificate {
  pem: string;
  subject: string;
  notAfter: string;
  fingerprint: string;
}

export interface SamlSettings {
  ssoUrl: string;
  certificates: Array<SamlCertificate>;
  nameIdFormat: 'persistent' | 'emailAddress' | 'unspecified';
  emailAttribute: string | null;
  nameAttribute: string | null;
  spEntityId: string;
}

export interface IdentityProvider {
  id: string;
  name: string;
  protocol: 'oidc' | 'saml';
  preset: 'generic' | 'google' | 'microsoft' | 'okta' | 'keycloak';
  issuer: string;
  clientId: string | null;
  scopes: string;
  enabled: boolean;
  unmatchedPolicy: 'reject' | 'auto_create';
  domains: Array<IdentityProviderDomain>;
  saml: SamlSettings | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityProviderList {
  items: Array<IdentityProvider>;
  callbackUrl: string;
  samlAcsUrl: string;
}

export type CreateIdentityProviderRequest =
  | {
      name: string;
      enabled: boolean;
      unmatchedPolicy: 'reject' | 'auto_create';
      domains: Array<IdentityProviderDomain>;
      protocol: 'oidc';
      preset: 'generic' | 'google' | 'microsoft' | 'okta' | 'keycloak';
      issuer: string;
      clientId: string;
      clientSecret: string;
      scopes: string;
    }
  | {
      name: string;
      enabled: boolean;
      unmatchedPolicy: 'reject' | 'auto_create';
      domains: Array<IdentityProviderDomain>;
      protocol: 'saml';
      entityId: string;
      ssoUrl: string;
      certificates: Array<string>;
      nameIdFormat: 'persistent' | 'emailAddress' | 'unspecified';
      emailAttribute: string | null;
      nameAttribute: string | null;
    };

export type UpdateIdentityProviderRequest =
  | {
      name?: string;
      enabled?: boolean;
      unmatchedPolicy?: 'reject' | 'auto_create';
      domains?: Array<IdentityProviderDomain>;
      protocol: 'oidc';
      preset?: 'generic' | 'google' | 'microsoft' | 'okta' | 'keycloak';
      issuer?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
    }
  | {
      name?: string;
      enabled?: boolean;
      unmatchedPolicy?: 'reject' | 'auto_create';
      domains?: Array<IdentityProviderDomain>;
      protocol: 'saml';
      entityId?: string;
      ssoUrl?: string;
      certificates?: Array<string>;
      nameIdFormat?: 'persistent' | 'emailAddress' | 'unspecified';
      emailAttribute?: string | null;
      nameAttribute?: string | null;
    };

export interface UserIdentity {
  id: string;
  providerId: string;
  providerName: string;
  protocol: 'oidc' | 'saml';
  providerDeleted: boolean;
  subject: string;
  email: string | null;
  linkedAt: string;
  lastLoginAt: string | null;
}

export interface UserIdentityList {
  items: Array<UserIdentity>;
}

export interface PlatformNotification {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: {
    route: string;
    params: Record<string, string>;
  } | null;
  readAt: string | null;
  createdAt: string;
}

export interface PlatformNotificationUnreadCount {
  count: number;
}

export interface PlatformAdmin {
  id: string;
  email: string;
  displayName: string;
  role: 'super-admin' | 'operator' | 'auditor';
  status: 'active' | 'inactive' | 'locked' | 'pending';
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface PlatformAdminList {
  items: Array<PlatformAdmin>;
}

export interface CreatePlatformAdminRequest {
  email: string;
  displayName: string;
  role: 'super-admin' | 'operator' | 'auditor';
}

export interface UpdatePlatformAdminRequest {
  displayName?: string;
  role?: 'super-admin' | 'operator' | 'auditor';
  status?: 'active' | 'inactive';
}

export interface PlatformAdminPasswordLink {
  purpose: 'activation' | 'passwordReset';
}

export interface PlatformAuditLog {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: 'success' | 'failure';
  errorCode: string | null;
  metadata: Record<string, unknown> | null;
}

export interface OrgUnit {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  sortOrder: number;
  memberCount: number;
  managerCount: number;
  managers: Array<{
    userId: string;
    displayName: string;
  }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrgUnitPathItem {
  id: string;
  name: string;
}

export interface OrgUnitDetail {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  sortOrder: number;
  memberCount: number;
  managerCount: number;
  managers: Array<{
    userId: string;
    displayName: string;
  }>;
  version: number;
  createdAt: string;
  updatedAt: string;
  path: Array<OrgUnitPathItem>;
}

export interface OrgUnitTree {
  items: Array<OrgUnit>;
}

export interface CreateOrgUnitRequest {
  name: string;
  parentId?: string | null;
  code?: string | null;
  description?: string | null;
}

export interface UpdateOrgUnitRequest {
  name?: string;
  code?: string | null;
  description?: string | null;
  version: number;
}

export interface MoveOrgUnitRequest {
  parentId: string | null;
  beforeId?: string | null;
  version: number;
}

export interface OrgUnitMember {
  userId: string;
  displayName: string;
  email: string;
  status: 'pending' | 'active' | 'inactive' | 'locked';
  unitId: string;
  unitName: string;
  isManager: boolean;
  isPrimary: boolean;
  title: string | null;
}

export interface UpdateOrgUnitMembersRequest {
  add: Array<{
    userId: string;
    isManager?: boolean;
    isPrimary?: boolean;
    title?: string | null;
  }>;
  update: Array<{
    userId: string;
    isManager?: boolean;
    isPrimary?: boolean;
    title?: string | null;
  }>;
  remove: Array<string>;
}

export interface UserOrgUnit {
  unitId: string;
  name: string;
  path: Array<OrgUnitPathItem>;
  isManager: boolean;
  isPrimary: boolean;
  title: string | null;
}

export interface UserOrgUnits {
  items: Array<UserOrgUnit>;
}

export interface TagSummary {
  id: string;
  name: string;
  color: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}

export interface Tag {
  id: string;
  scope: string;
  name: string;
  color: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagList {
  items: Array<Tag>;
}

export interface CreateTagRequest {
  scope: string;
  name: string;
  color: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}

export interface UpdateTagRequest {
  name?: string;
  color?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  version: number;
}

export interface ReplaceResourceTagsRequest {
  tagIds: Array<string>;
}

export interface UpdateResourceTagsRequest {
  add: Array<string>;
  remove: Array<string>;
}

export interface ResourceTags {
  tags: Array<TagSummary>;
}

export interface CreateUserRequest {
  email: string;
  username?: string;
  displayName: string;
  roleIds: Array<string>;
}

export interface UpdateUserRequest {
  username?: string | null;
  displayName?: string;
  status?: 'active' | 'inactive';
  locale?: string;
  timezone?: string;
  avatarImageId?: string | null;
  avatarCrop?: ImageCrop;
  version: number;
}

export interface ReplaceUserRolesRequest {
  roleIds: Array<string>;
  expectedRoleIds: Array<string>;
}

export const UserStatus = {
  pending: 'pending',
  active: 'active',
  inactive: 'inactive',
  locked: 'locked',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export interface RoleSummary {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
}

export interface User {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  avatar: ImageSources | null;
  avatarImageId: string | null;
  status: UserStatus;
  roles: Array<RoleSummary>;
  tags: Array<TagSummary>;
  locale: string;
  timezone: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  mfaEnabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoles {
  roles: Array<RoleSummary>;
}

export interface SsoRedirect {
  redirectTo: string;
}

export interface MfaMethodInfo {
  id: string;
  challenge: 'none' | 'server';
  enrollChallenge: 'immediate' | 'onRequest';
  enrollAt: 'anywhere' | 'idp';
  assurance: 'phishingResistant' | 'possession' | 'messaging' | 'inbox';
  maxFactorsPerAccount: number;
}

export interface MfaFactor {
  id: string;
  method: string;
  label: string | null;
  hint: string | null;
  available: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MfaOverview {
  factors: Array<MfaFactor>;
  recoveryCodesRemaining: number;
  methods: Array<{
    id: string;
    challenge: 'none' | 'server';
    enrollChallenge: 'immediate' | 'onRequest';
    enrollAt: 'anywhere' | 'idp';
    assurance: 'phishingResistant' | 'possession' | 'messaging' | 'inbox';
    maxFactorsPerAccount: number;
    enrolled: number;
  }>;
  required: boolean;
}

export interface StartMfaEnrollmentRequest {
  method: string;
  input?: Record<string, unknown>;
}

export interface MfaChallengeInfo {
  challengeId: string;
  hint: string | null;
  expiresAt: string;
  resendAvailableAt: string;
  publicData: Record<string, unknown> | null;
}

export interface MfaEnrollment {
  factorId: string;
  method: string;
  publicData: Record<string, unknown>;
  challenge: MfaChallengeInfo | null;
}

export interface ConfirmMfaEnrollmentRequest {
  challengeId?: string;
  payload: Record<string, unknown>;
  label?: string;
}

export interface MfaEnrollmentResult {
  factor: MfaFactor;
  recoveryCodes: Array<string> | null;
}

export interface MfaPasswordConfirmRequest {
  password: string;
}

export interface MfaRecoveryCodes {
  recoveryCodes: Array<string>;
}

export interface MfaAccountStatus {
  enabled: boolean;
  factors: Array<MfaFactor>;
  recoveryCodesRemaining: number;
}

export interface MfaLoginChallengeRequest {
  factorId: string;
}

export interface MfaLoginVerifyRequest {
  factorId: string | 'recovery';
  challengeId?: string;
  payload: Record<string, unknown>;
}

export interface MfaInteractionEnrollmentResult {
  recoveryCodes: Array<string>;
  redirectTo: string;
}

export interface SsoMfaChallengeNext {
  next: 'mfa';
  factors: Array<MfaFactor>;
  recoveryAvailable: boolean;
}

export interface SsoMfaEnrollNext {
  next: 'mfaEnroll';
  methods: Array<MfaMethodInfo>;
  optional: boolean;
}

export type MfaLoginVerifyResult = SsoRedirect | SsoMfaEnrollNext;

export type SsoLoginResult = SsoRedirect | SsoMfaChallengeNext | SsoMfaEnrollNext;

export interface MfaPolicy {
  requireAll: boolean;
  requiredRoleIds: Array<string>;
  allowedMethods: Array<string> | null;
  version: number;
  updatedAt: string | null;
  methods: Array<{
    id: string;
    challenge: 'none' | 'server';
    enrollChallenge: 'immediate' | 'onRequest';
    enrollAt: 'anywhere' | 'idp';
    assurance: 'phishingResistant' | 'possession' | 'messaging' | 'inbox';
    maxFactorsPerAccount: number;
    platformEnabled: boolean;
  }>;
  nonCompliant: number;
}

export interface UpdateMfaPolicyRequest {
  requireAll: boolean;
  requiredRoleIds: Array<string>;
  allowedMethods: Array<string> | null;
  version: number;
}

export interface MfaPolicyImpact {
  nonCompliant: number;
  stranded: number;
}

export interface MfaSettingField {
  key: string;
  type: 'text' | 'url' | 'secret' | 'select';
  required: boolean;
  requiredWhen?: {
    key: string;
    equals: string;
  };
  options?: Array<string>;
  defaultValue?: string;
  maxLength?: number;
}

export interface PlatformMfaMethod {
  id: string;
  challenge: 'none' | 'server';
  enrollChallenge: 'immediate' | 'onRequest';
  enrollAt: 'anywhere' | 'idp';
  assurance: 'phishingResistant' | 'possession' | 'messaging' | 'inbox';
  maxFactorsPerAccount: number;
  settings: {
    fields: Array<MfaSettingField>;
    configured: boolean;
  } | null;
  realms: Array<'tenant' | 'platform'>;
  defaultEnabled: boolean;
  globalState: 'default' | 'on' | 'off';
  effective: boolean;
  tenantOverrides: {
    on: number;
    off: number;
  };
  stats: {
    tenantFactors: number;
    tenants: number;
    platformFactors: number;
    computedAt: string;
  } | null;
  platformAdminEnabled: boolean;
}

export interface PlatformMfaMethodList {
  items: Array<PlatformMfaMethod>;
}

export interface UpdatePlatformMfaMethodRequest {
  state: 'default' | 'on' | 'off';
}

export interface MfaMethodSettings {
  method: string;
  values: Record<string, string>;
  secrets: Record<string, boolean>;
  configured: boolean;
  version: number | null;
  updatedAt: string | null;
}

export interface UpdateMfaMethodSettingsRequest {
  values: Record<string, string>;
  secrets: Record<string, string>;
  version: number | null;
}

export interface MfaMethodImpact {
  stranded: number;
  tenants: number;
  skippedTenants: number;
}

export interface TenantUsageSummary {
  usersActive: number | null;
  usersTotal: number | null;
  serviceAccounts: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  storageUsageRatio: number | null;
  recentRequests: number;
  lastActivityAt: string | null;
  snapshotAt: string | null;
}

export interface TenantUsageDay {
  date: string;
  usersActive: number | null;
  usersTotal: number | null;
  serviceAccounts: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  requestsInternal: number;
  requestsExternal: number;
  jobsExecuted: number;
}

export interface TenantUsage {
  summary: TenantUsageSummary;
  warningRatio: number;
  recentDays: number;
  daily: Array<TenantUsageDay>;
}

export const TenantFeature = {
  file: 'file',
  auditLog: 'auditLog',
  job: 'job',
  trash: 'trash',
  systemSetting: 'systemSetting',
  identityProvider: 'identityProvider',
  tenantSwitch: 'tenantSwitch',
  webhook: 'webhook',
  announcement: 'announcement',
  externalApi: 'externalApi',
  group: 'group',
  dataTransfer: 'dataTransfer',
  organization: 'organization',
  approvalChain: 'approvalChain',
  gallery: 'gallery',
} as const;
export type TenantFeature = (typeof TenantFeature)[keyof typeof TenantFeature];

export type TenantFlagOverrides = Record<string, boolean>;

export type TenantMfaMethodOverrides = Record<string, boolean>;

export const TenantFeatureParamKey = {
  'file.storageQuotaMb': 'file.storageQuotaMb',
  'auditLog.hotRetentionDays': 'auditLog.hotRetentionDays',
  'auditLog.retentionDays': 'auditLog.retentionDays',
  'job.maxConcurrency': 'job.maxConcurrency',
  'identityProvider.maxProviders': 'identityProvider.maxProviders',
  'webhook.maxUrls': 'webhook.maxUrls',
  'dataTransfer.importMaxRows': 'dataTransfer.importMaxRows',
  'dataTransfer.importMaxSizeMb': 'dataTransfer.importMaxSizeMb',
  'dataTransfer.exportMaxRows': 'dataTransfer.exportMaxRows',
  'gallery.maxItemSizeMb': 'gallery.maxItemSizeMb',
  'rateLimit.authPerMinute': 'rateLimit.authPerMinute',
  'rateLimit.trustedCidrs': 'rateLimit.trustedCidrs',
} as const;
export type TenantFeatureParamKey =
  (typeof TenantFeatureParamKey)[keyof typeof TenantFeatureParamKey];

export interface TenantFeatureParam {
  key: TenantFeatureParamKey;
  feature: TenantFeature | null;
  type: 'integer' | 'string';
  value: number | string;
  defaultValue: number | string;
  overridden: boolean;
  unit: ('days' | 'megabytes' | 'count' | 'perMinute') | null;
  min: number | null;
  max: number | null;
  foreverValue: number | null;
  maxLength: number | null;
}

export interface PlatformTenant {
  id: string;
  code: string;
  name: string;
  status: 'provisioning' | 'active' | 'disabled' | 'failed';
  domains: Array<string>;
  storageBucket: string;
  features: Array<TenantFeature>;
  flags: TenantFlagOverrides;
  mfaMethods: TenantMfaMethodOverrides;
  featureParams: Array<TenantFeatureParam>;
  adminEmail: string | null;
  provisionError: string | null;
  provisionedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTenantListItem {
  id: string;
  code: string;
  name: string;
  status: 'provisioning' | 'active' | 'disabled' | 'failed';
  domains: Array<string>;
  storageBucket: string;
  features: Array<TenantFeature>;
  flags: TenantFlagOverrides;
  mfaMethods: TenantMfaMethodOverrides;
  featureParams: Array<TenantFeatureParam>;
  adminEmail: string | null;
  provisionError: string | null;
  provisionedAt: string | null;
  createdAt: string;
  updatedAt: string;
  usage: TenantUsageSummary;
}

export interface PlatformTenantList {
  items: Array<PlatformTenantListItem>;
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
  baseDomain: string;
  usageRecentDays: number;
  usageWarningRatio: number;
}

export interface CreateTenantRequest {
  code: string;
  name: string;
  adminEmail: string;
  adminName?: string;
  domains: Array<string>;
}

export interface UpdateTenantRequest {
  name?: string;
  features?: Array<TenantFeature>;
  flags?: TenantFlagOverrides;
  mfaMethods?: TenantMfaMethodOverrides;
  featureParams?: Record<string, (number | string) | null>;
}

export interface TenantFeatureImpact {
  feature: TenantFeature;
  available: boolean;
  items: Array<{
    key:
      | 'identityProviderConnections'
      | 'ssoOnlyDomains'
      | 'passwordlessExternalUsers'
      | 'groups'
      | 'groupMembers'
      | 'groupRoleGrants'
      | 'orgUnits'
      | 'orgUnitMembers'
      | 'approvalFlowsUsingOrg'
      | 'approvalFlows'
      | 'approvalRequestsInChain'
      | 'galleryItems'
      | 'galleryAlbums';
    count: number;
  }>;
}

export interface AddTenantDomainRequest {
  domain: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface Session {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface Profile {
  user: {
    id: string;
    email: string;
    username: string | null;
    displayName: string;
    avatar: ImageSources | null;
    avatarImageId: string | null;
    status: UserStatus;
    lastLoginAt: string | null;
    preferences: {
      locale: string;
      timezone: string;
    };
  };
  roles: Array<RoleSummary>;
  permissions: Array<PermissionKey>;
  features: Array<TenantFeature>;
  flags: Array<string>;
}

export const PlatformPermissionKey = {
  'tenant:read': 'tenant:read',
  'tenant:create': 'tenant:create',
  'tenant:update': 'tenant:update',
  'tenant:delete': 'tenant:delete',
  'platformAdmin:read': 'platformAdmin:read',
  'platformAdmin:create': 'platformAdmin:create',
  'platformAdmin:update': 'platformAdmin:update',
  'platformAdmin:resetMfa': 'platformAdmin:resetMfa',
  'platformAuditLog:read': 'platformAuditLog:read',
  'platformJob:read': 'platformJob:read',
  'platformJob:retry': 'platformJob:retry',
  'featureFlag:read': 'featureFlag:read',
  'featureFlag:update': 'featureFlag:update',
  'mfaMethod:read': 'mfaMethod:read',
  'mfaMethod:update': 'mfaMethod:update',
  'cdn:read': 'cdn:read',
  'cdn:update': 'cdn:update',
  'cdn:purge': 'cdn:purge',
  'cdn:purgeAll': 'cdn:purgeAll',
} as const;
export type PlatformPermissionKey =
  (typeof PlatformPermissionKey)[keyof typeof PlatformPermissionKey];

export interface PlatformProfile {
  admin: {
    id: string;
    email: string;
    displayName: string;
    status: 'active' | 'inactive' | 'locked' | 'pending';
    lastLoginAt: string | null;
    role: 'super-admin' | 'operator' | 'auditor';
  };
  permissions: Array<PlatformPermissionKey>;
}

export interface UpdatePlatformProfileRequest {
  displayName: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  preferences?: {
    locale?: string;
    timezone?: string;
  };
  avatarImageId?: string | null;
  avatarCrop?: ImageCrop;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface SetupRequest {
  token: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  displayName: string;
  reason?: string;
}

export interface RegisterResult {
  submitted: true;
}

export interface SsoInteraction {
  uid: string;
  prompt: string;
  clientId: string;
  clientName: string;
  loginHint: string | null;
  uiLocales: string | null;
  tenant: {
    code: string;
    name: string;
  } | null;
  mfaEnroll: string | null;
  passkeyLogin: boolean;
}

export interface SsoPasskeyOptions {
  publicData: Record<string, unknown>;
}

export interface SsoPasskeyLoginRequest {
  payload: Record<string, unknown>;
}

export interface SsoDiscovery {
  provider: {
    id: string;
    name: string;
  } | null;
  ssoOnly: boolean;
}

export interface StartExternalLoginRequest {
  providerId: string;
}

export interface SsoCallbackRequest {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}

export interface ExplainNode {
  type: string;
  id: string | null;
  relation: string;
  name: string | null;
  hidden: boolean;
}

export interface PermissionSources {
  isSuperAdmin: boolean;
  superAdminVia: Array<ExplainNode> | null;
  items: Array<{
    key: string;
    nameI18nKey: string;
    resource: string;
    resourceNameI18nKey: string;
    includes: Array<string>;
    requires: Array<string>;
    sources: Array<PermissionSource>;
  }>;
}

export const FeatureFlagGlobalState = {
  on: 'on',
  off: 'off',
} as const;
export type FeatureFlagGlobalState =
  (typeof FeatureFlagGlobalState)[keyof typeof FeatureFlagGlobalState];

export interface FeatureFlag {
  key: string;
  description: string;
  defaultEnabled: boolean;
  owner: string;
  removeBy: string;
  globalState: FeatureFlagGlobalState | null;
  tenantOverrides: {
    on: number;
    off: number;
  };
}

export interface FeatureFlagList {
  items: Array<FeatureFlag>;
}

export interface UpdateFeatureFlagRequest {
  state: 'default' | 'on' | 'off';
}

export interface CreateFileUploadRequest {
  name: string;
  contentType: string;
  size: number;
  folderId?: string | null;
  thumbnail?: {
    contentType: 'image/webp' | 'image/jpeg' | 'image/png';
    size: number;
  };
}

export interface CreateFileUploadPartsRequest {
  partNumbers: Array<number>;
}

export interface CompleteFileUploadRequest {
  parts?: Array<{
    partNumber: number;
    etag: string;
  }>;
}

export interface FileAccessExplain {
  folderId: string;
  userId: string;
  actions: Array<{
    action: 'read' | 'create' | 'update' | 'delete' | 'share';
    allowed: boolean;
    path: Array<ExplainNode> | null;
  }>;
}

export interface SetFileFolderGrantRequest {
  subjectType: 'role' | 'user' | 'group' | 'everyone';
  subjectId: string;
  level: 'viewer' | 'contributor' | 'editor' | 'manager';
  expiresAt: string | null;
}

export interface FileFolderGrant {
  subjectType: 'role' | 'user' | 'group' | 'everyone';
  subjectId: string;
  subjectName: string;
  level: 'viewer' | 'contributor' | 'editor' | 'manager';
  expiresAt: string | null;
  isExpired: boolean;
  grantedAt: string;
  source: {
    folderId: string;
    folderName: string;
  } | null;
}

export interface FileFolderGrantList {
  folderId: string;
  inheritGrants: boolean;
  assignableLevels: Array<'viewer' | 'contributor' | 'editor' | 'manager'>;
  items: Array<FileFolderGrant>;
}

export interface FileGrantSubjectList {
  items: Array<{
    subjectType: 'role' | 'user' | 'group' | 'everyone';
    id: string;
    name: string;
    hint: string | null;
  }>;
}

export interface UpdateFileFolderAccessRequest {
  inheritGrants: boolean;
}

export interface CreateFileAccessRequest {
  level: 'viewer' | 'contributor' | 'editor' | 'manager';
  reason?: string;
  resubmittedFrom?: string;
}

export interface FileAccessRequestSubmitted {
  submitted: boolean;
}

export interface FileAccessRequest {
  id: string;
  requesterId: string | null;
  requesterName: string;
  level: 'viewer' | 'contributor' | 'editor' | 'manager';
  reason: string | null;
  createdAt: string;
}

export interface FileAccessRequestList {
  items: Array<FileAccessRequest>;
}

export interface ReviewFileAccessRequest {
  comment?: string;
}

export interface FileFolderCapabilities {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canShare: boolean;
}

export interface FileFolder {
  id: string;
  name: string;
  parentId: string | null;
  kind: 'normal' | 'shared' | 'privateRoot' | 'personal';
  inheritGrants: boolean;
  hasPendingAccessRequest: boolean;
  capabilities: FileFolderCapabilities;
  tags: Array<TagSummary>;
  createdAt: string;
  updatedAt: string;
}

export interface RestoredFileFolder {
  id: string;
  name: string;
  parentId: string | null;
  kind: 'normal' | 'shared' | 'privateRoot' | 'personal';
  inheritGrants: boolean;
  hasPendingAccessRequest: boolean;
  capabilities: FileFolderCapabilities;
  tags: Array<TagSummary>;
  createdAt: string;
  updatedAt: string;
  foldersRestored: number;
  filesRestored: number;
  filesSkipped: number;
}

export interface FileFolderList {
  items: Array<FileFolder>;
  rootCapabilities: {
    canCreate: boolean;
  };
  personalFolderId: string | null;
}

export interface CreateFileFolderRequest {
  name: string;
  parentId: string | null;
}

export interface UpdateFileFolderRequest {
  name: string;
}

export interface EnsureFileFolderPathsRequest {
  parentId: string | null;
  paths: Array<Array<string>>;
}

export interface FileFolderPaths {
  items: Array<{
    path: Array<string>;
    id: string;
  }>;
}

export interface MoveFileItemsRequest {
  fileIds: Array<string>;
  folderIds: Array<string>;
  targetFolderId: string | null;
}

export interface MoveFileItemsResult {
  movedFiles: number;
  movedFolders: number;
}

export interface FileUploader {
  id: string;
  displayName: string;
}

export interface StoredFileImage {
  width: number;
  height: number;
  originalUrl: string;
  previewUrl: string;
  thumbnailUrl: string;
  expiresAt: string;
}

export interface StoredFileCapabilities {
  canUpdate: boolean;
  canDelete: boolean;
}

export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  status: 'pending' | 'ready';
  folderId: string | null;
  url: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
  image: StoredFileImage | null;
  urlExpiresAt: string | null;
  version: number;
  uploader: FileUploader | null;
  capabilities: StoredFileCapabilities;
  tags: Array<TagSummary>;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileListPage {
  items: Array<StoredFile>;
  pagination: {
    offset: number;
    limit: number;
    total: number | null;
  };
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface FileUploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface FileMultipartUpload {
  partSize: number;
  partCount: number;
}

export interface FileUpload {
  file: StoredFile;
  upload: FileUploadTarget | null;
  multipart: FileMultipartUpload | null;
  thumbnailUpload: FileUploadTarget | null;
}

export interface FileUploadPart {
  partNumber: number;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface FileUploadParts {
  parts: Array<FileUploadPart>;
  expiresAt: string;
}

export interface FileUploadPolicy {
  maxSize: number;
  multipartThreshold: number;
  partSize: number;
  thumbnailMaxSize: number;
  thumbnailContentTypes: Array<string>;
  storageQuota: number;
  storageUsed: number;
}

export interface GetFileImageQuery {
  exp: number;
  sig: string;
  format?: 'jpeg' | 'webp' | 'avif' | 'png' | 'auto';
}

export interface UpdateFileRequest {
  name: string;
  version: number;
}

export interface GalleryAlbum {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  coverItemId: string | null;
  cover: ImageSources | null;
  coverColor: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryAlbumList {
  items: Array<GalleryAlbum>;
}

export interface CreateGalleryAlbumRequest {
  name: string;
  description?: string | null;
}

export interface UpdateGalleryAlbumRequest {
  version: number;
  name?: string;
  description?: string | null;
  coverItemId?: string | null;
}

export interface GalleryAlbumItemsRequest {
  itemIds: Array<string>;
}

export interface GalleryAlbumItemsResult {
  changed: number;
}

export interface GalleryItem {
  id: string;
  title: string;
  description: string | null;
  contentType: string;
  size: number;
  width: number;
  height: number;
  displayRotation: 0 | 90 | 180 | 270;
  dominantColor: string | null;
  placeholder: string | null;
  takenAt: string | null;
  sortAt: string;
  createdAt: string;
  image: ImageSources;
  tags: Array<TagSummary>;
  version: number;
}

export interface GalleryItemList {
  items: Array<GalleryItem>;
  nextCursor: string | null;
}

export interface GalleryExif {
  make?: string;
  model?: string;
  lensMake?: string;
  lensModel?: string;
  focalLength?: number;
  focalLength35mm?: number;
  fNumber?: number;
  exposureTime?: number;
  iso?: number;
  flashFired?: boolean;
}

export interface GalleryItemDetail {
  id: string;
  title: string;
  description: string | null;
  contentType: string;
  size: number;
  width: number;
  height: number;
  displayRotation: 0 | 90 | 180 | 270;
  dominantColor: string | null;
  placeholder: string | null;
  takenAt: string | null;
  sortAt: string;
  createdAt: string;
  image: ImageSources;
  tags: Array<TagSummary>;
  version: number;
  exif: GalleryExif | null;
  locationStripped: boolean;
  source: string;
  sourceName: string | null;
  uploader: {
    id: string;
    name: string;
  } | null;
  albums: Array<{
    id: string;
    name: string;
  }>;
  duplicates: Array<{
    id: string;
    title: string;
  }>;
  original: {
    url: string;
    width: number;
    height: number;
    expiresAt: string;
  } | null;
  download: {
    original: string;
    large: string;
  };
}

export interface GalleryNeighbors {
  previousId: string | null;
  nextId: string | null;
}

export interface GalleryTimeline {
  timeZone: string;
  months: Array<{
    month: string;
    count: number;
  }>;
}

export interface CreateGalleryUploadRequest {
  fileName: string;
  title?: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  albumId?: string;
}

export interface GalleryUploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface GalleryUploadItem {
  id: string;
  title: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  failureReason: ('notImage' | 'typeNotAllowed' | 'tooLarge' | 'missing') | null;
  createdAt: string;
}

export interface GalleryUpload {
  item: GalleryUploadItem;
  upload: GalleryUploadTarget;
}

export interface GalleryUploadStatus {
  processing: number;
  failed: Array<GalleryUploadItem>;
  maxItemSize: number;
}

export interface CreateGalleryFromSourceRequest {
  source: string;
  refIds: Array<string>;
  albumId?: string;
}

export interface GalleryFromSourceResult {
  results: Array<{
    refId: string;
    status: 'added' | 'skipped';
    itemId: string | null;
    reason: ('typeNotAllowed' | 'tooLarge' | 'alreadyAdded' | 'notFound') | null;
    existingItemId: string | null;
    name: string | null;
  }>;
}

export interface UpdateGalleryItemRequest {
  version: number;
  title?: string;
  description?: string | null;
  displayRotation?: 0 | 90 | 180 | 270;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  roleCount: number;
  version: number;
  membership?: 'direct' | 'nested';
  createdAt: string;
  updatedAt: string;
}

export interface RestoredGroup {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  roleCount: number;
  version: number;
  membership?: 'direct' | 'nested';
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  type: 'user' | 'group';
  id: string;
  name: string;
  email: string | null;
  status: ('pending' | 'active' | 'inactive' | 'locked') | null;
}

export interface GroupRole {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
}

export interface GroupRoles {
  roles: Array<GroupRole>;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string | null;
  version: number;
}

export interface GroupMemberRef {
  type: 'user' | 'group';
  id: string;
}

export interface UpdateGroupMembersRequest {
  add: Array<GroupMemberRef>;
  remove: Array<GroupMemberRef>;
}

export interface UpdateGroupRolesRequest {
  add: Array<string>;
  remove: Array<string>;
}

export const TenantJobName = {
  'announcement.dispatch': 'announcement.dispatch',
  'announcement.eventDispatch': 'announcement.eventDispatch',
  'announcement.fanOut': 'announcement.fanOut',
  'announcement.maintenance': 'announcement.maintenance',
  'approval.resultMail': 'approval.resultMail',
  'auditLog.archive': 'auditLog.archive',
  'auth.activationMail': 'auth.activationMail',
  'auth.passwordResetMail': 'auth.passwordResetMail',
  'auth.tokenCleanup': 'auth.tokenCleanup',
  'dataTransfer.applyImport': 'dataTransfer.applyImport',
  'dataTransfer.cleanup': 'dataTransfer.cleanup',
  'dataTransfer.export': 'dataTransfer.export',
  'file.imageVariants': 'file.imageVariants',
  'file.maintenance': 'file.maintenance',
  'gallery.maintenance': 'gallery.maintenance',
  'gallery.process': 'gallery.process',
  'image.maintenance': 'image.maintenance',
  'image.process': 'image.process',
  'mfa.cleanup': 'mfa.cleanup',
  'mfa.emailCodeMail': 'mfa.emailCodeMail',
  'mfa.lineCode': 'mfa.lineCode',
  'mfa.securityNoticeMail': 'mfa.securityNoticeMail',
  'mfa.smsCode': 'mfa.smsCode',
  'mfa.telegramCode': 'mfa.telegramCode',
  'notification.cleanup': 'notification.cleanup',
  'revision.prune': 'revision.prune',
  'trash.purge': 'trash.purge',
  'watch.notify': 'watch.notify',
  'webhook.cleanup': 'webhook.cleanup',
  'webhook.deliver': 'webhook.deliver',
} as const;
export type TenantJobName = (typeof TenantJobName)[keyof typeof TenantJobName];

export const JobName = {
  'announcement.dispatch': 'announcement.dispatch',
  'announcement.eventDispatch': 'announcement.eventDispatch',
  'announcement.fanOut': 'announcement.fanOut',
  'announcement.maintenance': 'announcement.maintenance',
  'approval.resultMail': 'approval.resultMail',
  'auditLog.archive': 'auditLog.archive',
  'auth.activationMail': 'auth.activationMail',
  'auth.passwordResetMail': 'auth.passwordResetMail',
  'auth.platformTokenCleanup': 'auth.platformTokenCleanup',
  'auth.tokenCleanup': 'auth.tokenCleanup',
  'cdn.healthCheck': 'cdn.healthCheck',
  'cdn.purge': 'cdn.purge',
  'dataTransfer.applyImport': 'dataTransfer.applyImport',
  'dataTransfer.cleanup': 'dataTransfer.cleanup',
  'dataTransfer.export': 'dataTransfer.export',
  'file.imageVariants': 'file.imageVariants',
  'file.maintenance': 'file.maintenance',
  'gallery.maintenance': 'gallery.maintenance',
  'gallery.process': 'gallery.process',
  'image.maintenance': 'image.maintenance',
  'image.process': 'image.process',
  'jobs.outboxSweep': 'jobs.outboxSweep',
  'mfa.channelLinkCleanup': 'mfa.channelLinkCleanup',
  'mfa.cleanup': 'mfa.cleanup',
  'mfa.emailCodeMail': 'mfa.emailCodeMail',
  'mfa.factorStats': 'mfa.factorStats',
  'mfa.lineCode': 'mfa.lineCode',
  'mfa.platformCleanup': 'mfa.platformCleanup',
  'mfa.platformEmailCodeMail': 'mfa.platformEmailCodeMail',
  'mfa.platformLineCode': 'mfa.platformLineCode',
  'mfa.platformSecurityNoticeMail': 'mfa.platformSecurityNoticeMail',
  'mfa.platformSmsCode': 'mfa.platformSmsCode',
  'mfa.platformTelegramCode': 'mfa.platformTelegramCode',
  'mfa.securityNoticeMail': 'mfa.securityNoticeMail',
  'mfa.smsCode': 'mfa.smsCode',
  'mfa.telegramCode': 'mfa.telegramCode',
  'notification.cleanup': 'notification.cleanup',
  'oidc.cleanup': 'oidc.cleanup',
  'platformAdmin.accountMail': 'platformAdmin.accountMail',
  'platformNotification.cleanup': 'platformNotification.cleanup',
  'rateLimit.cleanup': 'rateLimit.cleanup',
  'revision.prune': 'revision.prune',
  'storage.totalRollup': 'storage.totalRollup',
  'tenant.provision': 'tenant.provision',
  'tenant.provisionSweep': 'tenant.provisionSweep',
  'tenant.usageRollup': 'tenant.usageRollup',
  'trash.purge': 'trash.purge',
  'watch.notify': 'watch.notify',
  'webhook.cleanup': 'webhook.cleanup',
  'webhook.deliver': 'webhook.deliver',
} as const;
export type JobName = (typeof JobName)[keyof typeof JobName];

export interface JobQueue {
  name: TenantJobName;
  cron: string | null;
  readyCount: number;
  deferredCount: number;
  activeCount: number;
  failedCount: number;
  completedCount: number;
}

export interface JobQueueList {
  items: Array<JobQueue>;
}

export interface JobSummary {
  id: string;
  name: TenantJobName;
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  retryCount: number;
  retryLimit: number;
  createdOn: string;
  startAfter: string;
  startedOn: string | null;
  completedOn: string | null;
}

export interface Job {
  id: string;
  name: TenantJobName;
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  retryCount: number;
  retryLimit: number;
  createdOn: string;
  startAfter: string;
  startedOn: string | null;
  completedOn: string | null;
  data: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
}

export interface PlatformJobQueue {
  name: JobName;
  cron: string | null;
  readyCount: number;
  deferredCount: number;
  activeCount: number;
  failedCount: number;
  completedCount: number;
  scope: 'tenant' | 'platform';
}

export interface PlatformJobQueueList {
  items: Array<PlatformJobQueue>;
}

export interface PlatformJobSummary {
  id: string;
  name: JobName;
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  retryCount: number;
  retryLimit: number;
  createdOn: string;
  startAfter: string;
  startedOn: string | null;
  completedOn: string | null;
  tenantId: string | null;
  tenantCode: string | null;
}

export interface PlatformJob {
  id: string;
  name: JobName;
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  retryCount: number;
  retryLimit: number;
  createdOn: string;
  startAfter: string;
  startedOn: string | null;
  completedOn: string | null;
  tenantId: string | null;
  tenantCode: string | null;
  data: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
}

export const CdnResource = {
  fileVariant: 'fileVariant',
  imageAsset: 'imageAsset',
  galleryItem: 'galleryItem',
} as const;
export type CdnResource = (typeof CdnResource)[keyof typeof CdnResource];

export const CdnState = {
  on: 'on',
  off: 'off',
} as const;
export type CdnState = (typeof CdnState)[keyof typeof CdnState];

export interface CdnCheckNode {
  address: string;
  problems: Array<
    | 'unreachable'
    | 'timeout'
    | 'purgeSecretRejected'
    | 'badResponse'
    | 'signingKidMissing'
    | 'verifyKidMissing'
  >;
  kids: Array<string> | null;
  missingKids: Array<string>;
  cache: {
    maxSize: string;
    inactive: string;
    valid: string;
  } | null;
  build: string | null;
  startedAt: string | null;
  detail?: string;
}

export interface CdnCheckResult {
  checkedAt: string;
  ready: boolean;
  discovery: {
    ok: boolean;
    problem?: 'purgeNotConfigured' | 'resolveFailed';
    detail?: string;
  };
  nodes: Array<CdnCheckNode>;
  publicUrl: {
    result:
      | 'ok'
      | 'signatureRejected'
      | 'originAuthRejected'
      | 'originUnreachable'
      | 'unreachable'
      | 'unexpected';
    status?: number;
    detail?: string;
  };
  signatureEnforced: {
    result: 'ok' | 'notEnforced' | 'unreachable' | 'unexpected';
    status?: number;
    detail?: string;
  };
}

export interface CdnDeployment {
  deployed: boolean;
  provider: string | null;
  origin: string | null;
  signingKid: string | null;
  kids: Array<string>;
  resources: Array<CdnResource>;
  minUrlTtl: number;
  maxUrlTtl: number;
  purgeConfigured: boolean;
  purgeOnDelete: boolean;
  purgeBatchSize: number;
  healthCheckCron: string | null;
}

export interface CdnStoredSettings {
  state: CdnState | null;
  resources: Array<string> | null;
  urlTtlCap: number | null;
  purgeOnDelete: boolean | null;
  purgeBatchSize: number | null;
  stateChangedAt: string | null;
  stateChangedBy: {
    id: string;
    email: string | null;
  } | null;
  version: number;
  updatedAt: string | null;
}

export interface CdnEffective {
  serving: boolean;
  resources: Array<CdnResource>;
  urlTtlCap: number;
  purgeOnDelete: boolean;
  purgeBatchSize: number;
  clamped: {
    resources: Array<CdnResource>;
    urlTtlCap: boolean;
  };
  issuedUrlsExpireAt: string | null;
}

export interface CdnPurgeJobSummary {
  id: string;
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  createdOn: string;
  completedOn: string | null;
  paths: number | 'all';
  manual: {
    requestedBy: string;
    tenantId: string | null;
    target: string;
    id?: string;
  } | null;
}

export interface CdnOverview {
  deployment: CdnDeployment;
  settings: CdnStoredSettings | null;
  effective: CdnEffective | null;
  lastCheck: CdnCheckResult | null;
  recentPurges: Array<CdnPurgeJobSummary>;
  purgeTargets: Array<CdnResource>;
}

export interface UpdateCdnSettingsRequest {
  version: number;
  state?: CdnState | null;
  resources?: Array<CdnResource> | null;
  urlTtlCap?: number | null;
  purgeOnDelete?: boolean | null;
  purgeBatchSize?: number | null;
}

export interface CdnPurgeRequest {
  target:
    | {
        type: 'paths';
        tenantId: string;
        paths: Array<string>;
      }
    | {
        type: CdnResource;
        tenantId: string;
        id: string;
      }
    | {
        type: 'all';
      };
}

export interface CdnPurgeResult {
  jobIds: Array<string>;
  paths: number | 'all';
}

export interface RevisionSummary {
  version: number;
  createdAt: string;
  actor: {
    id: string;
    name: string;
  } | null;
  tooLarge: boolean;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissionKeys: Array<PermissionKey>;
}

export interface DuplicateRoleRequest {
  name?: string;
}

export interface RoleRevisionSnapshot {
  name: string;
  description: string | null;
  permissionKeys: Array<string>;
}

export interface RoleRevision {
  version: number;
  createdAt: string;
  actor: {
    id: string;
    name: string;
  } | null;
  tooLarge: boolean;
  snapshot: RoleRevisionSnapshot | null;
}

export interface RevertRoleRevisionRequest {
  version: number;
}

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
  userCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RestoredRole {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
  userCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  holdersRestored: number;
}

export interface RolePermissions {
  permissions: Array<Permission>;
  effective: Array<EffectivePermission>;
  isSuperAdmin: boolean;
}

export interface RoleHolder {
  id: string;
  kind: 'human' | 'service';
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'inactive' | 'locked';
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string | null;
  version: number;
}

export interface UpdateRolePermissionsRequest {
  add: Array<PermissionKey>;
  remove: Array<PermissionKey>;
}

export interface ServiceAccount {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  roles: Array<RoleSummary>;
  activeTokenCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceAccountRequest {
  name: string;
  roleIds: Array<string>;
}

export interface UpdateServiceAccountRequest {
  name?: string;
  status?: 'active' | 'inactive';
  version: number;
}

export interface ReplaceServiceAccountRolesRequest {
  roleIds: Array<string>;
  expectedRoleIds: Array<string>;
}

export interface ServiceAccountRoles {
  roles: Array<RoleSummary>;
}

export interface SystemSetting {
  key: string;
  category:
    | 'general'
    | 'auth'
    | 'file'
    | 'trash'
    | 'revision'
    | 'notification'
    | 'dataTransfer'
    | 'gallery';
  type: 'string' | 'number' | 'boolean';
  value: string | number | boolean;
  defaultValue: string | number | boolean;
  isOverridden: boolean;
  isPublic: boolean;
  minimum: number | null;
  maximum: number | null;
  updatedAt: string | null;
}

export interface SystemSettingList {
  items: Array<SystemSetting>;
}

export interface UpdateSystemSettingsRequest {
  values: Record<string, (string | number | boolean) | null>;
}

export interface PublicSystemSettings {
  values: Record<string, string | number | boolean>;
}

export interface StorageTotal {
  usedBytes: number;
  limitBytes: number | null;
  usageRatio: number | null;
  warningRatio: number;
  measuredAt: string | null;
  isStale: boolean;
}

export interface CurrentTenant {
  code: string;
  name: string;
}

export interface TenantLookupQuery {
  code: string;
}

export interface TenantLookup {
  code: string;
  name: string;
  loginUrl: string;
}
