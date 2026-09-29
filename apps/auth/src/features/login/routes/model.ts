import { z } from 'zod';

export const LoginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});
export type LoginSearch = z.infer<typeof LoginSearchSchema>;
