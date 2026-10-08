// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { WatchState } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /watches/{resourceType}/{resourceId}

export interface WatchControllerStatePathParams {
  resourceType: string;
  resourceId: string;
}

export interface WatchControllerStateInput {
  path: WatchControllerStatePathParams;
}

export interface WatchControllerStateResponses {
  200: {
    data: WatchState;
  };
}

export type WatchControllerStateResponse = WatchControllerStateResponses[200];

export type WatchControllerStateResult = ApiResponse<200, WatchControllerStateResponses[200]>;

export function getWatchControllerStateUrl(path: WatchControllerStatePathParams): string {
  return buildUrl('/watches/{resourceType}/{resourceId}', path);
}

// PUT /watches/{resourceType}/{resourceId}

export interface WatchControllerWatchPathParams {
  resourceType: string;
  resourceId: string;
}

export interface WatchControllerWatchInput {
  path: WatchControllerWatchPathParams;
}

export interface WatchControllerWatchResponses {
  200: {
    data: WatchState;
  };
}

export type WatchControllerWatchResponse = WatchControllerWatchResponses[200];

export type WatchControllerWatchResult = ApiResponse<200, WatchControllerWatchResponses[200]>;

export function getWatchControllerWatchUrl(path: WatchControllerWatchPathParams): string {
  return buildUrl('/watches/{resourceType}/{resourceId}', path);
}

// DELETE /watches/{resourceType}/{resourceId}

export interface WatchControllerUnwatchPathParams {
  resourceType: string;
  resourceId: string;
}

export interface WatchControllerUnwatchInput {
  path: WatchControllerUnwatchPathParams;
}

export interface WatchControllerUnwatchResponses {
  200: {
    data: WatchState;
  };
}

export type WatchControllerUnwatchResponse = WatchControllerUnwatchResponses[200];

export type WatchControllerUnwatchResult = ApiResponse<200, WatchControllerUnwatchResponses[200]>;

export function getWatchControllerUnwatchUrl(path: WatchControllerUnwatchPathParams): string {
  return buildUrl('/watches/{resourceType}/{resourceId}', path);
}
