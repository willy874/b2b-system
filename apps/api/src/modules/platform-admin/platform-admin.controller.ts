import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePlatformPermissions } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import {
  CreatePlatformAdminSchema,
  ListPlatformAuditLogSchema,
  PlatformAdminListSchema,
  PlatformAdminPasswordLinkSchema,
  PlatformAdminSchema,
  PlatformAuditLogSchema,
  UpdatePlatformAdminSchema,
} from './dto/platform-admin.dto';
import type {
  CreatePlatformAdminDto,
  ListPlatformAuditLogDto,
  UpdatePlatformAdminDto,
} from './dto/platform-admin.dto';
import { PlatformAdminManagementService } from './platform-admin-management.service';
import { PlatformAuditService } from './platform-audit.service';

/**
 * 平台管理者與平台稽核（apps/auth，docs/architecture/05-tenancy.md §10.2 D5、D19）。
 * 只在 apps/auth 的網域有效，租戶網域上回 `PLATFORM_ONLY`。
 */
@ApiTags('platform-admins')
@Controller('platform')
export class PlatformAdminController {
  constructor(
    private readonly admins: PlatformAdminManagementService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Get('admins')
  @RequirePlatformPermissions('platformAdmin:read')
  @ApiZodResponse(200, PlatformAdminListSchema)
  list() {
    return this.admins.list();
  }

  @Post('admins')
  @RequirePlatformPermissions('platformAdmin:create')
  @ApiOperation({ summary: '新增平台管理者：建立成 pending，寄啟用信讓本人設定密碼' })
  @ApiZodBody(CreatePlatformAdminSchema)
  @ApiZodResponse(201, PlatformAdminSchema)
  create(@Body(new ZodValidationPipe(CreatePlatformAdminSchema)) dto: CreatePlatformAdminDto) {
    return this.admins.create(dto);
  }

  @Patch('admins/:id')
  @RequirePlatformPermissions('platformAdmin:update')
  @ApiOperation({
    summary: '改名、換角色、停用／啟用（停用即撤銷 session；locked 改回 active 即解鎖）',
  })
  @ApiZodBody(UpdatePlatformAdminSchema)
  @ApiZodResponse(200, PlatformAdminSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePlatformAdminSchema)) dto: UpdatePlatformAdminDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admins.update(id, dto, actor);
  }

  @Post('admins/:id/password-link')
  @HttpCode(200)
  @RequirePlatformPermissions('platformAdmin:update')
  @ApiOperation({ summary: '寄設定密碼的連結：還沒啟用的寄啟用信，其他人寄重設密碼信' })
  @ApiZodResponse(200, PlatformAdminPasswordLinkSchema)
  sendPasswordLink(@Param('id', ParseUUIDPipe) id: string) {
    return this.admins.sendPasswordLink(id);
  }

  @Get('audit-logs')
  @RequirePlatformPermissions('platformAuditLog:read')
  @ApiOperation({ summary: '平台稽核（固定 occurred_at DESC；時間範圍預設且最多 90 天）' })
  @ApiZodListResponse(200, PlatformAuditLogSchema)
  auditLogs(
    @Query(new ZodValidationPipe(ListPlatformAuditLogSchema)) query: ListPlatformAuditLogDto,
  ) {
    return this.audit.list(query);
  }
}
