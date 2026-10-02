// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CreateWebhookRequest,
  CreatedWebhook,
  UpdateWebhookRequest,
  Webhook,
  WebhookDelivery,
  WebhookEventList,
  WebhookSecret,
  WebhookTestResult,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreateWebhookRequestSchema,
  CreatedWebhookSchema,
  UpdateWebhookRequestSchema,
  WebhookDeliverySchema,
  WebhookEventListSchema,
  WebhookSchema,
  WebhookSecretSchema,
  WebhookTestResultSchema,
} from '../schemas';

// GET /webhooks

export interface WebhookControllerListResponses {
  200: {
    data: {
      items: Array<Webhook>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type WebhookControllerListResponse = WebhookControllerListResponses[200];

export type WebhookControllerListResult = ApiResponse<200, WebhookControllerListResponses[200]>;

export const WebhookControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(WebhookSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerListUrl(): string {
  return buildUrl('/webhooks');
}

const webhookControllerListOperation: OperationDefinition = {
  id: 'WebhookController_list',
  method: 'GET',
  path: '/webhooks',
  responseTypes: { 200: 'json' },
  schemas: WebhookControllerListSchemas,
};

export function webhookControllerList(
  options?: RequestOptions,
): Promise<WebhookControllerListResult> {
  return request<WebhookControllerListResult>(webhookControllerListOperation, {}, options);
}

// POST /webhooks

export type WebhookControllerCreateBody = CreateWebhookRequest;

export interface WebhookControllerCreateInput {
  body: WebhookControllerCreateBody;
}

export interface WebhookControllerCreateResponses {
  201: {
    data: CreatedWebhook;
  };
}

export type WebhookControllerCreateResponse = WebhookControllerCreateResponses[201];

export type WebhookControllerCreateResult = ApiResponse<201, WebhookControllerCreateResponses[201]>;

export const WebhookControllerCreateSchemas = {
  body: CreateWebhookRequestSchema,
  responses: {
    201: z.object({
      data: CreatedWebhookSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerCreateUrl(): string {
  return buildUrl('/webhooks');
}

const webhookControllerCreateOperation: OperationDefinition = {
  id: 'WebhookController_create',
  method: 'POST',
  path: '/webhooks',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: WebhookControllerCreateSchemas,
};

/** 建立訂閱；回應的 secret 只出現這一次 */
export function webhookControllerCreate(
  input: WebhookControllerCreateInput,
  options?: RequestOptions,
): Promise<WebhookControllerCreateResult> {
  return request<WebhookControllerCreateResult>(webhookControllerCreateOperation, input, options);
}

// GET /webhooks/events

export interface WebhookControllerListEventsResponses {
  200: {
    data: WebhookEventList;
  };
}

export type WebhookControllerListEventsResponse = WebhookControllerListEventsResponses[200];

export type WebhookControllerListEventsResult = ApiResponse<
  200,
  WebhookControllerListEventsResponses[200]
>;

export const WebhookControllerListEventsSchemas = {
  responses: {
    200: z.object({
      data: WebhookEventListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerListEventsUrl(): string {
  return buildUrl('/webhooks/events');
}

const webhookControllerListEventsOperation: OperationDefinition = {
  id: 'WebhookController_listEvents',
  method: 'GET',
  path: '/webhooks/events',
  responseTypes: { 200: 'json' },
  schemas: WebhookControllerListEventsSchemas,
};

/** 可以訂閱的對外事件（所屬 feature 已啟用） */
export function webhookControllerListEvents(
  options?: RequestOptions,
): Promise<WebhookControllerListEventsResult> {
  return request<WebhookControllerListEventsResult>(
    webhookControllerListEventsOperation,
    {},
    options,
  );
}

// GET /webhooks/{id}

export interface WebhookControllerFindOnePathParams {
  id: string;
}

export interface WebhookControllerFindOneInput {
  path: WebhookControllerFindOnePathParams;
}

export interface WebhookControllerFindOneResponses {
  200: {
    data: Webhook;
  };
}

export type WebhookControllerFindOneResponse = WebhookControllerFindOneResponses[200];

export type WebhookControllerFindOneResult = ApiResponse<
  200,
  WebhookControllerFindOneResponses[200]
>;

export const WebhookControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: WebhookSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerFindOneUrl(path: WebhookControllerFindOnePathParams): string {
  return buildUrl('/webhooks/{id}', path);
}

const webhookControllerFindOneOperation: OperationDefinition = {
  id: 'WebhookController_findOne',
  method: 'GET',
  path: '/webhooks/{id}',
  responseTypes: { 200: 'json' },
  schemas: WebhookControllerFindOneSchemas,
};

export function webhookControllerFindOne(
  input: WebhookControllerFindOneInput,
  options?: RequestOptions,
): Promise<WebhookControllerFindOneResult> {
  return request<WebhookControllerFindOneResult>(webhookControllerFindOneOperation, input, options);
}

// DELETE /webhooks/{id}

export interface WebhookControllerRemovePathParams {
  id: string;
}

export interface WebhookControllerRemoveInput {
  path: WebhookControllerRemovePathParams;
}

export interface WebhookControllerRemoveResponses {
  204: undefined;
}

export type WebhookControllerRemoveResponse = WebhookControllerRemoveResponses[204];

export type WebhookControllerRemoveResult = ApiResponse<204, WebhookControllerRemoveResponses[204]>;

export const WebhookControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getWebhookControllerRemoveUrl(path: WebhookControllerRemovePathParams): string {
  return buildUrl('/webhooks/{id}', path);
}

const webhookControllerRemoveOperation: OperationDefinition = {
  id: 'WebhookController_remove',
  method: 'DELETE',
  path: '/webhooks/{id}',
  responseTypes: { 204: 'none' },
  schemas: WebhookControllerRemoveSchemas,
};

/** 刪除；投遞紀錄一併刪除，不進回收桶 */
export function webhookControllerRemove(
  input: WebhookControllerRemoveInput,
  options?: RequestOptions,
): Promise<WebhookControllerRemoveResult> {
  return request<WebhookControllerRemoveResult>(webhookControllerRemoveOperation, input, options);
}

// PATCH /webhooks/{id}

export interface WebhookControllerUpdatePathParams {
  id: string;
}

export type WebhookControllerUpdateBody = UpdateWebhookRequest;

export interface WebhookControllerUpdateInput {
  path: WebhookControllerUpdatePathParams;
  body: WebhookControllerUpdateBody;
}

export interface WebhookControllerUpdateResponses {
  200: {
    data: Webhook;
  };
}

export type WebhookControllerUpdateResponse = WebhookControllerUpdateResponses[200];

export type WebhookControllerUpdateResult = ApiResponse<200, WebhookControllerUpdateResponses[200]>;

export const WebhookControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateWebhookRequestSchema,
  responses: {
    200: z.object({
      data: WebhookSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerUpdateUrl(path: WebhookControllerUpdatePathParams): string {
  return buildUrl('/webhooks/{id}', path);
}

const webhookControllerUpdateOperation: OperationDefinition = {
  id: 'WebhookController_update',
  method: 'PATCH',
  path: '/webhooks/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: WebhookControllerUpdateSchemas,
};

/** 修改名稱、網址、事件，停用或啟用（啟用時失敗次數歸零） */
export function webhookControllerUpdate(
  input: WebhookControllerUpdateInput,
  options?: RequestOptions,
): Promise<WebhookControllerUpdateResult> {
  return request<WebhookControllerUpdateResult>(webhookControllerUpdateOperation, input, options);
}

// POST /webhooks/{id}/rotate-secret

export interface WebhookControllerRotateSecretPathParams {
  id: string;
}

export interface WebhookControllerRotateSecretInput {
  path: WebhookControllerRotateSecretPathParams;
}

export interface WebhookControllerRotateSecretResponses {
  201: {
    data: WebhookSecret;
  };
}

export type WebhookControllerRotateSecretResponse = WebhookControllerRotateSecretResponses[201];

export type WebhookControllerRotateSecretResult = ApiResponse<
  201,
  WebhookControllerRotateSecretResponses[201]
>;

export const WebhookControllerRotateSecretSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    201: z.object({
      data: WebhookSecretSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerRotateSecretUrl(
  path: WebhookControllerRotateSecretPathParams,
): string {
  return buildUrl('/webhooks/{id}/rotate-secret', path);
}

const webhookControllerRotateSecretOperation: OperationDefinition = {
  id: 'WebhookController_rotateSecret',
  method: 'POST',
  path: '/webhooks/{id}/rotate-secret',
  responseTypes: { 201: 'json' },
  schemas: WebhookControllerRotateSecretSchemas,
};

/** 輪替密鑰：新的立即生效、舊的立即失效；新的 secret 只出現這一次 */
export function webhookControllerRotateSecret(
  input: WebhookControllerRotateSecretInput,
  options?: RequestOptions,
): Promise<WebhookControllerRotateSecretResult> {
  return request<WebhookControllerRotateSecretResult>(
    webhookControllerRotateSecretOperation,
    input,
    options,
  );
}

// POST /webhooks/{id}/test

export interface WebhookControllerSendTestPathParams {
  id: string;
}

export interface WebhookControllerSendTestInput {
  path: WebhookControllerSendTestPathParams;
}

export interface WebhookControllerSendTestResponses {
  201: {
    data: WebhookTestResult;
  };
}

export type WebhookControllerSendTestResponse = WebhookControllerSendTestResponses[201];

export type WebhookControllerSendTestResult = ApiResponse<
  201,
  WebhookControllerSendTestResponses[201]
>;

export const WebhookControllerSendTestSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    201: z.object({
      data: WebhookTestResultSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerSendTestUrl(path: WebhookControllerSendTestPathParams): string {
  return buildUrl('/webhooks/{id}/test', path);
}

const webhookControllerSendTestOperation: OperationDefinition = {
  id: 'WebhookController_sendTest',
  method: 'POST',
  path: '/webhooks/{id}/test',
  responseTypes: { 201: 'json' },
  schemas: WebhookControllerSendTestSchemas,
};

/** 同步送出 webhook.ping，回傳這一次的投遞紀錄 */
export function webhookControllerSendTest(
  input: WebhookControllerSendTestInput,
  options?: RequestOptions,
): Promise<WebhookControllerSendTestResult> {
  return request<WebhookControllerSendTestResult>(
    webhookControllerSendTestOperation,
    input,
    options,
  );
}

// GET /webhooks/{id}/deliveries

export interface WebhookControllerListDeliveriesPathParams {
  id: string;
}

export interface WebhookControllerListDeliveriesInput {
  path: WebhookControllerListDeliveriesPathParams;
}

export interface WebhookControllerListDeliveriesResponses {
  200: {
    data: {
      items: Array<WebhookDelivery>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type WebhookControllerListDeliveriesResponse = WebhookControllerListDeliveriesResponses[200];

export type WebhookControllerListDeliveriesResult = ApiResponse<
  200,
  WebhookControllerListDeliveriesResponses[200]
>;

export const WebhookControllerListDeliveriesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(WebhookDeliverySchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerListDeliveriesUrl(
  path: WebhookControllerListDeliveriesPathParams,
): string {
  return buildUrl('/webhooks/{id}/deliveries', path);
}

const webhookControllerListDeliveriesOperation: OperationDefinition = {
  id: 'WebhookController_listDeliveries',
  method: 'GET',
  path: '/webhooks/{id}/deliveries',
  responseTypes: { 200: 'json' },
  schemas: WebhookControllerListDeliveriesSchemas,
};

/** 投遞紀錄（每一次嘗試一筆，新的在前；保留 30 天） */
export function webhookControllerListDeliveries(
  input: WebhookControllerListDeliveriesInput,
  options?: RequestOptions,
): Promise<WebhookControllerListDeliveriesResult> {
  return request<WebhookControllerListDeliveriesResult>(
    webhookControllerListDeliveriesOperation,
    input,
    options,
  );
}

// POST /webhooks/{id}/deliveries/{deliveryId}/redeliver

export interface WebhookControllerRedeliverPathParams {
  id: string;
  deliveryId: string;
}

export interface WebhookControllerRedeliverInput {
  path: WebhookControllerRedeliverPathParams;
}

export interface WebhookControllerRedeliverResponses {
  201: {
    data: WebhookDelivery;
  };
}

export type WebhookControllerRedeliverResponse = WebhookControllerRedeliverResponses[201];

export type WebhookControllerRedeliverResult = ApiResponse<
  201,
  WebhookControllerRedeliverResponses[201]
>;

export const WebhookControllerRedeliverSchemas = {
  path: z.object({
    id: z.string(),
    deliveryId: z.string(),
  }),
  responses: {
    201: z.object({
      data: WebhookDeliverySchema,
    }),
  },
} satisfies OperationSchemas;

export function getWebhookControllerRedeliverUrl(
  path: WebhookControllerRedeliverPathParams,
): string {
  return buildUrl('/webhooks/{id}/deliveries/{deliveryId}/redeliver', path);
}

const webhookControllerRedeliverOperation: OperationDefinition = {
  id: 'WebhookController_redeliver',
  method: 'POST',
  path: '/webhooks/{id}/deliveries/{deliveryId}/redeliver',
  responseTypes: { 201: 'json' },
  schemas: WebhookControllerRedeliverSchemas,
};

/** 同步重送那一筆紀錄的事件（事件 id 不變），回傳這一次的投遞紀錄 */
export function webhookControllerRedeliver(
  input: WebhookControllerRedeliverInput,
  options?: RequestOptions,
): Promise<WebhookControllerRedeliverResult> {
  return request<WebhookControllerRedeliverResult>(
    webhookControllerRedeliverOperation,
    input,
    options,
  );
}
