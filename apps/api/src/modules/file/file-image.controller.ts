import { Controller, Get, Headers, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { Public } from '@/common/decorators';
import { ZodValidationPipe } from '@/core/validation';

import { GetFileImageSchema, ImageVariantSchema } from './dto/get-file-image.dto';
import type { GetFileImageDto } from './dto/get-file-image.dto';
import { FileImageService } from './file-image.service';
import { IMAGE_VARIANTS } from './file.constants';
import type { ImageVariant } from './file.constants';

/**
 * 影像 API 不在工作區前綴底下：它不經過成員資格檢查，而以網址簽章授權；
 * 簽章只從看得到該檔案的回應拿得到（docs/adr/0018-workspace-tenancy.md D8 的例外）。
 */
@ApiTags('files')
@Controller('files')
export class FileImageController {
  constructor(private readonly fileImageService: FileImageService) {}

  /**
   * 影像 API：`<img src>` 帶不了 access token，所以是 `@Public()`，改以網址簽章授權
   * （網址只從看得到該檔案的回應拿得到，docs/architecture/backend/09-file.md §5.4）。
   * 不限流：一頁的圖示預覽就有數十個請求，轉址又會被瀏覽器快取；格式轉換只在第一次發生。
   */
  @Get(':id/image/:variant')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: '取得圖片的原圖／全螢幕預覽／圖示預覽（302 轉址到物件儲存）' })
  @ApiParam({ name: 'variant', enum: IMAGE_VARIANTS })
  @ApiResponse({ status: 302, description: '轉址到該版本、該格式的內容' })
  async getImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variant', new ZodValidationPipe(ImageVariantSchema)) variant: ImageVariant,
    @Query(new ZodValidationPipe(GetFileImageSchema)) query: GetFileImageDto,
    @Headers('accept') accept: string | undefined,
    @Res() res: Response,
  ) {
    const target = await this.fileImageService.resolve(id, variant, query, accept);
    // 轉址本身也快取：同一個時間窗內重抓列表，瀏覽器不必再問 api
    res
      .set({ 'Cache-Control': `private, max-age=${target.maxAge}`, Vary: 'Accept' })
      .redirect(302, target.url);
  }
}
