import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import { ApprovalService } from './approval.service';
import {
  ApprovalRequestSchema,
  ApproveApprovalSchema,
  ListApprovalSchema,
  RejectApprovalSchema,
} from './dto/approval.dto';
import type { ApproveApprovalDto, ListApprovalDto, RejectApprovalDto } from './dto/approval.dto';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get()
  @RequirePermissions(PERMISSION.APPROVAL_READ)
  @ApiOperation({ summary: '審批請求列表' })
  @ApiZodListResponse(200, ApprovalRequestSchema)
  list(@Query(new ZodValidationPipe(ListApprovalSchema)) query: ListApprovalDto) {
    return this.approvalService.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.APPROVAL_READ)
  @ApiZodResponse(200, ApprovalRequestSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.approvalService.findOne(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.APPROVAL_REVIEW)
  @ApiOperation({ summary: '核准（另需該類型要求的權限，例：user.register 需要 user:create）' })
  @ApiZodBody(ApproveApprovalSchema)
  @ApiZodResponse(200, ApprovalRequestSchema)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ApproveApprovalSchema)) dto: ApproveApprovalDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.approvalService.approve(id, dto, actor);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.APPROVAL_REVIEW)
  @ApiOperation({ summary: '駁回' })
  @ApiZodBody(RejectApprovalSchema)
  @ApiZodResponse(200, ApprovalRequestSchema)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RejectApprovalSchema)) dto: RejectApprovalDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.approvalService.reject(id, dto, actor);
  }
}
