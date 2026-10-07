// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

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
  body: string;
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
  body: string;
  audience: AnnouncementAudience;
  trigger: AnnouncementTrigger;
}

export interface UpdateAnnouncementRequest {
  title?: string;
  body?: string;
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
  body: string;
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
  body: string;
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
  'authz:explain': 'authz:explain',
  'serviceAccount:create': 'serviceAccount:create',
  'serviceAccount:read': 'serviceAccount:read',
  'serviceAccount:update': 'serviceAccount:update',
  'serviceAccount:delete': 'serviceAccount:delete',
  'webhook:create': 'webhook:create',
  'webhook:read': 'webhook:read',
  'webhook:update': 'webhook:update',
  'webhook:delete': 'webhook:delete',
  'tag:create': 'tag:create',
  'tag:update': 'tag:update',
  'tag:delete': 'tag:delete',
  'notification:read': 'notification:read',
  'announcement:create': 'announcement:create',
  'announcement:read': 'announcement:read',
  'announcement:update': 'announcement:update',
  'announcement:delete': 'announcement:delete',
  'announcement:publish': 'announcement:publish',
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

export interface IdentityProviderDomain {
  domain: string;
  ssoOnly: boolean;
}

export interface IdentityProvider {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  scopes: string;
  enabled: boolean;
  unmatchedPolicy: 'reject' | 'auto_create';
  domains: Array<IdentityProviderDomain>;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityProviderList {
  items: Array<IdentityProvider>;
  callbackUrl: string;
}

export interface CreateIdentityProviderRequest {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  enabled: boolean;
  unmatchedPolicy: 'reject' | 'auto_create';
  domains: Array<IdentityProviderDomain>;
}

export interface UpdateIdentityProviderRequest {
  name?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  enabled?: boolean;
  unmatchedPolicy?: 'reject' | 'auto_create';
  domains?: Array<IdentityProviderDomain>;
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
  enrollAt: 'anywhere' | 'idp';
  assurance: 'possession' | 'inbox';
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
    enrollAt: 'anywhere' | 'idp';
    assurance: 'possession' | 'inbox';
    maxFactorsPerAccount: number;
    enrolled: number;
  }>;
  required: boolean;
}

export interface StartMfaEnrollmentRequest {
  method: string;
}

export interface MfaChallengeInfo {
  challengeId: string;
  hint: string | null;
  expiresAt: string;
  resendAvailableAt: string;
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
}

export type SsoLoginResult = SsoRedirect | SsoMfaChallengeNext | SsoMfaEnrollNext;

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
} as const;
export type TenantFeature = (typeof TenantFeature)[keyof typeof TenantFeature];

export type TenantFlagOverrides = Record<string, boolean>;

export const TenantFeatureParamKey = {
  'file.storageQuotaMb': 'file.storageQuotaMb',
  'auditLog.hotRetentionDays': 'auditLog.hotRetentionDays',
  'auditLog.retentionDays': 'auditLog.retentionDays',
  'job.maxConcurrency': 'job.maxConcurrency',
  'identityProvider.maxProviders': 'identityProvider.maxProviders',
  'webhook.maxUrls': 'webhook.maxUrls',
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
  featureParams: Array<TenantFeatureParam>;
  adminEmail: string | null;
  provisionError: string | null;
  provisionedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTenantList {
  items: Array<PlatformTenant>;
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
  baseDomain: string;
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
  featureParams?: Record<string, (number | string) | null>;
}

export interface TenantFeatureImpact {
  feature: TenantFeature;
  available: boolean;
  items: Array<{
    key: 'identityProviderConnections' | 'ssoOnlyDomains' | 'passwordlessExternalUsers';
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
  'platformAuditLog:read': 'platformAuditLog:read',
  'platformJob:read': 'platformJob:read',
  'platformJob:retry': 'platformJob:retry',
  'featureFlag:read': 'featureFlag:read',
  'featureFlag:update': 'featureFlag:update',
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

export interface PlatformJobQueue {
  name: string;
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
  name: string;
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
  name: string;
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
  category: 'general' | 'auth' | 'file' | 'trash' | 'revision' | 'notification';
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
