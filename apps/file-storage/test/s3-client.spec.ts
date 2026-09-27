import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { type FileStorageConfig, S3_MIN_PART_SIZE } from '@/config';
import { createFileStorageServer } from '@/server';
import { DiskStore } from '@/storage/disk-store';

const credentials = { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' };
const ALLOWED_ORIGIN = 'http://localhost:5173';

let dataDir: string;
let server: Server;
let endpoint: string;
let client: S3Client;

async function startServer(): Promise<void> {
  const config: FileStorageConfig = {
    host: '127.0.0.1',
    port: 0,
    basePath: '',
    dataDir,
    region: 'us-east-1',
    credentials,
    allowedOrigins: [ALLOWED_ORIGIN],
    maxObjectSize: 64 * 1024 * 1024,
    minPartSize: S3_MIN_PART_SIZE,
  };
  const store = await DiskStore.open(dataDir);
  server = createFileStorageServer({ config, store, isAccessLogEnabled: false });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
}

async function stopServer(): Promise<void> {
  client.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 斷言 SDK 丟出的例外帶有 S3 錯誤碼與 HTTP 狀態碼。 */
async function expectS3Error(promise: Promise<unknown>, name: string, status: number) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(S3ServiceException);
  expect((error as S3ServiceException).name).toBe(name);
  expect((error as S3ServiceException).$metadata.httpStatusCode).toBe(status);
}

let bucketSeq = 0;
async function newBucket(): Promise<string> {
  bucketSeq += 1;
  const bucket = `bucket-${bucketSeq}`;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return bucket;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'file-storage-'));
  await startServer();
});

afterAll(async () => {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
});

describe('Bucket 操作', () => {
  it('CreateBucket 後 ListBuckets / HeadBucket 看得到', async () => {
    const bucket = await newBucket();
    const { Buckets } = await client.send(new ListBucketsCommand({}));
    expect(Buckets?.map((item) => item.Name)).toContain(bucket);
    const head = await client.send(new HeadBucketCommand({ Bucket: bucket }));
    expect(head.$metadata.httpStatusCode).toBe(200);
  });

  it('重複建立回 BucketAlreadyOwnedByYou', async () => {
    const bucket = await newBucket();
    await expectS3Error(
      client.send(new CreateBucketCommand({ Bucket: bucket })),
      'BucketAlreadyOwnedByYou',
      409,
    );
  });

  it('不合法的名稱回 InvalidBucketName', async () => {
    await expectS3Error(
      client.send(new CreateBucketCommand({ Bucket: 'Invalid_Name' })),
      'InvalidBucketName',
      400,
    );
  });

  it('非空的 bucket 不能刪；清空後可以', async () => {
    const bucket = await newBucket();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'a.txt', Body: 'a' }));
    await expectS3Error(
      client.send(new DeleteBucketCommand({ Bucket: bucket })),
      'BucketNotEmpty',
      409,
    );
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'a.txt' }));
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    await expectS3Error(client.send(new HeadBucketCommand({ Bucket: bucket })), 'NotFound', 404);
  });

  it('不存在的 bucket 回 NoSuchBucket', async () => {
    await expectS3Error(
      client.send(new PutObjectCommand({ Bucket: 'missing-bucket', Key: 'a', Body: 'a' })),
      'NoSuchBucket',
      404,
    );
  });
});

describe('Object 操作', () => {
  it('PutObject → GetObject 取回內容、標頭與 x-amz-meta-*', async () => {
    const bucket = await newBucket();
    const put = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'assets/角色/hero.json',
        Body: '{"hp":100}',
        ContentType: 'application/json',
        CacheControl: 'max-age=60',
        Metadata: { author: 'willy' },
      }),
    );
    expect(put.ETag).toMatch(/^"[0-9a-f]{32}"$/);

    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'assets/角色/hero.json' }),
    );
    expect(await got.Body?.transformToString()).toBe('{"hp":100}');
    expect(got.ContentType).toBe('application/json');
    expect(got.CacheControl).toBe('max-age=60');
    expect(got.Metadata).toEqual({ author: 'willy' });
    expect(got.ETag).toBe(put.ETag);
    expect(got.ContentLength).toBe(10);
  });

  it('ETag 是內容的 MD5', async () => {
    const bucket = await newBucket();
    const put = await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: 'k', Body: 'hello' }),
    );
    expect(put.ETag).toBe('"5d41402abc4b2a76b9719d911017c592"');
  });

  it('未指定 Content-Type 時為 binary/octet-stream', async () => {
    const bucket = await newBucket();
    // SDK 會自己補 Content-Type，改用 presigned URL ＋ ArrayBuffer body（fetch 不會帶 Content-Type）
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: 'raw' }), {
      expiresIn: 60,
    });
    const put = await fetch(url, { method: 'PUT', body: new Uint8Array([1, 2, 3]).buffer });
    expect(put.status).toBe(200);
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: 'raw' }));
    expect(head.ContentType).toBe('binary/octet-stream');
  });

  it('串流 body（aws-chunked）也能上傳', async () => {
    const bucket = await newBucket();
    const content = 'x'.repeat(200_000);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'stream.txt',
        Body: Readable.from([content.slice(0, 100_000), content.slice(100_000)]),
        ContentLength: content.length,
      }),
    );
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'stream.txt' }));
    expect(await got.Body?.transformToString()).toBe(content);
  });

  it('空物件', async () => {
    const bucket = await newBucket();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'empty', Body: '' }));
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'empty' }));
    expect(await got.Body?.transformToString()).toBe('');
    expect(got.ETag).toBe('"d41d8cd98f00b204e9800998ecf8427e"');
  });

  it('Range 讀取回 206 與 Content-Range', async () => {
    const bucket = await newBucket();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'r', Body: '0123456789' }));
    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'r', Range: 'bytes=2-5' }),
    );
    expect(got.$metadata.httpStatusCode).toBe(206);
    expect(got.ContentRange).toBe('bytes 2-5/10');
    expect(await got.Body?.transformToString()).toBe('2345');

    const suffix = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'r', Range: 'bytes=-3' }),
    );
    expect(await suffix.Body?.transformToString()).toBe('789');

    await expectS3Error(
      client.send(new GetObjectCommand({ Bucket: bucket, Key: 'r', Range: 'bytes=20-' })),
      'InvalidRange',
      416,
    );
  });

  it('If-None-Match 命中回 304、If-Match 不符回 412', async () => {
    const bucket = await newBucket();
    const put = await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'c', Body: 'c' }));
    // 304 沒有 body，SDK 無從得知錯誤碼，只看狀態碼
    const notModified = await client
      .send(new GetObjectCommand({ Bucket: bucket, Key: 'c', IfNoneMatch: put.ETag }))
      .catch((error: S3ServiceException) => error);
    expect((notModified as S3ServiceException).$metadata.httpStatusCode).toBe(304);
    await expectS3Error(
      client.send(new GetObjectCommand({ Bucket: bucket, Key: 'c', IfMatch: '"nope"' })),
      'PreconditionFailed',
      412,
    );
  });

  it('PutObject 的 If-None-Match: * 在物件已存在時回 412', async () => {
    const bucket = await newBucket();
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: 'once', Body: '1', IfNoneMatch: '*' }),
    );
    await expectS3Error(
      client.send(
        new PutObjectCommand({ Bucket: bucket, Key: 'once', Body: '2', IfNoneMatch: '*' }),
      ),
      'PreconditionFailed',
      412,
    );
  });

  it('Content-MD5 不符回 BadDigest', async () => {
    const bucket = await newBucket();
    await expectS3Error(
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: 'md5',
          Body: 'abc',
          ContentMD5: Buffer.alloc(16).toString('base64'),
        }),
      ),
      'BadDigest',
      400,
    );
  });

  it('不存在的 key：GetObject 回 NoSuchKey、HeadObject 回 404、DeleteObject 仍回 204', async () => {
    const bucket = await newBucket();
    await expectS3Error(
      client.send(new GetObjectCommand({ Bucket: bucket, Key: 'nope' })),
      'NoSuchKey',
      404,
    );
    await expectS3Error(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: 'nope' })),
      'NotFound',
      404,
    );
    const deleted = await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'nope' }));
    expect(deleted.$metadata.httpStatusCode).toBe(204);
  });

  it('覆寫物件後讀到新內容', async () => {
    const bucket = await newBucket();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'v', Body: 'old' }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'v', Body: 'new' }));
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'v' }));
    expect(await got.Body?.transformToString()).toBe('new');
  });

  it('CopyObject：預設沿用中繼資料，REPLACE 時換成新的', async () => {
    const bucket = await newBucket();
    const target = await newBucket();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'src/a b+c.txt',
        Body: 'copy me',
        ContentType: 'text/plain',
        Metadata: { tag: 'one' },
      }),
    );

    const copied = await client.send(
      new CopyObjectCommand({
        Bucket: target,
        Key: 'dst.txt',
        CopySource: `${bucket}/src/a%20b%2Bc.txt`,
      }),
    );
    expect(copied.CopyObjectResult?.ETag).toBeDefined();
    const head = await client.send(new HeadObjectCommand({ Bucket: target, Key: 'dst.txt' }));
    expect(head.ContentType).toBe('text/plain');
    expect(head.Metadata).toEqual({ tag: 'one' });

    await client.send(
      new CopyObjectCommand({
        Bucket: target,
        Key: 'dst.txt',
        CopySource: `${target}/dst.txt`,
        MetadataDirective: 'REPLACE',
        ContentType: 'application/octet-stream',
        Metadata: { tag: 'two' },
      }),
    );
    const replaced = await client.send(new GetObjectCommand({ Bucket: target, Key: 'dst.txt' }));
    expect(replaced.Metadata).toEqual({ tag: 'two' });
    expect(await replaced.Body?.transformToString()).toBe('copy me');
  });

  it('複製到自己且不改中繼資料回 InvalidRequest', async () => {
    const bucket = await newBucket();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'self', Body: 'x' }));
    await expectS3Error(
      client.send(
        new CopyObjectCommand({ Bucket: bucket, Key: 'self', CopySource: `${bucket}/self` }),
      ),
      'InvalidRequest',
      400,
    );
  });

  it('DeleteObjects 一次刪多個', async () => {
    const bucket = await newBucket();
    for (const key of ['a', 'b', 'c']) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: key }));
    }
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: [{ Key: 'a' }, { Key: 'b' }, { Key: 'missing' }] },
      }),
    );
    expect(result.Deleted?.map((item) => item.Key).toSorted()).toEqual(['a', 'b', 'missing']);
    const list = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(list.Contents?.map((item) => item.Key)).toEqual(['c']);
  });
});

describe('ListObjects', () => {
  const keys = ['a.txt', 'dir/1.txt', 'dir/2.txt', 'dir/sub/3.txt', 'other/4.txt', 'z.txt'];
  let bucket: string;

  beforeAll(async () => {
    bucket = await newBucket();
    for (const key of keys) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: key }));
    }
  });

  it('V2：delimiter 把子目錄折成 CommonPrefixes', async () => {
    const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Delimiter: '/' }));
    expect(result.Contents?.map((item) => item.Key)).toEqual(['a.txt', 'z.txt']);
    expect(result.CommonPrefixes?.map((item) => item.Prefix)).toEqual(['dir/', 'other/']);
    expect(result.KeyCount).toBe(4);
  });

  it('V2：prefix ＋ delimiter', async () => {
    const result = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'dir/', Delimiter: '/' }),
    );
    expect(result.Contents?.map((item) => item.Key)).toEqual(['dir/1.txt', 'dir/2.txt']);
    expect(result.CommonPrefixes?.map((item) => item.Prefix)).toEqual(['dir/sub/']);
  });

  it('V2：以 continuation token 分頁可完整走完', async () => {
    const seen: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 2, ContinuationToken: token }),
      );
      seen.push(...(page.Contents ?? []).map((item) => item.Key ?? ''));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    expect(seen).toEqual(keys);
  });

  it('V2：分頁停在 common prefix 時，下一頁不重複該 prefix', async () => {
    const first = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Delimiter: '/', MaxKeys: 2 }),
    );
    expect(first.Contents?.map((item) => item.Key)).toEqual(['a.txt']);
    expect(first.CommonPrefixes?.map((item) => item.Prefix)).toEqual(['dir/']);
    const second = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Delimiter: '/',
        MaxKeys: 2,
        ContinuationToken: first.NextContinuationToken,
      }),
    );
    expect(second.CommonPrefixes?.map((item) => item.Prefix)).toEqual(['other/']);
    expect(second.Contents?.map((item) => item.Key)).toEqual(['z.txt']);
    expect(second.IsTruncated).toBe(false);
  });

  it('V2：start-after', async () => {
    const result = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, StartAfter: 'dir/2.txt' }),
    );
    expect(result.Contents?.map((item) => item.Key)).toEqual([
      'dir/sub/3.txt',
      'other/4.txt',
      'z.txt',
    ]);
  });

  it('V1：marker 分頁', async () => {
    const result = await client.send(
      new ListObjectsCommand({ Bucket: bucket, Marker: 'dir/sub/3.txt' }),
    );
    expect(result.Contents?.map((item) => item.Key)).toEqual(['other/4.txt', 'z.txt']);
  });
});

describe('Multipart upload', () => {
  it('分段上傳後合併，ETag 為 <md5>-<段數>', async () => {
    const bucket = await newBucket();
    const { UploadId } = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: 'big.bin',
        ContentType: 'application/x-test',
      }),
    );
    const part1 = Buffer.alloc(S3_MIN_PART_SIZE, 1);
    const part2 = Buffer.from('tail');
    const uploaded = [];
    for (const [index, body] of [part1, part2].entries()) {
      const { ETag } = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: 'big.bin',
          UploadId,
          PartNumber: index + 1,
          Body: body,
        }),
      );
      uploaded.push({ ETag, PartNumber: index + 1 });
    }
    const completed = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: 'big.bin',
        UploadId,
        MultipartUpload: { Parts: uploaded },
      }),
    );
    expect(completed.ETag).toMatch(/^"[0-9a-f]{32}-2"$/);

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: 'big.bin' }));
    expect(head.ContentLength).toBe(part1.length + part2.length);
    expect(head.ContentType).toBe('application/x-test');
    const tail = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'big.bin', Range: `bytes=${part1.length}-` }),
    );
    expect(await tail.Body?.transformToString()).toBe('tail');
  });

  it('ListMultipartUploads：列出未完成的上傳、prefix 篩選、marker 分頁；完成或放棄後消失', async () => {
    const bucket = await newBucket();
    const start = async (key: string) =>
      (await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }))).UploadId;
    const a1 = await start('files/a');
    const a2 = await start('files/a');
    const b = await start('files/b');
    await start('other/c');

    const all = await client.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: 'files/' }),
    );
    expect(all.IsTruncated).toBe(false);
    expect(all.Uploads?.map((upload) => [upload.Key, upload.UploadId])).toEqual([
      ['files/a', a1],
      ['files/a', a2],
      ['files/b', b],
    ]);
    expect(all.Uploads?.[0]?.Initiated).toBeInstanceOf(Date);

    // 分頁停在同一個 key 的兩個上傳之間
    const first = await client.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: 'files/', MaxUploads: 1 }),
    );
    expect(first).toMatchObject({
      IsTruncated: true,
      NextKeyMarker: 'files/a',
      NextUploadIdMarker: a1,
    });
    const rest = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: 'files/',
        KeyMarker: first.NextKeyMarker,
        UploadIdMarker: first.NextUploadIdMarker,
      }),
    );
    expect(rest.Uploads?.map((upload) => upload.UploadId)).toEqual([a2, b]);

    await client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: 'files/b', UploadId: b }),
    );
    const after = await client.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: 'files/', KeyMarker: 'files/a' }),
    );
    expect(after.Uploads ?? []).toEqual([]);
  });

  it('非最後一段小於 5 MiB 回 EntityTooSmall', async () => {
    const bucket = await newBucket();
    const { UploadId } = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'small' }),
    );
    const parts = [];
    for (const partNumber of [1, 2]) {
      const { ETag } = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: 'small',
          UploadId,
          PartNumber: partNumber,
          Body: 'x',
        }),
      );
      parts.push({ ETag, PartNumber: partNumber });
    }
    await expectS3Error(
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: 'small',
          UploadId,
          MultipartUpload: { Parts: parts },
        }),
      ),
      'EntityTooSmall',
      400,
    );
  });

  it('ETag 對不上回 InvalidPart；順序錯回 InvalidPartOrder', async () => {
    const bucket = await newBucket();
    const { UploadId } = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'bad' }),
    );
    const { ETag } = await client.send(
      new UploadPartCommand({ Bucket: bucket, Key: 'bad', UploadId, PartNumber: 1, Body: 'x' }),
    );
    await expectS3Error(
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: 'bad',
          UploadId,
          MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"0000"' }] },
        }),
      ),
      'InvalidPart',
      400,
    );
    await expectS3Error(
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: 'bad',
          UploadId,
          MultipartUpload: {
            Parts: [
              { PartNumber: 2, ETag },
              { PartNumber: 1, ETag },
            ],
          },
        }),
      ),
      'InvalidPartOrder',
      400,
    );
  });

  it('AbortMultipartUpload 之後再上傳 part 回 NoSuchUpload', async () => {
    const bucket = await newBucket();
    const { UploadId } = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'gone' }),
    );
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: 'gone', UploadId }));
    await expectS3Error(
      client.send(
        new UploadPartCommand({ Bucket: bucket, Key: 'gone', UploadId, PartNumber: 1, Body: 'x' }),
      ),
      'NoSuchUpload',
      404,
    );
  });
});

describe('驗證（SigV4）', () => {
  it('secret 錯誤回 SignatureDoesNotMatch', async () => {
    const wrong = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { ...credentials, secretAccessKey: 'wrong-secret' },
    });
    await expectS3Error(wrong.send(new ListBucketsCommand({})), 'SignatureDoesNotMatch', 403);
    wrong.destroy();
  });

  it('access key 不存在回 InvalidAccessKeyId', async () => {
    const wrong = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { ...credentials, accessKeyId: 'unknown-key' },
    });
    await expectS3Error(wrong.send(new ListBucketsCommand({})), 'InvalidAccessKeyId', 403);
    wrong.destroy();
  });

  it('任何 region 的簽章都接受', async () => {
    const other = new S3Client({
      endpoint,
      region: 'ap-northeast-1',
      forcePathStyle: true,
      credentials,
    });
    const result = await other.send(new ListBucketsCommand({}));
    expect(result.$metadata.httpStatusCode).toBe(200);
    other.destroy();
  });

  it('匿名請求回 AccessDenied', async () => {
    const response = await fetch(`${endpoint}/`);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('<Code>AccessDenied</Code>');
  });
});

describe('Presigned URL 與 CORS', () => {
  it('presigned PUT 上傳、presigned GET 下載（含 response-content-disposition）', async () => {
    const bucket = await newBucket();
    const putUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: 'upload/圖 1.png', ContentType: 'image/png' }),
      { expiresIn: 60 },
    );
    const put = await fetch(putUrl, {
      method: 'PUT',
      body: 'png-bytes',
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/);

    const getUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: 'upload/圖 1.png',
        ResponseContentDisposition: 'attachment; filename="a.png"',
      }),
      { expiresIn: 60 },
    );
    const got = await fetch(getUrl, { headers: { Origin: ALLOWED_ORIGIN } });
    expect(got.status).toBe(200);
    expect(await got.text()).toBe('png-bytes');
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('content-disposition')).toBe('attachment; filename="a.png"');
    expect(got.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });

  it('presigned URL 被竄改回 SignatureDoesNotMatch', async () => {
    const bucket = await newBucket();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: 'a' }), {
      expiresIn: 60,
    });
    const response = await fetch(url.replace('/a?', '/b?'));
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('<Code>SignatureDoesNotMatch</Code>');
  });

  it('過期的 presigned URL 回 AccessDenied', async () => {
    const bucket = await newBucket();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: 'a' }), {
      expiresIn: 1,
      signingDate: new Date(Date.now() - 10_000),
    });
    const response = await fetch(url);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Request has expired');
  });

  it('允許的 Origin 通過 preflight；其他 Origin 回 403', async () => {
    const allowed = await fetch(`${endpoint}/any/key`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers.get('access-control-allow-headers')).toBe('content-type');

    const denied = await fetch(`${endpoint}/any/key`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(denied.status).toBe(403);
  });
});

describe('持久化', () => {
  it('重新啟動後 bucket 與物件仍在', async () => {
    const bucket = await newBucket();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'persist.txt',
        Body: 'still here',
        Metadata: { a: '1' },
      }),
    );
    await stopServer();
    await startServer();

    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'persist.txt' }));
    expect(await got.Body?.transformToString()).toBe('still here');
    expect(got.Metadata).toEqual({ a: '1' });
  });
});

describe('掛在子路徑下（FILE_STORAGE_BASE_PATH）', () => {
  let prefixed: Server;
  let prefixedClient: S3Client;
  let prefixedEndpoint: string;

  beforeAll(async () => {
    const store = await DiskStore.open(join(dataDir, 'prefixed'));
    prefixed = createFileStorageServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        basePath: '/storage',
        dataDir: join(dataDir, 'prefixed'),
        region: 'us-east-1',
        credentials,
        allowedOrigins: [],
        maxObjectSize: 1024 * 1024,
        minPartSize: S3_MIN_PART_SIZE,
      },
      store,
      isAccessLogEnabled: false,
    });
    await new Promise<void>((resolve) => prefixed.listen(0, '127.0.0.1', resolve));
    prefixedEndpoint = `http://127.0.0.1:${(prefixed.address() as AddressInfo).port}`;
    prefixedClient = new S3Client({
      endpoint: `${prefixedEndpoint}/storage`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
    });
  });

  afterAll(async () => {
    prefixedClient.destroy();
    prefixed.closeAllConnections();
    await new Promise<void>((resolve) => prefixed.close(() => resolve()));
  });

  it('SDK 的 endpoint 帶上前綴即可正常存取（簽章涵蓋前綴）', async () => {
    await prefixedClient.send(new CreateBucketCommand({ Bucket: 'prefixed' }));
    await prefixedClient.send(
      new PutObjectCommand({ Bucket: 'prefixed', Key: 'a/b.txt', Body: 'ok' }),
    );
    const url = await getSignedUrl(
      prefixedClient,
      new GetObjectCommand({ Bucket: 'prefixed', Key: 'a/b.txt' }),
      { expiresIn: 60 },
    );
    expect(new URL(url).pathname).toBe('/storage/prefixed/a/b.txt');
    expect(await (await fetch(url)).text()).toBe('ok');
  });

  it('不在前綴底下的路徑回 InvalidURI', async () => {
    const response = await fetch(`${prefixedEndpoint}/prefixed/a/b.txt`);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('<Code>InvalidURI</Code>');
  });

  it('/_health 不需要簽章', async () => {
    expect((await fetch(`${prefixedEndpoint}/_health`)).status).toBe(200);
    expect((await fetch(`${prefixedEndpoint}/storage/_health`)).status).toBe(200);
  });
});
