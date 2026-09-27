import { createHash, type Hash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { type Readable, Transform, type TransformCallback } from 'node:stream';

import type { PayloadMode } from '@/auth/sigv4';
import { S3Error } from '@/s3/errors';

import { AwsChunkedDecoder } from './aws-chunked';

/** body 讀完時比對 `x-amz-content-sha256`；不符就讓串流以錯誤結束，儲存層會丟棄暫存檔。 */
class Sha256Verifier extends Transform {
  private readonly hash: Hash = createHash('sha256');

  constructor(private readonly expected: string) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.hash.update(chunk);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    const actual = this.hash.digest('hex');
    callback(
      actual === this.expected
        ? null
        : new S3Error('XAmzContentSHA256Mismatch', undefined, {
            ClientComputedContentSHA256: this.expected,
            S3ComputedContentSHA256: actual,
          }),
    );
  }
}

/** 依簽章方式包裝請求 body：解 aws-chunked、驗 SHA-256，或原樣讀取。 */
export function openBody(req: IncomingMessage, mode: PayloadMode): Readable {
  switch (mode.kind) {
    case 'unsigned':
      return req;
    case 'sha256':
      return forward(req, new Sha256Verifier(mode.hash));
    case 'aws-chunked':
      return forward(req, new AwsChunkedDecoder());
  }
}

function forward(source: Readable, target: Transform): Transform {
  source.on('error', (error) => target.destroy(error));
  return source.pipe(target);
}

/** 讀出整個 body（只給 XML 這類小型請求用）；超過 `limit` 位元組回 `MaxMessageLengthExceeded`。 */
export async function readBodyBuffer(body: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      body.destroy();
      throw new S3Error('MaxMessageLengthExceeded');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
