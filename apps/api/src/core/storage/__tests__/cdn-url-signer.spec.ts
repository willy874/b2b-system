import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runInTenantContext } from '../../tenant';
import type { TenantContext } from '../../tenant';
import { encodeCdnPath, NginxCdnUrlSigner, nginxCdnSignature } from '../cdn-url-signer';
import type { PresignedUrlSigner, SignObjectUrlOptions } from '../object-url-signer';
import { CDN_KEY_2 as KEY_2, cdnConfigOf } from './cdn.fixture';

const BUCKET = 'b2b-acme';
const NOW = new Date('2026-10-09T12:34:56.000Z');

function fakePresigned() {
  const sign = vi.fn(async (key: string, _options: SignObjectUrlOptions) => ({
    url: `https://files.example.test/storage/${BUCKET}/${key}?X-Amz-Signature=abc`,
    expiresAt: new Date('2026-10-09T13:00:00.000Z'),
  }));
  return { presigned: { sign } as unknown as PresignedUrlSigner, sign };
}

function inTenant<T>(fn: () => T): T {
  return runInTenantContext({ id: 't1', code: 'acme', storageBucket: BUCKET } as TenantContext, fn);
}

describe('NginxCdnUrlSigner（docs/architecture/backend/09-file.md §16.2）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('開放的資源簽成 <origin>/storage/<bucket>/<key>?exp&kid&sig：第一把金鑰簽發，簽的是 exp 與完整路徑', async () => {
    const { presigned, sign } = fakePresigned();
    const signer = new NginxCdnUrlSigner(presigned, cdnConfigOf());
    const signed = await inTenant(() =>
      signer.sign('images/a1/r3/sm.webp', { expiresIn: 3600, cdn: 'imageAsset' }),
    );

    expect(sign).not.toHaveBeenCalled();
    const url = new URL(signed.url);
    expect(url.origin).toBe('https://cdn.example.test');
    expect(url.pathname).toBe(`/storage/${BUCKET}/images/a1/r3/sm.webp`);
    expect(url.searchParams.get('kid')).toBe('k2');
    const exp = Number(url.searchParams.get('exp'));
    expect(url.searchParams.get('sig')).toBe(
      nginxCdnSignature(KEY_2, `/storage/${BUCKET}/images/a1/r3/sm.webp`, exp),
    );
    expect(signed.expiresAt.getTime()).toBe(exp * 1000);
  });

  it('exp 取整到效期一半的時間窗：同一個時間窗內網址相同，剩餘效期介於一半與全部之間', async () => {
    const signer = new NginxCdnUrlSigner(fakePresigned().presigned, cdnConfigOf());
    const sign = () =>
      inTenant(() =>
        signer.sign('variants/f1/preview.jpeg', { expiresIn: 900, cdn: 'fileVariant' }),
      );
    const first = await sign();
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const second = await sign();

    expect(second.url).toBe(first.url);
    const remaining = (first.expiresAt.getTime() - NOW.getTime()) / 1000;
    expect(remaining).toBeGreaterThan(450);
    expect(remaining).toBeLessThanOrEqual(900);
  });

  it('效期以 FILE_CDN_MAX_URL_TTL 封頂（docs/architecture/backend/09-file.md §17 D2）', async () => {
    const signer = new NginxCdnUrlSigner(
      fakePresigned().presigned,
      cdnConfigOf({ FILE_CDN_MAX_URL_TTL: '600' }),
    );
    const signed = await inTenant(() =>
      signer.sign('images/a1/r1/lg.jpg', { expiresIn: 12 * 3600, cdn: 'imageAsset' }),
    );
    expect(signed.expiresAt.getTime() - NOW.getTime()).toBeLessThanOrEqual(600_000);
  });

  it('路徑逐段編碼（@ 等），簽章用的是未編碼的路徑（邊緣以解碼後的 $uri 驗證）', async () => {
    const signer = new NginxCdnUrlSigner(fakePresigned().presigned, cdnConfigOf());
    const signed = await inTenant(() =>
      signer.sign('images/a1/r1/sm@2x.webp', { expiresIn: 3600, cdn: 'imageAsset' }),
    );
    expect(signed.url).toContain('/images/a1/r1/sm%402x.webp?');
    expect(encodeCdnPath('/storage/b/a b/x@2x.webp')).toBe('/storage/b/a%20b/x%402x.webp');
    const url = new URL(signed.url);
    expect(url.searchParams.get('sig')).toBe(
      nginxCdnSignature(
        KEY_2,
        `/storage/${BUCKET}/images/a1/r1/sm@2x.webp`,
        Number(url.searchParams.get('exp')),
      ),
    );
  });

  it.each<[string, SignObjectUrlOptions, Record<string, string>]>([
    ['沒標 cdn（原檔）', { expiresIn: 900 }, {}],
    [
      '不在 FILE_CDN_RESOURCES 裡',
      { expiresIn: 900, cdn: 'imageAsset' },
      { FILE_CDN_RESOURCES: 'fileVariant' },
    ],
    ['下載（attachment）', { expiresIn: 900, cdn: 'fileVariant', disposition: 'attachment' }, {}],
    [
      '覆寫 Content-Type',
      { expiresIn: 900, cdn: 'fileVariant', contentType: 'application/octet-stream' },
      {},
    ],
  ])('%s → 交給 presigned（§17 D4、D5）', async (_name, options, overrides) => {
    const { presigned, sign } = fakePresigned();
    const signer = new NginxCdnUrlSigner(presigned, cdnConfigOf(overrides));
    const signed = await inTenant(() => signer.sign('variants/f1/preview.jpeg', options));
    expect(sign).toHaveBeenCalledWith('variants/f1/preview.jpeg', options);
    expect(signed.url).toContain('X-Amz-Signature');
  });

  it('沒有租戶脈絡 → TENANT_NOT_FOUND（bucket 一個租戶一個，不退回任何共用的 bucket）', async () => {
    const signer = new NginxCdnUrlSigner(fakePresigned().presigned, cdnConfigOf());
    await expect(
      signer.sign('images/a1/r1/sm.jpg', { expiresIn: 900, cdn: 'imageAsset' }),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });
});

describe('CdnConfig（生效值，docs/architecture/backend/09-file.md §16.5）', () => {
  it('FILE_CDN_ENABLED=false：沒有部署、不走 CDN、不清理；其他 FILE_CDN_* 不檢查', () => {
    const config = cdnConfigOf({
      FILE_CDN_ENABLED: 'false',
      FILE_CDN_ORIGIN: 'not a url',
      FILE_CDN_SIGNING_KEYS: 'broken',
    });
    expect(config.isDeployed).toBe(false);
    expect(config.deployment).toBeUndefined();
    expect(config.servesResource('fileVariant')).toBe(false);
    expect(config.purgeOnDelete()).toBe(false);
  });

  it('FILE_CDN_RESOURCES 決定哪些資源走 CDN；FILE_CDN_PURGE_ON_DELETE 決定要不要清理', () => {
    const config = cdnConfigOf({
      FILE_CDN_RESOURCES: 'fileVariant',
      FILE_CDN_PURGE_ON_DELETE: 'false',
    });
    expect(config.servesResource('fileVariant')).toBe(true);
    expect(config.servesResource('imageAsset')).toBe(false);
    expect(config.servesResource(undefined)).toBe(false);
    expect(config.purgeOnDelete()).toBe(false);
    expect(config.deployment?.origin).toBe('https://cdn.example.test');
  });
});
