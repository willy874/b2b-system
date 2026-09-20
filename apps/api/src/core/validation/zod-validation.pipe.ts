import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Zod 失敗時直接拋 `ZodError`，由 `HttpExceptionFilter` 轉成
 * `VALIDATION_FAILED` ＋ `details.fields`（前端表單回填的契約）。
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): unknown {
    return this.schema.parse(value);
  }
}
