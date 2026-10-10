import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import {
  CreatedWebhookSchema,
  CreateWebhookSchema,
  ListWebhookDeliverySchema,
  ListWebhookSchema,
  UpdateWebhookSchema,
  WebhookDeliverySchema,
  WebhookEventListSchema,
  WebhookSchema,
  WebhookSecretSchema,
  WebhookTestResultSchema,
  GetWebhookUrlLimitSchema,
  WebhookUrlLimitSchema,
} from './dto/webhook.dto';
import type {
  CreateWebhookDto,
  ListWebhookDeliveryDto,
  ListWebhookDto,
  GetWebhookUrlLimitDto,
  UpdateWebhookDto,
} from './dto/webhook.dto';
import { WebhookService } from './webhook.service';

/** Webhook 訂閱與投遞紀錄（docs/architecture/backend/17-webhook.md §9.2 D6、D8）。 */
@ApiTags('webhooks')
@Controller('webhooks')
@RequireFeature('webhook')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get()
  @RequirePermissions(PERMISSION.WEBHOOK_READ)
  @ApiZodListResponse(200, WebhookSchema)
  list(@Query(new ZodValidationPipe(ListWebhookSchema)) query: ListWebhookDto) {
    return this.webhooks.list(query);
  }

  @Get('events')
  @RequirePermissions(PERMISSION.WEBHOOK_READ)
  @ApiOperation({ summary: '可以訂閱的對外事件（所屬 feature 已啟用）' })
  @ApiZodResponse(200, WebhookEventListSchema)
  listEvents() {
    return this.webhooks.listEvents();
  }

  @Get('url-limit')
  @RequirePermissions(PERMISSION.WEBHOOK_READ)
  @ApiOperation({ summary: '網址數的上限與這個訂閱還能有幾個網址（feature 參數 webhook.maxUrls）' })
  @ApiZodResponse(200, WebhookUrlLimitSchema)
  urlLimit(@Query(new ZodValidationPipe(GetWebhookUrlLimitSchema)) query: GetWebhookUrlLimitDto) {
    return this.webhooks.urlLimit(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.WEBHOOK_CREATE)
  @ApiOperation({ summary: '建立訂閱；回應的 secret 只出現這一次' })
  @ApiZodBody(CreateWebhookSchema)
  @ApiZodResponse(201, CreatedWebhookSchema)
  create(
    @Body(new ZodValidationPipe(CreateWebhookSchema)) dto: CreateWebhookDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.webhooks.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.WEBHOOK_READ)
  @ApiZodResponse(200, WebhookSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.WEBHOOK_UPDATE)
  @ApiOperation({ summary: '修改名稱、網址、事件，停用或啟用（啟用時失敗次數歸零）' })
  @ApiZodBody(UpdateWebhookSchema)
  @ApiZodResponse(200, WebhookSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateWebhookSchema)) dto: UpdateWebhookDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.webhooks.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.WEBHOOK_DELETE)
  @ApiOperation({ summary: '刪除；投遞紀錄一併刪除，不進回收桶' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.webhooks.remove(id);
  }

  @Post(':id/rotate-secret')
  @RequirePermissions(PERMISSION.WEBHOOK_UPDATE)
  @ApiOperation({ summary: '輪替密鑰：新的立即生效、舊的立即失效；新的 secret 只出現這一次' })
  @ApiZodResponse(201, WebhookSecretSchema)
  rotateSecret(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.webhooks.rotateSecret(id, actor);
  }

  @Post(':id/test')
  @RequirePermissions(PERMISSION.WEBHOOK_UPDATE)
  @ApiOperation({ summary: '同步送出 webhook.ping，回傳這一次的投遞紀錄' })
  @ApiZodResponse(201, WebhookTestResultSchema)
  sendTest(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.sendTest(id);
  }

  @Get(':id/deliveries')
  @RequirePermissions(PERMISSION.WEBHOOK_READ)
  @ApiOperation({ summary: '投遞紀錄（每一次嘗試一筆，新的在前；保留 30 天）' })
  @ApiZodListResponse(200, WebhookDeliverySchema)
  listDeliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListWebhookDeliverySchema)) query: ListWebhookDeliveryDto,
  ) {
    return this.webhooks.listDeliveries(id, query);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @RequirePermissions(PERMISSION.WEBHOOK_UPDATE)
  @ApiOperation({ summary: '同步重送那一筆紀錄的事件（事件 id 不變），回傳這一次的投遞紀錄' })
  @ApiZodResponse(201, WebhookDeliverySchema)
  redeliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooks.redeliver(id, deliveryId);
  }
}
