import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { Env } from '@/core/config';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('info')
  @RequirePermissions(PERMISSION.SYSTEM_READ)
  @ApiOperation({ summary: '版本、建置時間、環境' })
  info() {
    return {
      version: process.env.npm_package_version ?? '0.0.0',
      environment: this.config.get('NODE_ENV', { infer: true }),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      nodeVersion: process.version,
    };
  }
}
