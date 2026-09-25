import { z } from 'zod';

import { BatchIdsSchema } from '@/core/batch';
import { defineSchema } from '@/core/validation';

/** 批次只開放啟用／停用；`pending`（等待啟用）與 `locked` 不是管理員能整批設定的狀態。 */
export const BatchUserStatusSchema = defineSchema(
  'BatchUserStatusRequest',
  BatchIdsSchema.extend({ status: z.enum(['active', 'inactive']) }),
);

export type BatchUserStatusDto = z.infer<typeof BatchUserStatusSchema>;
export type BatchUserStatus = BatchUserStatusDto['status'];
