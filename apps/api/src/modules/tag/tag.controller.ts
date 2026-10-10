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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CreateTagSchema,
  ListTagSchema,
  ReplaceResourceTagsSchema,
  UpdateResourceTagsSchema,
  ResourceTagsSchema,
  TagListSchema,
  TagSchema,
  UpdateTagSchema,
} from './dto/tag.dto';
import type {
  CreateTagDto,
  ListTagDto,
  ReplaceResourceTagsDto,
  UpdateResourceTagsDto,
  UpdateTagDto,
} from './dto/tag.dto';
import { TagService } from './tag.service';

/** 標籤的定義與指派（docs/architecture/backend/18-tag.md §7.2 D5、D7）。 */
@ApiTags('tags')
@Controller('tags')
export class TagController {
  constructor(private readonly tags: TagService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '一個標籤組的標籤；要進得了那個標籤組（例：file 組要能進檔案管理器）' })
  @ApiZodResponse(200, TagListSchema)
  list(
    @Query(new ZodValidationPipe(ListTagSchema)) query: ListTagDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tags.list(query.scope, actor);
  }

  @Post()
  @RequirePermissions(PERMISSION.TAG_CREATE)
  @ApiZodBody(CreateTagSchema)
  @ApiZodResponse(201, TagSchema)
  create(
    @Body(new ZodValidationPipe(CreateTagSchema)) dto: CreateTagDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tags.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.TAG_UPDATE)
  @ApiOperation({ summary: '改名、改色；標籤組不能改' })
  @ApiZodBody(UpdateTagSchema)
  @ApiZodResponse(200, TagSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTagSchema)) dto: UpdateTagDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tags.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.TAG_DELETE)
  @ApiOperation({ summary: '刪除；所有資源上的這個標籤一併移除，不進回收桶' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tags.remove(id);
  }

  @Put('assignments/:resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '整批取代一個資源的標籤；能不能改跟著那個資源的編輯權限' })
  @ApiZodBody(ReplaceResourceTagsSchema)
  @ApiZodResponse(200, ResourceTagsSchema)
  replace(
    @Param('resourceType') resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Body(new ZodValidationPipe(ReplaceResourceTagsSchema)) dto: ReplaceResourceTagsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tags.replaceFor(resourceType, resourceId, dto, actor);
  }

  @Patch('assignments/:resourceType/:resourceId')
  @Authenticated()
  @ApiOperation({ summary: '加上、拿掉一個資源的幾個標籤（差異語意，其他的不動）；權限同整批取代' })
  @ApiZodBody(UpdateResourceTagsSchema)
  @ApiZodResponse(200, ResourceTagsSchema)
  updateAssignments(
    @Param('resourceType') resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Body(new ZodValidationPipe(UpdateResourceTagsSchema)) dto: UpdateResourceTagsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tags.updateFor(resourceType, resourceId, dto, actor);
  }
}
