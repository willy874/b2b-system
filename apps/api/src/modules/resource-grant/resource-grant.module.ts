import { Module } from '@nestjs/common';

import { ResourceGrantRepository } from './resource-grant.repository';
import { ResourceGrantService } from './resource-grant.service';

/**
 * 資源授權（docs/rbac/07-resource-grants.md）：`resource_grants` 與通用的等級解析。
 * 葉節點模組：不依賴任何業務模組；每種資源（資料夾、未來的專案）自己決定規則，只用這裡存取資料。
 */
@Module({
  providers: [ResourceGrantService, ResourceGrantRepository],
  exports: [ResourceGrantService],
})
export class ResourceGrantModule {}
