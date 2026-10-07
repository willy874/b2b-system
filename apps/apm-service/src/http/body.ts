import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { ApmError } from './errors';

/** 依 `Content-Encoding` 解壓縮；SDK 在 Node 端會 gzip，瀏覽器端不壓縮。 */
function decode(req: IncomingMessage): Readable {
  const encoding = (req.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  switch (encoding) {
    case 'identity':
    case '':
      return req;
    case 'gzip':
      return req.pipe(createGunzip());
    case 'deflate':
      return req.pipe(createInflate());
    case 'br':
      return req.pipe(createBrotliDecompress());
    default:
      throw new ApmError(415, `不支援的 Content-Encoding：${encoding}`);
  }
}

/**
 * 讀出整個 body（解壓縮之後）；超過 `limit` 位元組回 413。
 * 上限套在解壓縮後的大小，避免小小的 gzip 炸彈吃光記憶體。
 */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApmError(413, `內容超過 ${limit} 位元組`);
  }
  const stream = decode(req);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > limit) throw new ApmError(413, `內容超過 ${limit} 位元組`);
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof ApmError) throw error;
    throw new ApmError(400, '無法讀取或解壓縮內容');
  }
  return Buffer.concat(chunks);
}
