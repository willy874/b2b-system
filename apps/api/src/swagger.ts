import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

import { buildComponentSchemas } from './core/validation';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('B2B System API')
      .setDescription('RBAC 骨架 API')
      .setVersion('0.0.0')
      .addBearerAuth()
      .build(),
  );

  // Zod 具名 schema → components.schemas，SDK 才能產生具名型別（ADR-0007）
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ...buildComponentSchemas(),
  };
  return document;
}

export function setupSwagger(app: INestApplication, enabled: boolean): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  if (enabled) SwaggerModule.setup('docs', app, document);
  return document;
}
