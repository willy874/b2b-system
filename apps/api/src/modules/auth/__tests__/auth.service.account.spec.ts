import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { describe, expect, it } from 'vitest';

import { DomainEvent } from '@/core/events';

import { inTenant, makeUser, setupAuthService, TX, USER_ID } from './auth.fixture';

const actor = { id: USER_ID, email: 'alice@example.com' } as never;
const STRONG = 'Correct-Horse-Battery-9';

function resourceChangedFor(events: { publish: { mock: { calls: unknown[][] } } }) {
  return events.publish.mock.calls.filter(([name]) => name === DomainEvent.RESOURCE_CHANGED);
}

describe('AuthService.getProfile / updateProfile（docs/architecture/backend/04-auth.md §6）', () => {
  it('帳號不存在 → USER_NOT_FOUND', async () => {
    const ctx = setupAuthService();
    await expect(inTenant(() => ctx.service.getProfile(actor))).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('回傳個人資料、角色、有效權限、租戶啟用的 feature 與 flag', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(
      makeUser({ lastLoginAt: new Date('2026-10-01T00:00:00Z') }),
    );

    const profile = await inTenant(() => ctx.service.getProfile(actor));
    expect(profile).toEqual({
      user: {
        id: USER_ID,
        email: 'alice@example.com',
        username: 'alice',
        displayName: 'Alice',
        avatar: null,
        avatarImageId: null,
        status: 'active',
        lastLoginAt: '2026-10-01T00:00:00.000Z',
        preferences: { locale: 'zh-TW', timezone: 'Asia/Taipei' },
      },
      roles: [{ id: 'role-1', name: 'Member' }],
      permissions: ['user:read'],
      features: ['user', 'role'],
      flags: ['beta'],
    });
  });

  it('從未登入過 → lastLoginAt 為 null', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    const profile = await inTenant(() => ctx.service.getProfile(actor));
    expect(profile.user.lastLoginAt).toBeNull();
  });

  it('更新個人資料 → 寫入、失效快取，並推播自己的 USER 變更（含角色 refs）', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());

    await inTenant(() =>
      ctx.service.updateProfile(
        { displayName: 'Alice W', preferences: { locale: 'en', timezone: 'UTC' } },
        actor,
      ),
    );
    expect(ctx.users.updateAccount).toHaveBeenCalledWith(USER_ID, {
      displayName: 'Alice W',
      locale: 'en',
      timezone: 'UTC',
      updatedBy: USER_ID,
    });
    expect(ctx.userCache.invalidate).toHaveBeenCalledWith(USER_ID);
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.USER,
          kind: ChangeKind.UPDATE,
          id: USER_ID,
          refs: { [ChangeSource.ROLE]: ['role-1'] },
        },
      ],
      affectedUserIds: [USER_ID],
    });
  });

  it('沒帶 preferences → 語系與時區不更新（undefined）', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    await inTenant(() => ctx.service.updateProfile({ displayName: 'A' } as never, actor));
    expect(ctx.users.updateAccount).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ locale: undefined, timezone: undefined }),
    );
  });
});

describe('AuthService.changePassword（docs/architecture/backend/04-auth.md §4、07-testing.md §8 認證）', () => {
  it.each([
    ['帳號不存在', undefined],
    ['帳號沒有密碼（只用 SSO）', makeUser({ passwordHash: null })],
  ])('%s → AUTH_PASSWORD_MISMATCH', async (_label, user) => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(user);
    await expect(
      inTenant(() =>
        ctx.service.changePassword({ currentPassword: 'x', newPassword: STRONG }, actor),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_PASSWORD_MISMATCH' });
    expect(ctx.passwords.verify).not.toHaveBeenCalled();
  });

  it('目前密碼錯誤 → AUTH_PASSWORD_MISMATCH 並寫失敗稽核（可追查猜密碼）', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    ctx.passwords.verify.mockResolvedValue(false);

    await expect(
      inTenant(() =>
        ctx.service.changePassword({ currentPassword: 'wrong', newPassword: STRONG }, actor),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_PASSWORD_MISMATCH' });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.password_change',
        result: 'failure',
        errorCode: 'AUTH_PASSWORD_MISMATCH',
      }),
    );
    expect(ctx.db.transaction).not.toHaveBeenCalled();
  });

  it('新密碼與目前相同 → AUTH_PASSWORD_WEAK', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    await expect(
      inTenant(() =>
        ctx.service.changePassword({ currentPassword: STRONG, newPassword: STRONG }, actor),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_PASSWORD_WEAK' });
  });

  it('短於租戶設定的最短長度 → VALIDATION_FAILED（欄位 newPassword、帶 minLength）', async () => {
    const ctx = setupAuthService({ settings: { 'auth.passwordMinLength': 30 } });
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    await expect(
      inTenant(() =>
        ctx.service.changePassword({ currentPassword: 'old', newPassword: STRONG }, actor),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { newPassword: 'AUTH_PASSWORD_WEAK' }, minLength: 30 },
    });
  });

  it.each([
    ['email 的帳號', 'Alice-is-the-best-2026'],
    ['email 的網域名稱', 'Welcome-to-Example-2026'],
    ['租戶代碼', 'Acme-rocks-forever-2026'],
  ])('密碼含%s → VALIDATION_FAILED', async (_label, newPassword) => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    await expect(
      inTenant(() => ctx.service.changePassword({ currentPassword: 'old', newPassword }, actor)),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { newPassword: 'AUTH_PASSWORD_WEAK' } },
    });
  });

  it('變更密碼 → 同一交易內更新雜湊、遞增 token_version、撤銷所有 refresh、寫稽核；交易後所有 session 失效', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountById.mockResolvedValue(makeUser());

    await expect(
      inTenant(() =>
        ctx.service.changePassword({ currentPassword: 'old', newPassword: STRONG }, actor),
      ),
    ).resolves.toEqual({ success: true });

    expect(ctx.users.updateAccount).toHaveBeenCalledWith(
      USER_ID,
      { passwordHash: `hash:${STRONG}`, updatedBy: USER_ID },
      TX,
    );
    expect(ctx.users.incrementTokenVersion).toHaveBeenCalledWith(USER_ID, TX);
    expect(ctx.refreshTokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, 'password_reset', TX);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_change', changes: null }),
      TX,
    );
    expect(ctx.userCache.invalidate).toHaveBeenCalledWith(USER_ID);
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.SESSIONS_REVOKED, {
      userIds: [USER_ID],
      reason: SessionRevokedReason.TOKEN_STALE,
    });
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.USER_CREDENTIAL, kind: ChangeKind.UPDATE, id: USER_ID }],
    });
    // 快取失效在交易之後
    expect(ctx.userCache.invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(
      ctx.audit.record.mock.invocationCallOrder[0]!,
    );
  });
});

describe('AuthService.register：註冊申請（docs/architecture/backend/20-approval.md §5）', () => {
  const dto = { email: 'New.User@Example.com', displayName: 'New', reason: '加入團隊' };

  it('未開放註冊 → AUTH_REGISTRATION_DISABLED', async () => {
    const ctx = setupAuthService({ settings: { 'auth.registrationEnabled': false } });
    await expect(ctx.service.register(dto)).rejects.toMatchObject({
      code: 'AUTH_REGISTRATION_DISABLED',
    });
  });

  it('只允許 SSO 的網域 → AUTH_SSO_REQUIRED，不送申請', async () => {
    const ctx = setupAuthService();
    ctx.identityProviders.isSsoOnly.mockResolvedValue(true);
    await expect(ctx.service.register(dto)).rejects.toMatchObject({ code: 'AUTH_SSO_REQUIRED' });
    expect(ctx.approvals.submit).not.toHaveBeenCalled();
  });

  it('email 已註冊 → 回應相同但不送申請（帳號列舉防護）', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser());
    await expect(ctx.service.register(dto)).resolves.toEqual({ submitted: true });
    expect(ctx.approvals.submit).not.toHaveBeenCalled();
  });

  it('新的 email → 送出審批申請（去重鍵不分大小寫，不含密碼）', async () => {
    const ctx = setupAuthService();
    await expect(ctx.service.register(dto)).resolves.toEqual({ submitted: true });
    expect(ctx.approvals.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKey: 'new.user@example.com',
        payload: { email: 'New.User@Example.com', displayName: 'New' },
        reason: '加入團隊',
      }),
    );
  });
});

describe('AuthService.forgotPassword：只允許 SSO 的網域（docs/architecture/04-sso.md §12.2 D9）', () => {
  it('不查帳號、不寄信，但照樣回 200（忘記密碼永遠成功）', async () => {
    const ctx = setupAuthService();
    ctx.identityProviders.isSsoOnly.mockResolvedValue(true);
    await expect(ctx.service.forgotPassword({ email: 'a@example.com' })).resolves.toEqual({
      sent: true,
    });
    expect(ctx.users.findAccountByEmail).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('寄信以使用者為鍵節流', async () => {
    const ctx = setupAuthService();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser());
    await ctx.service.forgotPassword({ email: 'a@example.com' });
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      { userId: USER_ID },
      { throttle: { key: USER_ID, seconds: expect.any(Number) } },
    );
  });
});

describe('AuthService.resetPassword（docs/architecture/backend/04-auth.md §5.2）', () => {
  const dto = { token: 'reset-token', newPassword: STRONG };

  it('token 不可用（不存在、過期或已用）→ AUTH_SETUP_TOKEN_INVALID', async () => {
    const ctx = setupAuthService();
    await expect(inTenant(() => ctx.service.resetPassword(dto))).rejects.toMatchObject({
      code: 'AUTH_SETUP_TOKEN_INVALID',
    });
    expect(ctx.authTokens.findUsable).toHaveBeenCalledWith('reset-token', 'password_reset');
  });

  it('token 的帳號不存在 → AUTH_SETUP_TOKEN_INVALID', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    await expect(inTenant(() => ctx.service.resetPassword(dto))).rejects.toMatchObject({
      code: 'AUTH_SETUP_TOKEN_INVALID',
    });
  });

  it('新密碼違反租戶政策 → VALIDATION_FAILED，不消耗 token', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    await expect(
      inTenant(() => ctx.service.resetPassword({ token: 't', newPassword: 'alice-2026-password' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(ctx.authTokens.markUsed).not.toHaveBeenCalled();
  });

  it('同一個連結併發送出、沒搶到 token → AUTH_SETUP_TOKEN_INVALID，不改密碼', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser());
    ctx.authTokens.markUsed.mockResolvedValue(false);

    await expect(inTenant(() => ctx.service.resetPassword(dto))).rejects.toMatchObject({
      code: 'AUTH_SETUP_TOKEN_INVALID',
    });
    expect(ctx.users.updateAccount).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('重設成功 → 清除失敗計數與鎖定、遞增 token_version、撤銷所有 refresh、session 失效；沒鎖定時不推播使用者變更', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser());

    await expect(inTenant(() => ctx.service.resetPassword(dto))).resolves.toEqual({
      success: true,
    });
    expect(ctx.authTokens.markUsed).toHaveBeenCalledWith('tok-1', TX);
    expect(ctx.users.updateAccount).toHaveBeenCalledWith(
      USER_ID,
      { passwordHash: `hash:${STRONG}`, failedLoginCount: 0, lockedUntil: null },
      TX,
    );
    expect(ctx.users.incrementTokenVersion).toHaveBeenCalledWith(USER_ID, TX);
    expect(ctx.refreshTokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, 'password_reset', TX);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset' }),
      TX,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.SESSIONS_REVOKED, {
      userIds: [USER_ID],
      reason: SessionRevokedReason.TOKEN_STALE,
    });
    const changes = resourceChangedFor(ctx.events);
    expect(changes).toHaveLength(1);
    expect(changes[0]![1]).toMatchObject({
      changes: [{ resource: ChangeSource.USER_CREDENTIAL }],
    });
  });

  it('鎖定中的帳號重設 → 順帶解鎖，另推播使用者狀態變更', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(
      makeUser({ lockedUntil: new Date(Date.now() + 600_000) }),
    );

    await inTenant(() => ctx.service.resetPassword(dto));
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [expect.objectContaining({ resource: ChangeSource.USER, id: USER_ID })],
      affectedUserIds: [USER_ID],
    });
  });
});

describe('AuthService.verifySetupToken / setup：帳號啟用（docs/architecture/backend/04-auth.md §5.1）', () => {
  it('token 不可用 → valid: false', async () => {
    const ctx = setupAuthService();
    await expect(ctx.service.verifySetupToken('t')).resolves.toEqual({ valid: false });
    expect(ctx.authTokens.findUsable).toHaveBeenCalledWith('t', 'activation');
  });

  it('pending 帳號 → valid 並帶 email', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser({ status: 'pending' }));
    await expect(ctx.service.verifySetupToken('t')).resolves.toEqual({
      valid: true,
      email: 'alice@example.com',
    });
  });

  it.each([
    ['已啟用', makeUser()],
    ['不存在', undefined],
  ])('帳號%s → valid: false', async (_label, user) => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(user);
    await expect(ctx.service.verifySetupToken('t')).resolves.toEqual({ valid: false });
  });

  it('token 不可用 → AUTH_SETUP_TOKEN_INVALID', async () => {
    const ctx = setupAuthService();
    await expect(
      inTenant(() => ctx.service.setup({ token: 't', password: STRONG })),
    ).rejects.toMatchObject({ code: 'AUTH_SETUP_TOKEN_INVALID' });
  });

  it.each([
    ['已停用（不能用舊的啟用信把自己改回 active）', makeUser({ status: 'inactive' })],
    ['已啟用', makeUser()],
    ['不存在', undefined],
  ])('帳號%s → AUTH_SETUP_TOKEN_INVALID', async (_label, user) => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(user);
    await expect(
      inTenant(() => ctx.service.setup({ token: 't', password: STRONG })),
    ).rejects.toMatchObject({ code: 'AUTH_SETUP_TOKEN_INVALID' });
    expect(ctx.db.transaction).not.toHaveBeenCalled();
  });

  it('密碼違反政策 → VALIDATION_FAILED（欄位 password）', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser({ status: 'pending' }));
    await expect(
      inTenant(() => ctx.service.setup({ token: 't', password: 'short' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { password: 'AUTH_PASSWORD_WEAK' } },
    });
  });

  it('沒搶到 token → AUTH_SETUP_TOKEN_INVALID，不改狀態', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser({ status: 'pending' }));
    ctx.authTokens.markUsed.mockResolvedValue(false);
    await expect(
      inTenant(() => ctx.service.setup({ token: 't', password: STRONG })),
    ).rejects.toMatchObject({ code: 'AUTH_SETUP_TOKEN_INVALID' });
    expect(ctx.users.updateAccount).not.toHaveBeenCalled();
  });

  it('啟用成功 → 設密碼並把 pending 改成 active、寫 user.activate 稽核與狀態事件，交易後推播', async () => {
    const ctx = setupAuthService();
    ctx.authTokens.findUsable.mockResolvedValue({ id: 'tok-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser({ status: 'pending' }));

    await expect(
      inTenant(() => ctx.service.setup({ token: 't', password: STRONG })),
    ).resolves.toEqual({ success: true });
    expect(ctx.authTokens.markUsed).toHaveBeenCalledWith('tok-1', TX);
    expect(ctx.users.updateAccount).toHaveBeenCalledWith(
      USER_ID,
      { passwordHash: `hash:${STRONG}`, status: 'active' },
      TX,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.activate', resourceName: 'alice@example.com' }),
      TX,
    );
    expect(ctx.users.emitStatusChanged).toHaveBeenCalledWith(USER_ID, 'active', 'pending', TX);
    expect(ctx.userCache.invalidate).toHaveBeenCalledWith(USER_ID);
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [expect.objectContaining({ resource: ChangeSource.USER, id: USER_ID })],
      affectedUserIds: [USER_ID],
    });
  });
});
