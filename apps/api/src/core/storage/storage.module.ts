import { Global, Module } from '@nestjs/common';

import { JobQueue } from '../jobs';
import { CdnConfig } from './cdn-config';
import { CdnPurgeJob, CdnPurger, NoopCdnPurger, QueuedCdnPurger } from './cdn-purger';
import { NginxCdnUrlSigner } from './cdn-url-signer';
import { ObjectStorage } from './object-storage';
import { ObjectUrlSigner, PresignedUrlSigner } from './object-url-signer';
import { S3ObjectStorage } from './s3-object-storage';

/**
 * 全域提供 `ObjectStorage`、`ObjectUrlSigner`、`CdnPurger`、`CdnConfig`；實作在這裡選定，注入端只認抽象類別。
 * 沒有 CDN（`FILE_CDN_ENABLED=false`）時簽章是 presigned、清理是 no-op，與沒有這個功能時完全相同
 * （docs/architecture/backend/09-file.md §16.4）。
 */
@Global()
@Module({
  providers: [
    { provide: ObjectStorage, useClass: S3ObjectStorage },
    CdnConfig,
    PresignedUrlSigner,
    {
      provide: ObjectUrlSigner,
      inject: [CdnConfig, PresignedUrlSigner],
      useFactory: (config: CdnConfig, presigned: PresignedUrlSigner): ObjectUrlSigner =>
        config.isDeployed ? new NginxCdnUrlSigner(presigned, config) : presigned,
    },
    {
      provide: CdnPurger,
      inject: [CdnConfig, JobQueue],
      useFactory: (config: CdnConfig, jobs: JobQueue): CdnPurger =>
        config.isDeployed ? new QueuedCdnPurger(jobs, config) : new NoopCdnPurger(),
    },
    CdnPurgeJob,
  ],
  exports: [ObjectStorage, ObjectUrlSigner, CdnPurger, CdnConfig],
})
export class StorageModule {}
