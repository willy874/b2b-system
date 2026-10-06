// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { PlatformNotification, PlatformNotificationUnreadCount } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

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

export function getPlatformNotificationControllerListUrl(): string {
  return buildUrl('/platform/notifications');
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

export function getPlatformNotificationControllerUnreadCountUrl(): string {
  return buildUrl('/platform/notifications/unread-count');
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

export function getPlatformNotificationControllerMarkAllReadUrl(): string {
  return buildUrl('/platform/notifications/read-all');
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

export function getPlatformNotificationControllerMarkReadUrl(
  path: PlatformNotificationControllerMarkReadPathParams,
): string {
  return buildUrl('/platform/notifications/{id}/read', path);
}
