import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePlatformPermissions } from '@/common/decorators';
import { ApiZodListResponse, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ListPlatformJobSchema,
  PlatformJobQueueListSchema,
  PlatformJobSchema,
  PlatformJobSummarySchema,
} from './dto/job.dto';
import type { ListPlatformJobDto } from './dto/job.dto';
import { PlatformJobService } from './platform-job.service';

/** 平台的背景工作監控（apps/auth）：所有租戶與平台自己的工作。租戶網域上回 `PLATFORM_ONLY`。 */
@ApiTags('platform-jobs')
@Controller('platform/jobs')
export class PlatformJobController {
  constructor(private readonly jobs: PlatformJobService) {}

  @Get('queues')
  @RequirePlatformPermissions('platformJob:read')
  @ApiOperation({ summary: '每種工作的佇列狀態（所有租戶合計）' })
  @ApiZodResponse(200, PlatformJobQueueListSchema)
  queues() {
    return this.jobs.queues();
  }

  @Get()
  @RequirePlatformPermissions('platformJob:read')
  @ApiOperation({ summary: '背景工作列表（固定 createdOn DESC；tenant=代碼或 platform）' })
  @ApiZodListResponse(200, PlatformJobSummarySchema)
  list(@Query(new ZodValidationPipe(ListPlatformJobSchema)) query: ListPlatformJobDto) {
    return this.jobs.list(query);
  }

  @Get(':id')
  @RequirePlatformPermissions('platformJob:read')
  @ApiZodResponse(200, PlatformJobSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.findOne(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePlatformPermissions('platformJob:retry')
  @ApiZodResponse(200, PlatformJobSchema)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.retry(id);
  }
}
