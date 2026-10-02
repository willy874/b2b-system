import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse } from '@/core/validation';

import { AuthzExplainService } from './authz-explain.service';
import { PermissionSourcesSchema } from './dto/authz-explain.dto';

@ApiTags('users')
@Controller('users/:id')
export class AuthzExplainController {
  constructor(private readonly explain: AuthzExplainService) {}

  /**
   * 有效權限與每個權限的來源（docs/rbac/01-domain-model.md §9 G4b）。查自己不需要權限；查別人要 `authz:explain`（service 判斷，
   * 「自己或有權限」無法以路由宣告表達）。路徑上讀不到的節點只回型別（D14）。
   */
  @Get('permission-sources')
  @Authenticated()
  @ApiOperation({ summary: '使用者的有效權限與來源（自己，或需要 authz:explain）' })
  @ApiZodResponse(200, PermissionSourcesSchema)
  permissionSources(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.explain.permissionSources(id, actor);
  }
}
