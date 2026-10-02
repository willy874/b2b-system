import { Inject, Injectable } from '@nestjs/common';

import { featureFlagOverrides } from '@/db/platform/schema';
import type { FeatureFlagOverrideRow } from '@/db/platform/schema';

import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';

/** 全平台層的覆寫（平台 DB，docs/architecture/05-tenancy.md §11.2 D2）。寫入在 `modules/feature-flag`。 */
@Injectable()
export class FeatureFlagRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  listGlobal(): Promise<FeatureFlagOverrideRow[]> {
    return this.db.select().from(featureFlagOverrides);
  }
}
