import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireAnyPermission, RequireFeature } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodListResponse, ZodValidationPipe } from '@/core/validation';

import { ListTrashSchema, TrashItemSchema } from './dto/trash.dto';
import type { ListTrashDto } from './dto/trash.dto';
import { TRASH_PERMISSIONS } from './trash.constants';
import { TrashService } from './trash.service';

@ApiTags('trash')
@Controller('trash')
@RequireFeature('trash')
export class TrashController {
  constructor(private readonly trashService: TrashService) {}

  /**
   * 路由擋「任何一類都不能刪」的人；指定的類型還要有該類型的 `<resource>:delete`（service 檢查，ADR-0025 D10）。
   * 還原端點在各資源自己的 controller（`POST /users/:id/restore`…）。
   */
  @Get()
  @RequireAnyPermission(...TRASH_PERMISSIONS)
  @ApiOperation({ summary: '回收桶：某一類已刪除的項目（新刪除的在前）' })
  @ApiZodListResponse(200, TrashItemSchema)
  list(
    @Query(new ZodValidationPipe(ListTrashSchema)) query: ListTrashDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trashService.list(query, actor);
  }
}
