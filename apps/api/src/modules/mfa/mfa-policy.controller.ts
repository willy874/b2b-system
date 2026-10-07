import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { MfaPolicyImpactSchema, MfaPolicySchema, UpdateMfaPolicySchema } from './dto/mfa.dto';
import type { UpdateMfaPolicyDto } from './dto/mfa.dto';
import { MfaPolicyService } from './mfa-policy.service';

/** 租戶的 MFA 政策（docs/architecture/backend/21-mfa.md §6）：backstage 的 `/security/mfa`。 */
@ApiTags('mfa')
@Controller('mfa/policy')
export class MfaPolicyController {
  constructor(private readonly policies: MfaPolicyService) {}

  @Get()
  @RequirePermissions(PERMISSION.MFA_POLICY_READ)
  @ApiOperation({ summary: '租戶的 MFA 政策、可選的方式、不符合政策的人數' })
  @ApiZodResponse(200, MfaPolicySchema)
  get() {
    return this.policies.get();
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.MFA_POLICY_READ)
  @ApiOperation({ summary: '套用前先看影響：不符合政策的人數、會被擋在門外的人數' })
  @ApiZodBody(UpdateMfaPolicySchema)
  @ApiZodResponse(200, MfaPolicyImpactSchema)
  preview(@Body(new ZodValidationPipe(UpdateMfaPolicySchema)) dto: UpdateMfaPolicyDto) {
    return this.policies.preview(dto);
  }

  @Put()
  @RequirePermissions(PERMISSION.MFA_POLICY_UPDATE)
  @ApiOperation({ summary: '修改 MFA 政策（樂觀鎖；收緊立即生效但不踢人）' })
  @ApiZodBody(UpdateMfaPolicySchema)
  @ApiZodResponse(200, MfaPolicySchema)
  update(
    @Body(new ZodValidationPipe(UpdateMfaPolicySchema)) dto: UpdateMfaPolicyDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.update(dto, actor);
  }
}
