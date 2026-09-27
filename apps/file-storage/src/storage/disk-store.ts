import { createHash, type Hash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { etagMatches } from '@/s3/conditions';
import { S3Error } from '@/s3/errors';

import { KeyedLock } from './keyed-lock';
import type {
  BucketInfo,
  MultipartUpload,
  ObjectHeaders,
  ObjectWriteOptions,
  StoredObject,
  UploadedPart,
} from './types';

/**
 * 把 bucket / object 存在本機磁碟上。
 *
 * ```
 * <root>/
 * ├── buckets/<bucket>/
 * │   ├── bucket.json
 * │   ├── objects/<sha256(key)>.json   物件中繼資料（key、ETag、標頭、x-amz-meta-*）
 * │   └── blobs/<uuid>                 物件內容
 * ├── uploads/<uploadId>/
 * │   ├── upload.json
 * │   └── <partNumber>.part / .json
 * └── tmp/                             接收中的內容；啟動時清空
 * ```
 *
 * 中繼資料在啟動時全部載入記憶體，列表與 HEAD 不碰磁碟。
 * 寫入一律「先寫到 tmp → rename 進目標位置」，中途失敗不會留下半個物件。
 */

interface BucketState {
  info: BucketInfo;
  objects: Map<string, StoredObject>;
  /** 依 UTF-8 位元組排序的物件清單快取；有寫入就作廢。 */
  sorted: StoredObject[] | undefined;
}

interface PersistedObject {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
  headers: ObjectHeaders;
  metadata: Record<string, string>;
  blob: string;
}

interface PersistedUpload {
  uploadId: string;
  bucket: string;
  key: string;
  initiatedAt: string;
  headers: ObjectHeaders;
  metadata: Record<string, string>;
}

interface ReceivedFile {
  path: string;
  size: number;
  md5: Buffer;
}

export interface ByteRange {
  start: number;
  /** 含 end（與 HTTP Range 相同）。 */
  end: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** 邊收邊算 MD5 與長度；超過上限立即中止，不把整個超大 body 讀完。 */
class Digester extends Transform {
  readonly md5: Hash = createHash('md5');
  size = 0;

  constructor(private readonly maxSize: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.maxSize) {
      callback(new S3Error('EntityTooLarge'));
      return;
    }
    this.md5.update(chunk);
    callback(null, chunk);
  }
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export class DiskStore {
  private readonly buckets = new Map<string, BucketState>();
  private readonly uploads = new Map<string, MultipartUpload>();
  private readonly locks = new KeyedLock();

  private constructor(private readonly root: string) {}

  /** 開啟（必要時建立）資料目錄並把中繼資料載入記憶體。 */
  static async open(root: string): Promise<DiskStore> {
    const store = new DiskStore(resolve(root));
    await store.load();
    return store;
  }

  // ── bucket ─────────────────────────────────────────

  listBuckets(): BucketInfo[] {
    return [...this.buckets.values()]
      .map((state) => state.info)
      .toSorted((a, b) => compareUtf8(a.name, b.name));
  }

  getBucket(name: string): BucketInfo {
    return this.requireBucket(name).info;
  }

  async createBucket(name: string): Promise<BucketInfo> {
    if (this.buckets.has(name))
      throw new S3Error('BucketAlreadyOwnedByYou', undefined, { BucketName: name });
    const info: BucketInfo = { name, createdAt: new Date() };
    // 先佔位，避免兩個並行的 CreateBucket 都以為自己是第一個
    this.buckets.set(name, { info, objects: new Map(), sorted: undefined });
    try {
      await mkdir(join(this.bucketDir(name), 'objects'), { recursive: true });
      await mkdir(join(this.bucketDir(name), 'blobs'), { recursive: true });
      await this.writeJsonAtomic(join(this.bucketDir(name), 'bucket.json'), {
        name,
        createdAt: info.createdAt.toISOString(),
      });
    } catch (error) {
      this.buckets.delete(name);
      throw error;
    }
    return info;
  }

  async deleteBucket(name: string): Promise<void> {
    const state = this.requireBucket(name);
    if (state.objects.size > 0)
      throw new S3Error('BucketNotEmpty', undefined, { BucketName: name });
    this.buckets.delete(name);
    const pending = [...this.uploads.values()].filter((upload) => upload.bucket === name);
    for (const upload of pending) this.uploads.delete(upload.uploadId);
    await Promise.all(
      pending.map((upload) =>
        rm(this.uploadDir(upload.uploadId), { recursive: true, force: true }),
      ),
    );
    await rm(this.bucketDir(name), { recursive: true, force: true });
  }

  // ── object ─────────────────────────────────────────

  /** 依 UTF-8 位元組排序（與 S3 的 ListObjects 順序相同）。 */
  listObjects(bucket: string): readonly StoredObject[] {
    const state = this.requireBucket(bucket);
    state.sorted ??= [...state.objects.values()].toSorted((a, b) => compareUtf8(a.key, b.key));
    return state.sorted;
  }

  getObject(bucket: string, key: string): StoredObject {
    const object = this.requireBucket(bucket).objects.get(key);
    if (!object) throw new S3Error('NoSuchKey', undefined, { Key: key });
    return object;
  }

  /**
   * 先開檔再回傳串流：開檔成功後即使物件被覆寫（舊內容檔被刪），已開啟的讀取仍會完整讀完。
   */
  async openObject(bucket: string, object: StoredObject, range?: ByteRange): Promise<Readable> {
    try {
      const handle = await open(this.blobPath(bucket, object.blob), 'r');
      return handle.createReadStream(range ? { start: range.start, end: range.end } : {});
    } catch (error) {
      if (isNotFound(error)) throw new S3Error('NoSuchKey', undefined, { Key: object.key });
      throw error;
    }
  }

  async putObject(
    bucket: string,
    key: string,
    body: Readable,
    options: ObjectWriteOptions,
  ): Promise<StoredObject> {
    this.assertWriteConditions(bucket, key, options);
    const received = await this.receive(body, options.maxSize);
    try {
      if (options.expectedSize !== undefined && received.size !== options.expectedSize) {
        throw new S3Error('IncompleteBody');
      }
      if (
        options.contentMd5 !== undefined &&
        received.md5.toString('base64') !== options.contentMd5
      ) {
        throw new S3Error('BadDigest');
      }
      return await this.commit(
        bucket,
        key,
        received.path,
        {
          size: received.size,
          etag: `"${received.md5.toString('hex')}"`,
          headers: options.headers,
          metadata: options.metadata,
        },
        options,
      );
    } finally {
      await rm(received.path, { force: true });
    }
  }

  async copyObject(
    source: { bucket: string; key: string },
    target: { bucket: string; key: string },
    replacement: { headers: ObjectHeaders; metadata: Readonly<Record<string, string>> } | undefined,
  ): Promise<StoredObject> {
    const original = this.getObject(source.bucket, source.key);
    this.requireBucket(target.bucket);
    const received = await this.receive(
      await this.openObject(source.bucket, original),
      Number.POSITIVE_INFINITY,
    );
    try {
      return await this.commit(target.bucket, target.key, received.path, {
        size: received.size,
        etag: `"${received.md5.toString('hex')}"`,
        headers: replacement?.headers ?? original.headers,
        metadata: replacement?.metadata ?? original.metadata,
      });
    } finally {
      await rm(received.path, { force: true });
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.requireBucket(bucket);
    await this.locks.run(this.objectLockKey(bucket, key), async () => {
      const state = this.buckets.get(bucket);
      const previous = state?.objects.get(key);
      if (!state || !previous) return;
      await rm(this.metaPath(bucket, key), { force: true });
      state.objects.delete(key);
      state.sorted = undefined;
      await rm(this.blobPath(bucket, previous.blob), { force: true });
    });
  }

  // ── multipart upload ───────────────────────────────

  async createMultipartUpload(
    bucket: string,
    key: string,
    headers: ObjectHeaders,
    metadata: Readonly<Record<string, string>>,
  ): Promise<MultipartUpload> {
    this.requireBucket(bucket);
    const upload: MultipartUpload = {
      uploadId: randomBytes(24).toString('base64url'),
      bucket,
      key,
      initiatedAt: new Date(),
      headers,
      metadata,
    };
    await mkdir(this.uploadDir(upload.uploadId), { recursive: true });
    await this.writeJsonAtomic(join(this.uploadDir(upload.uploadId), 'upload.json'), {
      ...upload,
      initiatedAt: upload.initiatedAt.toISOString(),
    } satisfies PersistedUpload);
    this.uploads.set(upload.uploadId, upload);
    return upload;
  }

  getUpload(uploadId: string, bucket: string, key: string): MultipartUpload {
    this.requireBucket(bucket);
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.bucket !== bucket || upload.key !== key) {
      throw new S3Error('NoSuchUpload', undefined, { UploadId: uploadId });
    }
    return upload;
  }

  async uploadPart(
    upload: MultipartUpload,
    partNumber: number,
    body: Readable,
    options: Pick<ObjectWriteOptions, 'expectedSize' | 'contentMd5' | 'maxSize'>,
  ): Promise<UploadedPart> {
    const received = await this.receive(body, options.maxSize);
    try {
      if (options.expectedSize !== undefined && received.size !== options.expectedSize) {
        throw new S3Error('IncompleteBody');
      }
      if (
        options.contentMd5 !== undefined &&
        received.md5.toString('base64') !== options.contentMd5
      ) {
        throw new S3Error('BadDigest');
      }
      const part: UploadedPart = {
        partNumber,
        etag: `"${received.md5.toString('hex')}"`,
        size: received.size,
      };
      await this.locks.run(this.uploadLockKey(upload.uploadId), async () => {
        if (!this.uploads.has(upload.uploadId)) {
          throw new S3Error('NoSuchUpload', undefined, { UploadId: upload.uploadId });
        }
        const dir = this.uploadDir(upload.uploadId);
        await rename(received.path, join(dir, `${partNumber}.part`));
        await this.writeJsonAtomic(join(dir, `${partNumber}.json`), part);
      });
      return part;
    } finally {
      await rm(received.path, { force: true });
    }
  }

  async completeMultipartUpload(
    upload: MultipartUpload,
    parts: readonly CompletedPart[],
    minPartSize: number,
  ): Promise<StoredObject> {
    return this.locks.run(this.uploadLockKey(upload.uploadId), async () => {
      if (!this.uploads.has(upload.uploadId)) {
        throw new S3Error('NoSuchUpload', undefined, { UploadId: upload.uploadId });
      }
      if (parts.length === 0) throw new S3Error('MalformedXML');
      const dir = this.uploadDir(upload.uploadId);

      if (
        parts.some(
          (part, index) => index > 0 && part.partNumber <= (parts[index - 1]?.partNumber ?? 0),
        )
      ) {
        throw new S3Error('InvalidPartOrder');
      }

      const stored: UploadedPart[] = [];
      for (const requested of parts) {
        const part = await readJson<UploadedPart>(join(dir, `${requested.partNumber}.json`));
        if (!part || !etagMatches(requested.etag, part.etag)) {
          throw new S3Error('InvalidPart', undefined, {
            PartNumber: String(requested.partNumber),
            ETag: requested.etag,
          });
        }
        stored.push(part);
      }
      stored.forEach((part, index) => {
        if (index < stored.length - 1 && part.size < minPartSize) {
          throw new S3Error('EntityTooSmall', undefined, {
            PartNumber: String(part.partNumber),
            ProposedSize: String(part.size),
            MinSizeAllowed: String(minPartSize),
          });
        }
      });

      const temp = join(this.tmpDir, randomUUID());
      try {
        await pipeline(async function* () {
          for (const part of stored) yield* createReadStream(join(dir, `${part.partNumber}.part`));
        }, createWriteStream(temp));
        // multipart 的 ETag：各段 MD5（二進位）串起來再取 MD5，後綴段數
        const combined = createHash('md5');
        for (const part of stored)
          combined.update(Buffer.from(part.etag.replaceAll('"', ''), 'hex'));
        const object = await this.commit(upload.bucket, upload.key, temp, {
          size: stored.reduce((sum, part) => sum + part.size, 0),
          etag: `"${combined.digest('hex')}-${stored.length}"`,
          headers: upload.headers,
          metadata: upload.metadata,
        });
        this.uploads.delete(upload.uploadId);
        await rm(dir, { recursive: true, force: true });
        return object;
      } finally {
        await rm(temp, { force: true });
      }
    });
  }

  async abortMultipartUpload(upload: MultipartUpload): Promise<void> {
    await this.locks.run(this.uploadLockKey(upload.uploadId), async () => {
      if (!this.uploads.delete(upload.uploadId)) {
        throw new S3Error('NoSuchUpload', undefined, { UploadId: upload.uploadId });
      }
      await rm(this.uploadDir(upload.uploadId), { recursive: true, force: true });
    });
  }

  // ── 內部 ───────────────────────────────────────────

  private get tmpDir(): string {
    return join(this.root, 'tmp');
  }

  private bucketDir(bucket: string): string {
    return join(this.root, 'buckets', bucket);
  }

  private metaPath(bucket: string, key: string): string {
    return join(this.bucketDir(bucket), 'objects', `${sha256Hex(key)}.json`);
  }

  private blobPath(bucket: string, blob: string): string {
    return join(this.bucketDir(bucket), 'blobs', blob);
  }

  private uploadDir(uploadId: string): string {
    return join(this.root, 'uploads', uploadId);
  }

  private objectLockKey(bucket: string, key: string): string {
    return `object:${bucket}\u0000${key}`;
  }

  private uploadLockKey(uploadId: string): string {
    return `upload:${uploadId}`;
  }

  private requireBucket(name: string): BucketState {
    const state = this.buckets.get(name);
    if (!state) throw new S3Error('NoSuchBucket', undefined, { BucketName: name });
    return state;
  }

  private assertWriteConditions(
    bucket: string,
    key: string,
    conditions: Pick<ObjectWriteOptions, 'ifMatch' | 'ifNoneMatch'>,
  ): void {
    const existing = this.requireBucket(bucket).objects.get(key);
    if (conditions.ifNoneMatch !== undefined && existing) {
      throw new S3Error('PreconditionFailed', undefined, { Condition: 'If-None-Match' });
    }
    if (conditions.ifMatch !== undefined) {
      if (!existing) throw new S3Error('NoSuchKey', undefined, { Key: key });
      if (!etagMatches(conditions.ifMatch, existing.etag)) {
        throw new S3Error('PreconditionFailed', undefined, { Condition: 'If-Match' });
      }
    }
  }

  private async receive(body: Readable, maxSize: number): Promise<ReceivedFile> {
    const path = join(this.tmpDir, randomUUID());
    const digester = new Digester(maxSize);
    try {
      await pipeline(body, digester, createWriteStream(path));
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    return { path, size: digester.size, md5: digester.md5.digest() };
  }

  /**
   * 把 tmp 裡的內容檔變成物件。同一個 key 依序執行；
   * 條件式寫入在鎖內再檢查一次，避免兩個 `If-None-Match: *` 的並行上傳都成功。
   */
  private commit(
    bucket: string,
    key: string,
    tempPath: string,
    fields: Pick<StoredObject, 'size' | 'etag' | 'headers' | 'metadata'>,
    conditions: Pick<ObjectWriteOptions, 'ifMatch' | 'ifNoneMatch'> = {
      ifMatch: undefined,
      ifNoneMatch: undefined,
    },
  ): Promise<StoredObject> {
    return this.locks.run(this.objectLockKey(bucket, key), async () => {
      this.assertWriteConditions(bucket, key, conditions);
      const state = this.requireBucket(bucket);
      const previous = state.objects.get(key);

      const object: StoredObject = {
        ...fields,
        key,
        lastModified: new Date(),
        blob: randomUUID(),
      };
      await rename(tempPath, this.blobPath(bucket, object.blob));
      try {
        await this.writeJsonAtomic(this.metaPath(bucket, key), {
          ...object,
          metadata: { ...object.metadata },
          lastModified: object.lastModified.toISOString(),
        } satisfies PersistedObject);
      } catch (error) {
        await rm(this.blobPath(bucket, object.blob), { force: true });
        throw error;
      }

      state.objects.set(key, object);
      state.sorted = undefined;
      if (previous) await rm(this.blobPath(bucket, previous.blob), { force: true });
      return object;
    });
  }

  private async writeJsonAtomic(path: string, data: unknown): Promise<void> {
    const temp = join(this.tmpDir, randomUUID());
    await writeFile(temp, JSON.stringify(data));
    await rename(temp, path);
  }

  private async load(): Promise<void> {
    await rm(this.tmpDir, { recursive: true, force: true });
    await mkdir(this.tmpDir, { recursive: true });
    await mkdir(join(this.root, 'buckets'), { recursive: true });
    await mkdir(join(this.root, 'uploads'), { recursive: true });

    for (const name of await listDir(join(this.root, 'buckets'))) {
      const persisted = await readJson<{ name: string; createdAt: string }>(
        join(this.bucketDir(name), 'bucket.json'),
      );
      if (!persisted) continue;
      const objects = new Map<string, StoredObject>();
      for (const file of await listDir(join(this.bucketDir(name), 'objects'))) {
        if (!file.endsWith('.json')) continue;
        const object = await readJson<PersistedObject>(join(this.bucketDir(name), 'objects', file));
        if (!object) continue;
        objects.set(object.key, { ...object, lastModified: new Date(object.lastModified) });
      }
      this.buckets.set(name, {
        info: { name, createdAt: new Date(persisted.createdAt) },
        objects,
        sorted: undefined,
      });
      await this.sweepOrphanBlobs(name, objects);
    }

    for (const uploadId of await listDir(join(this.root, 'uploads'))) {
      const upload = await readJson<PersistedUpload>(join(this.uploadDir(uploadId), 'upload.json'));
      if (!upload || !this.buckets.has(upload.bucket)) {
        await rm(this.uploadDir(uploadId), { recursive: true, force: true });
        continue;
      }
      this.uploads.set(uploadId, { ...upload, initiatedAt: new Date(upload.initiatedAt) });
    }
  }

  /** 內容檔已改名、中繼資料還沒寫入就當機時，會留下沒有人引用的內容檔。 */
  private async sweepOrphanBlobs(
    bucket: string,
    objects: ReadonlyMap<string, StoredObject>,
  ): Promise<void> {
    const referenced = new Set([...objects.values()].map((object) => object.blob));
    for (const blob of await listDir(join(this.bucketDir(bucket), 'blobs'))) {
      if (!referenced.has(blob)) await rm(this.blobPath(bucket, blob), { force: true });
    }
  }
}
