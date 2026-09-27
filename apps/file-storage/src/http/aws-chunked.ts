import { Transform, type TransformCallback } from 'node:stream';

import { S3Error } from '@/s3/errors';

/**
 * 解 `Content-Encoding: aws-chunked` 的 body，輸出原始內容。
 * 格式（https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html）：
 *
 * ```
 * <hex size>[;chunk-signature=<sig>]\r\n<data>\r\n
 * …
 * 0[;chunk-signature=<sig>]\r\n
 * [<trailer-name>:<value>\r\n]*
 * \r\n
 * ```
 *
 * 尾端的 trailer（例：`x-amz-checksum-crc32`）只解析、不驗證。
 */

const MAX_LINE_LENGTH = 8 * 1024;
const CRLF = Buffer.from('\r\n');

type State = 'size-line' | 'data' | 'data-end' | 'trailer' | 'done';

export class AwsChunkedDecoder extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private state: State = 'size-line';
  private remaining = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    try {
      this.drain();
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    // 部分客戶端在最後一個 trailer 後不補空行；只要 0 長度塊已經出現就算完整
    const isComplete =
      this.state === 'done' || (this.state === 'trailer' && this.buffer.length === 0);
    callback(isComplete ? null : new S3Error('IncompleteBody'));
  }

  private readLine(): string | undefined {
    const end = this.buffer.indexOf(CRLF);
    if (end < 0) {
      if (this.buffer.length > MAX_LINE_LENGTH) throw new S3Error('IncompleteBody');
      return undefined;
    }
    const line = this.buffer.subarray(0, end).toString('latin1');
    this.buffer = this.buffer.subarray(end + CRLF.length);
    return line;
  }

  private drain(): void {
    for (;;) {
      switch (this.state) {
        case 'size-line': {
          const line = this.readLine();
          if (line === undefined) return;
          const size = Number.parseInt(line.split(';', 1)[0] ?? '', 16);
          if (!Number.isInteger(size) || size < 0) throw new S3Error('IncompleteBody');
          this.remaining = size;
          this.state = size === 0 ? 'trailer' : 'data';
          break;
        }
        case 'data': {
          if (this.buffer.length === 0) return;
          const take = Math.min(this.remaining, this.buffer.length);
          this.push(this.buffer.subarray(0, take));
          this.buffer = this.buffer.subarray(take);
          this.remaining -= take;
          if (this.remaining === 0) this.state = 'data-end';
          break;
        }
        case 'data-end': {
          if (this.buffer.length < CRLF.length) return;
          if (!this.buffer.subarray(0, CRLF.length).equals(CRLF)) {
            throw new S3Error('IncompleteBody');
          }
          this.buffer = this.buffer.subarray(CRLF.length);
          this.state = 'size-line';
          break;
        }
        case 'trailer': {
          const line = this.readLine();
          if (line === undefined) return;
          if (line === '') this.state = 'done';
          break;
        }
        case 'done':
          this.buffer = Buffer.alloc(0);
          return;
      }
    }
  }
}
