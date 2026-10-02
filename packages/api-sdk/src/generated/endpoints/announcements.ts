// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  Announcement,
  AnnouncementActionRequest,
  AnnouncementAudience,
  AnnouncementAudiencePreview,
  AnnouncementDispatch,
  AnnouncementMessage,
  CreateAnnouncementRequest,
  UpdateAnnouncementRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  AnnouncementActionRequestSchema,
  AnnouncementAudiencePreviewSchema,
  AnnouncementAudienceSchema,
  AnnouncementDispatchSchema,
  AnnouncementMessageSchema,
  AnnouncementSchema,
  CreateAnnouncementRequestSchema,
  UpdateAnnouncementRequestSchema,
} from '../schemas';

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

export const AnnouncementControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(AnnouncementSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerListUrl(): string {
  return buildUrl('/announcements');
}

const announcementControllerListOperation: OperationDefinition = {
  id: 'AnnouncementController_list',
  method: 'GET',
  path: '/announcements',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerListSchemas,
};

export function announcementControllerList(
  options?: RequestOptions,
): Promise<AnnouncementControllerListResult> {
  return request<AnnouncementControllerListResult>(
    announcementControllerListOperation,
    {},
    options,
  );
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

export const AnnouncementControllerCreateSchemas = {
  body: CreateAnnouncementRequestSchema,
  responses: {
    201: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerCreateUrl(): string {
  return buildUrl('/announcements');
}

const announcementControllerCreateOperation: OperationDefinition = {
  id: 'AnnouncementController_create',
  method: 'POST',
  path: '/announcements',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: AnnouncementControllerCreateSchemas,
};

/** 建立草稿 */
export function announcementControllerCreate(
  input: AnnouncementControllerCreateInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerCreateResult> {
  return request<AnnouncementControllerCreateResult>(
    announcementControllerCreateOperation,
    input,
    options,
  );
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

export const AnnouncementControllerPreviewAudienceSchemas = {
  body: AnnouncementAudienceSchema,
  responses: {
    200: z.object({
      data: AnnouncementAudiencePreviewSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerPreviewAudienceUrl(): string {
  return buildUrl('/announcements/audience-preview');
}

const announcementControllerPreviewAudienceOperation: OperationDefinition = {
  id: 'AnnouncementController_previewAudience',
  method: 'POST',
  path: '/announcements/audience-preview',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerPreviewAudienceSchemas,
};

/** 受眾現在會解析成幾個人（不回名單） */
export function announcementControllerPreviewAudience(
  input: AnnouncementControllerPreviewAudienceInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerPreviewAudienceResult> {
  return request<AnnouncementControllerPreviewAudienceResult>(
    announcementControllerPreviewAudienceOperation,
    input,
    options,
  );
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

export const AnnouncementControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerFindOneUrl(
  path: AnnouncementControllerFindOnePathParams,
): string {
  return buildUrl('/announcements/{id}', path);
}

const announcementControllerFindOneOperation: OperationDefinition = {
  id: 'AnnouncementController_findOne',
  method: 'GET',
  path: '/announcements/{id}',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerFindOneSchemas,
};

export function announcementControllerFindOne(
  input: AnnouncementControllerFindOneInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerFindOneResult> {
  return request<AnnouncementControllerFindOneResult>(
    announcementControllerFindOneOperation,
    input,
    options,
  );
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

export const AnnouncementControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getAnnouncementControllerRemoveUrl(
  path: AnnouncementControllerRemovePathParams,
): string {
  return buildUrl('/announcements/{id}', path);
}

const announcementControllerRemoveOperation: OperationDefinition = {
  id: 'AnnouncementController_remove',
  method: 'DELETE',
  path: '/announcements/{id}',
  responseTypes: { 204: 'none' },
  schemas: AnnouncementControllerRemoveSchemas,
};

/** 刪除（進回收桶）；排程中的改成暫停 */
export function announcementControllerRemove(
  input: AnnouncementControllerRemoveInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerRemoveResult> {
  return request<AnnouncementControllerRemoveResult>(
    announcementControllerRemoveOperation,
    input,
    options,
  );
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

export const AnnouncementControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateAnnouncementRequestSchema,
  responses: {
    200: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerUpdateUrl(
  path: AnnouncementControllerUpdatePathParams,
): string {
  return buildUrl('/announcements/{id}', path);
}

const announcementControllerUpdateOperation: OperationDefinition = {
  id: 'AnnouncementController_update',
  method: 'PATCH',
  path: '/announcements/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerUpdateSchemas,
};

/** 修改標題、內文、受眾、時間；只影響之後的發送 */
export function announcementControllerUpdate(
  input: AnnouncementControllerUpdateInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerUpdateResult> {
  return request<AnnouncementControllerUpdateResult>(
    announcementControllerUpdateOperation,
    input,
    options,
  );
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

export const AnnouncementControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerRestoreUrl(
  path: AnnouncementControllerRestorePathParams,
): string {
  return buildUrl('/announcements/{id}/restore', path);
}

const announcementControllerRestoreOperation: OperationDefinition = {
  id: 'AnnouncementController_restore',
  method: 'POST',
  path: '/announcements/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerRestoreSchemas,
};

/** 還原刪除的公告（排程中的會是暫停，不會自己開始發） */
export function announcementControllerRestore(
  input: AnnouncementControllerRestoreInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerRestoreResult> {
  return request<AnnouncementControllerRestoreResult>(
    announcementControllerRestoreOperation,
    input,
    options,
  );
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

export const AnnouncementControllerPublishSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: AnnouncementActionRequestSchema,
  responses: {
    200: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerPublishUrl(
  path: AnnouncementControllerPublishPathParams,
): string {
  return buildUrl('/announcements/{id}/publish', path);
}

const announcementControllerPublishOperation: OperationDefinition = {
  id: 'AnnouncementController_publish',
  method: 'POST',
  path: '/announcements/{id}/publish',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerPublishSchemas,
};

/** 送出草稿：立即發送，或在指定的時間發送 */
export function announcementControllerPublish(
  input: AnnouncementControllerPublishInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerPublishResult> {
  return request<AnnouncementControllerPublishResult>(
    announcementControllerPublishOperation,
    input,
    options,
  );
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

export const AnnouncementControllerPauseSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: AnnouncementActionRequestSchema,
  responses: {
    200: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerPauseUrl(
  path: AnnouncementControllerPausePathParams,
): string {
  return buildUrl('/announcements/{id}/pause', path);
}

const announcementControllerPauseOperation: OperationDefinition = {
  id: 'AnnouncementController_pause',
  method: 'POST',
  path: '/announcements/{id}/pause',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerPauseSchemas,
};

/** 暫停排程 */
export function announcementControllerPause(
  input: AnnouncementControllerPauseInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerPauseResult> {
  return request<AnnouncementControllerPauseResult>(
    announcementControllerPauseOperation,
    input,
    options,
  );
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

export const AnnouncementControllerResumeSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: AnnouncementActionRequestSchema,
  responses: {
    200: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerResumeUrl(
  path: AnnouncementControllerResumePathParams,
): string {
  return buildUrl('/announcements/{id}/resume', path);
}

const announcementControllerResumeOperation: OperationDefinition = {
  id: 'AnnouncementController_resume',
  method: 'POST',
  path: '/announcements/{id}/resume',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerResumeSchemas,
};

/** 恢復排程（指定的時間已經過去時不能恢復） */
export function announcementControllerResume(
  input: AnnouncementControllerResumeInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerResumeResult> {
  return request<AnnouncementControllerResumeResult>(
    announcementControllerResumeOperation,
    input,
    options,
  );
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

export const AnnouncementControllerListDispatchesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(AnnouncementDispatchSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerListDispatchesUrl(
  path: AnnouncementControllerListDispatchesPathParams,
): string {
  return buildUrl('/announcements/{id}/dispatches', path);
}

const announcementControllerListDispatchesOperation: OperationDefinition = {
  id: 'AnnouncementController_listDispatches',
  method: 'GET',
  path: '/announcements/{id}/dispatches',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerListDispatchesSchemas,
};

/** 發送紀錄（新的在前；人數、已讀數、狀態） */
export function announcementControllerListDispatches(
  input: AnnouncementControllerListDispatchesInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerListDispatchesResult> {
  return request<AnnouncementControllerListDispatchesResult>(
    announcementControllerListDispatchesOperation,
    input,
    options,
  );
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

export const AnnouncementControllerRevokeSchemas = {
  path: z.object({
    id: z.string(),
    dispatchId: z.string(),
  }),
  responses: {
    200: z.object({
      data: AnnouncementDispatchSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementControllerRevokeUrl(
  path: AnnouncementControllerRevokePathParams,
): string {
  return buildUrl('/announcements/{id}/dispatches/{dispatchId}/revoke', path);
}

const announcementControllerRevokeOperation: OperationDefinition = {
  id: 'AnnouncementController_revoke',
  method: 'POST',
  path: '/announcements/{id}/dispatches/{dispatchId}/revoke',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerRevokeSchemas,
};

/** 撤回一次發送：刪除它的所有通知，發送紀錄保留 */
export function announcementControllerRevoke(
  input: AnnouncementControllerRevokeInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerRevokeResult> {
  return request<AnnouncementControllerRevokeResult>(
    announcementControllerRevokeOperation,
    input,
    options,
  );
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

export const AnnouncementMessageControllerReadSchemas = {
  path: z.object({
    dispatchId: z.string(),
  }),
  responses: {
    200: z.object({
      data: AnnouncementMessageSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAnnouncementMessageControllerReadUrl(
  path: AnnouncementMessageControllerReadPathParams,
): string {
  return buildUrl('/me/announcement-messages/{dispatchId}', path);
}

const announcementMessageControllerReadOperation: OperationDefinition = {
  id: 'AnnouncementMessageController_read',
  method: 'GET',
  path: '/me/announcement-messages/{dispatchId}',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementMessageControllerReadSchemas,
};

/** 自己收到的公告全文；同時把那則通知標為已讀 */
export function announcementMessageControllerRead(
  input: AnnouncementMessageControllerReadInput,
  options?: RequestOptions,
): Promise<AnnouncementMessageControllerReadResult> {
  return request<AnnouncementMessageControllerReadResult>(
    announcementMessageControllerReadOperation,
    input,
    options,
  );
}
