import { Global, Module } from '@nestjs/common';

import { ImageProcessor } from './image-processor';
import { SharpImageProcessor } from './sharp-image-processor';

/** 全域提供 `ImageProcessor`；實作在這裡選定，注入端只認抽象類別。 */
@Global()
@Module({
  providers: [{ provide: ImageProcessor, useClass: SharpImageProcessor }],
  exports: [ImageProcessor],
})
export class ImageModule {}
