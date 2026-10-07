// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AddTenantDomainRequest,
  Announcement,
  AnnouncementActionRequest,
  AnnouncementAudience,
  AnnouncementAudiencePreview,
  AnnouncementDispatch,
  AnnouncementMessage,
  AnnouncementRecurrencePreview,
  AnnouncementRecurrencePreviewRequest,
  AnnouncementTrigger,
  AnnouncementTriggerEventList,
  ApiToken,
  ApiTokenList,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  ApproveApprovalRequest,
  AuditLog,
  AuditLogList,
  AuditLogSummary,
  ChangePasswordRequest,
  CompleteFileUploadRequest,
  CreateAnnouncementRequest,
  CreateApiTokenRequest,
  CreateFileAccessRequest,
  CreateFileFolderRequest,
  CreateFileUploadPartsRequest,
  CreateFileUploadRequest,
  CreateGroupRequest,
  CreateIdentityProviderRequest,
  CreatePlatformAdminRequest,
  CreateRoleRequest,
  CreateServiceAccountRequest,
  CreateTagRequest,
  CreateTenantRequest,
  CreateUserRequest,
  CreateWebhookRequest,
  CreatedApiToken,
  CreatedWebhook,
  CurrentTenant,
  DuplicateRoleRequest,
  EffectivePermission,
  EnsureFileFolderPathsRequest,
  ExplainNode,
  FeatureFlag,
  FeatureFlagGlobalState,
  FeatureFlagList,
  FileAccessExplain,
  FileAccessRequest,
  FileAccessRequestList,
  FileAccessRequestSubmitted,
  FileFolder,
  FileFolderCapabilities,
  FileFolderGrant,
  FileFolderGrantList,
  FileFolderList,
  FileFolderPaths,
  FileGrantSubjectList,
  FileListPage,
  FileMultipartUpload,
  FileUpload,
  FileUploadPart,
  FileUploadParts,
  FileUploadPolicy,
  FileUploadTarget,
  FileUploader,
  ForgotPasswordRequest,
  GetFileImageQuery,
  Group,
  GroupMember,
  GroupMemberRef,
  GroupRole,
  GroupRoles,
  IdentityProvider,
  IdentityProviderDomain,
  IdentityProviderList,
  Job,
  JobQueue,
  JobQueueList,
  JobSummary,
  LoginRequest,
  MoveFileItemsRequest,
  MoveFileItemsResult,
  Notification,
  NotificationChannel,
  NotificationEvent,
  NotificationEventChannel,
  NotificationEventList,
  NotificationLink,
  NotificationOverviewItem,
  NotificationOverviewPage,
  NotificationPage,
  NotificationPreference,
  NotificationPreferenceChannel,
  NotificationPreferenceList,
  NotificationReadAllResult,
  NotificationUnreadCount,
  Permission,
  PermissionCatalog,
  PermissionGroup,
  PermissionKey,
  PermissionSource,
  PermissionSources,
  PlatformAdmin,
  PlatformAdminList,
  PlatformAdminPasswordLink,
  PlatformAuditLog,
  PlatformJob,
  PlatformJobQueue,
  PlatformJobQueueList,
  PlatformJobSummary,
  PlatformNotification,
  PlatformNotificationUnreadCount,
  PlatformPermissionKey,
  PlatformProfile,
  PlatformTenant,
  PlatformTenantList,
  Profile,
  PublicSystemSettings,
  RegisterRequest,
  RegisterResult,
  RejectApprovalRequest,
  ReplaceResourceTagsRequest,
  ReplaceServiceAccountRolesRequest,
  ReplaceUserRolesRequest,
  ResetPasswordRequest,
  ResourceTags,
  RestoredFileFolder,
  RestoredGroup,
  RestoredRole,
  RevertRoleRevisionRequest,
  ReviewFileAccessRequest,
  RevisionSummary,
  Role,
  RoleHolder,
  RolePermissions,
  RoleRevision,
  RoleRevisionSnapshot,
  RoleSummary,
  ServiceAccount,
  ServiceAccountRoles,
  Session,
  SetFileFolderGrantRequest,
  SetupRequest,
  SsoCallbackRequest,
  SsoDiscovery,
  SsoInteraction,
  SsoRedirect,
  StartExternalLoginRequest,
  StoredFile,
  StoredFileCapabilities,
  StoredFileImage,
  SystemSetting,
  SystemSettingList,
  Tag,
  TagList,
  TagSummary,
  TenantFeature,
  TenantFeatureImpact,
  TenantFeatureParam,
  TenantFeatureParamKey,
  TenantFlagOverrides,
  TenantLookup,
  TenantLookupQuery,
  TrashItem,
  TrashResourceType,
  UpdateAnnouncementRequest,
  UpdateFeatureFlagRequest,
  UpdateFileFolderAccessRequest,
  UpdateFileFolderRequest,
  UpdateFileRequest,
  UpdateGroupMembersRequest,
  UpdateGroupRequest,
  UpdateGroupRolesRequest,
  UpdateIdentityProviderRequest,
  UpdateNotificationEventsRequest,
  UpdateNotificationPreferencesRequest,
  UpdatePlatformAdminRequest,
  UpdatePlatformProfileRequest,
  UpdateProfileRequest,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
  UpdateServiceAccountRequest,
  UpdateSystemSettingsRequest,
  UpdateTagRequest,
  UpdateTenantRequest,
  UpdateUserRequest,
  UpdateWebhookRequest,
  User,
  UserRoles,
  UserStatus,
  Webhook,
  WebhookDelivery,
  WebhookEventList,
  WebhookSecret,
  WebhookTarget,
  WebhookTestResult,
} from '../models';

export const NotificationChannelSchema = z.enum([
  'inApp',
  'email',
]) satisfies z.ZodType<NotificationChannel>;

export const NotificationEventChannelSchema = z.object({
  channel: NotificationChannelSchema,
  enabled: z.boolean(),
  defaultEnabled: z.boolean(),
  isOverridden: z.boolean(),
  allowUserOverride: z.boolean(),
  updatedAt: z.string().nullable(),
}) satisfies z.ZodType<NotificationEventChannel>;

export const NotificationEventSchema = z.object({
  type: z.string(),
  category: z.string(),
  mandatory: z.boolean(),
  channels: z.array(NotificationEventChannelSchema),
}) satisfies z.ZodType<NotificationEvent>;

export const NotificationEventListSchema = z.object({
  items: z.array(NotificationEventSchema),
}) satisfies z.ZodType<NotificationEventList>;

export const UpdateNotificationEventsRequestSchema = z.object({
  changes: z
    .array(
      z.object({
        type: z.string().min(1).max(100),
        channel: NotificationChannelSchema,
        enabled: z.boolean().nullable().optional(),
        allowUserOverride: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
}) satisfies z.ZodType<UpdateNotificationEventsRequest>;

export const NotificationLinkSchema = z.object({
  route: z.string(),
  params: z.record(z.string(), z.string()),
}) satisfies z.ZodType<NotificationLink>;

export const NotificationSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
  link: NotificationLinkSchema.nullable(),
  actor: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    })
    .nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<Notification>;

export const NotificationPageSchema = z.object({
  items: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<NotificationPage>;

export const NotificationUnreadCountSchema = z.object({
  count: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<NotificationUnreadCount>;

export const NotificationReadAllResultSchema = z.object({
  updated: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<NotificationReadAllResult>;

export const NotificationOverviewItemSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
  link: NotificationLinkSchema.nullable(),
  actor: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    })
    .nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  recipient: z.object({
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
    name: z.string(),
  }),
}) satisfies z.ZodType<NotificationOverviewItem>;

export const NotificationOverviewPageSchema = z.object({
  items: z.array(NotificationOverviewItemSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<NotificationOverviewPage>;

export const NotificationPreferenceChannelSchema = z.object({
  channel: NotificationChannelSchema,
  enabled: z.boolean(),
  isOverridden: z.boolean(),
  lock: z.enum(['mandatory', 'tenantDisabled', 'tenantRequired']).nullable(),
}) satisfies z.ZodType<NotificationPreferenceChannel>;

export const NotificationPreferenceSchema = z.object({
  type: z.string(),
  category: z.string(),
  channels: z.array(NotificationPreferenceChannelSchema),
}) satisfies z.ZodType<NotificationPreference>;

export const NotificationPreferenceListSchema = z.object({
  items: z.array(NotificationPreferenceSchema),
}) satisfies z.ZodType<NotificationPreferenceList>;

export const UpdateNotificationPreferencesRequestSchema = z.object({
  changes: z
    .array(
      z.object({
        type: z.string().min(1).max(100),
        channel: NotificationChannelSchema,
        enabled: z.boolean().nullable(),
      }),
    )
    .min(1)
    .max(100),
}) satisfies z.ZodType<UpdateNotificationPreferencesRequest>;

export const TrashResourceTypeSchema = z.enum([
  'user',
  'role',
  'group',
  'file',
  'fileFolder',
  'announcement',
]) satisfies z.ZodType<TrashResourceType>;

export const TrashItemSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  type: TrashResourceTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  deletedAt: z.string(),
  deletedBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    })
    .nullable(),
  purgeAt: z.string(),
}) satisfies z.ZodType<TrashItem>;

export const AnnouncementAudienceSchema = z.object({
  all: z.boolean().default(false),
  userIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(200)
    .default([]),
  groupIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(200)
    .default([]),
  roleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(200)
    .default([]),
}) satisfies z.ZodType<AnnouncementAudience>;

export const AnnouncementTriggerSchema = z.union([
  z.object({
    kind: z.enum(['immediate']),
  }),
  z.object({
    kind: z.enum(['once']),
    at: z.iso
      .datetime({ offset: true })
      .regex(
        new RegExp(
          '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
        ),
      ),
  }),
  z.object({
    kind: z.enum(['recurring']),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.int().min(1).max(99),
    weekdays: z.array(z.int().min(0).max(6)).max(7).nullable().optional(),
    monthDay: z
      .union([z.int().min(1).max(28), z.enum(['last'])])
      .nullable()
      .optional(),
    time: z.string().regex(new RegExp('^([01]\\d|2[0-3]):[0-5]\\d$')),
    startsOn: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')),
    endsOn: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')).nullable().optional(),
    maxOccurrences: z.int().min(1).max(10000).nullable().optional(),
  }),
  z.object({
    kind: z.enum(['event']),
    event: z.string().min(1).max(100),
    delayMinutes: z.int().min(0).max(43200),
  }),
]) satisfies z.ZodType<AnnouncementTrigger>;

export const AnnouncementTriggerEventListSchema = z.object({
  items: z.array(
    z.object({
      event: z.string(),
      scope: z.enum(['audience', 'group', 'role']),
    }),
  ),
}) satisfies z.ZodType<AnnouncementTriggerEventList>;

export const AnnouncementRecurrencePreviewRequestSchema = z.object({
  trigger: z.object({
    kind: z.enum(['recurring']),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.int().min(1).max(99),
    weekdays: z.array(z.int().min(0).max(6)).max(7).nullable().optional(),
    monthDay: z
      .union([z.int().min(1).max(28), z.enum(['last'])])
      .nullable()
      .optional(),
    time: z.string().regex(new RegExp('^([01]\\d|2[0-3]):[0-5]\\d$')),
    startsOn: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')),
    endsOn: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')).nullable().optional(),
    maxOccurrences: z.int().min(1).max(10000).nullable().optional(),
  }),
}) satisfies z.ZodType<AnnouncementRecurrencePreviewRequest>;

export const AnnouncementRecurrencePreviewSchema = z.object({
  timeZone: z.string(),
  occurrences: z.array(z.string()),
}) satisfies z.ZodType<AnnouncementRecurrencePreview>;

export const AnnouncementSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  title: z.string(),
  body: z.string(),
  audience: AnnouncementAudienceSchema,
  trigger: AnnouncementTriggerSchema,
  status: z.enum(['draft', 'scheduled', 'paused', 'completed']),
  nextRunAt: z.string().nullable(),
  lastDispatch: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      status: z.enum(['pending', 'sending', 'sent', 'failed', 'revoked']),
      scheduledFor: z.string(),
      recipientCount: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
      readCount: z.int().min(-9007199254740991).max(9007199254740991),
    })
    .nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
  updatedBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<Announcement>;

export const CreateAnnouncementRequestSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(5000),
  audience: AnnouncementAudienceSchema,
  trigger: AnnouncementTriggerSchema,
}) satisfies z.ZodType<CreateAnnouncementRequest>;

export const UpdateAnnouncementRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(5000).optional(),
  audience: AnnouncementAudienceSchema.optional(),
  trigger: AnnouncementTriggerSchema.optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateAnnouncementRequest>;

export const AnnouncementActionRequestSchema = z.object({
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<AnnouncementActionRequest>;

export const AnnouncementAudiencePreviewSchema = z.object({
  count: z.int().min(-9007199254740991).max(9007199254740991),
  skipped: z.object({
    userIds: z.array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    ),
    groupIds: z.array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    ),
    roleIds: z.array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    ),
  }),
}) satisfies z.ZodType<AnnouncementAudiencePreview>;

export const AnnouncementDispatchSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  announcementId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  scheduledFor: z.string(),
  title: z.string(),
  body: z.string(),
  audience: AnnouncementAudienceSchema,
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'revoked']),
  recipientCount: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  readCount: z.int().min(-9007199254740991).max(9007199254740991),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
  revokedBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<AnnouncementDispatch>;

export const AnnouncementMessageSchema = z.object({
  dispatchId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  title: z.string(),
  body: z.string(),
  sentAt: z.string(),
  sender: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<AnnouncementMessage>;

export const PermissionKeySchema = z.enum([
  'user:create',
  'user:read',
  'user:update',
  'user:delete',
  'user:assignRole',
  'user:resetPassword',
  'role:create',
  'role:read',
  'role:update',
  'role:delete',
  'role:grantPermission',
  'permission:read',
  'auditLog:read',
  'system:read',
  'system:update',
  'approval:read',
  'approval:review',
  'file:create',
  'file:read',
  'file:update',
  'file:delete',
  'file:access',
  'file:share',
  'file:listPersonal',
  'job:read',
  'job:retry',
  'identityProvider:create',
  'identityProvider:read',
  'identityProvider:update',
  'identityProvider:delete',
  'group:create',
  'group:read',
  'group:update',
  'group:delete',
  'group:assignRole',
  'authz:explain',
  'serviceAccount:create',
  'serviceAccount:read',
  'serviceAccount:update',
  'serviceAccount:delete',
  'webhook:create',
  'webhook:read',
  'webhook:update',
  'webhook:delete',
  'tag:create',
  'tag:update',
  'tag:delete',
  'notification:read',
  'announcement:create',
  'announcement:read',
  'announcement:update',
  'announcement:delete',
  'announcement:publish',
]) satisfies z.ZodType<PermissionKey>;

export const PermissionSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  key: PermissionKeySchema,
  resource: z.string(),
  action: z.string(),
  nameI18nKey: z.string(),
  description: z.string().nullable(),
  sortOrder: z.int().min(-9007199254740991).max(9007199254740991),
  includes: z.array(PermissionKeySchema),
  requires: z.array(PermissionKeySchema),
}) satisfies z.ZodType<Permission>;

export const ExplainNodeSchema = z.object({
  type: z.string(),
  id: z.string().nullable(),
  relation: z.string(),
  name: z.string().nullable(),
  hidden: z.boolean(),
}) satisfies z.ZodType<ExplainNode>;

export const PermissionSourceSchema = z.object({
  grantedKey: z.string(),
  via: z.array(ExplainNodeSchema),
}) satisfies z.ZodType<PermissionSource>;

export const EffectivePermissionSchema = z.object({
  key: PermissionKeySchema,
  source: PermissionSourceSchema,
  impliedBy: z.array(PermissionKeySchema),
}) satisfies z.ZodType<EffectivePermission>;

export const PermissionGroupSchema = z.object({
  resource: z.string(),
  nameI18nKey: z.string(),
  keys: z.array(PermissionKeySchema),
}) satisfies z.ZodType<PermissionGroup>;

export const PermissionCatalogSchema = z.object({
  items: z.array(PermissionSchema),
  groups: z.array(PermissionGroupSchema),
}) satisfies z.ZodType<PermissionCatalog>;

export const ApiTokenSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(PermissionKeySchema).nullable(),
  status: z.enum(['active', 'expired', 'revoked', 'invalidated']),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<ApiToken>;

export const ApiTokenListSchema = z.object({
  items: z.array(ApiTokenSchema),
}) satisfies z.ZodType<ApiTokenList>;

export const CreateApiTokenRequestSchema = z.object({
  name: z.string().min(1).max(100),
  expiresInDays: z.int().min(1).max(365),
  scopes: z.array(PermissionKeySchema).min(1).max(50).nullable().optional(),
}) satisfies z.ZodType<CreateApiTokenRequest>;

export const CreatedApiTokenSchema = z.object({
  token: z.string(),
  apiToken: ApiTokenSchema,
}) satisfies z.ZodType<CreatedApiToken>;

export const WebhookTargetSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  url: z.string(),
  consecutiveFailures: z.int().min(-9007199254740991).max(9007199254740991),
  lastDeliveryAt: z.string().nullable(),
}) satisfies z.ZodType<WebhookTarget>;

export const WebhookSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  targets: z.array(WebhookTargetSchema),
  events: z.array(z.string()),
  status: z.enum(['active', 'disabled']),
  disabledReason: z.enum(['manual', 'failing']).nullable(),
  consecutiveFailures: z.int().min(-9007199254740991).max(9007199254740991),
  lastDeliveryAt: z.string().nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<Webhook>;

export const CreateWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100),
  urls: z.array(z.string().min(1).max(2000)).min(1).max(10),
  events: z.array(z.string().min(1).max(100)).min(1).max(50),
}) satisfies z.ZodType<CreateWebhookRequest>;

export const UpdateWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  urls: z.array(z.string().min(1).max(2000)).min(1).max(10).optional(),
  events: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateWebhookRequest>;

export const CreatedWebhookSchema = z.object({
  secret: z.string(),
  webhook: WebhookSchema,
}) satisfies z.ZodType<CreatedWebhook>;

export const WebhookSecretSchema = z.object({
  secret: z.string(),
  webhook: WebhookSchema,
}) satisfies z.ZodType<WebhookSecret>;

export const WebhookEventListSchema = z.object({
  items: z.array(
    z.object({
      type: z.string(),
      version: z.int().min(-9007199254740991).max(9007199254740991),
    }),
  ),
}) satisfies z.ZodType<WebhookEventList>;

export const WebhookDeliverySchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  eventId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  eventType: z.string(),
  eventData: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  targetId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  url: z.string(),
  attempt: z.int().min(-9007199254740991).max(9007199254740991),
  trigger: z.enum(['auto', 'manual']),
  succeeded: z.boolean(),
  responseStatus: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  durationMs: z.int().min(-9007199254740991).max(9007199254740991),
  responseBody: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<WebhookDelivery>;

export const WebhookTestResultSchema = z.object({
  items: z.array(WebhookDeliverySchema),
}) satisfies z.ZodType<WebhookTestResult>;

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
]) satisfies z.ZodType<ApprovalStatus>;

export const ApprovalTypeSchema = z.enum([
  'user.register',
  'fileFolder.access',
]) satisfies z.ZodType<ApprovalType>;

export const ApprovalRequestSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  type: ApprovalTypeSchema,
  status: ApprovalStatusSchema,
  payload: z.record(z.string(), z.unknown()),
  requesterId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  requesterName: z.string(),
  reason: z.string().nullable(),
  reviewerId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  reviewerName: z.string().nullable(),
  reviewComment: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  resultResourceId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ApprovalRequest>;

export const ApproveApprovalRequestSchema = z.object({
  comment: z.string().max(500).optional(),
  roleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20)
    .default([]),
}) satisfies z.ZodType<ApproveApprovalRequest>;

export const RejectApprovalRequestSchema = z.object({
  comment: z.string().max(500).optional(),
}) satisfies z.ZodType<RejectApprovalRequest>;

export const AuditLogSummarySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  resourceName: z.string().nullable(),
  result: z.enum(['success', 'failure']),
  errorCode: z.string().nullable(),
}) satisfies z.ZodType<AuditLogSummary>;

export const AuditLogListSchema = z.object({
  items: z.array(AuditLogSummarySchema),
  pagination: z.object({
    offset: z.int().min(-9007199254740991).max(9007199254740991),
    limit: z.int().min(-9007199254740991).max(9007199254740991),
    total: z.int().min(-9007199254740991).max(9007199254740991),
  }),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<AuditLogList>;

export const AuditLogSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  resourceName: z.string().nullable(),
  result: z.enum(['success', 'failure']),
  errorCode: z.string().nullable(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<AuditLog>;

export const IdentityProviderDomainSchema = z.object({
  domain: z
    .string()
    .max(253)
    .regex(new RegExp('^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\\.(?!-)[a-z0-9-]{1,63}(?<!-))+$')),
  ssoOnly: z.boolean(),
}) satisfies z.ZodType<IdentityProviderDomain>;

export const IdentityProviderSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  issuer: z.string(),
  clientId: z.string(),
  scopes: z.string(),
  enabled: z.boolean(),
  unmatchedPolicy: z.enum(['reject', 'auto_create']),
  domains: z.array(IdentityProviderDomainSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<IdentityProvider>;

export const IdentityProviderListSchema = z.object({
  items: z.array(IdentityProviderSchema),
  callbackUrl: z.url(),
}) satisfies z.ZodType<IdentityProviderList>;

export const CreateIdentityProviderRequestSchema = z.object({
  name: z.string().min(1).max(64),
  issuer: z.url().max(500),
  clientId: z.string().min(1).max(255),
  clientSecret: z.string().min(1).max(2000),
  scopes: z.string().max(500).default('openid email profile'),
  enabled: z.boolean().default(true),
  unmatchedPolicy: z.enum(['reject', 'auto_create']).default('reject'),
  domains: z.array(IdentityProviderDomainSchema).max(50).default([]),
}) satisfies z.ZodType<CreateIdentityProviderRequest>;

export const UpdateIdentityProviderRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  issuer: z.url().max(500).optional(),
  clientId: z.string().min(1).max(255).optional(),
  clientSecret: z.string().min(1).max(2000).optional(),
  scopes: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  unmatchedPolicy: z.enum(['reject', 'auto_create']).optional(),
  domains: z.array(IdentityProviderDomainSchema).max(50).optional(),
}) satisfies z.ZodType<UpdateIdentityProviderRequest>;

export const PlatformNotificationSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
  link: z
    .object({
      route: z.string(),
      params: z.record(z.string(), z.string()),
    })
    .nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<PlatformNotification>;

export const PlatformNotificationUnreadCountSchema = z.object({
  count: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<PlatformNotificationUnreadCount>;

export const PlatformAdminSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['super-admin', 'operator', 'auditor']),
  status: z.enum(['active', 'inactive', 'locked', 'pending']),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<PlatformAdmin>;

export const PlatformAdminListSchema = z.object({
  items: z.array(PlatformAdminSchema),
}) satisfies z.ZodType<PlatformAdminList>;

export const CreatePlatformAdminRequestSchema = z.object({
  email: z
    .email()
    .max(254)
    .regex(
      new RegExp(
        "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
      ),
    ),
  displayName: z.string().min(1).max(100),
  role: z.enum(['super-admin', 'operator', 'auditor']),
}) satisfies z.ZodType<CreatePlatformAdminRequest>;

export const UpdatePlatformAdminRequestSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(['super-admin', 'operator', 'auditor']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}) satisfies z.ZodType<UpdatePlatformAdminRequest>;

export const PlatformAdminPasswordLinkSchema = z.object({
  purpose: z.enum(['activation', 'passwordReset']),
}) satisfies z.ZodType<PlatformAdminPasswordLink>;

export const PlatformAuditLogSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  result: z.enum(['success', 'failure']),
  errorCode: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<PlatformAuditLog>;

export const TagSummarySchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  color: z.enum(['neutral', 'brand', 'success', 'warning', 'danger']),
}) satisfies z.ZodType<TagSummary>;

export const TagSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  scope: z.string(),
  name: z.string(),
  color: z.enum(['neutral', 'brand', 'success', 'warning', 'danger']),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Tag>;

export const TagListSchema = z.object({
  items: z.array(TagSchema),
}) satisfies z.ZodType<TagList>;

export const CreateTagRequestSchema = z.object({
  scope: z.string().max(50).regex(new RegExp('^[a-z][A-Za-z0-9]*$')),
  name: z.string().min(1).max(50),
  color: z.enum(['neutral', 'brand', 'success', 'warning', 'danger']).default('neutral'),
}) satisfies z.ZodType<CreateTagRequest>;

export const UpdateTagRequestSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.enum(['neutral', 'brand', 'success', 'warning', 'danger']).optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateTagRequest>;

export const ReplaceResourceTagsRequestSchema = z.object({
  tagIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20),
}) satisfies z.ZodType<ReplaceResourceTagsRequest>;

export const ResourceTagsSchema = z.object({
  tags: z.array(TagSummarySchema),
}) satisfies z.ZodType<ResourceTags>;

export const CreateUserRequestSchema = z.object({
  email: z
    .email()
    .max(255)
    .regex(
      new RegExp(
        "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
      ),
    ),
  username: z.string().min(3).max(50).optional(),
  displayName: z.string().min(1).max(100),
  roleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20)
    .default([]),
}) satisfies z.ZodType<CreateUserRequest>;

export const UpdateUserRequestSchema = z.object({
  username: z.string().min(3).max(50).nullable().optional(),
  displayName: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateUserRequest>;

export const ReplaceUserRolesRequestSchema = z.object({
  roleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20),
  expectedRoleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(100),
}) satisfies z.ZodType<ReplaceUserRolesRequest>;

export const UserStatusSchema = z.enum([
  'pending',
  'active',
  'inactive',
  'locked',
]) satisfies z.ZodType<UserStatus>;

export const RoleSummarySchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  slug: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
}) satisfies z.ZodType<RoleSummary>;

export const UserSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  email: z.string(),
  username: z.string().nullable(),
  displayName: z.string(),
  status: UserStatusSchema,
  roles: z.array(RoleSummarySchema),
  tags: z.array(TagSummarySchema),
  locale: z.string(),
  timezone: z.string(),
  lastLoginAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<User>;

export const UserRolesSchema = z.object({
  roles: z.array(RoleSummarySchema),
}) satisfies z.ZodType<UserRoles>;

export const TenantFeatureSchema = z.enum([
  'file',
  'auditLog',
  'job',
  'trash',
  'systemSetting',
  'identityProvider',
  'tenantSwitch',
  'webhook',
  'announcement',
]) satisfies z.ZodType<TenantFeature>;

export const TenantFlagOverridesSchema = z.record(
  z.string(),
  z.boolean(),
) satisfies z.ZodType<TenantFlagOverrides>;

export const TenantFeatureParamKeySchema = z.enum([
  'file.storageQuotaMb',
  'auditLog.hotRetentionDays',
  'job.maxConcurrency',
  'identityProvider.maxProviders',
  'webhook.maxUrls',
  'rateLimit.authPerMinute',
]) satisfies z.ZodType<TenantFeatureParamKey>;

export const TenantFeatureParamSchema = z.object({
  key: TenantFeatureParamKeySchema,
  feature: TenantFeatureSchema.nullable(),
  type: z.enum(['integer', 'string']),
  value: z.union([z.number(), z.string()]),
  defaultValue: z.union([z.number(), z.string()]),
  overridden: z.boolean(),
  unit: z.enum(['days', 'megabytes', 'count', 'perMinute']).nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  maxLength: z.number().nullable(),
}) satisfies z.ZodType<TenantFeatureParam>;

export const PlatformTenantSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  code: z.string(),
  name: z.string(),
  status: z.enum(['provisioning', 'active', 'disabled', 'failed']),
  domains: z.array(z.string()),
  storageBucket: z.string(),
  features: z.array(TenantFeatureSchema),
  flags: TenantFlagOverridesSchema,
  featureParams: z.array(TenantFeatureParamSchema),
  adminEmail: z.string().nullable(),
  provisionError: z.string().nullable(),
  provisionedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<PlatformTenant>;

export const PlatformTenantListSchema = z.object({
  items: z.array(PlatformTenantSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
  }),
  baseDomain: z.string(),
}) satisfies z.ZodType<PlatformTenantList>;

export const CreateTenantRequestSchema = z.object({
  code: z.string().regex(new RegExp('^[a-z][a-z0-9-]{1,30}[a-z0-9]$')),
  name: z.string().min(1).max(100),
  adminEmail: z
    .email()
    .max(254)
    .regex(
      new RegExp(
        "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
      ),
    ),
  adminName: z.string().min(1).max(100).optional(),
  domains: z
    .array(
      z
        .string()
        .regex(
          new RegExp(
            '^(?=.{1,253}(?::\\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\\d{1,5})?$',
          ),
        ),
    )
    .max(10)
    .default([]),
}) satisfies z.ZodType<CreateTenantRequest>;

export const UpdateTenantRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  features: z.array(TenantFeatureSchema).max(9).optional(),
  flags: TenantFlagOverridesSchema.optional(),
  featureParams: z
    .record(z.string(), z.union([z.number(), z.string().max(1000)]).nullable())
    .optional(),
}) satisfies z.ZodType<UpdateTenantRequest>;

export const TenantFeatureImpactSchema = z.object({
  feature: TenantFeatureSchema,
  available: z.boolean(),
  items: z.array(
    z.object({
      key: z.enum(['identityProviderConnections', 'ssoOnlyDomains', 'passwordlessExternalUsers']),
      count: z.int().min(0).max(9007199254740991),
    }),
  ),
}) satisfies z.ZodType<TenantFeatureImpact>;

export const AddTenantDomainRequestSchema = z.object({
  domain: z
    .string()
    .regex(
      new RegExp(
        '^(?=.{1,253}(?::\\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\\d{1,5})?$',
      ),
    ),
}) satisfies z.ZodType<AddTenantDomainRequest>;

export const LoginRequestSchema = z.object({
  email: z
    .email()
    .max(255)
    .regex(
      new RegExp(
        "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
      ),
    ),
  password: z.string().min(1).max(128),
}) satisfies z.ZodType<LoginRequest>;

export const SessionSchema = z.object({
  accessToken: z.string(),
  tokenType: z.enum(['Bearer']),
  expiresIn: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<Session>;

export const ProfileSchema = z.object({
  user: z.object({
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
    email: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    status: UserStatusSchema,
    lastLoginAt: z.string().nullable(),
    preferences: z.object({
      locale: z.string(),
      timezone: z.string(),
    }),
  }),
  roles: z.array(RoleSummarySchema),
  permissions: z.array(PermissionKeySchema),
  features: z.array(TenantFeatureSchema),
  flags: z.array(z.string()),
}) satisfies z.ZodType<Profile>;

export const PlatformPermissionKeySchema = z.enum([
  'tenant:read',
  'tenant:create',
  'tenant:update',
  'tenant:delete',
  'platformAdmin:read',
  'platformAdmin:create',
  'platformAdmin:update',
  'platformAuditLog:read',
  'platformJob:read',
  'platformJob:retry',
  'featureFlag:read',
  'featureFlag:update',
]) satisfies z.ZodType<PlatformPermissionKey>;

export const PlatformProfileSchema = z.object({
  admin: z.object({
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
    email: z.string(),
    displayName: z.string(),
    status: z.enum(['active', 'inactive', 'locked', 'pending']),
    lastLoginAt: z.string().nullable(),
    role: z.enum(['super-admin', 'operator', 'auditor']),
  }),
  permissions: z.array(PlatformPermissionKeySchema),
}) satisfies z.ZodType<PlatformProfile>;

export const UpdatePlatformProfileRequestSchema = z.object({
  displayName: z.string().min(1).max(100),
}) satisfies z.ZodType<UpdatePlatformProfileRequest>;

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  preferences: z
    .object({
      locale: z.string().max(10).optional(),
      timezone: z.string().min(1).max(64).optional(),
    })
    .optional(),
}) satisfies z.ZodType<UpdateProfileRequest>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
}) satisfies z.ZodType<ChangePasswordRequest>;

export const ForgotPasswordRequestSchema = z.object({
  email: z
    .email()
    .max(255)
    .regex(
      new RegExp(
        "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
      ),
    ),
}) satisfies z.ZodType<ForgotPasswordRequest>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(12).max(128),
}) satisfies z.ZodType<ResetPasswordRequest>;

export const SetupRequestSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(12).max(128),
}) satisfies z.ZodType<SetupRequest>;

export const RegisterRequestSchema = z.object({
  email: z
    .email()
    .max(255)
    .regex(
      new RegExp(
        "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
      ),
    ),
  displayName: z.string().min(1).max(100),
  reason: z.string().max(500).optional(),
}) satisfies z.ZodType<RegisterRequest>;

export const RegisterResultSchema = z.object({
  submitted: z.literal(true),
}) satisfies z.ZodType<RegisterResult>;

export const SsoInteractionSchema = z.object({
  uid: z.string(),
  prompt: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  loginHint: z.string().nullable(),
  uiLocales: z.string().nullable(),
  tenant: z
    .object({
      code: z.string(),
      name: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<SsoInteraction>;

export const SsoRedirectSchema = z.object({
  redirectTo: z.url(),
}) satisfies z.ZodType<SsoRedirect>;

export const SsoDiscoverySchema = z.object({
  provider: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    })
    .nullable(),
  ssoOnly: z.boolean(),
}) satisfies z.ZodType<SsoDiscovery>;

export const StartExternalLoginRequestSchema = z.object({
  providerId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
}) satisfies z.ZodType<StartExternalLoginRequest>;

export const SsoCallbackRequestSchema = z.object({
  code: z.string().min(10).max(500),
  codeVerifier: z.string().min(43).max(128),
  clientId: z.string().min(1).max(64),
  redirectUri: z.url().max(500),
}) satisfies z.ZodType<SsoCallbackRequest>;

export const PermissionSourcesSchema = z.object({
  isSuperAdmin: z.boolean(),
  superAdminVia: z.array(ExplainNodeSchema).nullable(),
  items: z.array(
    z.object({
      key: z.string(),
      sources: z.array(PermissionSourceSchema),
    }),
  ),
}) satisfies z.ZodType<PermissionSources>;

export const FeatureFlagGlobalStateSchema = z.enum([
  'on',
  'off',
]) satisfies z.ZodType<FeatureFlagGlobalState>;

export const FeatureFlagSchema = z.object({
  key: z.string(),
  description: z.string(),
  defaultEnabled: z.boolean(),
  owner: z.string(),
  removeBy: z.string(),
  globalState: FeatureFlagGlobalStateSchema.nullable(),
  tenantOverrides: z.object({
    on: z.int().min(-9007199254740991).max(9007199254740991),
    off: z.int().min(-9007199254740991).max(9007199254740991),
  }),
}) satisfies z.ZodType<FeatureFlag>;

export const FeatureFlagListSchema = z.object({
  items: z.array(FeatureFlagSchema),
}) satisfies z.ZodType<FeatureFlagList>;

export const UpdateFeatureFlagRequestSchema = z.object({
  state: z.enum(['default', 'on', 'off']),
}) satisfies z.ZodType<UpdateFeatureFlagRequest>;

export const CreateFileUploadRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(
      new RegExp(
        '^[^/\\\\\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]+$',
      ),
    ),
  contentType: z
    .string()
    .max(255)
    .regex(new RegExp('^[a-z0-9][a-z0-9!#$&^_.+-]*\\/[a-z0-9][a-z0-9!#$&^_.+-]*$')),
  size: z.int().min(0).max(9007199254740991),
  folderId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
  thumbnail: z
    .object({
      contentType: z.enum(['image/webp', 'image/jpeg', 'image/png']),
      size: z.int().min(1).max(524288),
    })
    .optional(),
}) satisfies z.ZodType<CreateFileUploadRequest>;

export const CreateFileUploadPartsRequestSchema = z.object({
  partNumbers: z.array(z.int().min(1).max(10000)).min(1).max(100),
}) satisfies z.ZodType<CreateFileUploadPartsRequest>;

export const CompleteFileUploadRequestSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.int().min(1).max(10000),
        etag: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(10000)
    .optional(),
}) satisfies z.ZodType<CompleteFileUploadRequest>;

export const FileAccessExplainSchema = z.object({
  folderId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  userId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  actions: z.array(
    z.object({
      action: z.enum(['read', 'create', 'update', 'delete', 'share']),
      allowed: z.boolean(),
      path: z.array(ExplainNodeSchema).nullable(),
    }),
  ),
}) satisfies z.ZodType<FileAccessExplain>;

export const SetFileFolderGrantRequestSchema = z.object({
  subjectType: z.enum(['role', 'user', 'group', 'everyone']),
  subjectId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  level: z.enum(['viewer', 'contributor', 'editor', 'manager']),
  expiresAt: z.iso
    .datetime({ offset: true })
    .regex(
      new RegExp(
        '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
      ),
    )
    .nullable()
    .default(null),
}) satisfies z.ZodType<SetFileFolderGrantRequest>;

export const FileFolderGrantSchema = z.object({
  subjectType: z.enum(['role', 'user', 'group', 'everyone']),
  subjectId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  subjectName: z.string(),
  level: z.enum(['viewer', 'contributor', 'editor', 'manager']),
  expiresAt: z.string().nullable(),
  isExpired: z.boolean(),
  grantedAt: z.string(),
  source: z
    .object({
      folderId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      folderName: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<FileFolderGrant>;

export const FileFolderGrantListSchema = z.object({
  folderId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  inheritGrants: z.boolean(),
  assignableLevels: z.array(z.enum(['viewer', 'contributor', 'editor', 'manager'])),
  items: z.array(FileFolderGrantSchema),
}) satisfies z.ZodType<FileFolderGrantList>;

export const FileGrantSubjectListSchema = z.object({
  items: z.array(
    z.object({
      subjectType: z.enum(['role', 'user', 'group', 'everyone']),
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
      hint: z.string().nullable(),
    }),
  ),
}) satisfies z.ZodType<FileGrantSubjectList>;

export const UpdateFileFolderAccessRequestSchema = z.object({
  inheritGrants: z.boolean(),
}) satisfies z.ZodType<UpdateFileFolderAccessRequest>;

export const CreateFileAccessRequestSchema = z.object({
  level: z.enum(['viewer', 'contributor', 'editor', 'manager']),
  reason: z.string().max(500).optional(),
}) satisfies z.ZodType<CreateFileAccessRequest>;

export const FileAccessRequestSubmittedSchema = z.object({
  submitted: z.boolean(),
}) satisfies z.ZodType<FileAccessRequestSubmitted>;

export const FileAccessRequestSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  requesterId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  requesterName: z.string(),
  level: z.enum(['viewer', 'contributor', 'editor', 'manager']),
  reason: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<FileAccessRequest>;

export const FileAccessRequestListSchema = z.object({
  items: z.array(FileAccessRequestSchema),
}) satisfies z.ZodType<FileAccessRequestList>;

export const ReviewFileAccessRequestSchema = z.object({
  comment: z.string().max(500).optional(),
}) satisfies z.ZodType<ReviewFileAccessRequest>;

export const FileFolderCapabilitiesSchema = z.object({
  canRead: z.boolean(),
  canCreate: z.boolean(),
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
  canShare: z.boolean(),
}) satisfies z.ZodType<FileFolderCapabilities>;

export const FileFolderSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  kind: z.enum(['normal', 'shared', 'privateRoot', 'personal']),
  inheritGrants: z.boolean(),
  hasPendingAccessRequest: z.boolean(),
  capabilities: FileFolderCapabilitiesSchema,
  tags: z.array(TagSummarySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<FileFolder>;

export const RestoredFileFolderSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  kind: z.enum(['normal', 'shared', 'privateRoot', 'personal']),
  inheritGrants: z.boolean(),
  hasPendingAccessRequest: z.boolean(),
  capabilities: FileFolderCapabilitiesSchema,
  tags: z.array(TagSummarySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  foldersRestored: z.int().min(-9007199254740991).max(9007199254740991),
  filesRestored: z.int().min(-9007199254740991).max(9007199254740991),
  filesSkipped: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<RestoredFileFolder>;

export const FileFolderListSchema = z.object({
  items: z.array(FileFolderSchema),
  rootCapabilities: z.object({
    canCreate: z.boolean(),
  }),
  personalFolderId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
}) satisfies z.ZodType<FileFolderList>;

export const CreateFileFolderRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(
      new RegExp(
        '^[^/\\\\\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]+$',
      ),
    ),
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .default(null),
}) satisfies z.ZodType<CreateFileFolderRequest>;

export const UpdateFileFolderRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(
      new RegExp(
        '^[^/\\\\\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]+$',
      ),
    ),
}) satisfies z.ZodType<UpdateFileFolderRequest>;

export const EnsureFileFolderPathsRequestSchema = z.object({
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .default(null),
  paths: z
    .array(
      z
        .array(
          z
            .string()
            .min(1)
            .max(255)
            .regex(
              new RegExp(
                '^[^/\\\\\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]+$',
              ),
            ),
        )
        .min(1)
        .max(32),
    )
    .min(1)
    .max(1000),
}) satisfies z.ZodType<EnsureFileFolderPathsRequest>;

export const FileFolderPathsSchema = z.object({
  items: z.array(
    z.object({
      path: z.array(z.string()),
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    }),
  ),
}) satisfies z.ZodType<FileFolderPaths>;

export const MoveFileItemsRequestSchema = z.object({
  fileIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(1000)
    .default([]),
  folderIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(1000)
    .default([]),
  targetFolderId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
}) satisfies z.ZodType<MoveFileItemsRequest>;

export const MoveFileItemsResultSchema = z.object({
  movedFiles: z.int().min(-9007199254740991).max(9007199254740991),
  movedFolders: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<MoveFileItemsResult>;

export const FileUploaderSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  displayName: z.string(),
}) satisfies z.ZodType<FileUploader>;

export const StoredFileImageSchema = z.object({
  width: z.int().min(-9007199254740991).max(9007199254740991),
  height: z.int().min(-9007199254740991).max(9007199254740991),
  originalUrl: z.string(),
  previewUrl: z.string(),
  thumbnailUrl: z.string(),
  expiresAt: z.string(),
}) satisfies z.ZodType<StoredFileImage>;

export const StoredFileCapabilitiesSchema = z.object({
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
}) satisfies z.ZodType<StoredFileCapabilities>;

export const StoredFileSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  contentType: z.string(),
  size: z.int().min(-9007199254740991).max(9007199254740991),
  status: z.enum(['pending', 'ready']),
  folderId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  url: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  image: StoredFileImageSchema.nullable(),
  urlExpiresAt: z.string().nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  uploader: FileUploaderSchema.nullable(),
  capabilities: StoredFileCapabilitiesSchema,
  tags: z.array(TagSummarySchema),
  uploadedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<StoredFile>;

export const FileListPageSchema = z.object({
  items: z.array(StoredFileSchema),
  pagination: z.object({
    offset: z.int().min(-9007199254740991).max(9007199254740991),
    limit: z.int().min(-9007199254740991).max(9007199254740991),
    total: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  }),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<FileListPage>;

export const FileUploadTargetSchema = z.object({
  url: z.string(),
  method: z.enum(['PUT']),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
}) satisfies z.ZodType<FileUploadTarget>;

export const FileMultipartUploadSchema = z.object({
  partSize: z.int().min(-9007199254740991).max(9007199254740991),
  partCount: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<FileMultipartUpload>;

export const FileUploadSchema = z.object({
  file: StoredFileSchema,
  upload: FileUploadTargetSchema.nullable(),
  multipart: FileMultipartUploadSchema.nullable(),
  thumbnailUpload: FileUploadTargetSchema.nullable(),
}) satisfies z.ZodType<FileUpload>;

export const FileUploadPartSchema = z.object({
  partNumber: z.int().min(-9007199254740991).max(9007199254740991),
  url: z.string(),
  method: z.enum(['PUT']),
  headers: z.record(z.string(), z.string()),
}) satisfies z.ZodType<FileUploadPart>;

export const FileUploadPartsSchema = z.object({
  parts: z.array(FileUploadPartSchema),
  expiresAt: z.string(),
}) satisfies z.ZodType<FileUploadParts>;

export const FileUploadPolicySchema = z.object({
  maxSize: z.int().min(-9007199254740991).max(9007199254740991),
  multipartThreshold: z.int().min(-9007199254740991).max(9007199254740991),
  partSize: z.int().min(-9007199254740991).max(9007199254740991),
  thumbnailMaxSize: z.int().min(-9007199254740991).max(9007199254740991),
  thumbnailContentTypes: z.array(z.string()),
  storageQuota: z.int().min(-9007199254740991).max(9007199254740991),
  storageUsed: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<FileUploadPolicy>;

export const GetFileImageQuerySchema = z.object({
  exp: z.int().max(9007199254740991).gt(0),
  sig: z.string().min(1).max(100),
  format: z.enum(['jpeg', 'webp', 'avif', 'png', 'auto']).optional(),
}) satisfies z.ZodType<GetFileImageQuery>;

export const UpdateFileRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(
      new RegExp(
        '^[^/\\\\\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]+$',
      ),
    ),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateFileRequest>;

export const CreateGroupRequestSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
}) satisfies z.ZodType<CreateGroupRequest>;

export const GroupSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.int().min(-9007199254740991).max(9007199254740991),
  roleCount: z.int().min(-9007199254740991).max(9007199254740991),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  membership: z.enum(['direct', 'nested']).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Group>;

export const RestoredGroupSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.int().min(-9007199254740991).max(9007199254740991),
  roleCount: z.int().min(-9007199254740991).max(9007199254740991),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  membership: z.enum(['direct', 'nested']).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<RestoredGroup>;

export const GroupMemberSchema = z.object({
  type: z.enum(['user', 'group']),
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  email: z.string().nullable(),
  status: z.enum(['pending', 'active', 'inactive', 'locked']).nullable(),
}) satisfies z.ZodType<GroupMember>;

export const GroupRoleSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  slug: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
}) satisfies z.ZodType<GroupRole>;

export const GroupRolesSchema = z.object({
  roles: z.array(GroupRoleSchema),
}) satisfies z.ZodType<GroupRoles>;

export const UpdateGroupRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).nullable().optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateGroupRequest>;

export const GroupMemberRefSchema = z.object({
  type: z.enum(['user', 'group']),
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
}) satisfies z.ZodType<GroupMemberRef>;

export const UpdateGroupMembersRequestSchema = z.object({
  add: z.array(GroupMemberRefSchema).max(100).default([]),
  remove: z.array(GroupMemberRefSchema).max(100).default([]),
}) satisfies z.ZodType<UpdateGroupMembersRequest>;

export const UpdateGroupRolesRequestSchema = z.object({
  add: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(100)
    .default([]),
  remove: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(100)
    .default([]),
}) satisfies z.ZodType<UpdateGroupRolesRequest>;

export const JobQueueSchema = z.object({
  name: z.string(),
  cron: z.string().nullable(),
  readyCount: z.int().min(-9007199254740991).max(9007199254740991),
  deferredCount: z.int().min(-9007199254740991).max(9007199254740991),
  activeCount: z.int().min(-9007199254740991).max(9007199254740991),
  failedCount: z.int().min(-9007199254740991).max(9007199254740991),
  completedCount: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<JobQueue>;

export const JobQueueListSchema = z.object({
  items: z.array(JobQueueSchema),
}) satisfies z.ZodType<JobQueueList>;

export const JobSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  retryCount: z.int().min(-9007199254740991).max(9007199254740991),
  retryLimit: z.int().min(-9007199254740991).max(9007199254740991),
  createdOn: z.string(),
  startAfter: z.string(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
}) satisfies z.ZodType<JobSummary>;

export const JobSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  retryCount: z.int().min(-9007199254740991).max(9007199254740991),
  retryLimit: z.int().min(-9007199254740991).max(9007199254740991),
  createdOn: z.string(),
  startAfter: z.string(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<Job>;

export const PlatformJobQueueSchema = z.object({
  name: z.string(),
  cron: z.string().nullable(),
  readyCount: z.int().min(-9007199254740991).max(9007199254740991),
  deferredCount: z.int().min(-9007199254740991).max(9007199254740991),
  activeCount: z.int().min(-9007199254740991).max(9007199254740991),
  failedCount: z.int().min(-9007199254740991).max(9007199254740991),
  completedCount: z.int().min(-9007199254740991).max(9007199254740991),
  scope: z.enum(['tenant', 'platform']),
}) satisfies z.ZodType<PlatformJobQueue>;

export const PlatformJobQueueListSchema = z.object({
  items: z.array(PlatformJobQueueSchema),
}) satisfies z.ZodType<PlatformJobQueueList>;

export const PlatformJobSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  retryCount: z.int().min(-9007199254740991).max(9007199254740991),
  retryLimit: z.int().min(-9007199254740991).max(9007199254740991),
  createdOn: z.string(),
  startAfter: z.string(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
  tenantId: z.string().nullable(),
  tenantCode: z.string().nullable(),
}) satisfies z.ZodType<PlatformJobSummary>;

export const PlatformJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  retryCount: z.int().min(-9007199254740991).max(9007199254740991),
  retryLimit: z.int().min(-9007199254740991).max(9007199254740991),
  createdOn: z.string(),
  startAfter: z.string(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
  tenantId: z.string().nullable(),
  tenantCode: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<PlatformJob>;

export const RevisionSummarySchema = z.object({
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  actor: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    })
    .nullable(),
  tooLarge: z.boolean(),
}) satisfies z.ZodType<RevisionSummary>;

export const CreateRoleRequestSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  permissionKeys: z.array(PermissionKeySchema).max(100).default([]),
}) satisfies z.ZodType<CreateRoleRequest>;

export const DuplicateRoleRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<DuplicateRoleRequest>;

export const RoleRevisionSnapshotSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  permissionKeys: z.array(z.string()),
}) satisfies z.ZodType<RoleRevisionSnapshot>;

export const RoleRevisionSchema = z.object({
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  actor: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    })
    .nullable(),
  tooLarge: z.boolean(),
  snapshot: RoleRevisionSnapshotSchema.nullable(),
}) satisfies z.ZodType<RoleRevision>;

export const RevertRoleRevisionRequestSchema = z.object({
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<RevertRoleRevisionRequest>;

export const RoleSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissionCount: z.int().min(-9007199254740991).max(9007199254740991),
  userCount: z.int().min(-9007199254740991).max(9007199254740991),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Role>;

export const RestoredRoleSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissionCount: z.int().min(-9007199254740991).max(9007199254740991),
  userCount: z.int().min(-9007199254740991).max(9007199254740991),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
  holdersRestored: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<RestoredRole>;

export const RolePermissionsSchema = z.object({
  permissions: z.array(PermissionSchema),
  effective: z.array(EffectivePermissionSchema),
  isSuperAdmin: z.boolean(),
}) satisfies z.ZodType<RolePermissions>;

export const RoleHolderSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(['pending', 'active', 'inactive', 'locked']),
}) satisfies z.ZodType<RoleHolder>;

export const UpdateRoleRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).nullable().optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateRoleRequest>;

export const UpdateRolePermissionsRequestSchema = z.object({
  add: z.array(PermissionKeySchema).max(100).default([]),
  remove: z.array(PermissionKeySchema).max(100).default([]),
}) satisfies z.ZodType<UpdateRolePermissionsRequest>;

export const ServiceAccountSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  status: z.enum(['active', 'inactive']),
  roles: z.array(RoleSummarySchema),
  activeTokenCount: z.int().min(-9007199254740991).max(9007199254740991),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ServiceAccount>;

export const CreateServiceAccountRequestSchema = z.object({
  name: z.string().min(1).max(100),
  roleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20)
    .default([]),
}) satisfies z.ZodType<CreateServiceAccountRequest>;

export const UpdateServiceAccountRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateServiceAccountRequest>;

export const ReplaceServiceAccountRolesRequestSchema = z.object({
  roleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20),
  expectedRoleIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .max(20),
}) satisfies z.ZodType<ReplaceServiceAccountRolesRequest>;

export const ServiceAccountRolesSchema = z.object({
  roles: z.array(RoleSummarySchema),
}) satisfies z.ZodType<ServiceAccountRoles>;

export const SystemSettingSchema = z.object({
  key: z.string(),
  category: z.enum(['general', 'auth', 'file', 'trash', 'revision', 'notification']),
  type: z.enum(['string', 'number', 'boolean']),
  value: z.union([z.string().max(1000), z.number(), z.boolean()]),
  defaultValue: z.union([z.string().max(1000), z.number(), z.boolean()]),
  isOverridden: z.boolean(),
  isPublic: z.boolean(),
  minimum: z.number().nullable(),
  maximum: z.number().nullable(),
  updatedAt: z.string().nullable(),
}) satisfies z.ZodType<SystemSetting>;

export const SystemSettingListSchema = z.object({
  items: z.array(SystemSettingSchema),
}) satisfies z.ZodType<SystemSettingList>;

export const UpdateSystemSettingsRequestSchema = z.object({
  values: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean()]).nullable()),
}) satisfies z.ZodType<UpdateSystemSettingsRequest>;

export const PublicSystemSettingsSchema = z.object({
  values: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean()])),
}) satisfies z.ZodType<PublicSystemSettings>;

export const CurrentTenantSchema = z.object({
  code: z.string(),
  name: z.string(),
}) satisfies z.ZodType<CurrentTenant>;

export const TenantLookupQuerySchema = z.object({
  code: z.string().min(1).max(63),
}) satisfies z.ZodType<TenantLookupQuery>;

export const TenantLookupSchema = z.object({
  code: z.string(),
  name: z.string(),
  loginUrl: z.string(),
}) satisfies z.ZodType<TenantLookup>;
