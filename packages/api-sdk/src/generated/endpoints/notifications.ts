// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  Notification,
  NotificationEventList,
  NotificationPage,
  NotificationPreferenceList,
  NotificationReadAllResult,
  NotificationUnreadCount,
  UpdateNotificationEventsRequest,
  UpdateNotificationPreferencesRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  NotificationEventListSchema,
  NotificationPageSchema,
  NotificationPreferenceListSchema,
  NotificationReadAllResultSchema,
  NotificationSchema,
  NotificationUnreadCountSchema,
  UpdateNotificationEventsRequestSchema,
  UpdateNotificationPreferencesRequestSchema,
} from '../schemas';

// GET /notifications

export interface NotificationControllerListResponses {
  200: {
    data: NotificationPage;
  };
}

export type NotificationControllerListResponse = NotificationControllerListResponses[200];

export type NotificationControllerListResult = ApiResponse<
  200,
  NotificationControllerListResponses[200]
>;

export const NotificationControllerListSchemas = {
  responses: {
    200: z.object({
      data: NotificationPageSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationControllerListUrl(): string {
  return buildUrl('/notifications');
}

const notificationControllerListOperation: OperationDefinition = {
  id: 'NotificationController_list',
  method: 'GET',
  path: '/notifications',
  responseTypes: { 200: 'json' },
  schemas: NotificationControllerListSchemas,
};

/** 自己的通知（新的在前，keyset 分頁；unread=true 只列未讀） */
export function notificationControllerList(
  options?: RequestOptions,
): Promise<NotificationControllerListResult> {
  return request<NotificationControllerListResult>(
    notificationControllerListOperation,
    {},
    options,
  );
}

// GET /notifications/unread-count

export interface NotificationControllerUnreadCountResponses {
  200: {
    data: NotificationUnreadCount;
  };
}

export type NotificationControllerUnreadCountResponse =
  NotificationControllerUnreadCountResponses[200];

export type NotificationControllerUnreadCountResult = ApiResponse<
  200,
  NotificationControllerUnreadCountResponses[200]
>;

export const NotificationControllerUnreadCountSchemas = {
  responses: {
    200: z.object({
      data: NotificationUnreadCountSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationControllerUnreadCountUrl(): string {
  return buildUrl('/notifications/unread-count');
}

const notificationControllerUnreadCountOperation: OperationDefinition = {
  id: 'NotificationController_unreadCount',
  method: 'GET',
  path: '/notifications/unread-count',
  responseTypes: { 200: 'json' },
  schemas: NotificationControllerUnreadCountSchemas,
};

/** 自己的未讀通知數 */
export function notificationControllerUnreadCount(
  options?: RequestOptions,
): Promise<NotificationControllerUnreadCountResult> {
  return request<NotificationControllerUnreadCountResult>(
    notificationControllerUnreadCountOperation,
    {},
    options,
  );
}

// POST /notifications/read-all

export interface NotificationControllerReadAllResponses {
  200: {
    data: NotificationReadAllResult;
  };
}

export type NotificationControllerReadAllResponse = NotificationControllerReadAllResponses[200];

export type NotificationControllerReadAllResult = ApiResponse<
  200,
  NotificationControllerReadAllResponses[200]
>;

export const NotificationControllerReadAllSchemas = {
  responses: {
    200: z.object({
      data: NotificationReadAllResultSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationControllerReadAllUrl(): string {
  return buildUrl('/notifications/read-all');
}

const notificationControllerReadAllOperation: OperationDefinition = {
  id: 'NotificationController_readAll',
  method: 'POST',
  path: '/notifications/read-all',
  responseTypes: { 200: 'json' },
  schemas: NotificationControllerReadAllSchemas,
};

/** 自己所有未讀的通知標為已讀 */
export function notificationControllerReadAll(
  options?: RequestOptions,
): Promise<NotificationControllerReadAllResult> {
  return request<NotificationControllerReadAllResult>(
    notificationControllerReadAllOperation,
    {},
    options,
  );
}

// POST /notifications/{id}/read

export interface NotificationControllerReadPathParams {
  id: string;
}

export interface NotificationControllerReadInput {
  path: NotificationControllerReadPathParams;
}

export interface NotificationControllerReadResponses {
  200: {
    data: Notification;
  };
}

export type NotificationControllerReadResponse = NotificationControllerReadResponses[200];

export type NotificationControllerReadResult = ApiResponse<
  200,
  NotificationControllerReadResponses[200]
>;

export const NotificationControllerReadSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: NotificationSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationControllerReadUrl(
  path: NotificationControllerReadPathParams,
): string {
  return buildUrl('/notifications/{id}/read', path);
}

const notificationControllerReadOperation: OperationDefinition = {
  id: 'NotificationController_read',
  method: 'POST',
  path: '/notifications/{id}/read',
  responseTypes: { 200: 'json' },
  schemas: NotificationControllerReadSchemas,
};

/** 一則通知標為已讀 */
export function notificationControllerRead(
  input: NotificationControllerReadInput,
  options?: RequestOptions,
): Promise<NotificationControllerReadResult> {
  return request<NotificationControllerReadResult>(
    notificationControllerReadOperation,
    input,
    options,
  );
}

// GET /notification-events

export interface NotificationEventControllerListResponses {
  200: {
    data: NotificationEventList;
  };
}

export type NotificationEventControllerListResponse = NotificationEventControllerListResponses[200];

export type NotificationEventControllerListResult = ApiResponse<
  200,
  NotificationEventControllerListResponses[200]
>;

export const NotificationEventControllerListSchemas = {
  responses: {
    200: z.object({
      data: NotificationEventListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationEventControllerListUrl(): string {
  return buildUrl('/notification-events');
}

const notificationEventControllerListOperation: OperationDefinition = {
  id: 'NotificationEventController_list',
  method: 'GET',
  path: '/notification-events',
  responseTypes: { 200: 'json' },
  schemas: NotificationEventControllerListSchemas,
};

/** 事件目錄與每個管道的生效值、預設值、是否覆寫 */
export function notificationEventControllerList(
  options?: RequestOptions,
): Promise<NotificationEventControllerListResult> {
  return request<NotificationEventControllerListResult>(
    notificationEventControllerListOperation,
    {},
    options,
  );
}

// PATCH /notification-events

export type NotificationEventControllerUpdateBody = UpdateNotificationEventsRequest;

export interface NotificationEventControllerUpdateInput {
  body: NotificationEventControllerUpdateBody;
}

export interface NotificationEventControllerUpdateResponses {
  200: {
    data: NotificationEventList;
  };
}

export type NotificationEventControllerUpdateResponse =
  NotificationEventControllerUpdateResponses[200];

export type NotificationEventControllerUpdateResult = ApiResponse<
  200,
  NotificationEventControllerUpdateResponses[200]
>;

export const NotificationEventControllerUpdateSchemas = {
  body: UpdateNotificationEventsRequestSchema,
  responses: {
    200: z.object({
      data: NotificationEventListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationEventControllerUpdateUrl(): string {
  return buildUrl('/notification-events');
}

const notificationEventControllerUpdateOperation: OperationDefinition = {
  id: 'NotificationEventController_update',
  method: 'PATCH',
  path: '/notification-events',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: NotificationEventControllerUpdateSchemas,
};

/** 開關事件的管道；enabled 為 null 代表還原預設 */
export function notificationEventControllerUpdate(
  input: NotificationEventControllerUpdateInput,
  options?: RequestOptions,
): Promise<NotificationEventControllerUpdateResult> {
  return request<NotificationEventControllerUpdateResult>(
    notificationEventControllerUpdateOperation,
    input,
    options,
  );
}

// GET /me/notification-preferences

export interface NotificationPreferenceControllerListResponses {
  200: {
    data: NotificationPreferenceList;
  };
}

export type NotificationPreferenceControllerListResponse =
  NotificationPreferenceControllerListResponses[200];

export type NotificationPreferenceControllerListResult = ApiResponse<
  200,
  NotificationPreferenceControllerListResponses[200]
>;

export const NotificationPreferenceControllerListSchemas = {
  responses: {
    200: z.object({
      data: NotificationPreferenceListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationPreferenceControllerListUrl(): string {
  return buildUrl('/me/notification-preferences');
}

const notificationPreferenceControllerListOperation: OperationDefinition = {
  id: 'NotificationPreferenceController_list',
  method: 'GET',
  path: '/me/notification-preferences',
  responseTypes: { 200: 'json' },
  schemas: NotificationPreferenceControllerListSchemas,
};

/** 自己的通知設定：每個事件與管道的生效值、能不能調整 */
export function notificationPreferenceControllerList(
  options?: RequestOptions,
): Promise<NotificationPreferenceControllerListResult> {
  return request<NotificationPreferenceControllerListResult>(
    notificationPreferenceControllerListOperation,
    {},
    options,
  );
}

// PATCH /me/notification-preferences

export type NotificationPreferenceControllerUpdateBody = UpdateNotificationPreferencesRequest;

export interface NotificationPreferenceControllerUpdateInput {
  body: NotificationPreferenceControllerUpdateBody;
}

export interface NotificationPreferenceControllerUpdateResponses {
  200: {
    data: NotificationPreferenceList;
  };
}

export type NotificationPreferenceControllerUpdateResponse =
  NotificationPreferenceControllerUpdateResponses[200];

export type NotificationPreferenceControllerUpdateResult = ApiResponse<
  200,
  NotificationPreferenceControllerUpdateResponses[200]
>;

export const NotificationPreferenceControllerUpdateSchemas = {
  body: UpdateNotificationPreferencesRequestSchema,
  responses: {
    200: z.object({
      data: NotificationPreferenceListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getNotificationPreferenceControllerUpdateUrl(): string {
  return buildUrl('/me/notification-preferences');
}

const notificationPreferenceControllerUpdateOperation: OperationDefinition = {
  id: 'NotificationPreferenceController_update',
  method: 'PATCH',
  path: '/me/notification-preferences',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: NotificationPreferenceControllerUpdateSchemas,
};

/** 開關自己的通知；enabled 為 null 代表跟著租戶 */
export function notificationPreferenceControllerUpdate(
  input: NotificationPreferenceControllerUpdateInput,
  options?: RequestOptions,
): Promise<NotificationPreferenceControllerUpdateResult> {
  return request<NotificationPreferenceControllerUpdateResult>(
    notificationPreferenceControllerUpdateOperation,
    input,
    options,
  );
}
