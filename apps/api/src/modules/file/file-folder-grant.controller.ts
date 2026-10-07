import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  Authenticated,
  CurrentUser,
  RequireAnyPermission,
  RequireFeature,
} from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  FileAccessExplainQuerySchema,
  FileAccessExplainSchema,
} from './dto/file-access-explain.dto';
import type { FileAccessExplainQueryDto } from './dto/file-access-explain.dto';
import {
  CreateFileAccessRequestSchema,
  FileAccessRequestListSchema,
  FileAccessRequestSubmittedSchema,
  ReviewFileAccessRequestSchema,
} from './dto/file-access-request.dto';
import type {
  CreateFileAccessRequestDto,
  ReviewFileAccessRequestDto,
} from './dto/file-access-request.dto';
import {
  FILE_GRANT_SUBJECT_TYPES,
  FileFolderGrantListSchema,
  FileGrantSubjectListSchema,
  GrantSubjectTypeSchema,
  ListFileGrantSubjectsSchema,
  SetFileFolderGrantSchema,
  UpdateFileFolderAccessSchema,
} from './dto/file-folder-grant.dto';
import type {
  FileGrantSubjectType,
  ListFileGrantSubjectsDto,
  SetFileFolderGrantDto,
  UpdateFileFolderAccessDto,
} from './dto/file-folder-grant.dto';
import { FileAccessExplainService } from './file-access-explain.service';
import { FileAccessRequestService } from './file-access-request.service';
import { FileFolderGrantService } from './file-folder-grant.service';

/**
 * 資料夾授權的管理（docs/architecture/iam/06-resource-grants.md §6）。閘門是 `file:access` 或全域 `file:share`；
 * 需要在該資料夾有 share（全域 `file:share` 或 `manager` 等級），由 service 判斷。
 */
@ApiTags('files')
@Controller('file-folders/:id')
@RequireFeature('file')
export class FileFolderGrantController {
  constructor(
    private readonly grantService: FileFolderGrantService,
    private readonly requestService: FileAccessRequestService,
    private readonly explainService: FileAccessExplainService,
  ) {}

  /** 申請存取：能進檔案管理器的人都可以（沒有權限、或權限不夠的資料夾）。 */
  @Post('access-requests')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @HttpCode(202)
  @ApiOperation({ summary: '申請資料夾存取（審批類型 fileFolder.access）' })
  @ApiZodBody(CreateFileAccessRequestSchema)
  @ApiZodResponse(202, FileAccessRequestSubmittedSchema)
  requestAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CreateFileAccessRequestSchema)) dto: CreateFileAccessRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requestService.submit(id, dto, actor);
  }

  @Get('access-requests')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @ApiOperation({ summary: '這個資料夾的待審存取申請（需要能管理它的授權）' })
  @ApiZodResponse(200, FileAccessRequestListSchema)
  listAccessRequests(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.requestService.list(id, actor);
  }

  @Post('access-requests/:requestId/approve')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @HttpCode(204)
  @ApiOperation({ summary: '核准存取申請 ＝ 授予申請的等級（受反提權限制）' })
  @ApiZodBody(ReviewFileAccessRequestSchema)
  async approveAccessRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(new ZodValidationPipe(ReviewFileAccessRequestSchema.default({})))
    dto: ReviewFileAccessRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.requestService.approve(id, requestId, dto, actor);
  }

  @Post('access-requests/:requestId/reject')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @HttpCode(204)
  @ApiOperation({ summary: '駁回存取申請' })
  @ApiZodBody(ReviewFileAccessRequestSchema)
  async rejectAccessRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(new ZodValidationPipe(ReviewFileAccessRequestSchema.default({})))
    dto: ReviewFileAccessRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.requestService.reject(id, requestId, dto, actor);
  }

  @Get('grants')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @ApiOperation({ summary: '資料夾的授權：直接授權 ＋ 繼承自上層的（標出來源資料夾）' })
  @ApiZodResponse(200, FileFolderGrantListSchema)
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.grantService.list(id, actor);
  }

  @Put('grants')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @ApiOperation({ summary: '新增或變更一筆授權（同一對象只有一筆，變更等級是覆寫）' })
  @ApiZodBody(SetFileFolderGrantSchema)
  @ApiZodResponse(200, FileFolderGrantListSchema)
  set(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetFileFolderGrantSchema)) dto: SetFileFolderGrantDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grantService.set(id, dto, actor);
  }

  @Delete('grants/:subjectType/:subjectId')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @HttpCode(204)
  @ApiOperation({ summary: '移除一筆直接授權' })
  @ApiParam({ name: 'subjectType', enum: FILE_GRANT_SUBJECT_TYPES })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subjectType', new ZodValidationPipe(GrantSubjectTypeSchema))
    subjectType: FileGrantSubjectType,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.grantService.revoke(id, subjectType, subjectId, actor);
  }

  @Patch('access')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @ApiOperation({ summary: '中斷／恢復繼承（中斷時複製目前繼承到的授權）' })
  @ApiZodBody(UpdateFileFolderAccessSchema)
  @ApiZodResponse(200, FileFolderGrantListSchema)
  setInheritance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateFileFolderAccessSchema)) dto: UpdateFileFolderAccessDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grantService.setInheritance(id, dto, actor);
  }

  /**
   * 某位使用者為什麼能（不能）在這個資料夾做每個動作（docs/architecture/iam/01-model.md §9 G4b）。查自己不需要權限；查別人要 `authz:explain`
   * （service 判斷）。路徑上操作者讀不到的節點只回型別（D14）。
   */
  @Get('explain')
  @Authenticated()
  @ApiOperation({ summary: '使用者在這個資料夾的存取與路徑（自己，或需要 authz:explain）' })
  @ApiZodResponse(200, FileAccessExplainSchema)
  explain(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(FileAccessExplainQuerySchema)) query: FileAccessExplainQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.explainService.explainFolder(id, query.userId, actor);
  }

  @Get('grant-subjects')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_SHARE)
  @ApiOperation({ summary: '授權對象的候選清單（只回 id 與名稱）' })
  @ApiZodResponse(200, FileGrantSubjectListSchema)
  searchSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListFileGrantSubjectsSchema)) query: ListFileGrantSubjectsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grantService.searchSubjects(id, query, actor);
  }
}
