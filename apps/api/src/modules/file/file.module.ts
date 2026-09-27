import { Module } from '@nestjs/common';

import { FileController } from './file.controller';
import { FileRepository } from './file.repository';
import { FileService } from './file.service';

/**
 * 檔案的轉介層：對外只有 `files` 資料表的 id，物件儲存（`core/storage`）藏在後面。
 * 其他模組要引用檔案時存 `files.id`，並注入 `FileService`。
 */
@Module({
  controllers: [FileController],
  providers: [FileService, FileRepository],
  exports: [FileService],
})
export class FileModule {}
