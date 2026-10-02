import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
// swagger 12 的 package.json `exports` 只開放根路徑，不再深入 dist/ 取型別
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import type { ZodType } from 'zod';

/**
 * 具名 schema 的登記處。有登記的 schema 會以 `$ref` 出現在 OpenAPI 的
 * `components.schemas` 裡，`packages/api-sdk` 才能產生對應的具名型別
 * （docs/architecture/backend/03-api-conventions.md §12）。
 */
const registry = z.registry<{ id: string }>();
const idBySchema = new WeakMap<ZodType, string>();

export function defineSchema<T extends ZodType>(id: string, schema: T): T {
  registry.add(schema, { id });
  idBySchema.set(schema, id);
  return schema;
}

export function schemaIdOf(schema: ZodType): string {
  const id = idBySchema.get(schema);
  if (!id) throw new Error('Schema 未以 defineSchema() 登記，無法產生 $ref');
  return id;
}

export function refOf(schema: ZodType): SchemaObject {
  return { $ref: `#/components/schemas/${schemaIdOf(schema)}` } as SchemaObject;
}

/** 套進 `SwaggerModule.createDocument()` 的結果，補上所有具名 schema。 */
export function buildComponentSchemas(): Record<string, SchemaObject> {
  const { schemas } = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    io: 'output',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, SchemaObject & { $id?: string }> };

  const result: Record<string, SchemaObject> = {};
  for (const [id, schema] of Object.entries(schemas)) {
    const { $id: _ignored, ...rest } = schema;
    result[id] = rest as SchemaObject;
  }
  return result;
}

/** 成功回應一律是 `{ data: ... }`。 */
function envelope(inner: SchemaObject): SchemaObject {
  return { type: 'object', required: ['data'], properties: { data: inner } } as SchemaObject;
}

export const ApiZodBody = (schema: ZodType) => ApiBody({ schema: refOf(schema) });

export const ApiZodResponse = (status: number, schema: ZodType, description?: string) =>
  ApiResponse({ status, description, schema: envelope(refOf(schema)) });

export const ApiZodListResponse = (status: number, item: ZodType, description?: string) =>
  ApiResponse({
    status,
    description,
    schema: envelope({
      type: 'object',
      required: ['items', 'pagination'],
      properties: {
        items: { type: 'array', items: refOf(item) },
        pagination: {
          type: 'object',
          required: ['offset', 'limit', 'total'],
          properties: {
            offset: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
      },
    } as SchemaObject),
  });

export const ApiZodEndpoint = (options: {
  body?: ZodType;
  status?: number;
  response?: ZodType;
  listOf?: ZodType;
  description?: string;
}) => {
  const decorators = [];
  if (options.body) decorators.push(ApiZodBody(options.body));
  const status = options.status ?? 200;
  if (options.response)
    decorators.push(ApiZodResponse(status, options.response, options.description));
  if (options.listOf)
    decorators.push(ApiZodListResponse(status, options.listOf, options.description));
  return applyDecorators(...decorators);
};
