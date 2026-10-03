// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { PlatformNotification, PlatformNotificationUnreadCount } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import { PlatformNotificationSchema, PlatformNotificationUnreadCountSchema } from '../schemas';

// GET /platform/notifications

export interface PlatformNotificationControllerListResponses {
  200: {
    data: {
      items: Array<PlatformNotification>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type PlatformNotificationControllerListResponse =
  PlatformNotificationControllerListResponses[200];

export type PlatformNotificationControllerListResult = ApiResponse<
  200,
  PlatformNotificationControllerListResponses[200]
>;

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

export function getPlatformNotificationControllerListUrl(): string {
  return buildUrl('/platform/notifications');
}

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

export interface PlatformNotificationControllerUnreadCountResponses {
  200: {
    data: PlatformNotificationUnreadCount;
  };
}

export type PlatformNotificationControllerUnreadCountResponse =
  PlatformNotificationControllerUnreadCountResponses[200];

export type PlatformNotificationControllerUnreadCountResult = ApiResponse<
  200,
  PlatformNotificationControllerUnreadCountResponses[200]
>;

export const PlatformNotificationControllerUnreadCountSchemas = {
  responses: {
    200: z.object({
      data: PlatformNotificationUnreadCountSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformNotificationControllerUnreadCountUrl(): string {
  return buildUrl('/platform/notifications/unread-count');
}

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

export interface PlatformNotificationControllerMarkAllReadResponses {
  200: undefined;
}

export type PlatformNotificationControllerMarkAllReadResponse =
  PlatformNotificationControllerMarkAllReadResponses[200];

export type PlatformNotificationControllerMarkAllReadResult = ApiResponse<
  200,
  PlatformNotificationControllerMarkAllReadResponses[200]
>;

export const PlatformNotificationControllerMarkAllReadSchemas = {} satisfies OperationSchemas;

export function getPlatformNotificationControllerMarkAllReadUrl(): string {
  return buildUrl('/platform/notifications/read-all');
}

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

export interface PlatformNotificationControllerMarkReadPathParams {
  id: string;
}

export interface PlatformNotificationControllerMarkReadInput {
  path: PlatformNotificationControllerMarkReadPathParams;
}

export interface PlatformNotificationControllerMarkReadResponses {
  200: undefined;
}

export type PlatformNotificationControllerMarkReadResponse =
  PlatformNotificationControllerMarkReadResponses[200];

export type PlatformNotificationControllerMarkReadResult = ApiResponse<
  200,
  PlatformNotificationControllerMarkReadResponses[200]
>;

export const PlatformNotificationControllerMarkReadSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getPlatformNotificationControllerMarkReadUrl(
  path: PlatformNotificationControllerMarkReadPathParams,
): string {
  return buildUrl('/platform/notifications/{id}/read', path);
}

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
