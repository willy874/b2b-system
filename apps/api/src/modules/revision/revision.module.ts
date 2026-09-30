import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { RevisionPruneJob } from './revision-prune.job';
import { RevisionRepository } from './revision.repository';
import { RevisionService } from './revision.service';
import { REVISION_SETTINGS } from './revision.settings';

/**
 * 版本歷史（docs/architecture/backend/14-revisions.md）。只依賴 core 與 db/schema，不 import 任何業務模組；
 * 加入的擁有者模組 import 它，在自己的交易內呼叫 `RevisionService.record()`，並提供自己的版本端點（ADR-0025 D1、D10）。
 */
@Module({
  providers: [RevisionService, RevisionRepository, RevisionPruneJob],
  exports: [RevisionService],
})
export class RevisionModule {
  constructor(settings: SettingService) {
    settings.register(REVISION_SETTINGS);
  }
}
