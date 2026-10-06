import {
  DEFAULT_LANGUAGE,
  LanguageNamespace,
  SUPPORTED_LANGUAGES,
} from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';
import { trackRegistration } from '@b2b-system/web-shared/registry';
import i18next from 'i18next';

export const i18n = i18next;

export type LocaleImporter = () => Promise<{ default: Record<string, unknown> }>;
export type LocaleBundle = Partial<Record<Language, Record<string, LocaleImporter>>>;

const registry = new Map<string, LocaleBundle>();
const loaded = new Set<string>();
/** 下載中的 `scope:language`：同時要求同一包時只下載一次。 */
const inflight = new Map<string, Promise<void>>();
/**
 * 被要求時還沒登記的 scope → 要求過的語系。所屬 feature 晚一步安裝（docs/architecture/frontend/02-plugin-system.md §9）時，登記的當下補載，
 * 不必等下一次換頁才由 route loader 觸發。
 */
const pending = new Map<string, Set<string>>();
const loadedListeners = new Set<(scope: string, language: string) => void>();

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

/**
 * 只登記「這個 scope 有這些包可以載」，實際下載由 route loader 觸發。
 * 回傳反註冊函式（在 plugin 的 `onInit` 裡呼叫時由容器收集，feature 卸載時撤回，
 * docs/architecture/frontend/02-plugin-system.md §9.2 D4）；已經下載進 i18next 的字串不移除，重新安裝時不必再下載。
 */
export function addResourceBundle(bundle: LocaleBundle, options: { scope: string }): () => void {
  const existing = registry.get(options.scope) ?? {};
  const added: Array<[Language, string, LocaleImporter]> = [];
  for (const [language, namespaces] of Object.entries(bundle) as Array<
    [Language, Record<string, LocaleImporter>]
  >) {
    existing[language] = { ...existing[language], ...namespaces };
    for (const [namespace, importer] of Object.entries(namespaces)) {
      added.push([language, namespace, importer]);
    }
  }
  registry.set(options.scope, existing);
  const requested = pending.get(options.scope);
  if (requested) {
    pending.delete(options.scope);
    for (const language of requested) {
      // 失敗時不記成已載入：下一次 route loader 或訂閱者再要求時重試
      loadLocaleScope(options.scope, language).catch(() => undefined);
    }
  }

  const dispose = () => {
    const current = registry.get(options.scope);
    if (!current) return;
    for (const [language, namespace, importer] of added) {
      // 同一個 namespace 已被別人重新登記時不動它
      if (current[language]?.[namespace] === importer) delete current[language]?.[namespace];
    }
    const isEmpty = Object.values(current).every(
      (namespaces) => !namespaces || Object.keys(namespaces).length === 0,
    );
    if (isEmpty) registry.delete(options.scope);
  };
  trackRegistration(dispose);
  return dispose;
}

export async function loadLocaleScope(scope: string, language: string): Promise<void> {
  const key = `${scope}:${language}`;
  if (loaded.has(key)) return;
  // 還沒登記的 scope（所屬 feature 尚未安裝）不能記成已載入，否則安裝後永遠不會再下載；
  // 記成待載入，登記時補載（`addResourceBundle`）
  if (!registry.has(scope)) {
    const languages = pending.get(scope) ?? new Set<string>();
    languages.add(language);
    pending.set(scope, languages);
    return;
  }
  const running = inflight.get(key);
  if (running) return running;
  const importers = registry.get(scope)?.[language as Language] ?? {};
  const task = Promise.all(
    Object.entries(importers).map(async ([namespace, importer]) => {
      const module = await importer();
      i18n.addResourceBundle(language, namespace, module.default, true, true);
    }),
  )
    .then(() => {
      loaded.add(key);
      for (const listener of loadedListeners) listener(scope, language);
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/**
 * 某個 scope 的語系包下載完成時通知（含登記後補載的）。`useTranslation` 訂閱它：載入的是目前語系時，
 * 已經掛上的元件重渲染並拿到新的 `t`——在路由之外顯示其他 feature 文字的元件（偏好頁的分頁、頂列的鈴鐺與批次佇列）
 * 不必自己重繪。回傳取消訂閱。
 */
export function subscribeLocaleScopeLoaded(
  listener: (scope: string, language: string) => void,
): () => void {
  loadedListeners.add(listener);
  return () => {
    loadedListeners.delete(listener);
  };
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
  inflight.clear();
  pending.clear();
  loadedListeners.clear();
}
