import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/** 目前網域的租戶（backstage 跳到 apps/auth 登入時帶上它的代碼，docs/adr/0020-physical-tenant-isolation.md D7）。 */
export const CurrentTenantSchema = defineSchema(
  'CurrentTenant',
  z.object({ code: z.string(), name: z.string() }),
);

export const TenantLookupQuerySchema = defineSchema(
  'TenantLookupQuery',
  z.object({ code: z.string().trim().min(1).max(63) }),
);

/** 以代碼找租戶的登入入口（apps/auth 的「進入租戶」與帳號流程完成後，D11）。 */
export const TenantLookupSchema = defineSchema(
  'TenantLookup',
  z.object({ code: z.string(), name: z.string(), loginUrl: z.string() }),
);

export type CurrentTenantDto = z.infer<typeof CurrentTenantSchema>;
export type TenantLookupQueryDto = z.infer<typeof TenantLookupQuerySchema>;
export type TenantLookupDto = z.infer<typeof TenantLookupSchema>;
