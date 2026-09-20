import type { ComponentType } from 'react';

export interface PreferenceSection {
  key: string;
  order: number;
  labelI18nKey: string;
  Component: ComponentType;
}

const registry = new Map<string, PreferenceSection>();

/** 讓 feature 或 `plugins/features/*` 往偏好頁插分頁，偏好頁不需要認識它們。 */
export function registerPreferenceSection(section: PreferenceSection): void {
  if (registry.has(section.key)) {
    throw new Error(`Preference section already registered: ${section.key}`);
  }
  registry.set(section.key, section);
}

export function getPreferenceSections(): PreferenceSection[] {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

export function resetPreferenceRegistry(): void {
  registry.clear();
}
