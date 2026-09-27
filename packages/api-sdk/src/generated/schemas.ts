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
  CreateFileUploadRequest,
  CreateRoleRequest,
  CreateUserRequest,
  DuplicateRoleRequest,
  FileUpload,
  FileUploadTarget,
  FileUploader,
  ForgotPasswordRequest,
  LoginRequest,
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
  Role,
  RoleHolder,
  RolePermissions,
  RoleSummary,
  Session,
  SetupRequest,
  StoredFile,
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

export const ApprovalTypeSchema = z.enum(['user.register']) satisfies z.ZodType<ApprovalType>;

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

export const CreateFileUploadRequestSchema = z.object({
  name: z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')),
  contentType: z
    .string()
    .max(255)
    .regex(new RegExp('^[a-z0-9][a-z0-9!#$&^_.+-]*\\/[a-z0-9][a-z0-9!#$&^_.+-]*$')),
  size: z.int().min(0).max(9007199254740991),
}) satisfies z.ZodType<CreateFileUploadRequest>;

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
  url: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  urlExpiresAt: z.string().nullable(),
  uploader: FileUploaderSchema.nullable(),
  uploadedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<StoredFile>;

export const FileUploadTargetSchema = z.object({
  url: z.string(),
  method: z.enum(['PUT']),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
}) satisfies z.ZodType<FileUploadTarget>;

export const FileUploadSchema = z.object({
  file: StoredFileSchema,
  upload: FileUploadTargetSchema,
}) satisfies z.ZodType<FileUpload>;

export const UpdateFileRequestSchema = z.object({
  name: z.string().min(1).max(255).regex(new RegExp('^[^/\\\\\\u0000-\\u001f\\u007f]+$')),
}) satisfies z.ZodType<UpdateFileRequest>;

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
