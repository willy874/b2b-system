import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { FileNameSchema } from './create-file-upload.dto';

export const UpdateFileSchema = defineSchema(
  'UpdateFileRequest',
  z.object({
    name: FileNameSchema,
    /**
     * 樂觀鎖：畫面上看到的 `version`。帶了而與目前版本不同（別人已經改過）回 `FILE_VERSION_CONFLICT`；
     * 不帶則後寫者勝（批次、腳本）。
     */
    version: z.number().int().min(1).optional(),
  }),
);

export type UpdateFileDto = z.infer<typeof UpdateFileSchema>;
