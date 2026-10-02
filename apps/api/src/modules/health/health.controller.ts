import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, Surface } from '@/common/decorators';

import { HealthService } from './health.service';

@ApiTags('health')
// 內部 api 與對外 API 都有：兩個程序各自被 LB／compose 檢查（docs/architecture/06-external-api.md §9.2 D11）
@Surface('both')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe（含 DB ping）' })
  ready() {
    return this.healthService.ready();
  }
}
