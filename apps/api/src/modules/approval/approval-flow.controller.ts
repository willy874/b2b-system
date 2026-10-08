import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { ApprovalFlowService } from './approval-flow.service';
import {
  ApprovalFlowListSchema,
  ApprovalFlowPreviewSchema,
  ApprovalFlowSchema,
  PreviewApprovalFlowSchema,
  PutApprovalFlowSchema,
} from './dto/approval-flow.dto';
import type { PreviewApprovalFlowDto, PutApprovalFlowDto } from './dto/approval-flow.dto';

/**
 * 審批流程的設定（docs/architecture/backend/20-approval.md §9、D1）。可由平台關閉（`approvalChain`，D12）：停用時整個 controller 回 404。
 * 路徑參數是審批類型（`user.register`）；不支援流程的類型 422 `APPROVAL_FLOW_NOT_SUPPORTED`。
 */
@ApiTags('approval-flows')
@Controller('approval-flows')
@RequireFeature('approvalChain')
export class ApprovalFlowController {
  constructor(private readonly flows: ApprovalFlowService) {}

  @Get()
  @RequirePermissions(PERMISSION.APPROVAL_FLOW_READ)
  @ApiOperation({ summary: '支援多階段流程的審批類型與它們的流程' })
  @ApiZodResponse(200, ApprovalFlowListSchema)
  list() {
    return this.flows.list();
  }

  @Get(':type')
  @RequirePermissions(PERMISSION.APPROVAL_FLOW_READ)
  @ApiZodResponse(200, ApprovalFlowSchema)
  get(@Param('type') type: string) {
    return this.flows.get(type);
  }

  /**
   * 建立或取代流程；修改既有流程必帶 `version`（409 `APPROVAL_FLOW_VERSION_CONFLICT`）。
   * 操作者要持有該類型核准所需的權限（反提權，D11）。
   */
  @Put(':type')
  @RequirePermissions(PERMISSION.APPROVAL_FLOW_UPDATE)
  @ApiZodBody(PutApprovalFlowSchema)
  @ApiZodResponse(200, ApprovalFlowSchema)
  put(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(PutApprovalFlowSchema)) dto: PutApprovalFlowDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.flows.put(type, dto, actor);
  }

  /** 試算：給定申請人與欄位值，每一關會不會略過、候選人是誰（唯讀）。 */
  @Post(':type/preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.APPROVAL_FLOW_READ)
  @ApiOperation({ summary: '試算流程會走哪些關卡、每關是誰' })
  @ApiZodBody(PreviewApprovalFlowSchema)
  @ApiZodResponse(200, ApprovalFlowPreviewSchema)
  preview(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(PreviewApprovalFlowSchema)) dto: PreviewApprovalFlowDto,
  ) {
    return this.flows.preview(type, dto);
  }
}
