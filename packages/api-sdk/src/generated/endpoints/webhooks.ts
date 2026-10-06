// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

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
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

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

export function getWebhookControllerListUrl(): string {
  return buildUrl('/webhooks');
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

export function getWebhookControllerCreateUrl(): string {
  return buildUrl('/webhooks');
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

export function getWebhookControllerListEventsUrl(): string {
  return buildUrl('/webhooks/events');
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

export function getWebhookControllerFindOneUrl(path: WebhookControllerFindOnePathParams): string {
  return buildUrl('/webhooks/{id}', path);
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

export function getWebhookControllerRemoveUrl(path: WebhookControllerRemovePathParams): string {
  return buildUrl('/webhooks/{id}', path);
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

export function getWebhookControllerUpdateUrl(path: WebhookControllerUpdatePathParams): string {
  return buildUrl('/webhooks/{id}', path);
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

export function getWebhookControllerRotateSecretUrl(
  path: WebhookControllerRotateSecretPathParams,
): string {
  return buildUrl('/webhooks/{id}/rotate-secret', path);
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

export function getWebhookControllerSendTestUrl(path: WebhookControllerSendTestPathParams): string {
  return buildUrl('/webhooks/{id}/test', path);
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

export function getWebhookControllerListDeliveriesUrl(
  path: WebhookControllerListDeliveriesPathParams,
): string {
  return buildUrl('/webhooks/{id}/deliveries', path);
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

export function getWebhookControllerRedeliverUrl(
  path: WebhookControllerRedeliverPathParams,
): string {
  return buildUrl('/webhooks/{id}/deliveries/{deliveryId}/redeliver', path);
}
