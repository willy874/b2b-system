import { Global, Module } from '@nestjs/common';

import { AuditLogArchiveJob } from './audit-log-archive.job';
import { AuditLogController } from './audit-log.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditService } from './audit.service';

/** 葉節點模組。設為 @Global 讓全域 Guard 與各 service 都能注入 AuditService。 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditService, AuditLogService, AuditLogRepository, AuditLogArchiveJob],
  exports: [AuditService, AuditLogService],
})
export class AuditLogModule {}
