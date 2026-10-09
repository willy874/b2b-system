import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { JobQueue } from '@/core/jobs';

import { ChannelLinkRepository } from './channel-link.repository';
import { LineChannel } from './line.channel';
import { MessagingWebhookController } from './messaging-webhook.controller';
import { MFA_CHANNEL_LINK_CLEANUP_JOB } from './messaging.constants';
import { LineMfaMethod, TelegramMfaMethod } from './messaging.method';
import { TelegramChannel } from './telegram.channel';

/**
 * MFA 的方式：通訊軟體驗證碼（Telegram、LINE；docs/architecture/backend/21-mfa.md §9.5）。`AppModule` 匯入，啟動時登記進註冊表。
 * 只依賴 `core/mfa`；綁定存在平台 DB 的 `mfa_channel_links`（這個模組自己的表），Bot 的 webhook 也在這裡。
 */
@Module({
  controllers: [MessagingWebhookController],
  providers: [
    ChannelLinkRepository,
    TelegramChannel,
    LineChannel,
    TelegramMfaMethod,
    LineMfaMethod,
  ],
})
export class MfaMessagingModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobQueue,
    private readonly links: ChannelLinkRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(
      MFA_CHANNEL_LINK_CLEANUP_JOB,
      async () => ({ deleted: await this.links.deleteExpired() }),
      { cron: this.config.get('AUTH_TOKEN_CLEANUP_CRON', { infer: true }) },
    );
  }
}
