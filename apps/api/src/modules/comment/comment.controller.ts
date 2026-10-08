import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { CommentService } from './comment.service';
import {
  CommentPageSchema,
  CommentResourceTypeSchema,
  CommentSchema,
  CreateCommentSchema,
  ListCommentSchema,
  ListMentionableSchema,
  MentionableListSchema,
  UpdateCommentSchema,
} from './dto/comment.dto';
import type {
  CreateCommentDto,
  ListCommentDto,
  ListMentionableDto,
  UpdateCommentDto,
} from './dto/comment.dto';

/**
 * 資源上的留言（docs/architecture/backend/24-comment.md §3.1）。端點只宣告 `@Authenticated()`：
 * 看不看得到由擁有者判斷（拒絕寫 `authz.denied`），刪別人的留言另要 `comment:delete`（service 內判斷）。
 */
@ApiTags('comments')
@Controller('comments')
export class CommentController {
  constructor(private readonly comments: CommentService) {}

  @Get(':resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '一個資源的留言，新的在前；看得到那個資源才能讀' })
  @ApiZodResponse(200, CommentPageSchema)
  list(
    @Param('resourceType', new ZodValidationPipe(CommentResourceTypeSchema)) resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Query(new ZodValidationPipe(ListCommentSchema)) query: ListCommentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.comments.list(resourceType, resourceId, query, actor);
  }

  @Post(':resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '留言；作者自動關注這個資源，被提及的人與關注者收到通知' })
  @ApiZodBody(CreateCommentSchema)
  @ApiZodResponse(201, CommentSchema)
  create(
    @Param('resourceType', new ZodValidationPipe(CommentResourceTypeSchema)) resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Body(new ZodValidationPipe(CreateCommentSchema)) dto: CreateCommentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.comments.create(resourceType, resourceId, dto, actor);
  }

  @Get(':resourceType/:resourceId/mentionable')
  @Authenticated()
  @ApiOperation({ summary: '@提及的候選：看得到這個資源的人（最多 10 位）' })
  @ApiZodResponse(200, MentionableListSchema)
  mentionable(
    @Param('resourceType', new ZodValidationPipe(CommentResourceTypeSchema)) resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Query(new ZodValidationPipe(ListMentionableSchema)) query: ListMentionableDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.comments.mentionable(resourceType, resourceId, query.q, actor);
  }

  @Patch(':id')
  @Authenticated()
  @ApiOperation({ summary: '編輯自己的留言（帶 version）' })
  @ApiZodBody(UpdateCommentSchema)
  @ApiZodResponse(200, CommentSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCommentSchema)) dto: UpdateCommentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.comments.update(id, dto, actor);
  }

  @Delete(':id')
  @Authenticated()
  @ApiOperation({ summary: '刪除留言：作者本人，或持有 comment:delete；不進回收桶' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.comments.remove(id, actor);
  }
}
