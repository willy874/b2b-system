import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { FileNameSchema } from './create-file-upload.dto';

export const UpdateFileSchema = defineSchema(
  'UpdateFileRequest',
  z.object({
    name: FileNameSchema,
    /**
     * 樂觀鎖：畫面上看到的 `version`（必填）。與目前版本不同（別人已經改過）回 409 `FILE_VERSION_CONFLICT`
     * （`details.current`）。要後寫者勝的腳本先讀一次目前的版本（ADR-0025 D4）。
     */
    version: z.number().int().min(1),
  }),
);

export type UpdateFileDto = z.infer<typeof UpdateFileSchema>;
