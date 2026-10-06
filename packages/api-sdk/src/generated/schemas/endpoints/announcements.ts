// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AnnouncementControllerCreateInput,
  AnnouncementControllerCreateResult,
  AnnouncementControllerFindOneInput,
  AnnouncementControllerFindOneResult,
  AnnouncementControllerListDispatchesInput,
  AnnouncementControllerListDispatchesResult,
  AnnouncementControllerListResult,
  AnnouncementControllerListTriggerEventsResult,
  AnnouncementControllerPauseInput,
  AnnouncementControllerPauseResult,
  AnnouncementControllerPreviewAudienceInput,
  AnnouncementControllerPreviewAudienceResult,
  AnnouncementControllerPreviewRecurrenceInput,
  AnnouncementControllerPreviewRecurrenceResult,
  AnnouncementControllerPublishInput,
  AnnouncementControllerPublishResult,
  AnnouncementControllerRemoveInput,
  AnnouncementControllerRemoveResult,
  AnnouncementControllerRestoreInput,
  AnnouncementControllerRestoreResult,
  AnnouncementControllerResumeInput,
  AnnouncementControllerResumeResult,
  AnnouncementControllerRevokeInput,
  AnnouncementControllerRevokeResult,
  AnnouncementControllerUpdateInput,
  AnnouncementControllerUpdateResult,
  AnnouncementMessageControllerReadInput,
  AnnouncementMessageControllerReadResult,
} from '../../endpoints/announcements';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  AnnouncementActionRequestSchema,
  AnnouncementAudiencePreviewSchema,
  AnnouncementAudienceSchema,
  AnnouncementDispatchSchema,
  AnnouncementMessageSchema,
  AnnouncementRecurrencePreviewRequestSchema,
  AnnouncementRecurrencePreviewSchema,
  AnnouncementSchema,
  AnnouncementTriggerEventListSchema,
  CreateAnnouncementRequestSchema,
  UpdateAnnouncementRequestSchema,
} from '../components';

// GET /announcements

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

export const AnnouncementControllerCreateSchemas = {
  body: CreateAnnouncementRequestSchema,
  responses: {
    201: z.object({
      data: AnnouncementSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AnnouncementControllerPreviewAudienceSchemas = {
  body: AnnouncementAudienceSchema,
  responses: {
    200: z.object({
      data: AnnouncementAudiencePreviewSchema,
    }),
  },
} satisfies OperationSchemas;

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

// GET /announcements/trigger-events

export const AnnouncementControllerListTriggerEventsSchemas = {
  responses: {
    200: z.object({
      data: AnnouncementTriggerEventListSchema,
    }),
  },
} satisfies OperationSchemas;

const announcementControllerListTriggerEventsOperation: OperationDefinition = {
  id: 'AnnouncementController_listTriggerEvents',
  method: 'GET',
  path: '/announcements/trigger-events',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerListTriggerEventsSchemas,
};

/** 可以訂的觸發點（事件點；所屬 feature 已啟用） */
export function announcementControllerListTriggerEvents(
  options?: RequestOptions,
): Promise<AnnouncementControllerListTriggerEventsResult> {
  return request<AnnouncementControllerListTriggerEventsResult>(
    announcementControllerListTriggerEventsOperation,
    {},
    options,
  );
}

// POST /announcements/recurrence-preview

export const AnnouncementControllerPreviewRecurrenceSchemas = {
  body: AnnouncementRecurrencePreviewRequestSchema,
  responses: {
    200: z.object({
      data: AnnouncementRecurrencePreviewSchema,
    }),
  },
} satisfies OperationSchemas;

const announcementControllerPreviewRecurrenceOperation: OperationDefinition = {
  id: 'AnnouncementController_previewRecurrence',
  method: 'POST',
  path: '/announcements/recurrence-preview',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AnnouncementControllerPreviewRecurrenceSchemas,
};

/** 週期接下來的發送時間（最多 5 次，依租戶時區） */
export function announcementControllerPreviewRecurrence(
  input: AnnouncementControllerPreviewRecurrenceInput,
  options?: RequestOptions,
): Promise<AnnouncementControllerPreviewRecurrenceResult> {
  return request<AnnouncementControllerPreviewRecurrenceResult>(
    announcementControllerPreviewRecurrenceOperation,
    input,
    options,
  );
}

// GET /announcements/{id}

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

export const AnnouncementControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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
