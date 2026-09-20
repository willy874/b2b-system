import { z } from 'zod';

export const LoginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});
export type LoginSearch = z.infer<typeof LoginSearchSchema>;

export const TokenSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
});
export type TokenSearch = z.infer<typeof TokenSearchSchema>;
