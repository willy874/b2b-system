import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { FileNameSchema } from './create-file-upload.dto';

export const UpdateFileSchema = defineSchema(
  'UpdateFileRequest',
  z.object({ name: FileNameSchema }),
);

export type UpdateFileDto = z.infer<typeof UpdateFileSchema>;
