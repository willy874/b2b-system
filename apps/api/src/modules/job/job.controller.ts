import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodListResponse, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { JobQueueListSchema, JobSchema, JobSummarySchema, ListJobSchema } from './dto/job.dto';
import type { ListJobDto } from './dto/job.dto';
import { JobService } from './job.service';

@ApiTags('jobs')
@Controller('jobs')
@RequireFeature('job')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Get('queues')
  @RequirePermissions(PERMISSION.JOB_READ)
  @ApiOperation({ summary: '各種背景工作的佇列狀態（等待、執行中、失敗筆數與排程）' })
  @ApiZodResponse(200, JobQueueListSchema)
  queues() {
    return this.jobService.queues();
  }

  @Get()
  @RequirePermissions(PERMISSION.JOB_READ)
  @ApiOperation({ summary: '背景工作列表（固定 createdOn DESC；不含 data / output）' })
  @ApiZodListResponse(200, JobSummarySchema)
  list(@Query(new ZodValidationPipe(ListJobSchema)) query: ListJobDto) {
    return this.jobService.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.JOB_READ)
  @ApiOperation({ summary: '背景工作詳情（含 data 與 output）' })
  @ApiZodResponse(200, JobSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobService.findOne(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.JOB_RETRY)
  @ApiOperation({ summary: '重新排入失敗的工作（只接受 failed）' })
  @ApiZodResponse(200, JobSchema)
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.jobService.retry(id, actor);
  }
}
