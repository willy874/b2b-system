import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listenOnLoopback } from './http';

const JWT_SECRET = 'test-secret-that-is-long-enough-32ch';

interface Started {
  app: INestApplication;
  http: App;
  hasGateway: boolean;
}

let started: Started | undefined;

/**
 * 以指定的角色建一個 AppModule：角色在 `app.module.ts` 被 import 時決定（推播的 gateway 是靜態的 import），
 * 所以每次都重新載入模組。
 */
async function startWithRoles(roles: string): Promise<Started> {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.APP_ROLES = roles;
  vi.resetModules();
  const { AppModule } = await import('@/app.module');
  const { RealtimeGateway } = await import('@/modules/realtime/realtime.gateway');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const http = await listenOnLoopback(app);
  let hasGateway = true;
  try {
    app.get(RealtimeGateway, { strict: false });
  } catch {
    // 沒有載入 RealtimeModule：找不到 provider
    hasGateway = false;
  }
  return { app, http, hasGateway };
}

describe('程序角色（APP_ROLES；docs/features/multi-instance.md §初步構想 1、D3）', () => {
  afterEach(async () => {
    await started?.app.close();
    started = undefined;
    delete process.env.APP_ROLES;
  });

  it('http：業務路由存在、沒有推播的 gateway', async () => {
    started = await startWithRoles('http');
    expect(started.hasGateway).toBe(false);
    const response = await request(started.http).get('/roles');
    expect(response.status).toBe(401);
    await request(started.http).get('/health').expect(200);
  });

  it('realtime：有 gateway；業務路由 404，健康檢查照常', async () => {
    started = await startWithRoles('realtime');
    expect(started.hasGateway).toBe(true);
    const response = await request(started.http).get('/roles');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await request(started.http).get('/health').expect(200);
    await request(started.http).get('/health/ready').expect(200);
  });

  it('worker：只有健康檢查；沒有 gateway', async () => {
    started = await startWithRoles('worker');
    expect(started.hasGateway).toBe(false);
    expect((await request(started.http).get('/roles')).status).toBe(404);
    expect((await request(started.http).post('/auth/login').send({})).status).toBe(404);
    await request(started.http).get('/health').expect(200);
  });
});
