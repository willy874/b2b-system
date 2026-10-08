// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateOrgUnitRequest,
  MoveOrgUnitRequest,
  OrgUnitDetail,
  OrgUnitMember,
  OrgUnitTree,
  UpdateOrgUnitMembersRequest,
  UpdateOrgUnitRequest,
  UserOrgUnits,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /org-units

export interface OrgUnitControllerListResponses {
  200: {
    data: OrgUnitTree;
  };
}

export type OrgUnitControllerListResponse = OrgUnitControllerListResponses[200];

export type OrgUnitControllerListResult = ApiResponse<200, OrgUnitControllerListResponses[200]>;

export function getOrgUnitControllerListUrl(): string {
  return buildUrl('/org-units');
}

// POST /org-units

export type OrgUnitControllerCreateBody = CreateOrgUnitRequest;

export interface OrgUnitControllerCreateInput {
  body: OrgUnitControllerCreateBody;
}

export interface OrgUnitControllerCreateResponses {
  201: {
    data: OrgUnitDetail;
  };
}

export type OrgUnitControllerCreateResponse = OrgUnitControllerCreateResponses[201];

export type OrgUnitControllerCreateResult = ApiResponse<201, OrgUnitControllerCreateResponses[201]>;

export function getOrgUnitControllerCreateUrl(): string {
  return buildUrl('/org-units');
}

// GET /org-units/{id}

export interface OrgUnitControllerFindOnePathParams {
  id: string;
}

export interface OrgUnitControllerFindOneInput {
  path: OrgUnitControllerFindOnePathParams;
}

export interface OrgUnitControllerFindOneResponses {
  200: {
    data: OrgUnitDetail;
  };
}

export type OrgUnitControllerFindOneResponse = OrgUnitControllerFindOneResponses[200];

export type OrgUnitControllerFindOneResult = ApiResponse<
  200,
  OrgUnitControllerFindOneResponses[200]
>;

export function getOrgUnitControllerFindOneUrl(path: OrgUnitControllerFindOnePathParams): string {
  return buildUrl('/org-units/{id}', path);
}

// DELETE /org-units/{id}

export interface OrgUnitControllerRemovePathParams {
  id: string;
}

export interface OrgUnitControllerRemoveInput {
  path: OrgUnitControllerRemovePathParams;
}

export interface OrgUnitControllerRemoveResponses {
  204: undefined;
}

export type OrgUnitControllerRemoveResponse = OrgUnitControllerRemoveResponses[204];

export type OrgUnitControllerRemoveResult = ApiResponse<204, OrgUnitControllerRemoveResponses[204]>;

export function getOrgUnitControllerRemoveUrl(path: OrgUnitControllerRemovePathParams): string {
  return buildUrl('/org-units/{id}', path);
}

// PATCH /org-units/{id}

export interface OrgUnitControllerUpdatePathParams {
  id: string;
}

export type OrgUnitControllerUpdateBody = UpdateOrgUnitRequest;

export interface OrgUnitControllerUpdateInput {
  path: OrgUnitControllerUpdatePathParams;
  body: OrgUnitControllerUpdateBody;
}

export interface OrgUnitControllerUpdateResponses {
  200: {
    data: OrgUnitDetail;
  };
}

export type OrgUnitControllerUpdateResponse = OrgUnitControllerUpdateResponses[200];

export type OrgUnitControllerUpdateResult = ApiResponse<200, OrgUnitControllerUpdateResponses[200]>;

export function getOrgUnitControllerUpdateUrl(path: OrgUnitControllerUpdatePathParams): string {
  return buildUrl('/org-units/{id}', path);
}

// POST /org-units/{id}/move

export interface OrgUnitControllerMovePathParams {
  id: string;
}

export type OrgUnitControllerMoveBody = MoveOrgUnitRequest;

export interface OrgUnitControllerMoveInput {
  path: OrgUnitControllerMovePathParams;
  body: OrgUnitControllerMoveBody;
}

export interface OrgUnitControllerMoveResponses {
  200: {
    data: OrgUnitDetail;
  };
}

export type OrgUnitControllerMoveResponse = OrgUnitControllerMoveResponses[200];

export type OrgUnitControllerMoveResult = ApiResponse<200, OrgUnitControllerMoveResponses[200]>;

export function getOrgUnitControllerMoveUrl(path: OrgUnitControllerMovePathParams): string {
  return buildUrl('/org-units/{id}/move', path);
}

// POST /org-units/{id}/restore

export interface OrgUnitControllerRestorePathParams {
  id: string;
}

export interface OrgUnitControllerRestoreInput {
  path: OrgUnitControllerRestorePathParams;
}

export interface OrgUnitControllerRestoreResponses {
  200: {
    data: OrgUnitDetail;
  };
}

export type OrgUnitControllerRestoreResponse = OrgUnitControllerRestoreResponses[200];

export type OrgUnitControllerRestoreResult = ApiResponse<
  200,
  OrgUnitControllerRestoreResponses[200]
>;

export function getOrgUnitControllerRestoreUrl(path: OrgUnitControllerRestorePathParams): string {
  return buildUrl('/org-units/{id}/restore', path);
}

// GET /org-units/{id}/members

export interface OrgUnitControllerListMembersPathParams {
  id: string;
}

export interface OrgUnitControllerListMembersInput {
  path: OrgUnitControllerListMembersPathParams;
}

export interface OrgUnitControllerListMembersResponses {
  200: {
    data: {
      items: Array<OrgUnitMember>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type OrgUnitControllerListMembersResponse = OrgUnitControllerListMembersResponses[200];

export type OrgUnitControllerListMembersResult = ApiResponse<
  200,
  OrgUnitControllerListMembersResponses[200]
>;

export function getOrgUnitControllerListMembersUrl(
  path: OrgUnitControllerListMembersPathParams,
): string {
  return buildUrl('/org-units/{id}/members', path);
}

// PATCH /org-units/{id}/members

export interface OrgUnitControllerUpdateMembersPathParams {
  id: string;
}

export type OrgUnitControllerUpdateMembersBody = UpdateOrgUnitMembersRequest;

export interface OrgUnitControllerUpdateMembersInput {
  path: OrgUnitControllerUpdateMembersPathParams;
  body: OrgUnitControllerUpdateMembersBody;
}

export interface OrgUnitControllerUpdateMembersResponses {
  200: {
    data: OrgUnitDetail;
  };
}

export type OrgUnitControllerUpdateMembersResponse = OrgUnitControllerUpdateMembersResponses[200];

export type OrgUnitControllerUpdateMembersResult = ApiResponse<
  200,
  OrgUnitControllerUpdateMembersResponses[200]
>;

export function getOrgUnitControllerUpdateMembersUrl(
  path: OrgUnitControllerUpdateMembersPathParams,
): string {
  return buildUrl('/org-units/{id}/members', path);
}

// GET /users/{id}/org-units

export interface UserOrgUnitControllerListOfUserPathParams {
  id: string;
}

export interface UserOrgUnitControllerListOfUserInput {
  path: UserOrgUnitControllerListOfUserPathParams;
}

export interface UserOrgUnitControllerListOfUserResponses {
  200: {
    data: UserOrgUnits;
  };
}

export type UserOrgUnitControllerListOfUserResponse = UserOrgUnitControllerListOfUserResponses[200];

export type UserOrgUnitControllerListOfUserResult = ApiResponse<
  200,
  UserOrgUnitControllerListOfUserResponses[200]
>;

export function getUserOrgUnitControllerListOfUserUrl(
  path: UserOrgUnitControllerListOfUserPathParams,
): string {
  return buildUrl('/users/{id}/org-units', path);
}
