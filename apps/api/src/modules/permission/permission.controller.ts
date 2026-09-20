import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import { ApiZodResponse } from '@/core/validation';

import { PermissionCatalogSchema } from './dto/permission.dto';
import { PermissionService } from './permission.service';

@ApiTags('permissions')
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @RequirePermissions(PERMISSION.PERMISSION_READ)
  @ApiOperation({ summary: '權限目錄（唯讀，不分頁）' })
  @ApiZodResponse(200, PermissionCatalogSchema)
  list() {
    return this.permissionService.getCatalog();
  }
}
