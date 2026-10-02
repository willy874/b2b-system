import { Global, Module } from '@nestjs/common';

import { FeatureFlagRepository } from './feature-flag.repository';
import { FEATURE_FLAG_CATALOG, FeatureFlagService } from './feature-flag.service';
import { FEATURE_FLAGS } from './feature-flags';

/** Feature flag 的目錄與判斷（docs/architecture/05-tenancy.md §11）。 */
@Global()
@Module({
  providers: [
    { provide: FEATURE_FLAG_CATALOG, useValue: FEATURE_FLAGS },
    FeatureFlagRepository,
    FeatureFlagService,
  ],
  exports: [FeatureFlagService],
})
export class FeatureFlagsModule {}
