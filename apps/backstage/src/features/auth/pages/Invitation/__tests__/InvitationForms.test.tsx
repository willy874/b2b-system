import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CoreAuth from '@/core/auth';
import type { AcceptedWorkspaceInvitation, WorkspaceInvitationPreview } from '@/shared/api-sdk';
import { renderWithPermissions } from '@/test/renderWithPermissions';

import { ExistingAccountForm } from '../components/ExistingAccountForm';
import { NewAccountForm } from '../components/NewAccountForm';

const { signup, accept, login, enter, session, profile } = vi.hoisted(() => ({
  signup: vi.fn(),
  accept: vi.fn(),
  login: vi.fn(),
  enter: vi.fn(),
  session: { has: false },
  profile: vi.fn(),
}));

vi.mock('@/apis/workspace/signup-workspace-invitation/mutation', () => ({
  getSignupWorkspaceInvitationMutationOptions: () => ({ mutationFn: signup }),
}));
vi.mock('@/apis/workspace/accept-workspace-invitation/mutation', () => ({
  getAcceptWorkspaceInvitationMutationOptions: () => ({ mutationFn: accept }),
}));
vi.mock('@/apis/auth/login/mutation', () => ({
  getLoginMutationOptions: () => ({ mutationFn: login }),
}));
vi.mock('@/apis/auth/get-profile/query', () => ({
  AUTH_PROFILE_QUERY_KEY: 'AUTH_PROFILE_QUERY_KEY',
  getAuthProfileQueryOptions: () => ({ queryKey: ['AUTH_PROFILE_QUERY_KEY'], queryFn: profile }),
}));
vi.mock('../../../hooks/useEnterInvitedWorkspace', () => ({
  useEnterInvitedWorkspace: () => enter,
}));
vi.mock('@/core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreAuth>()),
  useHasSession: () => session.has,
}));

const TOKEN = 'invitation-token-123';
const ACCEPTED: AcceptedWorkspaceInvitation = {
  email: 'artist@example.com',
  workspace: { id: 'ws-1', slug: 'art', name: '美術' },
};

function preview(hasAccount: boolean): WorkspaceInvitationPreview {
  return {
    email: 'artist@example.com',
    workspaceName: '美術',
    inviterName: '管理員',
    hasAccount,
    expiresAt: '2026-10-06T00:00:00.000Z',
  };
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => {
  signup.mockReset().mockResolvedValue(ACCEPTED);
  accept.mockReset().mockResolvedValue(ACCEPTED);
  login.mockReset().mockResolvedValue({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 });
  enter.mockReset();
  profile.mockReset();
  session.has = false;
});

describe('NewAccountForm（沒有帳號，docs/adr/0018-workspace-tenancy.md D14）', () => {
  it('建立帳號 → 以剛設定的密碼登入 → 進入工作區', async () => {
    renderWithPermissions(<NewAccountForm token={TOKEN} invitation={preview(false)} />);
    expect(screen.getByTestId('invitation-email')).toHaveValue('artist@example.com');
    type('invitation-display-name', '外包美術');
    type('invitation-password', 'InviteFlow!Pass2026');
    type('invitation-confirm', 'InviteFlow!Pass2026');
    fireEvent.click(screen.getByTestId('invitation-submit'));

    await waitFor(() => expect(enter).toHaveBeenCalledWith(ACCEPTED));
    expect(signup.mock.calls[0]?.[0]).toEqual({
      params: { token: TOKEN, displayName: '外包美術', password: 'InviteFlow!Pass2026' },
    });
    expect(login.mock.calls[0]?.[0]).toEqual({
      params: { email: 'artist@example.com', password: 'InviteFlow!Pass2026' },
    });
  });

  it('兩次密碼不同時不送出', async () => {
    renderWithPermissions(<NewAccountForm token={TOKEN} invitation={preview(false)} />);
    type('invitation-display-name', '外包美術');
    type('invitation-password', 'InviteFlow!Pass2026');
    type('invitation-confirm', 'Different!Pass2026');
    fireEvent.click(screen.getByTestId('invitation-submit'));
    expect(await screen.findByText('passwords do not match')).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it('建立失敗時不登入、不導向', async () => {
    signup.mockRejectedValue(new Error('WORKSPACE_INVITATION_INVALID'));
    renderWithPermissions(<NewAccountForm token={TOKEN} invitation={preview(false)} />);
    type('invitation-display-name', '外包美術');
    type('invitation-password', 'InviteFlow!Pass2026');
    type('invitation-confirm', 'InviteFlow!Pass2026');
    fireEvent.click(screen.getByTestId('invitation-submit'));
    await waitFor(() => expect(signup).toHaveBeenCalled());
    expect(login).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
  });
});

describe('ExistingAccountForm（已有帳號）', () => {
  it('沒登入：以受邀的 email 登入後接受並進入工作區', async () => {
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    type('invitation-login-password', 'OutsiderPassword!2026');
    fireEvent.click(screen.getByTestId('invitation-login-submit'));

    await waitFor(() => expect(enter).toHaveBeenCalledWith(ACCEPTED));
    expect(login.mock.calls[0]?.[0]).toEqual({
      params: { email: 'artist@example.com', password: 'OutsiderPassword!2026' },
    });
    expect(accept.mock.calls[0]?.[0]).toEqual({ params: { token: TOKEN } });
  });

  it('登入失敗時不接受', async () => {
    login.mockRejectedValue(new Error('AUTH_INVALID_CREDENTIALS'));
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    type('invitation-login-password', 'wrong');
    fireEvent.click(screen.getByTestId('invitation-login-submit'));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(accept).not.toHaveBeenCalled();
  });

  it('已登入受邀的帳號：直接接受', async () => {
    session.has = true;
    profile.mockResolvedValue({ user: { email: 'Artist@Example.com' } });
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    fireEvent.click(await screen.findByTestId('invitation-accept'));
    await waitFor(() => expect(enter).toHaveBeenCalledWith(ACCEPTED));
    expect(login).not.toHaveBeenCalled();
  });

  it('已登入別的帳號：提示信箱不符，不提供接受', async () => {
    session.has = true;
    profile.mockResolvedValue({ user: { email: 'someone@example.com' } });
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    expect(await screen.findByTestId('invitation-mismatch')).toBeInTheDocument();
    expect(screen.queryByTestId('invitation-accept')).toBeNull();
  });
});
