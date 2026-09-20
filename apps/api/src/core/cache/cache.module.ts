import { Global, Module } from '@nestjs/common';

import { PermissionCacheService } from './permission-cache.service';
import { UserCacheService } from './user-cache.service';

@Global()
@Module({
  providers: [PermissionCacheService, UserCacheService],
  exports: [PermissionCacheService, UserCacheService],
})
export class CacheModule {}
