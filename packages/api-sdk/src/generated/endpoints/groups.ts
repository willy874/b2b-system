// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateGroupRequest,
  GroupMember,
  GroupRoles,
  RestoredGroup,
  UpdateGroupMembersRequest,
  UpdateGroupRequest,
  UpdateGroupRolesRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /groups

export interface GroupControllerListResponses {
  200: {
    data: {
      items: Array<RestoredGroup>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type GroupControllerListResponse = GroupControllerListResponses[200];

export type GroupControllerListResult = ApiResponse<200, GroupControllerListResponses[200]>;

export function getGroupControllerListUrl(): string {
  return buildUrl('/groups');
}

// POST /groups

export type GroupControllerCreateBody = CreateGroupRequest;

export interface GroupControllerCreateInput {
  body: GroupControllerCreateBody;
}

export interface GroupControllerCreateResponses {
  201: {
    data: RestoredGroup;
  };
}

export type GroupControllerCreateResponse = GroupControllerCreateResponses[201];

export type GroupControllerCreateResult = ApiResponse<201, GroupControllerCreateResponses[201]>;

export function getGroupControllerCreateUrl(): string {
  return buildUrl('/groups');
}

// GET /groups/{id}

export interface GroupControllerFindOnePathParams {
  id: string;
}

export interface GroupControllerFindOneInput {
  path: GroupControllerFindOnePathParams;
}

export interface GroupControllerFindOneResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerFindOneResponse = GroupControllerFindOneResponses[200];

export type GroupControllerFindOneResult = ApiResponse<200, GroupControllerFindOneResponses[200]>;

export function getGroupControllerFindOneUrl(path: GroupControllerFindOnePathParams): string {
  return buildUrl('/groups/{id}', path);
}

// DELETE /groups/{id}

export interface GroupControllerRemovePathParams {
  id: string;
}

export interface GroupControllerRemoveInput {
  path: GroupControllerRemovePathParams;
}

export interface GroupControllerRemoveResponses {
  204: undefined;
}

export type GroupControllerRemoveResponse = GroupControllerRemoveResponses[204];

export type GroupControllerRemoveResult = ApiResponse<204, GroupControllerRemoveResponses[204]>;

export function getGroupControllerRemoveUrl(path: GroupControllerRemovePathParams): string {
  return buildUrl('/groups/{id}', path);
}

// PATCH /groups/{id}

export interface GroupControllerUpdatePathParams {
  id: string;
}

export type GroupControllerUpdateBody = UpdateGroupRequest;

export interface GroupControllerUpdateInput {
  path: GroupControllerUpdatePathParams;
  body: GroupControllerUpdateBody;
}

export interface GroupControllerUpdateResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerUpdateResponse = GroupControllerUpdateResponses[200];

export type GroupControllerUpdateResult = ApiResponse<200, GroupControllerUpdateResponses[200]>;

export function getGroupControllerUpdateUrl(path: GroupControllerUpdatePathParams): string {
  return buildUrl('/groups/{id}', path);
}

// POST /groups/{id}/restore

export interface GroupControllerRestorePathParams {
  id: string;
}

export interface GroupControllerRestoreInput {
  path: GroupControllerRestorePathParams;
}

export interface GroupControllerRestoreResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerRestoreResponse = GroupControllerRestoreResponses[200];

export type GroupControllerRestoreResult = ApiResponse<200, GroupControllerRestoreResponses[200]>;

export function getGroupControllerRestoreUrl(path: GroupControllerRestorePathParams): string {
  return buildUrl('/groups/{id}/restore', path);
}

// GET /groups/{id}/members

export interface GroupControllerListMembersPathParams {
  id: string;
}

export interface GroupControllerListMembersInput {
  path: GroupControllerListMembersPathParams;
}

export interface GroupControllerListMembersResponses {
  200: {
    data: {
      items: Array<GroupMember>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type GroupControllerListMembersResponse = GroupControllerListMembersResponses[200];

export type GroupControllerListMembersResult = ApiResponse<
  200,
  GroupControllerListMembersResponses[200]
>;

export function getGroupControllerListMembersUrl(
  path: GroupControllerListMembersPathParams,
): string {
  return buildUrl('/groups/{id}/members', path);
}

// PATCH /groups/{id}/members

export interface GroupControllerUpdateMembersPathParams {
  id: string;
}

export type GroupControllerUpdateMembersBody = UpdateGroupMembersRequest;

export interface GroupControllerUpdateMembersInput {
  path: GroupControllerUpdateMembersPathParams;
  body: GroupControllerUpdateMembersBody;
}

export interface GroupControllerUpdateMembersResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerUpdateMembersResponse = GroupControllerUpdateMembersResponses[200];

export type GroupControllerUpdateMembersResult = ApiResponse<
  200,
  GroupControllerUpdateMembersResponses[200]
>;

export function getGroupControllerUpdateMembersUrl(
  path: GroupControllerUpdateMembersPathParams,
): string {
  return buildUrl('/groups/{id}/members', path);
}

// GET /groups/{id}/roles

export interface GroupControllerListRolesPathParams {
  id: string;
}

export interface GroupControllerListRolesInput {
  path: GroupControllerListRolesPathParams;
}

export interface GroupControllerListRolesResponses {
  200: {
    data: GroupRoles;
  };
}

export type GroupControllerListRolesResponse = GroupControllerListRolesResponses[200];

export type GroupControllerListRolesResult = ApiResponse<
  200,
  GroupControllerListRolesResponses[200]
>;

export function getGroupControllerListRolesUrl(path: GroupControllerListRolesPathParams): string {
  return buildUrl('/groups/{id}/roles', path);
}

// PATCH /groups/{id}/roles

export interface GroupControllerUpdateRolesPathParams {
  id: string;
}

export type GroupControllerUpdateRolesBody = UpdateGroupRolesRequest;

export interface GroupControllerUpdateRolesInput {
  path: GroupControllerUpdateRolesPathParams;
  body: GroupControllerUpdateRolesBody;
}

export interface GroupControllerUpdateRolesResponses {
  200: {
    data: GroupRoles;
  };
}

export type GroupControllerUpdateRolesResponse = GroupControllerUpdateRolesResponses[200];

export type GroupControllerUpdateRolesResult = ApiResponse<
  200,
  GroupControllerUpdateRolesResponses[200]
>;

export function getGroupControllerUpdateRolesUrl(
  path: GroupControllerUpdateRolesPathParams,
): string {
  return buildUrl('/groups/{id}/roles', path);
}
