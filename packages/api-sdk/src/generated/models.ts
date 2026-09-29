// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

export const ApprovalStatus = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
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
  createdAt: string;
  updatedAt: string;
}

export interface ApproveApprovalRequest {
  comment?: string;
  roleIds: Array<string>;
}

export interface RejectApprovalRequest {
  comment?: string;
}

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

export interface CreateUserRequest {
  email: string;
  username?: string;
  displayName: string;
  roleIds: Array<string>;
}

export interface UpdateUserRequest {
  username?: string | null;
  displayName?: string;
  status?: 'pending' | 'active' | 'inactive';
  locale?: string;
  timezone?: string;
}

export interface ReplaceUserRolesRequest {
  roleIds: Array<string>;
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
  status: UserStatus;
  roles: Array<RoleSummary>;
  locale: string;
  timezone: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoles {
  roles: Array<RoleSummary>;
}

export const PermissionKey = {
  'user:create': 'user:create',
  'user:read': 'user:read',
  'user:update': 'user:update',
  'user:delete': 'user:delete',
  'user:assignRole': 'user:assignRole',
  'user:resetPassword': 'user:resetPassword',
  'role:create': 'role:create',
  'role:read': 'role:read',
  'role:update': 'role:update',
  'role:delete': 'role:delete',
  'role:grantPermission': 'role:grantPermission',
  'permission:read': 'permission:read',
  'auditLog:read': 'auditLog:read',
  'system:read': 'system:read',
  'system:update': 'system:update',
  'approval:read': 'approval:read',
  'approval:review': 'approval:review',
  'file:create': 'file:create',
  'file:read': 'file:read',
  'file:update': 'file:update',
  'file:delete': 'file:delete',
  'file:access': 'file:access',
  'file:share': 'file:share',
  'job:read': 'job:read',
  'job:retry': 'job:retry',
  'workspace:create': 'workspace:create',
  'workspace:read': 'workspace:read',
  'workspace:update': 'workspace:update',
  'workspace:delete': 'workspace:delete',
  'workspaceMember:read': 'workspaceMember:read',
  'workspaceMember:create': 'workspaceMember:create',
  'workspaceMember:delete': 'workspaceMember:delete',
  'workspaceMember:assignRole': 'workspaceMember:assignRole',
} as const;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];

export const PermissionScope = {
  platform: 'platform',
  workspace: 'workspace',
} as const;
export type PermissionScope = (typeof PermissionScope)[keyof typeof PermissionScope];

export interface Permission {
  id: string;
  key: PermissionKey;
  resource: string;
  action: string;
  scope: PermissionScope;
  nameI18nKey: string;
  description: string | null;
  sortOrder: number;
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
    status: UserStatus;
    lastLoginAt: string | null;
    preferences: {
      locale: string;
      timezone: string;
    };
  };
  roles: Array<RoleSummary>;
  permissions: Array<PermissionKey>;
}

export interface UpdateProfileRequest {
  displayName?: string;
  preferences?: {
    locale?: string;
    timezone?: string;
  };
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
  password: string;
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
}

export interface SsoRedirect {
  redirectTo: string;
}

export interface SsoCallbackRequest {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}

export interface SetFileFolderGrantRequest {
  subjectType: 'role' | 'user' | 'everyone';
  subjectId: string;
  level: 'viewer' | 'contributor' | 'editor' | 'manager';
  expiresAt: string | null;
}

export interface FileFolderGrant {
  subjectType: 'role' | 'user' | 'everyone';
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
    subjectType: 'role' | 'user' | 'everyone';
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
  createdAt: string;
  updatedAt: string;
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

export interface GetFileImageQuery {
  exp: number;
  sig: string;
  format?: 'jpeg' | 'webp' | 'avif' | 'png' | 'auto';
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
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileListPage {
  items: Array<StoredFile>;
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
  nextCursor: string | null;
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
}

export interface UpdateFileRequest {
  name: string;
  version?: number;
}

export interface JobQueue {
  name: string;
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
  name: string;
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
  name: string;
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

export interface CreateRoleRequest {
  name: string;
  description?: string;
  scope: PermissionScope;
  permissionKeys: Array<PermissionKey>;
}

export interface DuplicateRoleRequest {
  name?: string;
}

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  scope: PermissionScope;
  permissionCount: number;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RolePermissions {
  permissions: Array<Permission>;
}

export interface RoleHolder {
  id: string;
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'inactive' | 'locked';
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string | null;
}

export interface UpdateRolePermissionsRequest {
  add: Array<PermissionKey>;
  remove: Array<PermissionKey>;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAdmin {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  admins: Array<WorkspaceAdmin>;
}

export interface CreateWorkspaceRequest {
  name: string;
  slug?: string;
  description?: string;
  adminUserId: string;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string | null;
}

export interface AssignWorkspaceAdminRequest {
  userId: string;
}

export interface MyWorkspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isMember: boolean;
  lastAccessedAt: string | null;
}

export interface MyWorkspaceList {
  items: Array<MyWorkspace>;
}

export interface WorkspaceMe {
  workspace: MyWorkspace;
  roles: Array<RoleSummary>;
  permissions: Array<PermissionKey>;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  roles: Array<RoleSummary>;
  joinedAt: string;
}

export interface UpdateWorkspaceMemberRolesRequest {
  roleIds: Array<string>;
}

export interface WorkspaceMemberRoles {
  roles: Array<RoleSummary>;
}

export interface WorkspaceRole {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Array<PermissionKey>;
}

export interface WorkspaceRoleList {
  items: Array<WorkspaceRole>;
}

export interface CreateWorkspaceInvitationRequest {
  email: string;
  roleIds: Array<string>;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  roles: Array<RoleSummary>;
  invitedBy: {
    id: string;
    displayName: string;
  } | null;
  hasAccount: boolean;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
}

export interface WorkspaceInvitationList {
  items: Array<WorkspaceInvitation>;
}

export interface WorkspaceInvitationPreview {
  email: string;
  workspaceName: string;
  inviterName: string | null;
  hasAccount: boolean;
  expiresAt: string;
}

export interface AcceptWorkspaceInvitationRequest {
  token: string;
}

export interface SignupWorkspaceInvitationRequest {
  token: string;
  displayName: string;
  password: string;
}

export interface AcceptedWorkspaceInvitation {
  email: string;
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  workspaceUrl: string;
}
