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
  ApprovalAssigneeRule,
  ApprovalAssigneeStatus,
  ApprovalCandidate,
  ApprovalCondition,
  ApprovalConditionField,
  ApprovalCounts,
  ApprovalDecision,
  ApprovalFlow,
  ApprovalFlowList,
  ApprovalFlowPreview,
  ApprovalFlowStep,
  ApprovalFlowStepInput,
  ApprovalRequest,
  ApprovalRequestDetail,
  ApprovalStatus,
  ApprovalStep,
  ApprovalStepStatus,
  ApprovalType,
  ApprovalViewer,
  ApproveApprovalRequest,
  AuditLog,
  AuditLogList,
  AuditLogSummary,
  CancelDataTransferRequest,
  CdnCheckNode,
  CdnCheckResult,
  CdnDeployment,
  CdnEffective,
  CdnOverview,
  CdnPurgeJobSummary,
  CdnPurgeRequest,
  CdnPurgeResult,
  CdnResource,
  CdnState,
  CdnStoredSettings,
  ChangePasswordRequest,
  Comment,
  CommentPage,
  CommentUser,
  CompleteFileUploadRequest,
  CompleteImageUploadRequest,
  ConfirmMfaEnrollmentRequest,
  CreateAnnouncementRequest,
  CreateApiTokenRequest,
  CreateCommentRequest,
  CreateExportRequest,
  CreateFileAccessRequest,
  CreateFileFolderRequest,
  CreateFileUploadPartsRequest,
  CreateFileUploadRequest,
  CreateGalleryAlbumRequest,
  CreateGalleryFromSourceRequest,
  CreateGalleryUploadRequest,
  CreateGroupRequest,
  CreateIdentityProviderRequest,
  CreateImageFromSourceRequest,
  CreateImageUploadRequest,
  CreateImportRequest,
  CreateOrgUnitRequest,
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
  DataTransfer,
  DataTransferApplyRow,
  DataTransferApplyRowList,
  DataTransferDownload,
  DataTransferExportColumn,
  DataTransferImportAnalysis,
  DataTransferImportColumn,
  DataTransferImportColumnList,
  DataTransferImportRow,
  DataTransferImportTarget,
  DataTransferOption,
  DataTransferReferenceOptionList,
  DataTransferResource,
  DataTransferResourceList,
  DataTransferRowIssue,
  DataTransferRowValidation,
  DataTransferTargetOptionList,
  DecideApprovalStepRequest,
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
  GalleryAlbum,
  GalleryAlbumItemsRequest,
  GalleryAlbumItemsResult,
  GalleryAlbumList,
  GalleryExif,
  GalleryFromSourceResult,
  GalleryItem,
  GalleryItemDetail,
  GalleryItemList,
  GalleryNeighbors,
  GalleryTimeline,
  GalleryUpload,
  GalleryUploadItem,
  GalleryUploadStatus,
  GalleryUploadTarget,
  GetFileImageQuery,
  Group,
  GroupMember,
  GroupMemberRef,
  GroupRole,
  GroupRoles,
  IdentityProvider,
  IdentityProviderDomain,
  IdentityProviderList,
  ImageAsset,
  ImageAssetList,
  ImageCrop,
  ImageOriginal,
  ImageSourceVariant,
  ImageSources,
  ImageUpload,
  ImageUploadTarget,
  ImageUsage,
  ImageUsageList,
  Job,
  JobName,
  JobQueue,
  JobQueueList,
  JobSummary,
  LoginRequest,
  MentionableList,
  MfaAccountStatus,
  MfaChallengeInfo,
  MfaEnrollment,
  MfaEnrollmentResult,
  MfaFactor,
  MfaInteractionEnrollmentResult,
  MfaLoginChallengeRequest,
  MfaLoginVerifyRequest,
  MfaLoginVerifyResult,
  MfaMethodImpact,
  MfaMethodInfo,
  MfaMethodSettings,
  MfaOverview,
  MfaPasswordConfirmRequest,
  MfaPolicy,
  MfaPolicyImpact,
  MfaRecoveryCodes,
  MfaSettingField,
  MoveFileItemsRequest,
  MoveFileItemsResult,
  MoveOrgUnitRequest,
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
  OrgUnit,
  OrgUnitDetail,
  OrgUnitMember,
  OrgUnitPathItem,
  OrgUnitTree,
  OverrideApprovalStepRequest,
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
  PlatformMfaMethod,
  PlatformMfaMethodList,
  PlatformNotification,
  PlatformNotificationUnreadCount,
  PlatformPermissionKey,
  PlatformProfile,
  PlatformTenant,
  PlatformTenantList,
  PlatformTenantListItem,
  PreviewApprovalFlowRequest,
  Profile,
  PublicSystemSettings,
  PutApprovalFlowRequest,
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
  RichTextDocument,
  RichTextMark,
  RichTextNode,
  Role,
  RoleHolder,
  RolePermissions,
  RoleRevision,
  RoleRevisionSnapshot,
  RoleSummary,
  SamlCertificate,
  SamlSettings,
  ServiceAccount,
  ServiceAccountRoles,
  Session,
  SetFileFolderGrantRequest,
  SetupRequest,
  SsoCallbackRequest,
  SsoDiscovery,
  SsoInteraction,
  SsoLoginResult,
  SsoMfaChallengeNext,
  SsoMfaEnrollNext,
  SsoPasskeyLoginRequest,
  SsoPasskeyOptions,
  SsoRedirect,
  StartExternalLoginRequest,
  StartMfaEnrollmentRequest,
  StorageTotal,
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
  TenantJobName,
  TenantLookup,
  TenantLookupQuery,
  TenantMfaMethodOverrides,
  TenantUsage,
  TenantUsageDay,
  TenantUsageSummary,
  TrashItem,
  TrashResourceType,
  UpdateAnnouncementRequest,
  UpdateCdnSettingsRequest,
  UpdateCommentRequest,
  UpdateFeatureFlagRequest,
  UpdateFileFolderAccessRequest,
  UpdateFileFolderRequest,
  UpdateFileRequest,
  UpdateGalleryAlbumRequest,
  UpdateGalleryItemRequest,
  UpdateGroupMembersRequest,
  UpdateGroupRequest,
  UpdateGroupRolesRequest,
  UpdateIdentityProviderRequest,
  UpdateMfaMethodSettingsRequest,
  UpdateMfaPolicyRequest,
  UpdateNotificationEventsRequest,
  UpdateNotificationPreferencesRequest,
  UpdateOrgUnitMembersRequest,
  UpdateOrgUnitRequest,
  UpdatePlatformAdminRequest,
  UpdatePlatformMfaMethodRequest,
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
  UserIdentity,
  UserIdentityList,
  UserOrgUnit,
  UserOrgUnits,
  UserRoles,
  UserStatus,
  ValidateImportRequest,
  ValidateImportResult,
  WatchState,
  Webhook,
  WebhookDelivery,
  WebhookEventList,
  WebhookSecret,
  WebhookTarget,
  WebhookTestResult,
} from '../models';

export const RichTextMarkSchema = z.object({
  type: z.enum(['bold', 'italic', 'underline', 'strike', 'code', 'link']),
  attrs: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<RichTextMark>;

export const RichTextNodeSchema: z.ZodType<RichTextNode> = z.object({
  type: z.enum([
    'paragraph',
    'heading',
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'hardBreak',
    'text',
  ]),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(z.lazy(() => RichTextNodeSchema)).optional(),
  text: z.string().optional(),
  marks: z.array(RichTextMarkSchema).optional(),
});

export const RichTextDocumentSchema = z.object({
  type: z.enum(['doc']),
  content: z.array(RichTextNodeSchema),
}) satisfies z.ZodType<RichTextDocument>;

export const ImageSourceVariantSchema = z.object({
  src: z.string(),
  srcSet: z.string(),
  sources: z.array(
    z.object({
      type: z.string(),
      srcSet: z.string(),
    }),
  ),
  width: z.int().min(-9007199254740991).max(9007199254740991),
  height: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<ImageSourceVariant>;

export const ImageSourcesSchema = z.object({
  width: z.int().min(-9007199254740991).max(9007199254740991),
  height: z.int().min(-9007199254740991).max(9007199254740991),
  expiresAt: z.string(),
  variants: z.record(z.string(), ImageSourceVariantSchema),
}) satisfies z.ZodType<ImageSources>;

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
  'orgUnit',
  'galleryItem',
  'galleryAlbum',
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
  body: RichTextDocumentSchema,
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
  body: RichTextDocumentSchema,
  audience: AnnouncementAudienceSchema,
  trigger: AnnouncementTriggerSchema,
}) satisfies z.ZodType<CreateAnnouncementRequest>;

export const UpdateAnnouncementRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: RichTextDocumentSchema.optional(),
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
  body: RichTextDocumentSchema,
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
  body: RichTextDocumentSchema,
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
  'user:resetMfa',
  'user:export',
  'role:create',
  'role:read',
  'role:update',
  'role:delete',
  'role:grantPermission',
  'role:export',
  'permission:read',
  'auditLog:read',
  'auditLog:export',
  'system:read',
  'system:update',
  'approval:read',
  'approval:review',
  'approval:override',
  'approval:export',
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
  'group:export',
  'authz:explain',
  'serviceAccount:create',
  'serviceAccount:read',
  'serviceAccount:update',
  'serviceAccount:delete',
  'serviceAccount:export',
  'webhook:create',
  'webhook:read',
  'webhook:update',
  'webhook:delete',
  'tag:create',
  'tag:update',
  'tag:delete',
  'tag:export',
  'notification:read',
  'announcement:create',
  'announcement:read',
  'announcement:update',
  'announcement:delete',
  'announcement:publish',
  'mfaPolicy:read',
  'mfaPolicy:update',
  'orgUnit:create',
  'orgUnit:read',
  'orgUnit:update',
  'orgUnit:delete',
  'orgUnit:export',
  'approvalFlow:read',
  'approvalFlow:update',
  'gallery:create',
  'gallery:read',
  'gallery:update',
  'gallery:delete',
  'comment:delete',
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
  grantedNameI18nKey: z.string(),
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

export const ImageCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
}) satisfies z.ZodType<ImageCrop>;

export const ImageUsageSchema = z.object({
  id: z.string(),
  maxSize: z.int().min(-9007199254740991).max(9007199254740991),
  contentTypes: z.array(z.string()),
  minWidth: z.int().min(-9007199254740991).max(9007199254740991),
  minHeight: z.int().min(-9007199254740991).max(9007199254740991),
  aspectRatio: z.number().nullable(),
  presets: z.record(z.string(), z.int().min(-9007199254740991).max(9007199254740991)),
  sources: z.array(z.string()).nullable(),
}) satisfies z.ZodType<ImageUsage>;

export const ImageUsageListSchema = z.object({
  items: z.array(ImageUsageSchema),
}) satisfies z.ZodType<ImageUsageList>;

export const ImageOriginalSchema = z.object({
  url: z.string(),
  width: z.int().min(-9007199254740991).max(9007199254740991),
  height: z.int().min(-9007199254740991).max(9007199254740991),
  expiresAt: z.string(),
}) satisfies z.ZodType<ImageOriginal>;

export const ImageAssetSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  usage: z.string(),
  status: z.enum(['pending', 'ready', 'failed']),
  failureReason: z
    .enum(['notImage', 'typeNotAllowed', 'tooLarge', 'tooSmall', 'missing'])
    .nullable(),
  name: z.string(),
  source: z.string(),
  width: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  height: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  crop: ImageCropSchema.nullable(),
  image: ImageSourcesSchema.nullable(),
  original: ImageOriginalSchema.nullable(),
  isInUse: z.boolean(),
  createdAt: z.string(),
}) satisfies z.ZodType<ImageAsset>;

export const ImageAssetListSchema = z.object({
  items: z.array(ImageAssetSchema),
}) satisfies z.ZodType<ImageAssetList>;

export const CreateImageUploadRequestSchema = z.object({
  usage: z.string().max(100).regex(new RegExp('^[a-z][A-Za-z0-9]*\\.[a-z][A-Za-z0-9]*$')),
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  size: z.int().max(9007199254740991).gt(0),
}) satisfies z.ZodType<CreateImageUploadRequest>;

export const ImageUploadTargetSchema = z.object({
  url: z.string(),
  method: z.enum(['PUT']),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
}) satisfies z.ZodType<ImageUploadTarget>;

export const ImageUploadSchema = z.object({
  asset: ImageAssetSchema,
  upload: ImageUploadTargetSchema,
}) satisfies z.ZodType<ImageUpload>;

export const CompleteImageUploadRequestSchema = z.object({
  crop: ImageCropSchema.optional(),
}) satisfies z.ZodType<CompleteImageUploadRequest>;

export const CreateImageFromSourceRequestSchema = z.object({
  usage: z.string().max(100).regex(new RegExp('^[a-z][A-Za-z0-9]*\\.[a-z][A-Za-z0-9]*$')),
  source: z.string().max(50).regex(new RegExp('^[a-z][A-Za-z0-9]*$')),
  refId: z.string().min(1).max(200),
  crop: ImageCropSchema.optional(),
}) satisfies z.ZodType<CreateImageFromSourceRequest>;

export const CommentUserSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  displayName: z.string(),
  email: z.string(),
}) satisfies z.ZodType<CommentUser>;

export const CommentSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  resourceType: z.string(),
  resourceId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  body: z.string(),
  author: CommentUserSchema.nullable(),
  authorAvatar: ImageSourcesSchema.nullable(),
  mentions: z.array(CommentUserSchema),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
}) satisfies z.ZodType<Comment>;

export const CommentPageSchema = z.object({
  items: z.array(CommentSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<CommentPage>;

export const CreateCommentRequestSchema = z.object({
  body: z.string().min(1).max(4000),
  mentionIds: z
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
}) satisfies z.ZodType<CreateCommentRequest>;

export const UpdateCommentRequestSchema = z.object({
  body: z.string().min(1).max(4000),
  mentionIds: z
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
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateCommentRequest>;

export const MentionableListSchema = z.object({
  items: z.array(CommentUserSchema),
}) satisfies z.ZodType<MentionableList>;

export const WatchStateSchema = z.object({
  watching: z.boolean(),
  watcherCount: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<WatchState>;

export const DataTransferSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  direction: z.enum(['export', 'import']),
  type: z.string(),
  mode: z.enum(['create', 'update']).nullable(),
  format: z.enum(['csv', 'xlsx', 'json', 'yaml', 'sql']),
  status: z.enum(['queued', 'running', 'applying', 'completed', 'failed', 'cancelled', 'expired']),
  scopeKind: z.enum(['ids', 'filter']).nullable(),
  columns: z.array(z.string()),
  sourceName: z.string().nullable(),
  outputName: z.string().nullable(),
  outputSize: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  totalRows: z.int().min(-9007199254740991).max(9007199254740991),
  processedRows: z.int().min(-9007199254740991).max(9007199254740991),
  succeededRows: z.int().min(-9007199254740991).max(9007199254740991),
  failedRows: z.int().min(-9007199254740991).max(9007199254740991),
  skippedRows: z.int().min(-9007199254740991).max(9007199254740991),
  errorCode: z.string().nullable(),
  errorDetails: z.record(z.string(), z.unknown()).nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  expiresAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<DataTransfer>;

export const CancelDataTransferRequestSchema = z.object({
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<CancelDataTransferRequest>;

export const DataTransferDownloadSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  fileName: z.string(),
}) satisfies z.ZodType<DataTransferDownload>;

export const DataTransferOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
}) satisfies z.ZodType<DataTransferOption>;

export const DataTransferExportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'enum', 'reference', 'json']),
}) satisfies z.ZodType<DataTransferExportColumn>;

export const DataTransferResourceSchema = z.object({
  type: z.string(),
  label: z.string(),
  export: z
    .object({
      formats: z.array(z.enum(['csv', 'xlsx', 'json', 'yaml', 'sql'])),
      columns: z.array(DataTransferExportColumnSchema),
      orderHint: z.string().nullable(),
    })
    .nullable(),
  importModes: z.array(z.enum(['create', 'update'])),
}) satisfies z.ZodType<DataTransferResource>;

export const DataTransferResourceListSchema = z.object({
  items: z.array(DataTransferResourceSchema),
}) satisfies z.ZodType<DataTransferResourceList>;

export const DataTransferImportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'enum', 'reference', 'json']),
  required: z.boolean(),
  multiple: z.boolean(),
  matchKey: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  unique: z.boolean(),
  nullable: z.boolean(),
  suggest: z.boolean(),
  hint: z.string().nullable(),
  options: z.array(DataTransferOptionSchema).nullable(),
  transitions: z.record(z.string(), z.array(z.string())).nullable(),
  sameFile: z.string().nullable(),
}) satisfies z.ZodType<DataTransferImportColumn>;

export const DataTransferImportColumnListSchema = z.object({
  items: z.array(DataTransferImportColumnSchema),
  readOnly: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
    }),
  ),
}) satisfies z.ZodType<DataTransferImportColumnList>;

export const DataTransferReferenceOptionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
}) satisfies z.ZodType<DataTransferReferenceOptionList>;

export const DataTransferTargetOptionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
    }),
  ),
}) satisfies z.ZodType<DataTransferTargetOptionList>;

export const DataTransferRowIssueSchema = z.object({
  column: z.string().nullable(),
  code: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  severity: z.enum(['error', 'warning']),
}) satisfies z.ZodType<DataTransferRowIssue>;

export const DataTransferImportTargetSchema = z.object({
  id: z.string(),
  label: z.string(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  current: z.record(z.string(), z.string()),
  expected: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<DataTransferImportTarget>;

export const DataTransferRowValidationSchema = z.object({
  rowNo: z.int().min(-9007199254740991).max(9007199254740991),
  issues: z.array(DataTransferRowIssueSchema),
  target: DataTransferImportTargetSchema.optional(),
  changed: z.array(z.string()).optional(),
}) satisfies z.ZodType<DataTransferRowValidation>;

export const DataTransferImportRowSchema = z.object({
  rowNo: z.int().min(1).max(9007199254740991),
  sourceRow: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  cells: z.record(z.string(), z.string().max(32767)),
  targetId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
}) satisfies z.ZodType<DataTransferImportRow>;

export const DataTransferImportAnalysisSchema = z.union([
  z.object({
    status: z.enum(['needsMapping']),
    fileName: z.string(),
    headers: z.array(
      z.object({
        index: z.int().min(-9007199254740991).max(9007199254740991),
        text: z.string(),
        suggestion: z.string().nullable(),
      }),
    ),
    samples: z.array(z.array(z.string())),
    ignored: z.array(
      z.object({
        index: z.int().min(-9007199254740991).max(9007199254740991),
        header: z.string(),
        reason: z.enum(['readOnly', 'forbidden']),
      }),
    ),
    columns: z.array(DataTransferImportColumnSchema),
    sheets: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.enum(['ok']),
    fileName: z.string(),
    columns: z.array(DataTransferImportColumnSchema),
    ignored: z.array(
      z.object({
        header: z.string(),
        reason: z.enum(['readOnly', 'forbidden', 'unmapped']),
      }),
    ),
    rows: z.array(DataTransferImportRowSchema),
    results: z.array(DataTransferRowValidationSchema),
    sheets: z.array(z.string()).optional(),
  }),
]) satisfies z.ZodType<DataTransferImportAnalysis>;

export const ValidateImportRequestSchema = z.object({
  mode: z.enum(['create', 'update']),
  rows: z
    .array(
      z.object({
        rowNo: z.int().min(1).max(9007199254740991),
        cells: z.record(z.string(), z.string().max(32767)),
        targetId: z
          .uuid()
          .regex(
            new RegExp(
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            ),
          )
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(1000),
  fileKeys: z.record(z.string(), z.array(z.string().max(500)).max(1000)).optional(),
}) satisfies z.ZodType<ValidateImportRequest>;

export const ValidateImportResultSchema = z.object({
  rows: z.array(DataTransferRowValidationSchema),
}) satisfies z.ZodType<ValidateImportResult>;

export const CreateImportRequestSchema = z.object({
  type: z.string().min(1).max(50),
  mode: z.enum(['create', 'update']),
  fileName: z.string().max(255).optional(),
  skipInvalid: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        rowNo: z.int().min(1).max(9007199254740991),
        sourceRow: z.int().min(1).max(9007199254740991).nullable().optional(),
        cells: z.record(z.string(), z.string().max(32767)),
        targetId: z
          .uuid()
          .regex(
            new RegExp(
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            ),
          )
          .nullable()
          .optional(),
        target: z
          .object({
            id: z
              .uuid()
              .regex(
                new RegExp(
                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                ),
              ),
            version: z.int().min(1).max(9007199254740991),
            expected: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(20000),
}) satisfies z.ZodType<CreateImportRequest>;

export const CreateExportRequestSchema = z.object({
  type: z.string().min(1).max(50),
  format: z.enum(['csv', 'xlsx', 'json', 'yaml', 'sql']).default('csv'),
  scope: z.union([
    z.object({
      kind: z.enum(['ids']),
      ids: z.array(z.string().min(1).max(64)).min(1).max(10000),
    }),
    z.object({
      kind: z.enum(['filter']),
      filter: z.record(z.string(), z.unknown()).default({}),
    }),
  ]),
  columns: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
}) satisfies z.ZodType<CreateExportRequest>;

export const DataTransferApplyRowSchema = z.object({
  rowNo: z.int().min(-9007199254740991).max(9007199254740991),
  sourceRow: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  cells: z.record(z.string(), z.string()),
  outcome: z.enum(['pending', 'succeeded', 'failed', 'skipped', 'cancelled']),
  error: z.record(z.string(), z.unknown()).nullable(),
  changes: z
    .record(
      z.string(),
      z
        .array(z.union([z.string(), z.string()]))
        .min(2)
        .max(2),
    )
    .nullable(),
  resultId: z.string().nullable(),
}) satisfies z.ZodType<DataTransferApplyRow>;

export const DataTransferApplyRowListSchema = z.object({
  items: z.array(DataTransferApplyRowSchema),
  nextRowNo: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
}) satisfies z.ZodType<DataTransferApplyRowList>;

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

export const ApprovalAssigneeRuleSchema = z.union([
  z.object({
    kind: z.enum(['user']),
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
  }),
  z.object({
    kind: z.enum(['group']),
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
  }),
  z.object({
    kind: z.enum(['role']),
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
  }),
  z.object({
    kind: z.enum(['manager']),
    level: z.int().min(1).max(5),
  }),
  z.object({
    kind: z.enum(['orgUnit']),
    id: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
  }),
]) satisfies z.ZodType<ApprovalAssigneeRule>;

export const ApprovalConditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.union([
    z.union([z.number(), z.string().max(200)]),
    z
      .array(z.union([z.number(), z.string().max(200)]))
      .min(1)
      .max(50),
  ]),
}) satisfies z.ZodType<ApprovalCondition>;

export const ApprovalFlowStepInputSchema = z.object({
  key: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(64),
  assignee: ApprovalAssigneeRuleSchema,
  requiredApprovals: z.union([z.int().min(1).max(20), z.enum(['all'])]),
  conditions: z.array(ApprovalConditionSchema).max(5).default([]),
}) satisfies z.ZodType<ApprovalFlowStepInput>;

export const PutApprovalFlowRequestSchema = z.object({
  enabled: z.boolean(),
  allowRepeatApprover: z.boolean().default(false),
  steps: z.array(ApprovalFlowStepInputSchema).min(1).max(10),
  version: z.int().min(1).max(9007199254740991).optional(),
}) satisfies z.ZodType<PutApprovalFlowRequest>;

export const ApprovalAssigneeStatusSchema = z.object({
  label: z.string(),
  available: z.boolean(),
  deleted: z.boolean(),
}) satisfies z.ZodType<ApprovalAssigneeStatus>;

export const ApprovalFlowStepSchema = z.object({
  key: z.string(),
  name: z.string(),
  assignee: ApprovalAssigneeRuleSchema,
  assigneeStatus: ApprovalAssigneeStatusSchema,
  requiredApprovals: z.union([
    z.int().min(-9007199254740991).max(9007199254740991),
    z.enum(['all']),
  ]),
  conditions: z.array(ApprovalConditionSchema),
}) satisfies z.ZodType<ApprovalFlowStep>;

export const ApprovalConditionFieldSchema = z.object({
  key: z.string(),
  type: z.enum(['number', 'string', 'enum']),
  options: z.array(z.string()).nullable(),
}) satisfies z.ZodType<ApprovalConditionField>;

export const ApprovalFlowSchema = z.object({
  type: z.string(),
  requester: z.enum(['user', 'anonymous']),
  fields: z.array(ApprovalConditionFieldSchema),
  flow: z
    .object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      enabled: z.boolean(),
      allowRepeatApprover: z.boolean(),
      steps: z.array(ApprovalFlowStepSchema),
      version: z.int().min(-9007199254740991).max(9007199254740991),
      updatedAt: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<ApprovalFlow>;

export const ApprovalFlowListSchema = z.object({
  items: z.array(ApprovalFlowSchema),
  assigneeKinds: z.object({
    user: z.boolean(),
    group: z.boolean(),
    role: z.boolean(),
    manager: z.boolean(),
    orgUnit: z.boolean(),
  }),
}) satisfies z.ZodType<ApprovalFlowList>;

export const PreviewApprovalFlowRequestSchema = z.object({
  steps: z.array(ApprovalFlowStepInputSchema).min(1).max(10).optional(),
  allowRepeatApprover: z.boolean().optional(),
  requesterId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
  fields: z.record(z.string(), z.union([z.number(), z.string()]).nullable()).default({}),
}) satisfies z.ZodType<PreviewApprovalFlowRequest>;

export const ApprovalCandidateSchema = z.object({
  userId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
}) satisfies z.ZodType<ApprovalCandidate>;

export const ApprovalFlowPreviewSchema = z.object({
  steps: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      skipped: z.boolean(),
      candidates: z.array(ApprovalCandidateSchema),
      required: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
      shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
    }),
  ),
}) satisfies z.ZodType<ApprovalFlowPreview>;

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'withdrawn',
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
  flowVersion: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  currentStep: z
    .object({
      ordinal: z.int().min(-9007199254740991).max(9007199254740991),
      name: z.string(),
      approvals: z.int().min(-9007199254740991).max(9007199254740991),
      required: z.int().min(-9007199254740991).max(9007199254740991),
      shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
      activatedAt: z.string().nullable(),
      pendingReviewers: z.array(z.string()),
      pendingCount: z.int().min(-9007199254740991).max(9007199254740991),
    })
    .nullable(),
  stepCount: z.int().min(-9007199254740991).max(9007199254740991),
  resubmittedFrom: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ApprovalRequest>;

export const ApprovalStepStatusSchema = z.enum([
  'waiting',
  'active',
  'approved',
  'rejected',
  'skipped',
  'cancelled',
]) satisfies z.ZodType<ApprovalStepStatus>;

export const ApprovalDecisionSchema = z.object({
  reviewerId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  reviewerName: z.string(),
  decision: z.enum(['approve', 'reject']),
  via: z.enum(['assignee', 'override', 'legacy']),
  comment: z.string().nullable(),
  decidedAt: z.string(),
}) satisfies z.ZodType<ApprovalDecision>;

export const ApprovalStepSchema = z.object({
  ordinal: z.int().min(-9007199254740991).max(9007199254740991),
  key: z.string(),
  name: z.string(),
  assignee: z.intersection(
    ApprovalAssigneeRuleSchema,
    z.object({
      label: z.string(),
    }),
  ),
  requiredMode: z.enum(['count', 'all']),
  required: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  status: ApprovalStepStatusSchema,
  shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
  closeReason: z.enum(['rejected', 'withdrawn', 'chainDisabled', 'override']).nullable(),
  conditions: z.array(ApprovalConditionSchema),
  activatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  candidates: z.array(
    z.object({
      userId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    }),
  ),
  decisions: z.array(ApprovalDecisionSchema),
}) satisfies z.ZodType<ApprovalStep>;

export const ApprovalViewerSchema = z.object({
  canDecide: z.boolean(),
  canOverride: z.boolean(),
  canReviewSingle: z.boolean(),
  canWithdraw: z.boolean(),
}) satisfies z.ZodType<ApprovalViewer>;

export const ApprovalRequestDetailSchema = z.object({
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
  flowVersion: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  currentStep: z
    .object({
      ordinal: z.int().min(-9007199254740991).max(9007199254740991),
      name: z.string(),
      approvals: z.int().min(-9007199254740991).max(9007199254740991),
      required: z.int().min(-9007199254740991).max(9007199254740991),
      shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
      activatedAt: z.string().nullable(),
      pendingReviewers: z.array(z.string()),
      pendingCount: z.int().min(-9007199254740991).max(9007199254740991),
    })
    .nullable(),
  stepCount: z.int().min(-9007199254740991).max(9007199254740991),
  resubmittedFrom: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(ApprovalStepSchema),
  viewer: ApprovalViewerSchema,
  resubmittedTo: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
}) satisfies z.ZodType<ApprovalRequestDetail>;

export const ApprovalCountsSchema = z.object({
  assigned: z.int().min(-9007199254740991).max(9007199254740991),
  pending: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
}) satisfies z.ZodType<ApprovalCounts>;

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

export const DecideApprovalStepRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
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
}) satisfies z.ZodType<DecideApprovalStepRequest>;

export const OverrideApprovalStepRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().min(1).max(500),
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
}) satisfies z.ZodType<OverrideApprovalStepRequest>;

export const IdentityProviderDomainSchema = z.object({
  domain: z
    .string()
    .max(253)
    .regex(new RegExp('^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\\.(?!-)[a-z0-9-]{1,63}(?<!-))+$')),
  ssoOnly: z.boolean(),
}) satisfies z.ZodType<IdentityProviderDomain>;

export const SamlCertificateSchema = z.object({
  pem: z.string(),
  subject: z.string(),
  notAfter: z.string(),
  fingerprint: z.string(),
}) satisfies z.ZodType<SamlCertificate>;

export const SamlSettingsSchema = z.object({
  ssoUrl: z.string(),
  certificates: z.array(SamlCertificateSchema),
  nameIdFormat: z.enum(['persistent', 'emailAddress', 'unspecified']),
  emailAttribute: z.string().nullable(),
  nameAttribute: z.string().nullable(),
  spEntityId: z.string(),
}) satisfies z.ZodType<SamlSettings>;

export const IdentityProviderSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  protocol: z.enum(['oidc', 'saml']),
  preset: z.enum(['generic', 'google', 'microsoft', 'okta', 'keycloak']),
  issuer: z.string(),
  clientId: z.string().nullable(),
  scopes: z.string(),
  enabled: z.boolean(),
  unmatchedPolicy: z.enum(['reject', 'auto_create']),
  domains: z.array(IdentityProviderDomainSchema),
  saml: SamlSettingsSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<IdentityProvider>;

export const IdentityProviderListSchema = z.object({
  items: z.array(IdentityProviderSchema),
  callbackUrl: z.url(),
  samlAcsUrl: z.url(),
}) satisfies z.ZodType<IdentityProviderList>;

export const CreateIdentityProviderRequestSchema = z.union([
  z.object({
    name: z.string().min(1).max(64),
    enabled: z.boolean().default(true),
    unmatchedPolicy: z.enum(['reject', 'auto_create']).default('reject'),
    domains: z.array(IdentityProviderDomainSchema).max(50).default([]),
    protocol: z.enum(['oidc']).default('oidc'),
    preset: z.enum(['generic', 'google', 'microsoft', 'okta', 'keycloak']).default('generic'),
    issuer: z.url().max(500),
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().min(1).max(2000),
    scopes: z.string().max(500).default('openid email profile'),
  }),
  z.object({
    name: z.string().min(1).max(64),
    enabled: z.boolean().default(true),
    unmatchedPolicy: z.enum(['reject', 'auto_create']).default('reject'),
    domains: z.array(IdentityProviderDomainSchema).max(50).default([]),
    protocol: z.enum(['saml']),
    entityId: z.string().min(1).max(500),
    ssoUrl: z.url().max(2000),
    certificates: z.array(z.string().min(1).max(10000)).min(1).max(3),
    nameIdFormat: z.enum(['persistent', 'emailAddress', 'unspecified']).default('persistent'),
    emailAttribute: z.string().max(255).nullable().default(null),
    nameAttribute: z.string().max(255).nullable().default(null),
  }),
]) satisfies z.ZodType<CreateIdentityProviderRequest>;

export const UpdateIdentityProviderRequestSchema = z.union([
  z.object({
    name: z.string().min(1).max(64).optional(),
    enabled: z.boolean().optional(),
    unmatchedPolicy: z.enum(['reject', 'auto_create']).optional(),
    domains: z.array(IdentityProviderDomainSchema).max(50).optional(),
    protocol: z.enum(['oidc']).default('oidc'),
    preset: z.enum(['generic', 'google', 'microsoft', 'okta', 'keycloak']).optional(),
    issuer: z.url().max(500).optional(),
    clientId: z.string().min(1).max(255).optional(),
    clientSecret: z.string().min(1).max(2000).optional(),
    scopes: z.string().max(500).optional(),
  }),
  z.object({
    name: z.string().min(1).max(64).optional(),
    enabled: z.boolean().optional(),
    unmatchedPolicy: z.enum(['reject', 'auto_create']).optional(),
    domains: z.array(IdentityProviderDomainSchema).max(50).optional(),
    protocol: z.enum(['saml']),
    entityId: z.string().min(1).max(500).optional(),
    ssoUrl: z.url().max(2000).optional(),
    certificates: z.array(z.string().min(1).max(10000)).min(1).max(3).optional(),
    nameIdFormat: z.enum(['persistent', 'emailAddress', 'unspecified']).optional(),
    emailAttribute: z.string().max(255).nullable().optional(),
    nameAttribute: z.string().max(255).nullable().optional(),
  }),
]) satisfies z.ZodType<UpdateIdentityProviderRequest>;

export const UserIdentitySchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  providerId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  providerName: z.string(),
  protocol: z.enum(['oidc', 'saml']),
  providerDeleted: z.boolean(),
  subject: z.string(),
  email: z.string().nullable(),
  linkedAt: z.string(),
  lastLoginAt: z.string().nullable(),
}) satisfies z.ZodType<UserIdentity>;

export const UserIdentityListSchema = z.object({
  items: z.array(UserIdentitySchema),
}) satisfies z.ZodType<UserIdentityList>;

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
  mfaEnabled: z.boolean(),
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

export const OrgUnitSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  sortOrder: z.int().min(-9007199254740991).max(9007199254740991),
  memberCount: z.int().min(-9007199254740991).max(9007199254740991),
  managerCount: z.int().min(-9007199254740991).max(9007199254740991),
  managers: z.array(
    z.object({
      userId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    }),
  ),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<OrgUnit>;

export const OrgUnitPathItemSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
}) satisfies z.ZodType<OrgUnitPathItem>;

export const OrgUnitDetailSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  sortOrder: z.int().min(-9007199254740991).max(9007199254740991),
  memberCount: z.int().min(-9007199254740991).max(9007199254740991),
  managerCount: z.int().min(-9007199254740991).max(9007199254740991),
  managers: z.array(
    z.object({
      userId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      displayName: z.string(),
    }),
  ),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
  path: z.array(OrgUnitPathItemSchema),
}) satisfies z.ZodType<OrgUnitDetail>;

export const OrgUnitTreeSchema = z.object({
  items: z.array(OrgUnitSchema),
}) satisfies z.ZodType<OrgUnitTree>;

export const CreateOrgUnitRequestSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
  code: z.string().min(1).max(32).regex(new RegExp('^[A-Za-z0-9._-]+$')).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
}) satisfies z.ZodType<CreateOrgUnitRequest>;

export const UpdateOrgUnitRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  code: z.string().min(1).max(32).regex(new RegExp('^[A-Za-z0-9._-]+$')).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateOrgUnitRequest>;

export const MoveOrgUnitRequestSchema = z.object({
  parentId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  beforeId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<MoveOrgUnitRequest>;

export const OrgUnitMemberSchema = z.object({
  userId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  displayName: z.string(),
  email: z.string(),
  status: z.enum(['pending', 'active', 'inactive', 'locked']),
  unitId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  unitName: z.string(),
  isManager: z.boolean(),
  isPrimary: z.boolean(),
  title: z.string().nullable(),
}) satisfies z.ZodType<OrgUnitMember>;

export const UpdateOrgUnitMembersRequestSchema = z.object({
  add: z
    .array(
      z.object({
        userId: z
          .uuid()
          .regex(
            new RegExp(
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            ),
          ),
        isManager: z.boolean().optional(),
        isPrimary: z.boolean().optional(),
        title: z.string().max(64).nullable().optional(),
      }),
    )
    .max(200)
    .default([]),
  update: z
    .array(
      z.object({
        userId: z
          .uuid()
          .regex(
            new RegExp(
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            ),
          ),
        isManager: z.boolean().optional(),
        isPrimary: z.boolean().optional(),
        title: z.string().max(64).nullable().optional(),
      }),
    )
    .max(200)
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
    .max(200)
    .default([]),
}) satisfies z.ZodType<UpdateOrgUnitMembersRequest>;

export const UserOrgUnitSchema = z.object({
  unitId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  path: z.array(OrgUnitPathItemSchema),
  isManager: z.boolean(),
  isPrimary: z.boolean(),
  title: z.string().nullable(),
}) satisfies z.ZodType<UserOrgUnit>;

export const UserOrgUnitsSchema = z.object({
  items: z.array(UserOrgUnitSchema),
}) satisfies z.ZodType<UserOrgUnits>;

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
  avatarImageId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
  avatarCrop: ImageCropSchema.optional(),
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
  avatar: ImageSourcesSchema.nullable(),
  avatarImageId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  status: UserStatusSchema,
  roles: z.array(RoleSummarySchema),
  tags: z.array(TagSummarySchema),
  locale: z.string(),
  timezone: z.string(),
  lastLoginAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  mfaEnabled: z.boolean(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<User>;

export const UserRolesSchema = z.object({
  roles: z.array(RoleSummarySchema),
}) satisfies z.ZodType<UserRoles>;

export const SsoRedirectSchema = z.object({
  redirectTo: z.url(),
}) satisfies z.ZodType<SsoRedirect>;

export const MfaMethodInfoSchema = z.object({
  id: z.string(),
  challenge: z.enum(['none', 'server']),
  enrollChallenge: z.enum(['immediate', 'onRequest']),
  enrollAt: z.enum(['anywhere', 'idp']),
  assurance: z.enum(['phishingResistant', 'possession', 'messaging', 'inbox']),
  maxFactorsPerAccount: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<MfaMethodInfo>;

export const MfaFactorSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  method: z.string(),
  label: z.string().nullable(),
  hint: z.string().nullable(),
  available: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
}) satisfies z.ZodType<MfaFactor>;

export const MfaOverviewSchema = z.object({
  factors: z.array(MfaFactorSchema),
  recoveryCodesRemaining: z.int().min(-9007199254740991).max(9007199254740991),
  methods: z.array(
    z.object({
      id: z.string(),
      challenge: z.enum(['none', 'server']),
      enrollChallenge: z.enum(['immediate', 'onRequest']),
      enrollAt: z.enum(['anywhere', 'idp']),
      assurance: z.enum(['phishingResistant', 'possession', 'messaging', 'inbox']),
      maxFactorsPerAccount: z.int().min(-9007199254740991).max(9007199254740991),
      enrolled: z.int().min(-9007199254740991).max(9007199254740991),
    }),
  ),
  required: z.boolean(),
}) satisfies z.ZodType<MfaOverview>;

export const StartMfaEnrollmentRequestSchema = z.object({
  method: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<StartMfaEnrollmentRequest>;

export const MfaChallengeInfoSchema = z.object({
  challengeId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  hint: z.string().nullable(),
  expiresAt: z.string(),
  resendAvailableAt: z.string(),
  publicData: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<MfaChallengeInfo>;

export const MfaEnrollmentSchema = z.object({
  factorId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  method: z.string(),
  publicData: z.record(z.string(), z.unknown()),
  challenge: MfaChallengeInfoSchema.nullable(),
}) satisfies z.ZodType<MfaEnrollment>;

export const ConfirmMfaEnrollmentRequestSchema = z.object({
  challengeId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .optional(),
  payload: z.record(z.string(), z.unknown()),
  label: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<ConfirmMfaEnrollmentRequest>;

export const MfaEnrollmentResultSchema = z.object({
  factor: MfaFactorSchema,
  recoveryCodes: z.array(z.string()).nullable(),
}) satisfies z.ZodType<MfaEnrollmentResult>;

export const MfaPasswordConfirmRequestSchema = z.object({
  password: z.string().min(1).max(128),
}) satisfies z.ZodType<MfaPasswordConfirmRequest>;

export const MfaRecoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()),
}) satisfies z.ZodType<MfaRecoveryCodes>;

export const MfaAccountStatusSchema = z.object({
  enabled: z.boolean(),
  factors: z.array(MfaFactorSchema),
  recoveryCodesRemaining: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<MfaAccountStatus>;

export const MfaLoginChallengeRequestSchema = z.object({
  factorId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
}) satisfies z.ZodType<MfaLoginChallengeRequest>;

export const MfaLoginVerifyRequestSchema = z.object({
  factorId: z.union([
    z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      ),
    z.enum(['recovery']),
  ]),
  challengeId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .optional(),
  payload: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<MfaLoginVerifyRequest>;

export const MfaInteractionEnrollmentResultSchema = z.object({
  recoveryCodes: z.array(z.string()),
  redirectTo: z.url(),
}) satisfies z.ZodType<MfaInteractionEnrollmentResult>;

export const SsoMfaChallengeNextSchema = z.object({
  next: z.enum(['mfa']),
  factors: z.array(MfaFactorSchema),
  recoveryAvailable: z.boolean(),
}) satisfies z.ZodType<SsoMfaChallengeNext>;

export const SsoMfaEnrollNextSchema = z.object({
  next: z.enum(['mfaEnroll']),
  methods: z.array(MfaMethodInfoSchema),
  optional: z.boolean(),
}) satisfies z.ZodType<SsoMfaEnrollNext>;

export const MfaLoginVerifyResultSchema = z.union([
  SsoRedirectSchema,
  SsoMfaEnrollNextSchema,
]) satisfies z.ZodType<MfaLoginVerifyResult>;

export const SsoLoginResultSchema = z.union([
  SsoRedirectSchema,
  SsoMfaChallengeNextSchema,
  SsoMfaEnrollNextSchema,
]) satisfies z.ZodType<SsoLoginResult>;

export const MfaPolicySchema = z.object({
  requireAll: z.boolean(),
  requiredRoleIds: z
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
  allowedMethods: z.array(z.string().min(1).max(64)).max(20).nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  updatedAt: z.string().nullable(),
  methods: z.array(
    z.object({
      id: z.string(),
      challenge: z.enum(['none', 'server']),
      enrollChallenge: z.enum(['immediate', 'onRequest']),
      enrollAt: z.enum(['anywhere', 'idp']),
      assurance: z.enum(['phishingResistant', 'possession', 'messaging', 'inbox']),
      maxFactorsPerAccount: z.int().min(-9007199254740991).max(9007199254740991),
      platformEnabled: z.boolean(),
    }),
  ),
  nonCompliant: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<MfaPolicy>;

export const UpdateMfaPolicyRequestSchema = z.object({
  requireAll: z.boolean(),
  requiredRoleIds: z
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
  allowedMethods: z.array(z.string().min(1).max(64)).max(20).nullable(),
  version: z.int().min(1).max(9007199254740991),
}) satisfies z.ZodType<UpdateMfaPolicyRequest>;

export const MfaPolicyImpactSchema = z.object({
  nonCompliant: z.int().min(-9007199254740991).max(9007199254740991),
  stranded: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<MfaPolicyImpact>;

export const MfaSettingFieldSchema = z.object({
  key: z.string(),
  type: z.enum(['text', 'url', 'secret', 'select']),
  required: z.boolean(),
  requiredWhen: z
    .object({
      key: z.string(),
      equals: z.string(),
    })
    .optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  maxLength: z.int().min(-9007199254740991).max(9007199254740991).optional(),
}) satisfies z.ZodType<MfaSettingField>;

export const PlatformMfaMethodSchema = z.object({
  id: z.string(),
  challenge: z.enum(['none', 'server']),
  enrollChallenge: z.enum(['immediate', 'onRequest']),
  enrollAt: z.enum(['anywhere', 'idp']),
  assurance: z.enum(['phishingResistant', 'possession', 'messaging', 'inbox']),
  maxFactorsPerAccount: z.int().min(-9007199254740991).max(9007199254740991),
  settings: z
    .object({
      fields: z.array(MfaSettingFieldSchema),
      configured: z.boolean(),
    })
    .nullable(),
  realms: z.array(z.enum(['tenant', 'platform'])),
  defaultEnabled: z.boolean(),
  globalState: z.enum(['default', 'on', 'off']),
  effective: z.boolean(),
  tenantOverrides: z.object({
    on: z.int().min(-9007199254740991).max(9007199254740991),
    off: z.int().min(-9007199254740991).max(9007199254740991),
  }),
  stats: z
    .object({
      tenantFactors: z.int().min(-9007199254740991).max(9007199254740991),
      tenants: z.int().min(-9007199254740991).max(9007199254740991),
      platformFactors: z.int().min(-9007199254740991).max(9007199254740991),
      computedAt: z.string(),
    })
    .nullable(),
  platformAdminEnabled: z.boolean(),
}) satisfies z.ZodType<PlatformMfaMethod>;

export const PlatformMfaMethodListSchema = z.object({
  items: z.array(PlatformMfaMethodSchema),
}) satisfies z.ZodType<PlatformMfaMethodList>;

export const UpdatePlatformMfaMethodRequestSchema = z.object({
  state: z.enum(['default', 'on', 'off']),
}) satisfies z.ZodType<UpdatePlatformMfaMethodRequest>;

export const MfaMethodSettingsSchema = z.object({
  method: z.string(),
  values: z.record(z.string(), z.string()),
  secrets: z.record(z.string(), z.boolean()),
  configured: z.boolean(),
  version: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  updatedAt: z.string().nullable(),
}) satisfies z.ZodType<MfaMethodSettings>;

export const UpdateMfaMethodSettingsRequestSchema = z.object({
  values: z.record(z.string(), z.string().max(2000)),
  secrets: z.record(z.string(), z.string().max(4000)),
  version: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
}) satisfies z.ZodType<UpdateMfaMethodSettingsRequest>;

export const MfaMethodImpactSchema = z.object({
  stranded: z.int().min(-9007199254740991).max(9007199254740991),
  tenants: z.int().min(-9007199254740991).max(9007199254740991),
  skippedTenants: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<MfaMethodImpact>;

export const TenantUsageSummarySchema = z.object({
  usersActive: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  usersTotal: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  serviceAccounts: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  storageUsedBytes: z.number().nullable(),
  storageQuotaBytes: z.number().nullable(),
  storageUsageRatio: z.number().nullable(),
  recentRequests: z.int().min(-9007199254740991).max(9007199254740991),
  lastActivityAt: z.string().nullable(),
  snapshotAt: z.string().nullable(),
}) satisfies z.ZodType<TenantUsageSummary>;

export const TenantUsageDaySchema = z.object({
  date: z.string(),
  usersActive: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  usersTotal: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  serviceAccounts: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  storageUsedBytes: z.number().nullable(),
  storageQuotaBytes: z.number().nullable(),
  requestsInternal: z.int().min(-9007199254740991).max(9007199254740991),
  requestsExternal: z.int().min(-9007199254740991).max(9007199254740991),
  jobsExecuted: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<TenantUsageDay>;

export const TenantUsageSchema = z.object({
  summary: TenantUsageSummarySchema,
  warningRatio: z.number(),
  recentDays: z.int().min(-9007199254740991).max(9007199254740991),
  daily: z.array(TenantUsageDaySchema),
}) satisfies z.ZodType<TenantUsage>;

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
  'externalApi',
  'group',
  'dataTransfer',
  'organization',
  'approvalChain',
  'gallery',
]) satisfies z.ZodType<TenantFeature>;

export const TenantFlagOverridesSchema = z.record(
  z.string(),
  z.boolean(),
) satisfies z.ZodType<TenantFlagOverrides>;

export const TenantMfaMethodOverridesSchema = z.record(
  z.string(),
  z.boolean(),
) satisfies z.ZodType<TenantMfaMethodOverrides>;

export const TenantFeatureParamKeySchema = z.enum([
  'file.storageQuotaMb',
  'auditLog.hotRetentionDays',
  'auditLog.retentionDays',
  'job.maxConcurrency',
  'identityProvider.maxProviders',
  'webhook.maxUrls',
  'dataTransfer.importMaxRows',
  'dataTransfer.importMaxSizeMb',
  'dataTransfer.exportMaxRows',
  'gallery.maxItemSizeMb',
  'rateLimit.authPerMinute',
  'rateLimit.trustedCidrs',
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
  foreverValue: z.number().nullable(),
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
  mfaMethods: TenantMfaMethodOverridesSchema,
  featureParams: z.array(TenantFeatureParamSchema),
  adminEmail: z.string().nullable(),
  provisionError: z.string().nullable(),
  provisionedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<PlatformTenant>;

export const PlatformTenantListItemSchema = z.object({
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
  mfaMethods: TenantMfaMethodOverridesSchema,
  featureParams: z.array(TenantFeatureParamSchema),
  adminEmail: z.string().nullable(),
  provisionError: z.string().nullable(),
  provisionedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  usage: TenantUsageSummarySchema,
}) satisfies z.ZodType<PlatformTenantListItem>;

export const PlatformTenantListSchema = z.object({
  items: z.array(PlatformTenantListItemSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
  }),
  baseDomain: z.string(),
  usageRecentDays: z.int().min(-9007199254740991).max(9007199254740991),
  usageWarningRatio: z.number(),
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
  features: z.array(TenantFeatureSchema).max(15).optional(),
  flags: TenantFlagOverridesSchema.optional(),
  mfaMethods: TenantMfaMethodOverridesSchema.optional(),
  featureParams: z
    .record(z.string(), z.union([z.number(), z.string().max(1000)]).nullable())
    .optional(),
}) satisfies z.ZodType<UpdateTenantRequest>;

export const TenantFeatureImpactSchema = z.object({
  feature: TenantFeatureSchema,
  available: z.boolean(),
  items: z.array(
    z.object({
      key: z.enum([
        'identityProviderConnections',
        'ssoOnlyDomains',
        'passwordlessExternalUsers',
        'groups',
        'groupMembers',
        'groupRoleGrants',
        'orgUnits',
        'orgUnitMembers',
        'approvalFlowsUsingOrg',
        'approvalFlows',
        'approvalRequestsInChain',
        'galleryItems',
        'galleryAlbums',
      ]),
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
    avatar: ImageSourcesSchema.nullable(),
    avatarImageId: z
      .uuid()
      .regex(
        new RegExp(
          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        ),
      )
      .nullable(),
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
  'platformAdmin:resetMfa',
  'platformAuditLog:read',
  'platformJob:read',
  'platformJob:retry',
  'featureFlag:read',
  'featureFlag:update',
  'mfaMethod:read',
  'mfaMethod:update',
  'cdn:read',
  'cdn:update',
  'cdn:purge',
  'cdn:purgeAll',
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
  avatarImageId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
  avatarCrop: ImageCropSchema.optional(),
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
  mfaEnroll: z.string().nullable(),
  passkeyLogin: z.boolean(),
}) satisfies z.ZodType<SsoInteraction>;

export const SsoPasskeyOptionsSchema = z.object({
  publicData: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<SsoPasskeyOptions>;

export const SsoPasskeyLoginRequestSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<SsoPasskeyLoginRequest>;

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
      nameI18nKey: z.string(),
      resource: z.string(),
      resourceNameI18nKey: z.string(),
      includes: z.array(z.string()),
      requires: z.array(z.string()),
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
  resubmittedFrom: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .optional(),
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
  prevCursor: z.string().nullable(),
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

export const GalleryAlbumSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  name: z.string(),
  description: z.string().nullable(),
  itemCount: z.int().min(-9007199254740991).max(9007199254740991),
  coverItemId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  cover: ImageSourcesSchema.nullable(),
  coverColor: z.string().nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<GalleryAlbum>;

export const GalleryAlbumListSchema = z.object({
  items: z.array(GalleryAlbumSchema),
}) satisfies z.ZodType<GalleryAlbumList>;

export const CreateGalleryAlbumRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).nullable().optional(),
}) satisfies z.ZodType<CreateGalleryAlbumRequest>;

export const UpdateGalleryAlbumRequestSchema = z.object({
  version: z.int().max(9007199254740991).gt(0),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  coverItemId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable()
    .optional(),
}) satisfies z.ZodType<UpdateGalleryAlbumRequest>;

export const GalleryAlbumItemsRequestSchema = z.object({
  itemIds: z
    .array(
      z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    )
    .min(1)
    .max(500),
}) satisfies z.ZodType<GalleryAlbumItemsRequest>;

export const GalleryAlbumItemsResultSchema = z.object({
  changed: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<GalleryAlbumItemsResult>;

export const GalleryItemSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  title: z.string(),
  description: z.string().nullable(),
  contentType: z.string(),
  size: z.int().min(-9007199254740991).max(9007199254740991),
  width: z.int().min(-9007199254740991).max(9007199254740991),
  height: z.int().min(-9007199254740991).max(9007199254740991),
  displayRotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  dominantColor: z.string().nullable(),
  placeholder: z.string().nullable(),
  takenAt: z.string().nullable(),
  sortAt: z.string(),
  createdAt: z.string(),
  image: ImageSourcesSchema,
  tags: z.array(TagSummarySchema),
  version: z.int().min(-9007199254740991).max(9007199254740991),
}) satisfies z.ZodType<GalleryItem>;

export const GalleryItemListSchema = z.object({
  items: z.array(GalleryItemSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<GalleryItemList>;

export const GalleryExifSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  lensMake: z.string().optional(),
  lensModel: z.string().optional(),
  focalLength: z.number().optional(),
  focalLength35mm: z.number().optional(),
  fNumber: z.number().optional(),
  exposureTime: z.number().optional(),
  iso: z.number().optional(),
  flashFired: z.boolean().optional(),
}) satisfies z.ZodType<GalleryExif>;

export const GalleryItemDetailSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  title: z.string(),
  description: z.string().nullable(),
  contentType: z.string(),
  size: z.int().min(-9007199254740991).max(9007199254740991),
  width: z.int().min(-9007199254740991).max(9007199254740991),
  height: z.int().min(-9007199254740991).max(9007199254740991),
  displayRotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  dominantColor: z.string().nullable(),
  placeholder: z.string().nullable(),
  takenAt: z.string().nullable(),
  sortAt: z.string(),
  createdAt: z.string(),
  image: ImageSourcesSchema,
  tags: z.array(TagSummarySchema),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  exif: GalleryExifSchema.nullable(),
  locationStripped: z.boolean(),
  source: z.string(),
  sourceName: z.string().nullable(),
  uploader: z
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
  albums: z.array(
    z.object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      name: z.string(),
    }),
  ),
  duplicates: z.array(
    z.object({
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      title: z.string(),
    }),
  ),
  original: z
    .object({
      url: z.string(),
      width: z.int().min(-9007199254740991).max(9007199254740991),
      height: z.int().min(-9007199254740991).max(9007199254740991),
      expiresAt: z.string(),
    })
    .nullable(),
  download: z.object({
    original: z.string(),
    large: z.string(),
  }),
}) satisfies z.ZodType<GalleryItemDetail>;

export const GalleryNeighborsSchema = z.object({
  previousId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
  nextId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .nullable(),
}) satisfies z.ZodType<GalleryNeighbors>;

export const GalleryTimelineSchema = z.object({
  timeZone: z.string(),
  months: z.array(
    z.object({
      month: z.string(),
      count: z.int().min(-9007199254740991).max(9007199254740991),
    }),
  ),
}) satisfies z.ZodType<GalleryTimeline>;

export const CreateGalleryUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  title: z.string().min(1).max(255).optional(),
  contentType: z.string().min(1).max(100),
  size: z.int().max(9007199254740991).gt(0),
  width: z.int().max(100000).gt(0).optional(),
  height: z.int().max(100000).gt(0).optional(),
  albumId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .optional(),
}) satisfies z.ZodType<CreateGalleryUploadRequest>;

export const GalleryUploadTargetSchema = z.object({
  url: z.string(),
  method: z.enum(['PUT']),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
}) satisfies z.ZodType<GalleryUploadTarget>;

export const GalleryUploadItemSchema = z.object({
  id: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    ),
  title: z.string(),
  status: z.enum(['pending', 'processing', 'ready', 'failed']),
  failureReason: z.enum(['notImage', 'typeNotAllowed', 'tooLarge', 'missing']).nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<GalleryUploadItem>;

export const GalleryUploadSchema = z.object({
  item: GalleryUploadItemSchema,
  upload: GalleryUploadTargetSchema,
}) satisfies z.ZodType<GalleryUpload>;

export const GalleryUploadStatusSchema = z.object({
  processing: z.int().min(-9007199254740991).max(9007199254740991),
  failed: z.array(GalleryUploadItemSchema),
}) satisfies z.ZodType<GalleryUploadStatus>;

export const CreateGalleryFromSourceRequestSchema = z.object({
  source: z.string().max(50).regex(new RegExp('^[a-z][A-Za-z0-9]*$')),
  refIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  albumId: z
    .uuid()
    .regex(
      new RegExp(
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
      ),
    )
    .optional(),
}) satisfies z.ZodType<CreateGalleryFromSourceRequest>;

export const GalleryFromSourceResultSchema = z.object({
  results: z.array(
    z.object({
      refId: z.string(),
      status: z.enum(['added', 'skipped']),
      itemId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        )
        .nullable(),
      reason: z.enum(['typeNotAllowed', 'tooLarge', 'alreadyAdded', 'notFound']).nullable(),
      existingItemId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        )
        .nullable(),
      name: z.string().nullable(),
    }),
  ),
}) satisfies z.ZodType<GalleryFromSourceResult>;

export const UpdateGalleryItemRequestSchema = z.object({
  version: z.int().max(9007199254740991).gt(0),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  displayRotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .optional(),
}) satisfies z.ZodType<UpdateGalleryItemRequest>;

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

export const TenantJobNameSchema = z.enum([
  'announcement.dispatch',
  'announcement.eventDispatch',
  'announcement.fanOut',
  'announcement.maintenance',
  'approval.resultMail',
  'auditLog.archive',
  'auth.activationMail',
  'auth.passwordResetMail',
  'auth.tokenCleanup',
  'dataTransfer.applyImport',
  'dataTransfer.cleanup',
  'dataTransfer.export',
  'file.imageVariants',
  'file.maintenance',
  'gallery.maintenance',
  'gallery.process',
  'image.maintenance',
  'image.process',
  'mfa.cleanup',
  'mfa.emailCodeMail',
  'mfa.lineCode',
  'mfa.securityNoticeMail',
  'mfa.smsCode',
  'mfa.telegramCode',
  'notification.cleanup',
  'revision.prune',
  'trash.purge',
  'watch.notify',
  'webhook.cleanup',
  'webhook.deliver',
]) satisfies z.ZodType<TenantJobName>;

export const JobNameSchema = z.enum([
  'announcement.dispatch',
  'announcement.eventDispatch',
  'announcement.fanOut',
  'announcement.maintenance',
  'approval.resultMail',
  'auditLog.archive',
  'auth.activationMail',
  'auth.passwordResetMail',
  'auth.platformTokenCleanup',
  'auth.tokenCleanup',
  'cdn.healthCheck',
  'cdn.purge',
  'dataTransfer.applyImport',
  'dataTransfer.cleanup',
  'dataTransfer.export',
  'file.imageVariants',
  'file.maintenance',
  'gallery.maintenance',
  'gallery.process',
  'image.maintenance',
  'image.process',
  'jobs.outboxSweep',
  'mfa.channelLinkCleanup',
  'mfa.cleanup',
  'mfa.emailCodeMail',
  'mfa.factorStats',
  'mfa.lineCode',
  'mfa.platformCleanup',
  'mfa.platformEmailCodeMail',
  'mfa.platformLineCode',
  'mfa.platformSecurityNoticeMail',
  'mfa.platformSmsCode',
  'mfa.platformTelegramCode',
  'mfa.securityNoticeMail',
  'mfa.smsCode',
  'mfa.telegramCode',
  'notification.cleanup',
  'oidc.cleanup',
  'platformAdmin.accountMail',
  'platformNotification.cleanup',
  'rateLimit.cleanup',
  'revision.prune',
  'storage.totalRollup',
  'tenant.provision',
  'tenant.provisionSweep',
  'tenant.usageRollup',
  'trash.purge',
  'watch.notify',
  'webhook.cleanup',
  'webhook.deliver',
]) satisfies z.ZodType<JobName>;

export const JobQueueSchema = z.object({
  name: TenantJobNameSchema,
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
  name: TenantJobNameSchema,
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
  name: TenantJobNameSchema,
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
  name: JobNameSchema,
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
  name: JobNameSchema,
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
  name: JobNameSchema,
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

export const CdnResourceSchema = z.enum([
  'fileVariant',
  'imageAsset',
  'galleryItem',
]) satisfies z.ZodType<CdnResource>;

export const CdnStateSchema = z.enum(['on', 'off']) satisfies z.ZodType<CdnState>;

export const CdnCheckNodeSchema = z.object({
  address: z.string(),
  problems: z.array(
    z.enum([
      'unreachable',
      'timeout',
      'purgeSecretRejected',
      'badResponse',
      'signingKidMissing',
      'verifyKidMissing',
    ]),
  ),
  kids: z.array(z.string()).nullable(),
  missingKids: z.array(z.string()),
  cache: z
    .object({
      maxSize: z.string(),
      inactive: z.string(),
      valid: z.string(),
    })
    .nullable(),
  build: z.string().nullable(),
  startedAt: z.string().nullable(),
  detail: z.string().optional(),
}) satisfies z.ZodType<CdnCheckNode>;

export const CdnCheckResultSchema = z.object({
  checkedAt: z.string(),
  ready: z.boolean(),
  discovery: z.object({
    ok: z.boolean(),
    problem: z.enum(['purgeNotConfigured', 'resolveFailed']).optional(),
    detail: z.string().optional(),
  }),
  nodes: z.array(CdnCheckNodeSchema),
  publicUrl: z.object({
    result: z.enum([
      'ok',
      'signatureRejected',
      'originAuthRejected',
      'originUnreachable',
      'unreachable',
      'unexpected',
    ]),
    status: z.int().min(-9007199254740991).max(9007199254740991).optional(),
    detail: z.string().optional(),
  }),
  signatureEnforced: z.object({
    result: z.enum(['ok', 'notEnforced', 'unreachable', 'unexpected']),
    status: z.int().min(-9007199254740991).max(9007199254740991).optional(),
    detail: z.string().optional(),
  }),
}) satisfies z.ZodType<CdnCheckResult>;

export const CdnDeploymentSchema = z.object({
  deployed: z.boolean(),
  provider: z.string().nullable(),
  origin: z.string().nullable(),
  signingKid: z.string().nullable(),
  kids: z.array(z.string()),
  resources: z.array(CdnResourceSchema),
  minUrlTtl: z.int().min(-9007199254740991).max(9007199254740991),
  maxUrlTtl: z.int().min(-9007199254740991).max(9007199254740991),
  purgeConfigured: z.boolean(),
  purgeOnDelete: z.boolean(),
  purgeBatchSize: z.int().min(-9007199254740991).max(9007199254740991),
  healthCheckCron: z.string().nullable(),
}) satisfies z.ZodType<CdnDeployment>;

export const CdnStoredSettingsSchema = z.object({
  state: CdnStateSchema.nullable(),
  resources: z.array(z.string()).nullable(),
  urlTtlCap: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  purgeOnDelete: z.boolean().nullable(),
  purgeBatchSize: z.int().min(-9007199254740991).max(9007199254740991).nullable(),
  stateChangedAt: z.string().nullable(),
  stateChangedBy: z
    .object({
      id: z.string(),
      email: z.string().nullable(),
    })
    .nullable(),
  version: z.int().min(-9007199254740991).max(9007199254740991),
  updatedAt: z.string().nullable(),
}) satisfies z.ZodType<CdnStoredSettings>;

export const CdnEffectiveSchema = z.object({
  serving: z.boolean(),
  resources: z.array(CdnResourceSchema),
  urlTtlCap: z.int().min(-9007199254740991).max(9007199254740991),
  purgeOnDelete: z.boolean(),
  purgeBatchSize: z.int().min(-9007199254740991).max(9007199254740991),
  clamped: z.object({
    resources: z.array(CdnResourceSchema),
    urlTtlCap: z.boolean(),
  }),
  issuedUrlsExpireAt: z.string().nullable(),
}) satisfies z.ZodType<CdnEffective>;

export const CdnPurgeJobSummarySchema = z.object({
  id: z.string(),
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  createdOn: z.string(),
  completedOn: z.string().nullable(),
  paths: z.union([z.int().min(-9007199254740991).max(9007199254740991), z.enum(['all'])]),
  manual: z
    .object({
      requestedBy: z.string(),
      tenantId: z.string().nullable(),
      target: z.string(),
      id: z.string().optional(),
    })
    .nullable(),
}) satisfies z.ZodType<CdnPurgeJobSummary>;

export const CdnOverviewSchema = z.object({
  deployment: CdnDeploymentSchema,
  settings: CdnStoredSettingsSchema.nullable(),
  effective: CdnEffectiveSchema.nullable(),
  lastCheck: CdnCheckResultSchema.nullable(),
  recentPurges: z.array(CdnPurgeJobSummarySchema),
  purgeTargets: z.array(CdnResourceSchema),
}) satisfies z.ZodType<CdnOverview>;

export const UpdateCdnSettingsRequestSchema = z.object({
  version: z.int().min(1).max(9007199254740991),
  state: CdnStateSchema.nullable().optional(),
  resources: z.array(CdnResourceSchema).max(3).nullable().optional(),
  urlTtlCap: z.int().min(-9007199254740991).max(9007199254740991).nullable().optional(),
  purgeOnDelete: z.boolean().nullable().optional(),
  purgeBatchSize: z.int().min(1).max(1000).nullable().optional(),
}) satisfies z.ZodType<UpdateCdnSettingsRequest>;

export const CdnPurgeRequestSchema = z.object({
  target: z.union([
    z.object({
      type: z.enum(['paths']),
      tenantId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      paths: z.array(z.string().min(1).max(1024)).min(1).max(1000),
    }),
    z.object({
      type: CdnResourceSchema,
      tenantId: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
      id: z
        .uuid()
        .regex(
          new RegExp(
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          ),
        ),
    }),
    z.object({
      type: z.enum(['all']),
    }),
  ]),
}) satisfies z.ZodType<CdnPurgeRequest>;

export const CdnPurgeResultSchema = z.object({
  jobIds: z.array(z.string()),
  paths: z.union([z.int().min(-9007199254740991).max(9007199254740991), z.enum(['all'])]),
}) satisfies z.ZodType<CdnPurgeResult>;

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
  category: z.enum([
    'general',
    'auth',
    'file',
    'trash',
    'revision',
    'notification',
    'dataTransfer',
    'gallery',
  ]),
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

export const StorageTotalSchema = z.object({
  usedBytes: z.number(),
  limitBytes: z.number().nullable(),
  usageRatio: z.number().nullable(),
  warningRatio: z.number(),
  measuredAt: z.string().nullable(),
  isStale: z.boolean(),
}) satisfies z.ZodType<StorageTotal>;

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
