import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AccessTokenModule } from './common/auth';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { CacheModule } from './core/cache';
import { ConfigModule } from './core/config';
import type { Env } from './core/config';
import { DatabaseModule } from './core/database';
import { HttpExceptionFilter } from './core/errors';
import { EventsModule } from './core/events';
import { RequestIdMiddleware, TransformInterceptor } from './core/http';
import { ImageModule } from './core/image';
import { JobsModule } from './core/jobs';
import { LoggerModule } from './core/logger';
import { MailModule } from './core/mail';
import { SettingsModule } from './core/settings';
import { StorageModule } from './core/storage';
import { TenancyModule, TenantMiddleware } from './core/tenant';
import { ApprovalModule } from './modules/approval/approval.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { FileModule } from './modules/file/file.module';
import { HealthModule } from './modules/health/health.module';
import { JobModule } from './modules/job/job.module';
import { PermissionModule } from './modules/permission/permission.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RoleModule } from './modules/role/role.module';
import { SystemModule } from './modules/system/system.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UserModule } from './modules/user/user.module';

@Module({
  imports: [
    // core（global）
    DiscoveryModule, // 路由稽核掃描 controller metadata 用
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    // 依網域決定租戶、每租戶的連線池（docs/adr/0020-physical-tenant-isolation.md D2、D3）
    TenancyModule,
    CacheModule,
    // 執行期可調的設定：定義由各模組登記，覆寫值在租戶 DB（docs/architecture/backend/12-settings.md）
    SettingsModule,
    EventsModule,
    // 背景工作佇列（pg-boss）；handler 由各模組註冊（docs/architecture/backend/10-jobs.md）
    JobsModule,
    // 物件儲存的抽象層（ObjectStorage）；實作是 S3 SDK（docs/architecture/backend/09-file.md §2）
    StorageModule,
    // 寄信的抽象層（MailTransport）；smtp 或 console（docs/architecture/backend/11-mail.md）
    MailModule,
    // 影像處理的抽象層（ImageProcessor）；實作是 sharp（docs/architecture/backend/09-file.md §5.4）
    ImageModule,
    AccessTokenModule,
    // 只有一個全域桶；`/auth/*` 以 @Throttle() 覆寫成更嚴格的值。
    // （多個具名 throttler 會「同時」套用到每個路由，那會讓最嚴格的那個變成全域限制。）
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        { name: 'default', ttl: 60_000, limit: config.get('DEFAULT_RATE_LIMIT', { infer: true }) },
      ],
    }),

    // 葉節點模組（被很多人依賴）
    PermissionModule,
    AuditLogModule,
    // 平台管理者與平台稽核：全域 PermissionsGuard 判斷平台端點的權限（ADR-0020 D5）
    PlatformAdminModule,
    // 訂閱領域事件並推播；沒有任何模組依賴它（docs/architecture/backend/08-realtime.md §2）
    RealtimeModule,

    // 審批的狀態機；各類型的 handler 由擁有資源的業務模組註冊（docs/rbac/06-approval.md §4）
    ApprovalModule,

    // 業務模組
    AuthModule,
    UserModule,
    RoleModule,
    SystemModule,
    FileModule,
    JobModule,
    HealthModule,
    TenantModule,
  ],
  providers: [
    // 全域註冊 ＋ 預設拒絕：忘記宣告權限的後果是「啟動失敗」而不是「開了一個無保護的端點」
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // 租戶要在所有路由之前決定（含 OidcProviderModule 掛的 /oidc/*：查帳號要連租戶 DB）
    consumer.apply(RequestIdMiddleware, TenantMiddleware).forRoutes('*');
  }
}
