import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { platformAdmins } from '@/db/platform/schema';

export type PlatformAdminPatch = Partial<
  Pick<
    PlatformAdminRow,
    'failedLoginCount' | 'lockedUntil' | 'lastLoginAt' | 'status' | 'tokenVersion'
  >
>;

/** 平台管理者（平台 DB，docs/adr/0020-physical-tenant-isolation.md D5）。 */
@Injectable()
export class PlatformAdminRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async findByEmail(email: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdmins)
      .where(and(eq(platformAdmins.email, email), isNull(platformAdmins.deletedAt)))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdmins)
      .where(and(eq(platformAdmins.id, id), isNull(platformAdmins.deletedAt)))
      .limit(1);
    return row;
  }

  async update(id: string, patch: PlatformAdminPatch): Promise<void> {
    await this.db.update(platformAdmins).set(patch).where(eq(platformAdmins.id, id));
  }
}
