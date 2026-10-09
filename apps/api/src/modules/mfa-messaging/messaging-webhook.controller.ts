import { timingSafeEqual } from 'node:crypto';

import { Body, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '@/common/decorators';
import { AppException } from '@/core/errors';

import { LineChannel } from './line.channel';
import type { LineWebhookBody } from './line.channel';
import type { RequestWithRawBody } from './messaging-webhook.http';
import { LineMfaMethod, TelegramMfaMethod } from './messaging.method';
import { TelegramChannel } from './telegram.channel';
import type { TelegramUpdate } from './telegram.channel';

/**
 * 通訊軟體 Bot 的 webhook（docs/architecture/backend/21-mfa.md §9.5）：使用者把綁定碼傳給 Bot 時，Telegram／LINE 呼叫這裡。
 *
 * - `@Public()`：呼叫的是 Telegram／LINE 的伺服器；以它們的簽章認證（Telegram 的 secret token、LINE 的 HMAC 簽章），
 *   不符回 401，不處理內容。
 * - 不走速率限制：來源是少數幾個供應商的 IP，一般的每 IP 額度會在使用者多時擋下正常的通知；偽造的請求在簽章就被擋下。
 * - 處理失敗也回 200：供應商會重送失敗的通知，綁定碼只能用一次，重送沒有意義。
 * - 不在 OpenAPI：前端不會呼叫。
 */
@ApiExcludeController()
@Controller('mfa-channels')
@Public()
@SkipThrottle()
export class MessagingWebhookController {
  private readonly logger = new Logger(MessagingWebhookController.name);

  constructor(
    private readonly telegram: TelegramMfaMethod,
    private readonly telegramChannel: TelegramChannel,
    private readonly line: LineMfaMethod,
    private readonly lineChannel: LineChannel,
  ) {}

  @Post('telegram/webhook')
  @HttpCode(200)
  async telegramWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const settings = this.telegram.currentSettings();
    const token = settings?.botToken;
    if (!settings || !token || !sameSecret(secretToken, TelegramChannel.webhookSecretOf(token))) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }
    const message = this.telegramChannel.parse(update);
    if (message) {
      await this.telegram
        .handleInbound(settings, message)
        .catch((error: unknown) =>
          this.logger.error({ err: error }, '處理 Telegram 的 webhook 失敗'),
        );
    }
    return { ok: true };
  }

  @Post('line/webhook')
  @HttpCode(200)
  async lineWebhook(
    @Headers('x-line-signature') signature: string | undefined,
    @Req() request: RequestWithRawBody,
    @Body() body: LineWebhookBody,
  ): Promise<{ ok: true }> {
    const settings = this.line.currentSettings();
    const secret = settings?.channelSecret;
    if (
      !settings ||
      !secret ||
      !request.rawBody ||
      !LineChannel.verifySignature(secret, request.rawBody, signature)
    ) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }
    for (const message of this.lineChannel.parse(body)) {
      // oxlint-disable-next-line no-await-in-loop -- 一次通知通常只有一則；依序處理才不會同時回覆同一個人
      await this.line
        .handleInbound(settings, message)
        .catch((error: unknown) => this.logger.error({ err: error }, '處理 LINE 的 webhook 失敗'));
    }
    return { ok: true };
  }
}

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
