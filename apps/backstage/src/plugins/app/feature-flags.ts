import type { AppPluginFactory } from '@/core/app';

export interface FeatureFlags {
  [key: string]: boolean;
}

export function featureFlagPlugin(flags: FeatureFlags = {}): AppPluginFactory {
  return () => ({
    name: 'feature-flags',
    attrs: { featureFlags: flags },
  });
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    featureFlags: FeatureFlags;
  }
}
