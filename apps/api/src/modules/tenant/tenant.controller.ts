import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators';
import { RateLimit } from '@/common/rate-limit';
import { ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { CurrentTenantSchema, TenantLookupQuerySchema, TenantLookupSchema } from './dto/tenant.dto';
import type { TenantLookupQueryDto } from './dto/tenant.dto';
import { TenantService } from './tenant.service';

/** 租戶的公開資訊（docs/architecture/05-tenancy.md §10.2 D7、D11）。 */
@ApiTags('tenants')
@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get('tenant/current')
  @Public()
  @ApiOperation({ summary: '目前網域的租戶（backstage 跳去登入時帶上它的代碼）' })
  @ApiZodResponse(200, CurrentTenantSchema)
  current() {
    return this.tenants.current();
  }

  @Get('tenants/lookup')
  @Public()
  // 可以用來猜租戶代碼：與登入同一個速率限制
  @RateLimit('auth')
  @ApiOperation({ summary: '以代碼找租戶的登入入口（apps/platform 的進入租戶、帳號流程完成後）' })
  @ApiZodResponse(200, TenantLookupSchema)
  lookup(@Query(new ZodValidationPipe(TenantLookupQuerySchema)) query: TenantLookupQueryDto) {
    return this.tenants.lookup(query.code);
  }
}
