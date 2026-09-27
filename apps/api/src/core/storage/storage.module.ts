import { Global, Module } from '@nestjs/common';

import { ObjectStorage } from './object-storage';
import { S3ObjectStorage } from './s3-object-storage';

/** 全域提供 `ObjectStorage`；實作在這裡選定，注入端只認抽象類別。 */
@Global()
@Module({
  providers: [{ provide: ObjectStorage, useClass: S3ObjectStorage }],
  exports: [ObjectStorage],
})
export class StorageModule {}
