import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/** 登入互動完成（或取消）：要讓瀏覽器頂層跳轉的 resume 網址（docs/architecture/04-sso.md §3.2）。 */
export const SsoRedirectSchema = defineSchema(
  'SsoRedirect',
  z.object({ redirectTo: z.string().url() }),
);

export type SsoRedirectDto = z.infer<typeof SsoRedirectSchema>;
