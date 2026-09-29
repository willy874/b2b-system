import i18next from 'i18next';

import { DEFAULT_LANGUAGE, LanguageNamespace, SUPPORTED_LANGUAGES } from '@/shared/constants/lang';
import type { Language } from '@/shared/constants/lang';

export const i18n = i18next;

export type LocaleImporter = () => Promise<{ default: Record<string, unknown> }>;
export type LocaleBundle = Partial<Record<Language, Record<string, LocaleImporter>>>;

const registry = new Map<string, LocaleBundle>();
const loaded = new Set<string>();

export const GLOBAL_LOCALE_SCOPE = 'app';

export async function initI18n(language: Language = DEFAULT_LANGUAGE): Promise<void> {
  if (i18n.isInitialized) return;
  await i18n.init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: LanguageNamespace.TRANSLATE,
    ns: [LanguageNamespace.TRANSLATE],
    resources: {},
    interpolation: { escapeValue: false },
  });
}

/** 只登記「這個 scope 有這些包可以載」，實際下載由 route loader 觸發。 */
export function addResourceBundle(bundle: LocaleBundle, options: { scope: string }): void {
  const existing = registry.get(options.scope) ?? {};
  for (const [language, namespaces] of Object.entries(bundle) as Array<
    [Language, Record<string, LocaleImporter>]
  >) {
    existing[language] = { ...existing[language], ...namespaces };
  }
  registry.set(options.scope, existing);
}

export async function loadLocaleScope(scope: string, language: string): Promise<void> {
  const key = `${scope}:${language}`;
  if (loaded.has(key)) return;
  const importers = registry.get(scope)?.[language as Language] ?? {};
  await Promise.all(
    Object.entries(importers).map(async ([namespace, importer]) => {
      const module = await importer();
      i18n.addResourceBundle(language, namespace, module.default, true, true);
    }),
  );
  loaded.add(key);
}

/** 回傳一個 route loader：進入該 feature 時才真正下載語系包。 */
export function localeScopeLoader(scope: string) {
  return async (): Promise<void> => {
    await loadLocaleScope(scope, i18n.language);
  };
}

/**
 * 切換語系時必須補載所有「已載入過的 scope」的新語系版本，
 * 否則那些頁面會退回 key。
 */
export async function changeLanguage(language: Language): Promise<void> {
  const scopes = [...new Set([...loaded].map((key) => key.split(':')[0] as string))];
  await Promise.all(scopes.map((scope) => loadLocaleScope(scope, language)));
  await i18n.changeLanguage(language);
}

/** 測試用。 */
export function resetLocaleRegistry(): void {
  registry.clear();
  loaded.clear();
}
