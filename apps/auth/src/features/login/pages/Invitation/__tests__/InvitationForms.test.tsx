import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CoreAuth from '@/core/auth';
import type { AcceptedWorkspaceInvitation, WorkspaceInvitationPreview } from '@/shared/api-sdk';
import { renderWithPermissions } from '@/test/renderWithPermissions';

import { ExistingAccountForm } from '../components/ExistingAccountForm';
import { NewAccountForm } from '../components/NewAccountForm';

const { signup, accept, session, profile } = vi.hoisted(() => ({
  signup: vi.fn(),
  accept: vi.fn(),
  session: { has: false },
  profile: vi.fn(),
}));

vi.mock('@/apis/workspace/signup-workspace-invitation/mutation', () => ({
  getSignupWorkspaceInvitationMutationOptions: () => ({ mutationFn: signup }),
}));
vi.mock('@/apis/workspace/accept-workspace-invitation/mutation', () => ({
  getAcceptWorkspaceInvitationMutationOptions: () => ({ mutationFn: accept }),
}));
vi.mock('@/apis/auth/get-profile/query', () => ({
  AUTH_PROFILE_QUERY_KEY: 'AUTH_PROFILE_QUERY_KEY',
  getAuthProfileQueryOptions: () => ({ queryKey: ['AUTH_PROFILE_QUERY_KEY'], queryFn: profile }),
}));
vi.mock('@/core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreAuth>()),
  useHasSession: () => session.has,
}));

const TOKEN = 'invitation-token-123';
const WORKSPACE_URL = 'http://localhost:5173/w/art';
const ACCEPTED: AcceptedWorkspaceInvitation = {
  email: 'artist@example.com',
  workspace: { id: 'ws-1', slug: 'art', name: '美術' },
  workspaceUrl: WORKSPACE_URL,
};
const assign = vi.fn();

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
  profile.mockReset();
  session.has = false;
  assign.mockReset();
  sessionStorage.clear();
  // 頂層跳轉：jsdom 的 location.assign 不能 spy，整個換掉
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewAccountForm（沒有帳號，docs/adr/0018-workspace-tenancy.md D14）', () => {
  it('建立帳號 → 頂層跳轉到產品的工作區（登入在那裡經 IdP 完成）', async () => {
    renderWithPermissions(<NewAccountForm token={TOKEN} invitation={preview(false)} />);
    expect(screen.getByTestId('invitation-email')).toHaveValue('artist@example.com');
    type('invitation-display-name', '外包美術');
    type('invitation-password', 'InviteFlow!Pass2026');
    type('invitation-confirm', 'InviteFlow!Pass2026');
    fireEvent.click(screen.getByTestId('invitation-submit'));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(WORKSPACE_URL));
    expect(signup.mock.calls[0]?.[0]).toEqual({
      params: { token: TOKEN, displayName: '外包美術', password: 'InviteFlow!Pass2026' },
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

  it('建立失敗時不跳轉', async () => {
    signup.mockRejectedValue(new Error('WORKSPACE_INVITATION_INVALID'));
    renderWithPermissions(<NewAccountForm token={TOKEN} invitation={preview(false)} />);
    type('invitation-display-name', '外包美術');
    type('invitation-password', 'InviteFlow!Pass2026');
    type('invitation-confirm', 'InviteFlow!Pass2026');
    fireEvent.click(screen.getByTestId('invitation-submit'));
    await waitFor(() => expect(signup).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('ExistingAccountForm（已有帳號）', () => {
  it('沒登入：經 SSO 登入，登入後回到這一頁（帶著 token）', async () => {
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    fireEvent.click(screen.getByTestId('invitation-login-submit'));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const url = new URL(String(assign.mock.calls[0]?.[0]));
    expect(url.searchParams.get('client_id')).toBe('auth');
    const state = url.searchParams.get('state') ?? '';
    const pending = JSON.parse(sessionStorage.getItem(`sso:pending:${state}`) ?? '{}') as {
      returnTo?: string;
    };
    expect(pending.returnTo).toBe(`/invitation?token=${TOKEN}`);
    expect(accept).not.toHaveBeenCalled();
  });

  it('已登入受邀的帳號：接受後頂層跳轉到工作區', async () => {
    session.has = true;
    profile.mockResolvedValue({ user: { email: 'Artist@Example.com' } });
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    fireEvent.click(await screen.findByTestId('invitation-accept'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(WORKSPACE_URL));
    expect(accept.mock.calls[0]?.[0]).toEqual({ params: { token: TOKEN } });
  });

  it('已登入別的帳號：提示信箱不符，不提供接受', async () => {
    session.has = true;
    profile.mockResolvedValue({ user: { email: 'someone@example.com' } });
    renderWithPermissions(<ExistingAccountForm token={TOKEN} invitation={preview(true)} />);
    expect(await screen.findByTestId('invitation-mismatch')).toBeInTheDocument();
    expect(screen.queryByTestId('invitation-accept')).toBeNull();
  });
});
