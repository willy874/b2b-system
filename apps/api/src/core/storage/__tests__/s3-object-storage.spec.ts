import { S3ServiceException } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import type { Database } from '../../database';
import { runInTenantContext } from '../../tenant';
import type { TenantDirectory } from '../../tenant';
import { isValidBucketName } from '../object-storage';
import { S3ObjectStorage } from '../s3-object-storage';

interface SentCommand {
  constructor: { name: string };
  input: { Bucket?: string; Key?: string };
}

function notFound() {
  return new S3ServiceException({
    name: 'NotFound',
    $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });
}

function setup(existingBuckets: string[] = []) {
  const config = {
    get: vi.fn(
      (key: string) =>
        ({
          NODE_ENV: 'test',
          FILE_STORAGE_REGION: 'us-east-1',
          FILE_STORAGE_ACCESS_KEY_ID: 'key',
          FILE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
          FILE_STORAGE_ENDPOINT: 'http://127.0.0.1:9000/storage',
          FILE_STORAGE_PUBLIC_ENDPOINT: 'http://localhost:5173/storage',
        })[key],
    ),
  } as unknown as ConfigService<Env, true>;
  const storage = new S3ObjectStorage(config, {} as TenantDirectory);
  const sent: SentCommand[] = [];
  const buckets = new Set(existingBuckets);
  const send = vi.fn(async (command: SentCommand) => {
    sent.push(command);
    const name = command.constructor.name;
    if (name === 'HeadBucketCommand' && !buckets.has(command.input.Bucket!)) throw notFound();
    if (name === 'CreateBucketCommand') buckets.add(command.input.Bucket!);
    if (name === 'HeadObjectCommand') throw notFound();
    return {};
  });
  (storage as unknown as { client: { send: typeof send } }).client = { send };
  return { storage, sent, buckets };
}

const inTenant = <T>(bucket: string, fn: () => T) =>
  runInTenantContext({ id: bucket, code: bucket, db: {} as Database, storageBucket: bucket }, fn);

describe('S3ObjectStorage：每個租戶一個 bucket（docs/adr/0020-physical-tenant-isolation.md D16）', () => {
  it('每個操作都用目前租戶的 bucket', async () => {
    const { storage, sent } = setup();
    await inTenant('b2b-acme', () => storage.head('files/1'));
    await inTenant('b2b-beta', () => storage.delete('files/1'));
    expect(sent.map((command) => command.input.Bucket)).toEqual(['b2b-acme', 'b2b-beta']);
  });

  it('列出物件（檔案維護的對帳）只看目前租戶的 bucket', async () => {
    const { storage, sent } = setup();
    await inTenant('b2b-acme', async () => {
      for await (const _ of storage.listObjects('files/')) void _;
    });
    expect(sent[0]?.input.Bucket).toBe('b2b-acme');
  });

  it('沒有租戶脈絡時拋 TENANT_NOT_FOUND，不會退回共用的 bucket', async () => {
    const { storage, sent } = setup();
    await expect(storage.head('files/1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    expect(sent).toHaveLength(0);
  });

  it('ensureBucket 分別確認每個租戶的 bucket，不存在就建立', async () => {
    const { storage, buckets } = setup(['b2b-acme']);
    await inTenant('b2b-acme', () => storage.ensureBucket());
    await inTenant('b2b-beta', () => storage.ensureBucket());
    expect([...buckets].toSorted()).toEqual(['b2b-acme', 'b2b-beta']);
  });

  it('bucket 名稱要符合 S3 的命名規則', () => {
    expect(isValidBucketName('b2b-acme')).toBe(true);
    for (const name of ['B2B', 'ab', 'a..b', '-acme', 'acme_1']) {
      expect(isValidBucketName(name)).toBe(false);
    }
  });
});
