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

import { RequirePlatformPermissions } from '@/common/decorators';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  AddTenantDomainSchema,
  CreateTenantSchema,
  ListPlatformTenantSchema,
  PlatformTenantListSchema,
  PlatformTenantSchema,
  TenantDomainSchema,
  UpdateTenantSchema,
} from './dto/platform-tenant.dto';
import type {
  AddTenantDomainDto,
  CreateTenantDto,
  ListPlatformTenantDto,
  UpdateTenantDto,
} from './dto/platform-tenant.dto';
import { PlatformTenantService } from './platform-tenant.service';

/**
 * 平台管理者的租戶管理（apps/auth，docs/adr/0020-physical-tenant-isolation.md D12、D13）。
 * 只在 apps/auth 的網域有效（`@RequirePlatformPermissions`），租戶網域上回 `PLATFORM_ONLY`。
 */
@ApiTags('platform-tenants')
@Controller('platform/tenants')
export class PlatformTenantController {
  constructor(private readonly tenants: PlatformTenantService) {}

  @Get()
  @RequirePlatformPermissions('tenant:read')
  @ApiOperation({
    summary: '租戶（未刪除）與預設網域的上層；分頁、代碼／名稱／網域搜尋（q）、狀態篩選（status）',
  })
  @ApiZodResponse(200, PlatformTenantListSchema)
  list(@Query(new ZodValidationPipe(ListPlatformTenantSchema)) query: ListPlatformTenantDto) {
    return this.tenants.list(query);
  }

  @Get(':id')
  @RequirePlatformPermissions('tenant:read')
  @ApiZodResponse(200, PlatformTenantSchema)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }

  @Post()
  @RequirePlatformPermissions('tenant:create')
  @ApiOperation({
    summary: '建立租戶：登記後由背景工作佈建（database、migration、第一位管理員與啟用信）',
  })
  @ApiZodBody(CreateTenantSchema)
  @ApiZodResponse(201, PlatformTenantSchema)
  create(@Body(new ZodValidationPipe(CreateTenantSchema)) dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch(':id')
  @RequirePlatformPermissions('tenant:update')
  @ApiZodBody(UpdateTenantSchema)
  @ApiZodResponse(200, PlatformTenantSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTenantSchema)) dto: UpdateTenantDto,
  ) {
    return this.tenants.update(id, dto);
  }

  @Post(':id/provision')
  @HttpCode(200)
  @RequirePlatformPermissions('tenant:create')
  @ApiOperation({ summary: '重試失敗的佈建' })
  @ApiZodResponse(200, PlatformTenantSchema)
  retryProvisioning(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.retryProvisioning(id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePlatformPermissions('tenant:update')
  @ApiOperation({ summary: '停用：網域回 503，撤銷所有 session' })
  @ApiZodResponse(200, PlatformTenantSchema)
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.disable(id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePlatformPermissions('tenant:update')
  @ApiZodResponse(200, PlatformTenantSchema)
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.enable(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePlatformPermissions('tenant:delete')
  @ApiOperation({ summary: '標記刪除並停用、釋出網域；database 與 bucket 由手動步驟清除' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tenants.remove(id);
  }

  @Post(':id/domains')
  @HttpCode(200)
  @RequirePlatformPermissions('tenant:update')
  @ApiZodBody(AddTenantDomainSchema)
  @ApiZodResponse(200, PlatformTenantSchema)
  addDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AddTenantDomainSchema)) dto: AddTenantDomainDto,
  ) {
    return this.tenants.addDomain(id, dto.domain);
  }

  @Delete(':id/domains/:domain')
  @RequirePlatformPermissions('tenant:update')
  @ApiZodResponse(200, PlatformTenantSchema)
  removeDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domain', new ZodValidationPipe(TenantDomainSchema)) domain: string,
  ) {
    return this.tenants.removeDomain(id, domain);
  }
}
