import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceInvitation } from '@/shared/api-sdk';
import { TEST_WORKSPACE, renderWithPermissions } from '@/test/renderWithPermissions';

import { InviteMemberDialog } from '../components/InviteMemberDialog';
import { PendingInvitations } from '../components/PendingInvitations';

const { createInvitation, revokeInvitation, listInvitations } = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  listInvitations: vi.fn(),
}));

vi.mock('@/apis/workspace/create-workspace-invitation/mutation', () => ({
  getCreateWorkspaceInvitationMutationOptions: () => ({ mutationFn: createInvitation }),
}));
vi.mock('@/apis/workspace/revoke-workspace-invitation/mutation', () => ({
  getRevokeWorkspaceInvitationMutationOptions: () => ({ mutationFn: revokeInvitation }),
}));
vi.mock('@/apis/workspace/get-workspace-invitation-list/query', () => ({
  WORKSPACE_INVITATION_LIST_QUERY_KEY: 'WORKSPACE_INVITATION_LIST_QUERY_KEY',
  getWorkspaceInvitationListQueryOptions: (workspaceId: string) => ({
    queryKey: ['WORKSPACE_INVITATION_LIST_QUERY_KEY', workspaceId],
    queryFn: listInvitations,
  }),
}));
vi.mock('@/apis/workspace/get-workspace-role-list/query', () => ({
  WORKSPACE_ROLE_LIST_QUERY_KEY: 'WORKSPACE_ROLE_LIST_QUERY_KEY',
  getWorkspaceRoleListQueryOptions: (workspaceId: string) => ({
    queryKey: ['WORKSPACE_ROLE_LIST_QUERY_KEY', workspaceId],
    queryFn: () => ({
      items: [
        {
          id: 'role-member',
          slug: 'workspace-member',
          name: '工作區成員',
          description: null,
          isSystem: true,
          permissions: ['file:access'],
        },
      ],
    }),
  }),
}));

function invitation(overrides: Partial<WorkspaceInvitation> = {}): WorkspaceInvitation {
  return {
    id: 'inv-1',
    email: 'artist@example.com',
    roles: [{ id: 'role-member', slug: 'workspace-member', name: '工作區成員', isSystem: true }],
    invitedBy: { id: 'u-admin', displayName: '管理員' },
    hasAccount: false,
    createdAt: '2026-09-29T00:00:00.000Z',
    expiresAt: '2026-10-06T00:00:00.000Z',
    isExpired: false,
    ...overrides,
  };
}

beforeEach(() => {
  createInvitation.mockReset().mockResolvedValue(invitation());
  revokeInvitation.mockReset().mockResolvedValue(undefined);
  listInvitations.mockReset().mockResolvedValue({ items: [invitation()] });
});

describe('InviteMemberDialog（docs/adr/0018-workspace-tenancy.md D14）', () => {
  it('送出 email 與勾選的工作區角色；成功後關閉', async () => {
    const onClose = vi.fn();
    renderWithPermissions(
      <InviteMemberDialog workspaceId={TEST_WORKSPACE.id} open onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId('workspace-invite-email'), {
      target: { value: ' artist@example.com ' },
    });
    fireEvent.click(await screen.findByTestId('workspace-invite-role-checkbox'));
    fireEvent.click(screen.getByTestId('workspace-invite-submit'));

    await waitFor(() =>
      expect(createInvitation.mock.calls[0]?.[0]).toEqual({
        params: {
          workspaceId: TEST_WORKSPACE.id,
          email: 'artist@example.com',
          roleIds: ['role-member'],
        },
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('email 格式不對時不送出', () => {
    renderWithPermissions(
      <InviteMemberDialog workspaceId={TEST_WORKSPACE.id} open onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId('workspace-invite-email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByTestId('workspace-invite-submit'));
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('後端拒絕時錯誤留在對話框裡、不關閉', async () => {
    createInvitation.mockRejectedValue(new Error('rejected'));
    const onClose = vi.fn();
    renderWithPermissions(
      <InviteMemberDialog workspaceId={TEST_WORKSPACE.id} open onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId('workspace-invite-email'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-invite-submit'));
    await waitFor(() => expect(createInvitation).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PendingInvitations', () => {
  it('可以撤銷時顯示撤銷鈕，確認後以邀請 id 撤銷', async () => {
    renderWithPermissions(<PendingInvitations workspaceId={TEST_WORKSPACE.id} canRevoke />);
    fireEvent.click(await screen.findByTestId('workspace-invitation-revoke'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() =>
      expect(revokeInvitation.mock.calls[0]?.[0]).toEqual({
        params: { workspaceId: TEST_WORKSPACE.id, invitationId: 'inv-1' },
      }),
    );
  });

  it('沒有 workspaceMember:create 時不顯示撤銷鈕', async () => {
    renderWithPermissions(<PendingInvitations workspaceId={TEST_WORKSPACE.id} canRevoke={false} />);
    expect(await screen.findByTestId('workspace-invitation-section')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-invitation-revoke')).toBeNull();
  });

  it('過期的邀請標示已過期；沒有邀請時整個區塊不顯示', async () => {
    listInvitations.mockResolvedValue({ items: [invitation({ isExpired: true })] });
    const { unmount } = renderWithPermissions(
      <PendingInvitations workspaceId={TEST_WORKSPACE.id} canRevoke />,
    );
    expect(await screen.findByTestId('workspace-invitation-expired')).toBeInTheDocument();
    unmount();

    listInvitations.mockResolvedValue({ items: [] });
    renderWithPermissions(<PendingInvitations workspaceId={TEST_WORKSPACE.id} canRevoke />);
    await waitFor(() => expect(listInvitations).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('workspace-invitation-section')).toBeNull();
  });
});
