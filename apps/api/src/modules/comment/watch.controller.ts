import { Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { CommentResourceTypeSchema } from './dto/comment.dto';
import { WatchStateSchema } from './dto/watch.dto';
import { WatchService } from './watch.service';

/** 自己對一個資源的關注（docs/architecture/backend/24-comment.md §3.2）；看得到資源才能關注。 */
@ApiTags('watches')
@Controller('watches')
export class WatchController {
  constructor(private readonly watches: WatchService) {}

  @Get(':resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '自己有沒有關注、關注的人數' })
  @ApiZodResponse(200, WatchStateSchema)
  state(
    @Param('resourceType', new ZodValidationPipe(CommentResourceTypeSchema)) resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.watches.state(resourceType, resourceId, actor);
  }

  @Put(':resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '關注；有新留言或資源被修改時收到通知' })
  @ApiZodResponse(200, WatchStateSchema)
  watch(
    @Param('resourceType', new ZodValidationPipe(CommentResourceTypeSchema)) resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.watches.watch(resourceType, resourceId, actor);
  }

  @Delete(':resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '取消關注' })
  @ApiZodResponse(200, WatchStateSchema)
  unwatch(
    @Param('resourceType', new ZodValidationPipe(CommentResourceTypeSchema)) resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.watches.unwatch(resourceType, resourceId, actor);
  }
}
