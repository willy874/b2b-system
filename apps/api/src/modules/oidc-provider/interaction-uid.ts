import { z } from 'zod';

import { ZodValidationPipe } from '@/core/validation';

/** provider 產生的互動 id（nanoid）；只接受這個形狀，才能安全地放進轉址網址。 */
export const InteractionUidPipe = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/));
