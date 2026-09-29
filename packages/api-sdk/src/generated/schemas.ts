// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  ApproveApprovalRequest,
  AuditLog,
  AuditLogSummary,
  ChangePasswordRequest,
  CompleteFileUploadRequest,
  CreateFileAccessRequest,
  CreateFileFolderRequest,
  CreateFileUploadPartsRequest,
  CreateFileUploadRequest,
  CreateRoleRequest,
  CreateUserRequest,
  DuplicateRoleRequest,
  EnsureFileFolderPathsRequest,
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
  Job,
  JobQueue,
  JobQueueList,
  JobSummary,
  LoginRequest,
  MoveFileItemsRequest,
  MoveFileItemsResult,
  Permission,
  PermissionCatalog,
  PermissionGroup,
  PermissionKey,
  Profile,
  RegisterRequest,
  RegisterResult,
  RejectApprovalRequest,
  ReplaceUserRolesRequest,
  ResetPasswordRequest,
  ReviewFileAccessRequest,
  Role,
  RoleHolder,
  RolePermissions,
  RoleSummary,
  Session,
  SetFileFolderGrantRequest,
  SetupRequest,
  StoredFile,
  StoredFileCapabilities,
  StoredFileImage,
  UpdateFileFolderAccessRequest,
  UpdateFileFolderRequest,
  UpdateFileRequest,
  UpdateProfileRequest,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
  UpdateUserRequest,
  User,
  UserRoles,
  UserStatus,
} from './models';

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
  status: z.enum(['pending', 'active', 'inactive']).optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(64).optional(),
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
  locale: z.string(),
  timezone: z.string(),
  lastLoginAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<User>;

export const UserRolesSchema = z.object({
  roles: z.array(RoleSummarySchema),
}) satisfies z.ZodType<UserRoles>;

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
  'job:read',
  'job:retry',
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
}) satisfies z.ZodType<Permission>;

export const PermissionGroupSchema = z.object({
  resource: z.string(),
  nameI18nKey: z.string(),
  keys: z.array(PermissionKeySchema),
}) satisfies z.ZodType<PermissionGroup>;

export const PermissionCatalogSchema = z.object({
  items: z.array(PermissionSchema),
  groups: z.array(PermissionGroupSchema),
}) satisfies z.ZodType<PermissionCatalog>;

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
}) satisfies z.ZodType<Profile>;

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  preferences: z
    .object({
      locale: z.string().max(10).optional(),
      timezone: z.string().max(64).optional(),
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
  password: z.string().min(12).max(128),
  reason: z.string().max(500).optional(),
}) satisfies z.ZodType<RegisterRequest>;

export const RegisterResultSchema = z.object({
  submitted: z.literal(true),
}) satisfies z.ZodType<RegisterResult>;

export const SetFileFolderGrantRequestSchema = z.object({
  subjectType: z.enum(['role', 'user', 'everyone']),
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
  subjectType: z.enum(['role', 'user', 'everyone']),
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
      subjectType: z.enum(['role', 'user', 'everyone']),
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

export const CreateFileUploadRequestSchema = z.object({
  name: z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')),
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
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<FileFolder>;

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
  name: z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')),
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
  name: z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')),
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
        .array(z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')))
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
  uploadedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<StoredFile>;

export const FileListPageSchema = z.object({
  items: z.array(StoredFileSchema),
  pagination: z.object({
    offset: z.int().min(-9007199254740991).max(9007199254740991),
    limit: z.int().min(-9007199254740991).max(9007199254740991),
    total: z.int().min(-9007199254740991).max(9007199254740991),
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
}) satisfies z.ZodType<FileUploadPolicy>;

export const GetFileImageQuerySchema = z.object({
  exp: z.int().max(9007199254740991).gt(0),
  sig: z.string().min(1).max(100),
  format: z.enum(['jpeg', 'webp', 'avif', 'png', 'auto']).optional(),
}) satisfies z.ZodType<GetFileImageQuery>;

export const UpdateFileRequestSchema = z.object({
  name: z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')),
  version: z.int().min(1).max(9007199254740991).optional(),
}) satisfies z.ZodType<UpdateFileRequest>;

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

export const CreateRoleRequestSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  permissionKeys: z.array(PermissionKeySchema).max(100).default([]),
}) satisfies z.ZodType<CreateRoleRequest>;

export const DuplicateRoleRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<DuplicateRoleRequest>;

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
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Role>;

export const RolePermissionsSchema = z.object({
  permissions: z.array(PermissionSchema),
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
}) satisfies z.ZodType<UpdateRoleRequest>;

export const UpdateRolePermissionsRequestSchema = z.object({
  add: z.array(PermissionKeySchema).max(100).default([]),
  remove: z.array(PermissionKeySchema).max(100).default([]),
}) satisfies z.ZodType<UpdateRolePermissionsRequest>;
