import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  Authenticated,
  CurrentUser,
  RequireFeature,
  RequirePermissions,
} from '@/common/decorators';
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
  ApprovalRequestDetailSchema,
  ApprovalRequestSchema,
  ApproveApprovalSchema,
  DecideApprovalStepSchema,
  ListApprovalSchema,
  OverrideApprovalStepSchema,
  RejectApprovalSchema,
} from './dto/approval.dto';
import type {
  ApproveApprovalDto,
  DecideApprovalStepDto,
  ListApprovalDto,
  OverrideApprovalStepDto,
  RejectApprovalDto,
} from './dto/approval.dto';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  /**
   * `scope=all`（預設）需要 `approval:read`（service 檢查）；`assigned`（待我審核）與 `mine`（我送出的）登入即可
   * （docs/architecture/backend/20-approval.md §9.13）。
   */
  @Get()
  @Authenticated()
  @ApiOperation({ summary: '審批請求列表（全部／待我審核／我送出的）' })
  @ApiZodListResponse(200, ApprovalRequestSchema)
  list(
    @Query(new ZodValidationPipe(ListApprovalSchema)) query: ListApprovalDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.approvalService.list(query, actor);
  }

  /** `approval:read`、申請人、任一關的候選人看得到；其他人 404（§9.10）。 */
  @Get(':id')
  @Authenticated()
  @ApiZodResponse(200, ApprovalRequestDetailSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.approvalService.findOne(id, actor);
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

  /** 申請人撤回自己仍待審的請求（§9.9）。 */
  @Post(':id/withdraw')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: '撤回自己送出的申請' })
  @ApiZodResponse(200, ApprovalRequestDetailSchema)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.approvalService.withdraw(id, actor);
  }

  /**
   * 多階段：目前關卡的候選人同意或駁回（§9.7）。被流程指派就是授權，不需要 `approval:review`（D3）；
   * 關卡已往下走 409 `APPROVAL_STEP_STALE`、不是候選人 403 `APPROVAL_NOT_ASSIGNED`。
   */
  @Post(':id/steps/:ordinal/decisions')
  @HttpCode(200)
  @Authenticated()
  @RequireFeature('approvalChain')
  @ApiOperation({ summary: '在目前的關卡同意或駁回' })
  @ApiZodBody(DecideApprovalStepSchema)
  @ApiZodResponse(200, ApprovalRequestDetailSchema)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ordinal', ParseIntPipe) ordinal: number,
    @Body(new ZodValidationPipe(DecideApprovalStepSchema)) dto: DecideApprovalStepDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.approvalService.decideStep(id, ordinal, dto, actor);
  }

  /** 多階段：強制定案目前的關卡（意見必填；§9.8、D10）。 */
  @Post(':id/steps/:ordinal/override')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.APPROVAL_OVERRIDE)
  @RequireFeature('approvalChain')
  @ApiOperation({ summary: '強制定案目前的關卡' })
  @ApiZodBody(OverrideApprovalStepSchema)
  @ApiZodResponse(200, ApprovalRequestDetailSchema)
  override(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ordinal', ParseIntPipe) ordinal: number,
    @Body(new ZodValidationPipe(OverrideApprovalStepSchema)) dto: OverrideApprovalStepDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.approvalService.overrideStep(id, ordinal, dto, actor);
  }

  /** 多階段：依規則重新展開目前關卡的審核者（只增不減；§9.8）。 */
  @Post(':id/steps/:ordinal/refresh')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.APPROVAL_OVERRIDE)
  @RequireFeature('approvalChain')
  @ApiOperation({ summary: '重新展開目前關卡的審核者' })
  @ApiZodResponse(200, ApprovalRequestDetailSchema)
  refresh(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ordinal', ParseIntPipe) ordinal: number,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.approvalService.refreshStep(id, ordinal, actor);
  }
}
