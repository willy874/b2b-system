// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformNotificationControllerListResult,
  PlatformNotificationControllerMarkAllReadResult,
  PlatformNotificationControllerMarkReadInput,
  PlatformNotificationControllerMarkReadResult,
  PlatformNotificationControllerUnreadCountResult,
} from '../../endpoints/platform-notifications';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { PlatformNotificationSchema, PlatformNotificationUnreadCountSchema } from '../components';

// GET /platform/notifications

export const PlatformNotificationControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(PlatformNotificationSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const platformNotificationControllerListOperation: OperationDefinition = {
  id: 'PlatformNotificationController_list',
  method: 'GET',
  path: '/platform/notifications',
  responseTypes: { 200: 'json' },
  schemas: PlatformNotificationControllerListSchemas,
};

/** 自己的通知（新的在前）；`unread=true` 只列未讀 */
export function platformNotificationControllerList(
  options?: RequestOptions,
): Promise<PlatformNotificationControllerListResult> {
  return request<PlatformNotificationControllerListResult>(
    platformNotificationControllerListOperation,
    {},
    options,
  );
}

// GET /platform/notifications/unread-count

export const PlatformNotificationControllerUnreadCountSchemas = {
  responses: {
    200: z.object({
      data: PlatformNotificationUnreadCountSchema,
    }),
  },
} satisfies OperationSchemas;

const platformNotificationControllerUnreadCountOperation: OperationDefinition = {
  id: 'PlatformNotificationController_unreadCount',
  method: 'GET',
  path: '/platform/notifications/unread-count',
  responseTypes: { 200: 'json' },
  schemas: PlatformNotificationControllerUnreadCountSchemas,
};

/** 自己的未讀數（頂列的徽章） */
export function platformNotificationControllerUnreadCount(
  options?: RequestOptions,
): Promise<PlatformNotificationControllerUnreadCountResult> {
  return request<PlatformNotificationControllerUnreadCountResult>(
    platformNotificationControllerUnreadCountOperation,
    {},
    options,
  );
}

// POST /platform/notifications/read-all

export const PlatformNotificationControllerMarkAllReadSchemas = {} satisfies OperationSchemas;

const platformNotificationControllerMarkAllReadOperation: OperationDefinition = {
  id: 'PlatformNotificationController_markAllRead',
  method: 'POST',
  path: '/platform/notifications/read-all',
  responseTypes: { 200: 'none' },
  schemas: PlatformNotificationControllerMarkAllReadSchemas,
};

/** 自己的通知全部標為已讀 */
export function platformNotificationControllerMarkAllRead(
  options?: RequestOptions,
): Promise<PlatformNotificationControllerMarkAllReadResult> {
  return request<PlatformNotificationControllerMarkAllReadResult>(
    platformNotificationControllerMarkAllReadOperation,
    {},
    options,
  );
}

// POST /platform/notifications/{id}/read

export const PlatformNotificationControllerMarkReadSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const platformNotificationControllerMarkReadOperation: OperationDefinition = {
  id: 'PlatformNotificationController_markRead',
  method: 'POST',
  path: '/platform/notifications/{id}/read',
  responseTypes: { 200: 'none' },
  schemas: PlatformNotificationControllerMarkReadSchemas,
};

/** 標為已讀（已讀過的再標一次不算錯） */
export function platformNotificationControllerMarkRead(
  input: PlatformNotificationControllerMarkReadInput,
  options?: RequestOptions,
): Promise<PlatformNotificationControllerMarkReadResult> {
  return request<PlatformNotificationControllerMarkReadResult>(
    platformNotificationControllerMarkReadOperation,
    input,
    options,
  );
}
