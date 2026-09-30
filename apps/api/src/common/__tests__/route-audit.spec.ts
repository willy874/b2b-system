import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Authenticated,
  Public,
  RequireFeature,
  RequireFlag,
  RequirePermissions,
  RequirePlatformPermissions,
} from '@/common/decorators';

import {
  auditRoutes,
  collectDeclaredPermissionKeys,
  collectGatewayDeclarations,
  collectRouteDeclarations,
} from '../route-audit';

@WebSocketGateway({ path: '/socket.io' })
class DeclaredGateway {
  @Authenticated()
  @SubscribeMessage('declared.authenticated')
  authenticated(): void {}

  @RequirePermissions('role:read')
  @SubscribeMessage('declared.permission')
  permission(): void {}

  /** 不是訊息處理器，不該被收進來 */
  helper(): void {}
}

@WebSocketGateway({ path: '/socket.io' })
class UndeclaredGateway {
  @SubscribeMessage('oops')
  oops(): void {}
}

@WebSocketGateway({ path: '/socket.io' })
class PublicGateway {
  @Public()
  @SubscribeMessage('open')
  open(): void {}
}

@Module({ imports: [DiscoveryModule], providers: [DeclaredGateway] })
class DeclaredModule {}

@Module({ imports: [DiscoveryModule], providers: [UndeclaredGateway] })
class UndeclaredModule {}

@Module({ imports: [DiscoveryModule], providers: [PublicGateway] })
class PublicModule {}

@Controller('featured')
@RequireFeature('file')
class FeaturedController {
  @Get()
  @RequirePermissions('file:read')
  list(): void {}

  /** handler 的宣告蓋過 class 的 */
  @Get('logs')
  @RequireFeature('auditLog')
  @RequirePermissions('auditLog:read')
  logs(): void {}
}

@Controller('platform-featured')
class PlatformFeaturedController {
  @Get()
  @RequireFeature('job')
  @RequirePlatformPermissions('platformJob:read')
  list(): void {}
}

@Controller('trial')
class TrialController {
  @Get()
  @RequireFlag('levelEditor.v2')
  @RequirePermissions('file:read')
  list(): void {}
}

@Controller('platform-trial')
class PlatformTrialController {
  @Get()
  @RequireFlag('levelEditor.v2')
  @RequirePlatformPermissions('platformJob:read')
  list(): void {}
}

@Module({ imports: [DiscoveryModule], controllers: [TrialController] })
class TrialModule {}

@Module({ imports: [DiscoveryModule], controllers: [PlatformTrialController] })
class PlatformTrialModule {}

@Module({ imports: [DiscoveryModule], controllers: [FeaturedController] })
class FeaturedModule {}

@Module({ imports: [DiscoveryModule], controllers: [PlatformFeaturedController] })
class PlatformFeaturedModule {}

let app: INestApplication | undefined;

async function boot(module: new () => object): Promise<INestApplication> {
  app = await NestFactory.create(module, { logger: false });
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('路由稽核延伸到 gateway（docs/architecture/backend/08-realtime.md §5）', () => {
  it('收集每個 @SubscribeMessage 的宣告', async () => {
    const declared = collectGatewayDeclarations(await boot(DeclaredModule));
    expect(declared).toEqual([
      {
        gateway: 'DeclaredGateway',
        event: 'declared.authenticated',
        declaration: 'authenticated',
        keys: [],
        platformKeys: [],
        match: undefined,
      },
      {
        gateway: 'DeclaredGateway',
        event: 'declared.permission',
        declaration: 'permissions',
        keys: ['role:read'],
        platformKeys: [],
        match: 'every',
      },
    ]);
  });

  it('全部宣告時不拋錯，權限鍵也算進已宣告的鍵', async () => {
    const good = await boot(DeclaredModule);
    expect(() => auditRoutes(good)).not.toThrow();
    expect(collectDeclaredPermissionKeys(good)).toContain('role:read');
  });

  it('未宣告授權的訊息處理器 → 稽核失敗（程序啟動會中止）', async () => {
    const bad = await boot(UndeclaredModule);
    expect(() => auditRoutes(bad)).toThrow(/WebSocket 訊息處理器未宣告授權策略/);
    expect(() => auditRoutes(bad)).toThrow(/UndeclaredGateway oops/);
  });

  it('@Public() 在 WebSocket 上不允許 → 稽核失敗', async () => {
    const bad = await boot(PublicModule);
    expect(() => auditRoutes(bad)).toThrow(/PublicGateway open（public）/);
  });
});

describe('路由稽核的 @RequireFeature（docs/adr/0021-runtime-feature-activation.md D11）', () => {
  it('收集每個路由的 feature；handler 的宣告蓋過 class 的', async () => {
    const featured = await boot(FeaturedModule);
    const routes = collectRouteDeclarations(featured);
    expect(routes.map((r) => [r.path, r.feature])).toEqual([
      ['/featured', 'file'],
      ['/featured/logs', 'auditLog'],
    ]);
    expect(() => auditRoutes(featured)).not.toThrow();
  });

  it('平台端點標了 @RequireFeature → 稽核失敗（平台的請求沒有租戶，標了也不生效）', async () => {
    const bad = await boot(PlatformFeaturedModule);
    expect(() => auditRoutes(bad)).toThrow(/GET \/platform-featured（job）/);
  });
});

describe('路由稽核的 @RequireFlag（docs/adr/0022-feature-flags.md D5）', () => {
  const CATALOG = [
    {
      key: 'levelEditor.v2',
      description: '',
      defaultEnabled: false,
      owner: 't',
      removeBy: '2099-01-01',
    },
  ];

  it('收集每個路由的 flag；key 在目錄裡 → 通過', async () => {
    const trial = await boot(TrialModule);
    expect(collectRouteDeclarations(trial).map((r) => [r.path, r.flag])).toEqual([
      ['/trial', 'levelEditor.v2'],
    ]);
    expect(() => auditRoutes(trial, CATALOG)).not.toThrow();
  });

  it('key 不在目錄裡 → 稽核失敗（端點會被永遠關死）', async () => {
    const trial = await boot(TrialModule);
    expect(() => auditRoutes(trial, [])).toThrow(/GET \/trial（levelEditor.v2）/);
  });

  it('平台端點標了 @RequireFlag → 稽核失敗', async () => {
    const bad = await boot(PlatformTrialModule);
    expect(() => auditRoutes(bad, CATALOG)).toThrow(/GET \/platform-trial（levelEditor.v2）/);
  });
});
