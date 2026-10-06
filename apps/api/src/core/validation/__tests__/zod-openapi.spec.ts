import { Body, Controller, Get, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildComponentSchemas, defineSchema, refOf, schemaIdOf } from '../zod-openapi';
import { ApiZodEndpoint } from '../zod-openapi';

const WidgetSchema = defineSchema(
  'SpecWidget',
  z.object({ id: z.string(), size: z.number().int().optional() }),
);
const CreateWidgetSchema = defineSchema('SpecCreateWidget', z.object({ name: z.string().min(1) }));
/** 引用另一個具名 schema：輸出時以 `$ref` 指過去，不把內容展開。 */
defineSchema('SpecWidgetPage', z.object({ first: WidgetSchema }));

@Controller('widgets')
class WidgetController {
  @Get()
  @ApiZodEndpoint({ listOf: WidgetSchema, description: '列表' })
  list(): void {}

  @Post()
  @ApiZodEndpoint({ body: CreateWidgetSchema, status: 201, response: WidgetSchema })
  create(@Body() _body: unknown): void {}

  @Get('empty')
  @ApiZodEndpoint({})
  empty(): void {}
}

describe('zod-openapi：具名 schema 登記（docs/architecture/backend/03-api-conventions.md §12）', () => {
  it('schemaIdOf 回傳登記時的 id', () => {
    expect(schemaIdOf(WidgetSchema)).toBe('SpecWidget');
  });

  it('沒有以 defineSchema 登記的 schema → 拋錯（無法產生 $ref）', () => {
    expect(() => schemaIdOf(z.object({}))).toThrow(/defineSchema/);
  });

  it('refOf 指向 components.schemas 底下的同名 schema', () => {
    expect(refOf(WidgetSchema)).toEqual({ $ref: '#/components/schemas/SpecWidget' });
  });

  it('defineSchema 原樣回傳傳入的 schema（仍可直接用來 parse）', () => {
    expect(CreateWidgetSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
  });

  it('buildComponentSchemas 以 OpenAPI 3.0 輸出每個登記的 schema，不帶 $id', () => {
    const schemas = buildComponentSchemas();
    expect(schemas.SpecWidget).toMatchObject({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, size: { type: 'integer' } },
    });
    expect(schemas.SpecWidget).not.toHaveProperty('$id');
  });

  it('具名 schema 之間的引用輸出成 $ref', () => {
    expect(buildComponentSchemas().SpecWidgetPage).toMatchObject({
      properties: { first: { $ref: '#/components/schemas/SpecWidget' } },
    });
  });
});

describe('ApiZodEndpoint（寫進 OpenAPI 文件的請求與回應）', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [WidgetController] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('body：requestBody 以 $ref 指向具名 schema', () => {
    expect(document.paths['/widgets']?.post?.requestBody).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/SpecCreateWidget' } },
      },
    });
  });

  it('response：回應包在 { data } 信封裡，狀態碼依 status', () => {
    const responses = document.paths['/widgets']?.post?.responses ?? {};
    expect(responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['data'],
            properties: { data: { $ref: '#/components/schemas/SpecWidget' } },
          },
        },
      },
    });
  });

  it('listOf：{ data: { items, pagination } }，沒給 status 時是 200，帶上說明', () => {
    const response = document.paths['/widgets']?.get?.responses?.['200'];
    expect(response).toMatchObject({
      description: '列表',
      content: {
        'application/json': {
          schema: {
            required: ['data'],
            properties: {
              data: {
                required: ['items', 'pagination'],
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/SpecWidget' } },
                  pagination: { required: ['offset', 'limit', 'total'] },
                },
              },
            },
          },
        },
      },
    });
  });

  it('什麼都不給：不加任何 body 或 Zod 的回應宣告', () => {
    const operation = document.paths['/widgets/empty']?.get;
    expect(operation?.requestBody).toBeUndefined();
    expect(JSON.stringify(operation?.responses ?? {})).not.toContain('#/components/schemas/');
  });
});
