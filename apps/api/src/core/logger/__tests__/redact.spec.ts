import { describe, expect, it } from 'vitest';

import { redactRequest, redactUrl } from '../redact';

describe('日誌遮蔽（docs/conventions/03-backend.md §7）', () => {
  it('遮掉查詢字串裡的 token，保留其他參數', () => {
    expect(redactUrl('/auth/setup/verify?token=abc_123-XYZ')).toBe(
      '/auth/setup/verify?token=[Redacted]',
    );
    expect(redactUrl('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=[Redacted]&b=2');
    expect(redactUrl('/users?keyword=token')).toBe('/users?keyword=token');
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it('遮掉外部 IdP 回來的 code／state、完成外部登入的 ticket 與 OIDC 的 code_verifier／id_token_hint（SEC-15）', () => {
    expect(redactUrl('/oidc-interaction/external/callback?code=c0de&state=st4te&iss=x')).toBe(
      '/oidc-interaction/external/callback?code=[Redacted]&state=[Redacted]&iss=x',
    );
    expect(redactUrl('/oidc-interaction/u1/external/complete?ticket=t1')).toBe(
      '/oidc-interaction/u1/external/complete?ticket=[Redacted]',
    );
    expect(redactUrl('/oidc/session/end?id_token_hint=eyJ&code_verifier=v')).toBe(
      '/oidc/session/end?id_token_hint=[Redacted]&code_verifier=[Redacted]',
    );
    // 參數名稱只是剛好包含這些字的不遮
    expect(redactUrl('/files?zipcode=100&statement=1')).toBe('/files?zipcode=100&statement=1');
  });

  it('請求的 URL 與 Referer 都遮', () => {
    expect(
      redactRequest({
        url: '/auth/setup/verify?token=secret',
        headers: { referer: 'http://localhost:5173/auth/setup?token=secret', host: 'x' },
      }),
    ).toEqual({
      url: '/auth/setup/verify?token=[Redacted]',
      headers: { referer: 'http://localhost:5173/auth/setup?token=[Redacted]', host: 'x' },
    });
  });
});
