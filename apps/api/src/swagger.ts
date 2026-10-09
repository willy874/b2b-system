import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';

import type { ProcessSurface } from './common/guards';
import { JobQueue } from './core/jobs';
import { buildComponentSchemas } from './core/validation';

/** 對外 API 的路徑都在這底下（`common/route-audit.ts` 會擋不在這底下的對外路由）。 */
const EXTERNAL_PATH = /^\/v\d+(\/|$)/;
/** 兩邊都有的路由（健康檢查）。 */
const SHARED_PATH = /^\/health(\/|$)/;

function belongsTo(surface: ProcessSurface, path: string): boolean {
  if (SHARED_PATH.test(path)) return true;
  return surface === 'external' ? EXTERNAL_PATH.test(path) : !EXTERNAL_PATH.test(path);
}

/** `paths` 實際引用到的 `#/components/schemas/*`（含 schema 之間的引用）。 */
function referencedSchemas(
  paths: OpenAPIObject['paths'],
  all: Record<string, unknown>,
): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        const name = child.replace('#/components/schemas/', '');
        if (!found.has(name)) {
          found.add(name);
          visit(all[name]);
        }
      } else {
        visit(child);
      }
    }
  };
  visit(paths);
  return found;
}

/**
 * 工作名稱的 `enum`：工作由各模組在 `onModuleInit` 註冊，zod 的 schema 只能寫 `string`（`modules/job/dto`），
 * 產生文件時以已註冊的工作補上。SDK 因此有 `TenantJobName`／`JobName` 的聯集，新增工作而前端沒補顯示名稱時
 * typecheck 失敗（docs/architecture/backend/10-jobs.md §6）。
 */
function jobNameSchemas(app: INestApplication): Record<string, SchemaObject> {
  const definitions = app.get(JobQueue, { strict: false }).definitions();
  const tenantNames = definitions.filter(({ scope }) => scope === 'tenant').map(({ name }) => name);
  return {
    TenantJobName: { type: 'string', enum: tenantNames },
    JobName: { type: 'string', enum: definitions.map(({ name }) => name) },
  };
}

/**
 * 內部 api 的文件（`openapi.json`，產生前端 SDK）與對外 API 的文件（`openapi.external.json`，給整合方）
 * 來自同一個 app：兩個程序註冊的 controller 相同，以路徑分開（docs/architecture/06-external-api.md §9.2 D12）。
 */
export function buildOpenApiDocument(
  app: INestApplication,
  surface: ProcessSurface = 'internal',
): OpenAPIObject {
  const builder =
    surface === 'external'
      ? new DocumentBuilder()
          .setTitle('B2B System External API')
          .setDescription(
            '給外部系統的 API。以 API token 認證：`Authorization: Bearer b2bt_<租戶代碼>_<id>_<secret>`；' +
              'token 在後台建立（個人 token 或服務帳號）。v1 之內只會新增欄位與端點。',
          )
          .setVersion('v1')
          .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API token' })
      : new DocumentBuilder()
          .setTitle('B2B System API')
          .setDescription('RBAC 骨架 API')
          .setVersion('0.0.0')
          .addBearerAuth();
  const document = SwaggerModule.createDocument(app, builder.build());
  const entries = Object.entries(document.paths);
  document.paths = Object.fromEntries(entries.filter(([path]) => belongsTo(surface, path)));
  const otherPaths = Object.fromEntries(entries.filter(([path]) => !belongsTo(surface, path)));

  // Zod 具名 schema → components.schemas，SDK 才能產生具名型別（docs/architecture/backend/03-api-conventions.md §12）
  document.components ??= {};
  const schemas: Record<string, unknown> = {
    ...document.components.schemas,
    ...buildComponentSchemas(),
    // 對外文件不引用工作的 schema（只留引用得到的），不必查
    ...(surface === 'internal' ? jobNameSchemas(app) : {}),
  };
  // 具名 schema 是整個程序共用的登記表：
  // - 對外文件只留引用得到的，不把內部的 DTO 帶出去
  // - 內部文件拿掉「只有對外路由用到」的，前端 SDK 不出現對外 API 的型別（沒被任何路由引用的照舊保留）
  const used = referencedSchemas(document.paths, schemas);
  const otherOnly = new Set(
    [...referencedSchemas(otherPaths, schemas)].filter((name) => !used.has(name)),
  );
  document.components.schemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) =>
      surface === 'external' ? used.has(name) : !otherOnly.has(name),
    ),
  ) as NonNullable<OpenAPIObject['components']>['schemas'];
  return document;
}

export function setupSwagger(
  app: INestApplication,
  enabled: boolean,
  surface: ProcessSurface = 'internal',
): OpenAPIObject {
  const document = buildOpenApiDocument(app, surface);
  if (enabled) SwaggerModule.setup('docs', app, document);
  return document;
}
