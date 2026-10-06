// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  Notification,
  NotificationEventList,
  NotificationOverviewPage,
  NotificationPage,
  NotificationPreferenceList,
  NotificationReadAllResult,
  NotificationUnreadCount,
  UpdateNotificationEventsRequest,
  UpdateNotificationPreferencesRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

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

export function getNotificationControllerListUrl(): string {
  return buildUrl('/notifications');
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

export function getNotificationControllerUnreadCountUrl(): string {
  return buildUrl('/notifications/unread-count');
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

export function getNotificationControllerReadAllUrl(): string {
  return buildUrl('/notifications/read-all');
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

export function getNotificationControllerReadUrl(
  path: NotificationControllerReadPathParams,
): string {
  return buildUrl('/notifications/{id}/read', path);
}

// GET /notifications/all

export interface NotificationOverviewControllerListAllResponses {
  200: {
    data: NotificationOverviewPage;
  };
}

export type NotificationOverviewControllerListAllResponse =
  NotificationOverviewControllerListAllResponses[200];

export type NotificationOverviewControllerListAllResult = ApiResponse<
  200,
  NotificationOverviewControllerListAllResponses[200]
>;

export function getNotificationOverviewControllerListAllUrl(): string {
  return buildUrl('/notifications/all');
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

export function getNotificationEventControllerListUrl(): string {
  return buildUrl('/notification-events');
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

export function getNotificationEventControllerUpdateUrl(): string {
  return buildUrl('/notification-events');
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

export function getNotificationPreferenceControllerListUrl(): string {
  return buildUrl('/me/notification-preferences');
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

export function getNotificationPreferenceControllerUpdateUrl(): string {
  return buildUrl('/me/notification-preferences');
}
