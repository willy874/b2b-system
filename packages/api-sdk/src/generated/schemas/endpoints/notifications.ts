// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  NotificationControllerListResult,
  NotificationControllerReadAllResult,
  NotificationControllerReadInput,
  NotificationControllerReadResult,
  NotificationControllerRemoveInput,
  NotificationControllerRemoveResult,
  NotificationControllerUnreadCountResult,
  NotificationEventControllerListResult,
  NotificationEventControllerUpdateInput,
  NotificationEventControllerUpdateResult,
  NotificationOverviewControllerListAllResult,
  NotificationPreferenceControllerListResult,
  NotificationPreferenceControllerUpdateInput,
  NotificationPreferenceControllerUpdateResult,
} from '../../endpoints/notifications';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  NotificationEventListSchema,
  NotificationOverviewPageSchema,
  NotificationPageSchema,
  NotificationPreferenceListSchema,
  NotificationReadAllResultSchema,
  NotificationSchema,
  NotificationUnreadCountSchema,
  UpdateNotificationEventsRequestSchema,
  UpdateNotificationPreferencesRequestSchema,
} from '../components';

// GET /notifications

export const NotificationControllerListSchemas = {
  responses: {
    200: z.object({
      data: NotificationPageSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const NotificationControllerUnreadCountSchemas = {
  responses: {
    200: z.object({
      data: NotificationUnreadCountSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const NotificationControllerReadAllSchemas = {
  responses: {
    200: z.object({
      data: NotificationReadAllResultSchema,
    }),
  },
} satisfies OperationSchemas;

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

// DELETE /notifications/{id}

export const NotificationControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const notificationControllerRemoveOperation: OperationDefinition = {
  id: 'NotificationController_remove',
  method: 'DELETE',
  path: '/notifications/{id}',
  responseTypes: { 204: 'none' },
  schemas: NotificationControllerRemoveSchemas,
};

/** 刪除一則自己的通知 */
export function notificationControllerRemove(
  input: NotificationControllerRemoveInput,
  options?: RequestOptions,
): Promise<NotificationControllerRemoveResult> {
  return request<NotificationControllerRemoveResult>(
    notificationControllerRemoveOperation,
    input,
    options,
  );
}

// GET /notifications/all

export const NotificationOverviewControllerListAllSchemas = {
  responses: {
    200: z.object({
      data: NotificationOverviewPageSchema,
    }),
  },
} satisfies OperationSchemas;

const notificationOverviewControllerListAllOperation: OperationDefinition = {
  id: 'NotificationOverviewController_listAll',
  method: 'GET',
  path: '/notifications/all',
  responseTypes: { 200: 'json' },
  schemas: NotificationOverviewControllerListAllSchemas,
};

/** 租戶內所有人的通知（新的在前，keyset 分頁；可依類型、收件人、觸發者、時間篩選） */
export function notificationOverviewControllerListAll(
  options?: RequestOptions,
): Promise<NotificationOverviewControllerListAllResult> {
  return request<NotificationOverviewControllerListAllResult>(
    notificationOverviewControllerListAllOperation,
    {},
    options,
  );
}

// GET /notification-events

export const NotificationEventControllerListSchemas = {
  responses: {
    200: z.object({
      data: NotificationEventListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const NotificationEventControllerUpdateSchemas = {
  body: UpdateNotificationEventsRequestSchema,
  responses: {
    200: z.object({
      data: NotificationEventListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const NotificationPreferenceControllerListSchemas = {
  responses: {
    200: z.object({
      data: NotificationPreferenceListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const NotificationPreferenceControllerUpdateSchemas = {
  body: UpdateNotificationPreferencesRequestSchema,
  responses: {
    200: z.object({
      data: NotificationPreferenceListSchema,
    }),
  },
} satisfies OperationSchemas;

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
