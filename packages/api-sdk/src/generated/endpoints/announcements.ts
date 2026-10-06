// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  Announcement,
  AnnouncementActionRequest,
  AnnouncementAudience,
  AnnouncementAudiencePreview,
  AnnouncementDispatch,
  AnnouncementMessage,
  AnnouncementRecurrencePreview,
  AnnouncementRecurrencePreviewRequest,
  AnnouncementTriggerEventList,
  CreateAnnouncementRequest,
  UpdateAnnouncementRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /announcements

export interface AnnouncementControllerListResponses {
  200: {
    data: {
      items: Array<Announcement>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type AnnouncementControllerListResponse = AnnouncementControllerListResponses[200];

export type AnnouncementControllerListResult = ApiResponse<
  200,
  AnnouncementControllerListResponses[200]
>;

export function getAnnouncementControllerListUrl(): string {
  return buildUrl('/announcements');
}

// POST /announcements

export type AnnouncementControllerCreateBody = CreateAnnouncementRequest;

export interface AnnouncementControllerCreateInput {
  body: AnnouncementControllerCreateBody;
}

export interface AnnouncementControllerCreateResponses {
  201: {
    data: Announcement;
  };
}

export type AnnouncementControllerCreateResponse = AnnouncementControllerCreateResponses[201];

export type AnnouncementControllerCreateResult = ApiResponse<
  201,
  AnnouncementControllerCreateResponses[201]
>;

export function getAnnouncementControllerCreateUrl(): string {
  return buildUrl('/announcements');
}

// POST /announcements/audience-preview

export type AnnouncementControllerPreviewAudienceBody = AnnouncementAudience;

export interface AnnouncementControllerPreviewAudienceInput {
  body: AnnouncementControllerPreviewAudienceBody;
}

export interface AnnouncementControllerPreviewAudienceResponses {
  200: {
    data: AnnouncementAudiencePreview;
  };
}

export type AnnouncementControllerPreviewAudienceResponse =
  AnnouncementControllerPreviewAudienceResponses[200];

export type AnnouncementControllerPreviewAudienceResult = ApiResponse<
  200,
  AnnouncementControllerPreviewAudienceResponses[200]
>;

export function getAnnouncementControllerPreviewAudienceUrl(): string {
  return buildUrl('/announcements/audience-preview');
}

// GET /announcements/trigger-events

export interface AnnouncementControllerListTriggerEventsResponses {
  200: {
    data: AnnouncementTriggerEventList;
  };
}

export type AnnouncementControllerListTriggerEventsResponse =
  AnnouncementControllerListTriggerEventsResponses[200];

export type AnnouncementControllerListTriggerEventsResult = ApiResponse<
  200,
  AnnouncementControllerListTriggerEventsResponses[200]
>;

export function getAnnouncementControllerListTriggerEventsUrl(): string {
  return buildUrl('/announcements/trigger-events');
}

// POST /announcements/recurrence-preview

export type AnnouncementControllerPreviewRecurrenceBody = AnnouncementRecurrencePreviewRequest;

export interface AnnouncementControllerPreviewRecurrenceInput {
  body: AnnouncementControllerPreviewRecurrenceBody;
}

export interface AnnouncementControllerPreviewRecurrenceResponses {
  200: {
    data: AnnouncementRecurrencePreview;
  };
}

export type AnnouncementControllerPreviewRecurrenceResponse =
  AnnouncementControllerPreviewRecurrenceResponses[200];

export type AnnouncementControllerPreviewRecurrenceResult = ApiResponse<
  200,
  AnnouncementControllerPreviewRecurrenceResponses[200]
>;

export function getAnnouncementControllerPreviewRecurrenceUrl(): string {
  return buildUrl('/announcements/recurrence-preview');
}

// GET /announcements/{id}

export interface AnnouncementControllerFindOnePathParams {
  id: string;
}

export interface AnnouncementControllerFindOneInput {
  path: AnnouncementControllerFindOnePathParams;
}

export interface AnnouncementControllerFindOneResponses {
  200: {
    data: Announcement;
  };
}

export type AnnouncementControllerFindOneResponse = AnnouncementControllerFindOneResponses[200];

export type AnnouncementControllerFindOneResult = ApiResponse<
  200,
  AnnouncementControllerFindOneResponses[200]
>;

export function getAnnouncementControllerFindOneUrl(
  path: AnnouncementControllerFindOnePathParams,
): string {
  return buildUrl('/announcements/{id}', path);
}

// DELETE /announcements/{id}

export interface AnnouncementControllerRemovePathParams {
  id: string;
}

export interface AnnouncementControllerRemoveInput {
  path: AnnouncementControllerRemovePathParams;
}

export interface AnnouncementControllerRemoveResponses {
  204: undefined;
}

export type AnnouncementControllerRemoveResponse = AnnouncementControllerRemoveResponses[204];

export type AnnouncementControllerRemoveResult = ApiResponse<
  204,
  AnnouncementControllerRemoveResponses[204]
>;

export function getAnnouncementControllerRemoveUrl(
  path: AnnouncementControllerRemovePathParams,
): string {
  return buildUrl('/announcements/{id}', path);
}

// PATCH /announcements/{id}

export interface AnnouncementControllerUpdatePathParams {
  id: string;
}

export type AnnouncementControllerUpdateBody = UpdateAnnouncementRequest;

export interface AnnouncementControllerUpdateInput {
  path: AnnouncementControllerUpdatePathParams;
  body: AnnouncementControllerUpdateBody;
}

export interface AnnouncementControllerUpdateResponses {
  200: {
    data: Announcement;
  };
}

export type AnnouncementControllerUpdateResponse = AnnouncementControllerUpdateResponses[200];

export type AnnouncementControllerUpdateResult = ApiResponse<
  200,
  AnnouncementControllerUpdateResponses[200]
>;

export function getAnnouncementControllerUpdateUrl(
  path: AnnouncementControllerUpdatePathParams,
): string {
  return buildUrl('/announcements/{id}', path);
}

// POST /announcements/{id}/restore

export interface AnnouncementControllerRestorePathParams {
  id: string;
}

export interface AnnouncementControllerRestoreInput {
  path: AnnouncementControllerRestorePathParams;
}

export interface AnnouncementControllerRestoreResponses {
  200: {
    data: Announcement;
  };
}

export type AnnouncementControllerRestoreResponse = AnnouncementControllerRestoreResponses[200];

export type AnnouncementControllerRestoreResult = ApiResponse<
  200,
  AnnouncementControllerRestoreResponses[200]
>;

export function getAnnouncementControllerRestoreUrl(
  path: AnnouncementControllerRestorePathParams,
): string {
  return buildUrl('/announcements/{id}/restore', path);
}

// POST /announcements/{id}/publish

export interface AnnouncementControllerPublishPathParams {
  id: string;
}

export type AnnouncementControllerPublishBody = AnnouncementActionRequest;

export interface AnnouncementControllerPublishInput {
  path: AnnouncementControllerPublishPathParams;
  body: AnnouncementControllerPublishBody;
}

export interface AnnouncementControllerPublishResponses {
  200: {
    data: Announcement;
  };
}

export type AnnouncementControllerPublishResponse = AnnouncementControllerPublishResponses[200];

export type AnnouncementControllerPublishResult = ApiResponse<
  200,
  AnnouncementControllerPublishResponses[200]
>;

export function getAnnouncementControllerPublishUrl(
  path: AnnouncementControllerPublishPathParams,
): string {
  return buildUrl('/announcements/{id}/publish', path);
}

// POST /announcements/{id}/pause

export interface AnnouncementControllerPausePathParams {
  id: string;
}

export type AnnouncementControllerPauseBody = AnnouncementActionRequest;

export interface AnnouncementControllerPauseInput {
  path: AnnouncementControllerPausePathParams;
  body: AnnouncementControllerPauseBody;
}

export interface AnnouncementControllerPauseResponses {
  200: {
    data: Announcement;
  };
}

export type AnnouncementControllerPauseResponse = AnnouncementControllerPauseResponses[200];

export type AnnouncementControllerPauseResult = ApiResponse<
  200,
  AnnouncementControllerPauseResponses[200]
>;

export function getAnnouncementControllerPauseUrl(
  path: AnnouncementControllerPausePathParams,
): string {
  return buildUrl('/announcements/{id}/pause', path);
}

// POST /announcements/{id}/resume

export interface AnnouncementControllerResumePathParams {
  id: string;
}

export type AnnouncementControllerResumeBody = AnnouncementActionRequest;

export interface AnnouncementControllerResumeInput {
  path: AnnouncementControllerResumePathParams;
  body: AnnouncementControllerResumeBody;
}

export interface AnnouncementControllerResumeResponses {
  200: {
    data: Announcement;
  };
}

export type AnnouncementControllerResumeResponse = AnnouncementControllerResumeResponses[200];

export type AnnouncementControllerResumeResult = ApiResponse<
  200,
  AnnouncementControllerResumeResponses[200]
>;

export function getAnnouncementControllerResumeUrl(
  path: AnnouncementControllerResumePathParams,
): string {
  return buildUrl('/announcements/{id}/resume', path);
}

// GET /announcements/{id}/dispatches

export interface AnnouncementControllerListDispatchesPathParams {
  id: string;
}

export interface AnnouncementControllerListDispatchesInput {
  path: AnnouncementControllerListDispatchesPathParams;
}

export interface AnnouncementControllerListDispatchesResponses {
  200: {
    data: {
      items: Array<AnnouncementDispatch>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type AnnouncementControllerListDispatchesResponse =
  AnnouncementControllerListDispatchesResponses[200];

export type AnnouncementControllerListDispatchesResult = ApiResponse<
  200,
  AnnouncementControllerListDispatchesResponses[200]
>;

export function getAnnouncementControllerListDispatchesUrl(
  path: AnnouncementControllerListDispatchesPathParams,
): string {
  return buildUrl('/announcements/{id}/dispatches', path);
}

// POST /announcements/{id}/dispatches/{dispatchId}/revoke

export interface AnnouncementControllerRevokePathParams {
  id: string;
  dispatchId: string;
}

export interface AnnouncementControllerRevokeInput {
  path: AnnouncementControllerRevokePathParams;
}

export interface AnnouncementControllerRevokeResponses {
  200: {
    data: AnnouncementDispatch;
  };
}

export type AnnouncementControllerRevokeResponse = AnnouncementControllerRevokeResponses[200];

export type AnnouncementControllerRevokeResult = ApiResponse<
  200,
  AnnouncementControllerRevokeResponses[200]
>;

export function getAnnouncementControllerRevokeUrl(
  path: AnnouncementControllerRevokePathParams,
): string {
  return buildUrl('/announcements/{id}/dispatches/{dispatchId}/revoke', path);
}

// GET /me/announcement-messages/{dispatchId}

export interface AnnouncementMessageControllerReadPathParams {
  dispatchId: string;
}

export interface AnnouncementMessageControllerReadInput {
  path: AnnouncementMessageControllerReadPathParams;
}

export interface AnnouncementMessageControllerReadResponses {
  200: {
    data: AnnouncementMessage;
  };
}

export type AnnouncementMessageControllerReadResponse =
  AnnouncementMessageControllerReadResponses[200];

export type AnnouncementMessageControllerReadResult = ApiResponse<
  200,
  AnnouncementMessageControllerReadResponses[200]
>;

export function getAnnouncementMessageControllerReadUrl(
  path: AnnouncementMessageControllerReadPathParams,
): string {
  return buildUrl('/me/announcement-messages/{dispatchId}', path);
}
