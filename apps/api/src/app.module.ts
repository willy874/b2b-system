import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';

import { AccessTokenModule } from './common/auth';
import {
  FeatureGuard,
  JwtAuthGuard,
  PermissionsGuard,
  PROCESS_SURFACE,
  RateLimitGuard,
  SurfaceGuard,
  WsAuthGuard,
} from './common/guards';
import { AuthzModule } from './core/authz';
import { BroadcastModule } from './core/broadcast';
import { CacheModule } from './core/cache';
import { ConfigModule } from './core/config';
import { DatabaseModule } from './core/database';
import { HttpExceptionFilter } from './core/errors';
import { EventsModule } from './core/events';
import { FeatureFlagsModule } from './core/feature-flags';
import { CacheControlInterceptor, RequestIdMiddleware, TransformInterceptor } from './core/http';
import { ImageModule } from './core/image';
import { JobsModule } from './core/jobs';
import { LoggerModule } from './core/logger';
import { MailModule } from './core/mail';
import { MetricsModule } from './core/metrics';
import { MfaCoreModule } from './core/mfa';
import { RateLimitModule } from './core/rate-limit';
import { SettingsModule } from './core/settings';
import { StorageModule } from './core/storage';
import { TenancyModule, TenantMiddleware } from './core/tenant';
import { TracingModule } from './core/tracing';
import { UsageModule, UsageRequestMiddleware } from './core/usage';
import { AnnouncementModule } from './modules/announcement/announcement.module';
import { ApiTokenModule } from './modules/api-token/api-token.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthzExplainModule } from './modules/authz-explain/authz-explain.module';
import { CommentModule } from './modules/comment/comment.module';
import { PasswordHasherModule } from './modules/credential/password-hasher';
import { DataTransferModule } from './modules/data-transfer/data-transfer.module';
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
import { FileModule } from './modules/file/file.module';
import { GroupModule } from './modules/group/group.module';
import { HealthModule } from './modules/health/health.module';
import { JobModule } from './modules/job/job.module';
import { MfaEmailModule } from './modules/mfa-email/mfa-email.module';
import { MfaTotpModule } from './modules/mfa-totp/mfa-totp.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { NotificationModule } from './modules/notification/notification.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PermissionModule } from './modules/permission/permission.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PlatformNotificationModule } from './modules/platform-notification/platform-notification.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RevisionModule } from './modules/revision/revision.module';
import { RoleModule } from './modules/role/role.module';
import { ServiceAccountModule } from './modules/service-account/service-account.module';
import { SystemModule } from './modules/system/system.module';
import { TagModule } from './modules/tag/tag.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { TrashModule } from './modules/trash/trash.module';
import { UserModule } from './modules/user/user.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [
    // core（global）
    DiscoveryModule, // 路由稽核掃描 controller metadata 用
    ConfigModule,
    LoggerModule,
    // 給 Prometheus 的 /metrics（獨立的 port）與就緒檢查的 event loop 量測（docs/architecture/08-monitoring.md §2）
    MetricsModule,
    TracingModule,
    DatabaseModule,
    // 依網域決定租戶、每租戶的連線池（docs/architecture/05-tenancy.md §10.2 D2、D3）
    TenancyModule,
    // feature flag 的目錄與判斷；租戶層覆寫隨租戶登記載入（docs/architecture/05-tenancy.md §11）
    FeatureFlagsModule,
    CacheModule,
    AuthzModule,
    BroadcastModule,
    // 執行期可調的設定：定義由各模組登記，覆寫值在租戶 DB（docs/architecture/backend/12-settings.md）
    SettingsModule,
    EventsModule,
    // 背景工作佇列（pg-boss）；handler 由各模組註冊（docs/architecture/backend/10-jobs.md）
    JobsModule,
    // 租戶用量的計數與快照來源；彙總在 TenantModule（docs/architecture/05-tenancy.md §5.4）
    UsageModule,
    // 物件儲存的抽象層（ObjectStorage）；實作是 S3 SDK（docs/architecture/backend/09-file.md §2）
    StorageModule,
    // 寄信的抽象層（MailTransport）；smtp 或 console（docs/architecture/backend/11-mail.md）
    MailModule,
    // 影像處理的抽象層（ImageProcessor）；實作是 sharp（docs/architecture/backend/09-file.md §5.4）
    ImageModule,
    AccessTokenModule,

    // 葉節點模組（被很多人依賴）
    PermissionModule,
    AuditLogModule,
    // 平台管理者與平台稽核：全域 PermissionsGuard 判斷平台端點的權限（docs/architecture/05-tenancy.md §10.2 D5）
    PlatformAdminModule,
    // argon2 的並行上限：全程序共用一個（docs/architecture/backend/04-auth.md §4.1）
    PasswordHasherModule,
    // 限流與登入延遲的計數（docs/architecture/backend/03-api-conventions.md §8）
    RateLimitModule,
    // 平台管理者的站內通知；由租戶佈建、管理者管理發出（docs/architecture/backend/15-notification.md §6.2）
    PlatformNotificationModule,
    // 訂閱領域事件並推播；沒有任何模組依賴它（docs/architecture/backend/08-realtime.md §2）
    RealtimeModule,

    // 審批的狀態機；各類型的 handler 由擁有資源的業務模組註冊（docs/architecture/backend/20-approval.md §4）
    ApprovalModule,
    // 回收桶；各資源類型的 handler 由擁有資源的業務模組註冊（docs/architecture/backend/13-trash.md）
    TrashModule,
    RevisionModule,
    // 站內通知；通知由擁有者模組在業務交易內寫入（docs/architecture/backend/15-notification.md）
    NotificationModule,
    // 匯入／匯出；可匯入匯出的資源由擁有者模組登記（docs/architecture/backend/22-data-transfer.md §5.1）
    DataTransferModule,

    // MFA：機制（方式的註冊表）、框架，與各驗證方式（docs/architecture/backend/21-mfa.md §1）
    MfaCoreModule,
    MfaModule,
    MfaTotpModule,
    MfaEmailModule,

    // 業務模組
    AuthModule,
    UserModule,
    RoleModule,
    GroupModule,
    OrganizationModule,
    // 服務帳號與 API token（docs/architecture/06-external-api.md §9）
    ApiTokenModule,
    ServiceAccountModule,
    // 對外事件的訂閱與投遞；事件由擁有者模組在業務交易內發出（docs/architecture/backend/17-webhook.md §9）
    WebhookModule,
    // 標籤；標籤組與資源類型由擁有者模組登記（docs/architecture/backend/18-tag.md §7）
    TagModule,
    CommentModule,
    AnnouncementModule,
    AuthzExplainModule,
    SystemModule,
    FileModule,
    FeatureFlagModule,
    JobModule,
    HealthModule,
    TenantModule,
  ],
  providers: [
    // 全域註冊 ＋ 預設拒絕：忘記宣告權限的後果是「啟動失敗」而不是「開了一個無保護的端點」。
    // Nest 12 起全域 guard／interceptor 也套用到 WebSocket gateway：每個 guard 自己看 ctx.getType()，
    // HTTP 由 JwtAuthGuard、ws 由 WsAuthGuard 認人，兩者都排在 FeatureGuard 與 PermissionsGuard 之前
    // 這個程序是內部 api：對外 API 的路由（/v1/*）在這裡等同不存在（docs/architecture/06-external-api.md §9.2 D11）
    { provide: PROCESS_SURFACE, useValue: 'internal' },
    { provide: APP_GUARD, useClass: SurfaceGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: WsAuthGuard },
    // 未啟用的 feature → 404：在驗證之後（未登入照舊 401）、權限之前（不以 403 透露端點存在）
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // 租戶要在所有路由之前決定（含 OidcProviderModule 掛的 /oidc/*：查帳號要連租戶 DB）
    consumer.apply(RequestIdMiddleware, TenantMiddleware, UsageRequestMiddleware).forRoutes('*');
  }
}
