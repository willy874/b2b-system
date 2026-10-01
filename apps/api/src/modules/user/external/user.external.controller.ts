import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ExternalApi, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import { ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ExternalUserListSchema,
  ExternalUserSchema,
  ListExternalUserSchema,
} from './user.external.dto';
import type { ListExternalUserDto } from './user.external.dto';
import { UserExternalService } from './user.external.service';

/** 對外 API 的使用者（唯讀，docs/adr/0027-api-tokens-external-api.md T3）：給目錄同步。 */
@ApiTags('users')
@ExternalApi()
@Controller('v1/users')
export class UserExternalController {
  constructor(private readonly users: UserExternalService) {}

  @Get()
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiOperation({ summary: '使用者列表（只有人，不含服務帳號）' })
  @ApiZodResponse(200, ExternalUserListSchema)
  list(@Query(new ZodValidationPipe(ListExternalUserSchema)) query: ListExternalUserDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiZodResponse(200, ExternalUserSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }
}
