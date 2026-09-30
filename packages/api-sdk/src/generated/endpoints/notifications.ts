// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  Notification,
  NotificationPage,
  NotificationReadAllResult,
  NotificationUnreadCount,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  NotificationPageSchema,
  NotificationReadAllResultSchema,
  NotificationSchema,
  NotificationUnreadCountSchema,
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
