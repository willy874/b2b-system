import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/** 顯示用檔名：不可含路徑分隔字元或控制字元（下載時會寫進 Content-Disposition）。 */
export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // oxlint-disable-next-line no-control-regex -- 就是要排除控制字元
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/, 'must not contain path separators or control characters');

/** `type/subtype`，不含參數（`; charset=…`）；一律轉小寫。 */
const ContentTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/, 'must be a MIME type');

export const CreateFileUploadSchema = defineSchema(
  'CreateFileUploadRequest',
  z.object({
    name: FileNameSchema,
    contentType: ContentTypeSchema,
    /** 位元組。上限由 `FILE_UPLOAD_MAX_SIZE` 決定，超過回 `FILE_TOO_LARGE`。 */
    size: z.number().int().min(0),
  }),
);

export type CreateFileUploadDto = z.infer<typeof CreateFileUploadSchema>;
