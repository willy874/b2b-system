import { Global, Module } from '@nestjs/common';

import { PermissionController } from './permission.controller';
import { PermissionRepository } from './permission.repository';
import { PermissionService } from './permission.service';

/**
 * 葉節點模組：被很多人依賴，自己不依賴任何業務模組。
 * 設為 @Global 是因為全域 Guard（PermissionsGuard）需要注入它。
 */
@Global()
@Module({
  controllers: [PermissionController],
  providers: [PermissionService, PermissionRepository],
  exports: [PermissionService, PermissionRepository],
})
export class PermissionModule {}
