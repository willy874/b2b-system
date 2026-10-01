import { Global, Module } from '@nestjs/common';

import { ApiTokenCacheService } from './api-token-cache.service';
import { PermissionCacheService } from './permission-cache.service';
import { UserCacheService } from './user-cache.service';

@Global()
@Module({
  providers: [PermissionCacheService, UserCacheService, ApiTokenCacheService],
  exports: [PermissionCacheService, UserCacheService, ApiTokenCacheService],
})
export class CacheModule {}
