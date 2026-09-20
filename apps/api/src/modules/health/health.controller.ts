import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators';

import { HealthService } from './health.service';

@ApiTags('health')
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
