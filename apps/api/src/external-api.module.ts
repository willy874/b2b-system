import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenModule } from './common/auth';
import { FeatureGuard, PermissionsGuard, PROCESS_SURFACE, SurfaceGuard } from './common/guards';
import { AuthzModule } from './core/authz';
import { BroadcastModule } from './core/broadcast';
import { CacheModule } from './core/cache';
import { ConfigModule } from './core/config';
import { DatabaseModule } from './core/database';
import { HttpExceptionFilter } from './core/errors';
import { EventsModule } from './core/events';
import { FeatureFlagsModule } from './core/feature-flags';
import {
  CACHE_CONTROL_DEFAULT,
  CACHE_CONTROL_NO_STORE,
  CacheControlInterceptor,
  RequestIdMiddleware,
  TransformInterceptor,
} from './core/http';
import { ImageModule } from './core/image';
import { JobsModule } from './core/jobs';
import { LifecycleModule } from './core/lifecycle';
import { LoggerModule } from './core/logger';
import { MailModule } from './core/mail';
import { MetricsModule } from './core/metrics';
import { RateLimitModule } from './core/rate-limit';
import { SettingsModule } from './core/settings';
import { StorageModule } from './core/storage';
import { TenancyModule } from './core/tenant';
import { TracingModule } from './core/tracing';
import { UsageModule, UsageRequestMiddleware } from './core/usage';
import { AnnouncementModule } from './modules/announcement/announcement.module';
import { ApiTokenModule } from './modules/api-token/api-token.module';
import { ApiTokenAuthGuard } from './modules/api-token/external/api-token-auth.guard';
import { ExternalRateLimitGuard } from './modules/api-token/external/external-rate-limit.guard';
import { TokenTenantMiddleware } from './modules/api-token/external/token-tenant.middleware';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { PasswordHasherModule } from './modules/credential/password-hasher';
import { FileModule } from './modules/file/file.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { GroupModule } from './modules/group/group.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PermissionModule } from './modules/permission/permission.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { RoleModule } from './modules/role/role.module';
import { UserModule } from './modules/user/user.module';

/**
 * 對外 API 的組裝根（docs/architecture/06-external-api.md §9.2 D9～D11、D19）：另一個程序（`main.external.ts`）、
 * 另一個 port 與網域。業務邏輯與內部 api 共用同一份 service；這裡只決定這個程序 **有什麼、怎麼認人**：
 *
 * - 只認 API token（`ApiTokenAuthGuard`），租戶由 token 的代碼決定（`TokenTenantMiddleware`），不看網域
 * - 沒有 Socket.io、OIDC Provider、refresh cookie；不 import RealtimeModule、AuthModule
 * - 只入列、不執行背景工作（`main.external.ts` 固定 `JOBS_WORKER_ENABLED=false`）
 * - import 進來的模組也帶著內部的 controller，由 `SurfaceGuard` 回 404
 *
 * 之後每個要對外的功能：在這裡 import 它的模組，對外的 controller 放在 `modules/<name>/external/`。
 */
@Module({
  imports: [
    // core（global）
    DiscoveryModule, // 路由稽核掃描 controller metadata 用
    ConfigModule,
    LoggerModule,
    // 結束前的排空（readiness 503、WebSocket 分批斷線；docs/architecture/01-system.md §7 D13）
    LifecycleModule,
    // 給 Prometheus 的 /metrics（獨立的 port）與就緒檢查的 event loop 量測（docs/architecture/08-monitoring.md §2）
    MetricsModule,
    TracingModule,
    DatabaseModule,
    TenancyModule,
    FeatureFlagsModule,
    CacheModule,
    AuthzModule,
    BroadcastModule,
    SettingsModule,
    // 寫入的推播轉送給內部 api；這個程序沒有推播，不收別人轉送來的
    EventsModule.sendOnly(),
    JobsModule,
    // 對外 API 的請求數（docs/architecture/05-tenancy.md §5.4）
    UsageModule,
    StorageModule,
    // 寄信的工作在這裡只入列（平台管理者模組登記了寄信的 handler，PermissionsGuard 依賴那個模組）
    MailModule,
    // 檔案的影像處理（上傳完成時排入變體的產生；產生本身在背景工作）
    ImageModule,
    // 驗證 token 時以它檢查帳號（狀態、token_version），與內部 api 同一套規則。它也能驗 JWT，
    // 需要一個 JwtService；這個程序沒有 access token 的金鑰（AccessTokenKeys 在對外的範圍不載入任何金鑰），
    // verifyClaims 一律拒絕（docs/architecture/backend/04-auth.md §11 D5）
    JwtModule.register({ global: true }),
    AccessTokenModule,

    // 葉節點模組：PermissionsGuard 依賴
    PermissionModule,
    AuditLogModule,
    PlatformAdminModule,
    // argon2 的並行上限：全程序共用一個（docs/architecture/backend/04-auth.md §4.1）
    PasswordHasherModule,
    // 限流與登入延遲的計數（docs/architecture/backend/03-api-conventions.md §8）
    RateLimitModule,

    // 對外的功能（對外的 controller 在各模組的 external/）
    ApiTokenModule,
    FileModule,
    UserModule,
    HealthModule,
    // 回收桶要求每一種類型都有 handler（啟動時檢查）：檔案、使用者之外的擁有者模組也要在。它們的路由由 SurfaceGuard 擋下
    RoleModule,
    GroupModule,
    OrganizationModule,
    AnnouncementModule,
    GalleryModule,
  ],
  providers: [
    { provide: PROCESS_SURFACE, useValue: 'external' },
    { provide: APP_GUARD, useClass: SurfaceGuard },
    // 先認人再限流：限流以 token 計；認證失敗另以 IP 計數（ApiTokenAuthGuard）
    { provide: APP_GUARD, useClass: ApiTokenAuthGuard },
    { provide: APP_GUARD, useClass: ExternalRateLimitGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // 對外 API 一律不快取（同 deploy/nginx.external-api.conf）
    { provide: CACHE_CONTROL_DEFAULT, useValue: CACHE_CONTROL_NO_STORE },
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class ExternalApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, TokenTenantMiddleware, UsageRequestMiddleware)
      .forRoutes('*');
  }
}
