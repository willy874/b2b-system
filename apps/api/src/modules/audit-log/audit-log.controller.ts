import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import { NoStore } from '@/core/http';
import { ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { AuditLogService } from './audit-log.service';
import { AuditLogSchema, AuditLogListSchema, ListAuditLogSchema } from './dto/list-audit-log.dto';
import type { ListAuditLogDto } from './dto/list-audit-log.dto';

@ApiTags('audit-logs')
@Controller('audit-logs')
@RequireFeature('auditLog')
// 稽核紀錄含人名、email 與變更內容：不進瀏覽器的磁碟快取
@NoStore()
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermissions(PERMISSION.AUDIT_LOG_READ)
  @ApiOperation({
    summary:
      '稽核日誌列表（固定 occurred_at DESC；時間範圍預設且最多 90 天；不含 changes / metadata）',
  })
  @ApiZodResponse(200, AuditLogListSchema)
  list(@Query(new ZodValidationPipe(ListAuditLogSchema)) query: ListAuditLogDto) {
    return this.auditLogService.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.AUDIT_LOG_READ)
  @ApiOperation({ summary: '稽核日誌單筆詳情' })
  @ApiZodResponse(200, AuditLogSchema)
  findOne(@Param('id') id: string) {
    return this.auditLogService.findOne(id);
  }
}
