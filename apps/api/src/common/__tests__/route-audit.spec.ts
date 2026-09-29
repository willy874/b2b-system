import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { afterEach, describe, expect, it } from 'vitest';

import { Authenticated, Public, RequirePermissions } from '@/common/decorators';

import {
  auditRoutes,
  collectDeclaredPermissionKeys,
  collectGatewayDeclarations,
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
