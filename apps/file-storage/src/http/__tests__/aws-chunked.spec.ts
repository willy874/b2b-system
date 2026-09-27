import { Readable } from 'node:stream';

import { AwsChunkedDecoder } from '@/http/aws-chunked';
import { S3Error } from '@/s3/errors';

async function decode(pieces: readonly string[]): Promise<string> {
  const chunks: Buffer[] = [];
  const decoder = Readable.from(pieces.map((piece) => Buffer.from(piece, 'latin1'))).pipe(
    new AwsChunkedDecoder(),
  );
  for await (const chunk of decoder) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('latin1');
}

/** 把字串切成每次一個位元組，模擬最糟的 TCP 切割。 */
function byteByByte(value: string): string[] {
  return [...value];
}

describe('AwsChunkedDecoder', () => {
  const signed =
    '5;chunk-signature=aaaa\r\nhello\r\n6;chunk-signature=bbbb\r\n world\r\n0;chunk-signature=cccc\r\n\r\n';
  const unsignedWithTrailer = '5\r\nhello\r\n0\r\nx-amz-checksum-crc32:NhCmhg==\r\n\r\n';

  it('解出帶 chunk-signature 的內容', async () => {
    expect(await decode([signed])).toBe('hello world');
  });

  it('解出帶 trailer 的內容，trailer 不進輸出', async () => {
    expect(await decode([unsignedWithTrailer])).toBe('hello');
  });

  it('逐位元組送入也能正確解出', async () => {
    expect(await decode(byteByByte(signed))).toBe('hello world');
    expect(await decode(byteByByte(unsignedWithTrailer))).toBe('hello');
  });

  it('資料不完整時回 IncompleteBody', async () => {
    await expect(decode(['5\r\nhel'])).rejects.toSatisfy(
      (error: unknown) => error instanceof S3Error && error.code === 'IncompleteBody',
    );
  });
});
