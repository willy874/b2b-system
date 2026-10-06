// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  WebhookControllerCreateInput,
  WebhookControllerCreateResult,
  WebhookControllerFindOneInput,
  WebhookControllerFindOneResult,
  WebhookControllerListDeliveriesInput,
  WebhookControllerListDeliveriesResult,
  WebhookControllerListEventsResult,
  WebhookControllerListResult,
  WebhookControllerRedeliverInput,
  WebhookControllerRedeliverResult,
  WebhookControllerRemoveInput,
  WebhookControllerRemoveResult,
  WebhookControllerRotateSecretInput,
  WebhookControllerRotateSecretResult,
  WebhookControllerSendTestInput,
  WebhookControllerSendTestResult,
  WebhookControllerUpdateInput,
  WebhookControllerUpdateResult,
} from '../../endpoints/webhooks';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateWebhookRequestSchema,
  CreatedWebhookSchema,
  UpdateWebhookRequestSchema,
  WebhookDeliverySchema,
  WebhookEventListSchema,
  WebhookSchema,
  WebhookSecretSchema,
  WebhookTestResultSchema,
} from '../components';

// GET /webhooks

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

export const WebhookControllerCreateSchemas = {
  body: CreateWebhookRequestSchema,
  responses: {
    201: z.object({
      data: CreatedWebhookSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const WebhookControllerListEventsSchemas = {
  responses: {
    200: z.object({
      data: WebhookEventListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const WebhookControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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
