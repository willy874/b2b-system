// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { TrashControllerListResult } from '../../endpoints/trash';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { TrashItemSchema } from '../components';

// GET /trash

export const TrashControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(TrashItemSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const trashControllerListOperation: OperationDefinition = {
  id: 'TrashController_list',
  method: 'GET',
  path: '/trash',
  responseTypes: { 200: 'json' },
  schemas: TrashControllerListSchemas,
};

/** 回收桶：某一類已刪除的項目（新刪除的在前） */
export function trashControllerList(options?: RequestOptions): Promise<TrashControllerListResult> {
  return request<TrashControllerListResult>(trashControllerListOperation, {}, options);
}
