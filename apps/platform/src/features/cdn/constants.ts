import type { CdnCheckNode, CdnCheckResult, CdnResource } from '@/shared/api-sdk';

/** 資源類型的顯示名稱；後端新增資源類型而這裡沒跟上時編譯失敗。 */
export const CDN_RESOURCE_LABEL_KEY = {
  fileVariant: 'cdn.resource.fileVariant',
  imageAsset: 'cdn.resource.imageAsset',
  galleryItem: 'cdn.resource.galleryItem',
} as const satisfies Record<CdnResource, string>;

/** 資源類型的固定順序（與後端的 `CDN_RESOURCE_TYPES` 相同）。 */
export const CDN_RESOURCES = Object.keys(CDN_RESOURCE_LABEL_KEY) as CdnResource[];

type NodeProblem = CdnCheckNode['problems'][number];

export const CDN_NODE_PROBLEM_LABEL_KEY = {
  unreachable: 'cdn.nodes.problem.unreachable',
  timeout: 'cdn.nodes.problem.timeout',
  purgeSecretRejected: 'cdn.nodes.problem.purgeSecretRejected',
  badResponse: 'cdn.nodes.problem.badResponse',
  signingKidMissing: 'cdn.nodes.problem.signingKidMissing',
  verifyKidMissing: 'cdn.nodes.problem.verifyKidMissing',
} as const satisfies Record<NodeProblem, string>;

/** 只警告、不擋開啟的問題（輪替中的舊金鑰）。 */
export const CDN_WARNING_PROBLEMS: ReadonlySet<string> = new Set<NodeProblem>(['verifyKidMissing']);

export const CDN_DISCOVERY_PROBLEM_LABEL_KEY = {
  purgeNotConfigured: 'cdn.nodes.discovery.purgeNotConfigured',
  resolveFailed: 'cdn.nodes.discovery.resolveFailed',
} as const satisfies Record<NonNullable<CdnCheckResult['discovery']['problem']>, string>;

export const CDN_PUBLIC_URL_LABEL_KEY = {
  ok: 'cdn.nodes.publicUrlResult.ok',
  signatureRejected: 'cdn.nodes.publicUrlResult.signatureRejected',
  originAuthRejected: 'cdn.nodes.publicUrlResult.originAuthRejected',
  originUnreachable: 'cdn.nodes.publicUrlResult.originUnreachable',
  unreachable: 'cdn.nodes.publicUrlResult.unreachable',
  unexpected: 'cdn.nodes.publicUrlResult.unexpected',
} as const satisfies Record<CdnCheckResult['publicUrl']['result'], string>;

export const CDN_SIGNATURE_CHECK_LABEL_KEY = {
  ok: 'cdn.nodes.signatureResult.ok',
  notEnforced: 'cdn.nodes.signatureResult.notEnforced',
  unreachable: 'cdn.nodes.signatureResult.unreachable',
  unexpected: 'cdn.nodes.signatureResult.unexpected',
} as const satisfies Record<CdnCheckResult['signatureEnforced']['result'], string>;

/** 手動清理的目標種類。 */
export type CdnPurgeTargetType = 'paths' | CdnResource | 'all';

export const CDN_PURGE_TARGET_LABEL_KEY = {
  paths: 'cdn.purge.targetType.paths',
  fileVariant: 'cdn.purge.targetType.fileVariant',
  imageAsset: 'cdn.purge.targetType.imageAsset',
  galleryItem: 'cdn.purge.targetType.galleryItem',
  all: 'cdn.purge.targetType.all',
} as const satisfies Record<CdnPurgeTargetType, string>;
