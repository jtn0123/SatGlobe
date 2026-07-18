import i18next, { BackendModule, InitOptions, ResourceKey } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import { Keys, t7e } from './keys';

const SUPPORTED_LOCALE_CODES = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'ru', 'uk', 'zh', 'pl', 'cs', 'it'] as const;

type SupportedLocaleCode = typeof SUPPORTED_LOCALE_CODES[number];
type AsyncLocaleCode = Exclude<SupportedLocaleCode, 'en'>;

export interface SupportedLocale {
  /** BCP-47 base code matching a supported i18next resource. */
  code: SupportedLocaleCode;
  /** Endonym shown in language pickers (always rendered in its own script). */
  nativeName: string;
}

/** Canonical list of UI languages used by both i18next and language pickers. */
export const SUPPORTED_LOCALES: SupportedLocale[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'uk', nativeName: 'Українська' },
  { code: 'zh', nativeName: '中文' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'cs', nativeName: 'Čeština' },
  { code: 'it', nativeName: 'Italiano' },
];

const localeLoaders: Record<AsyncLocaleCode, () => Promise<{ default: ResourceKey }>> = {
  cs: () => import(/* webpackChunkName: "locale-cs" */ './cs.json'),
  de: () => import(/* webpackChunkName: "locale-de" */ './de.json'),
  es: () => import(/* webpackChunkName: "locale-es" */ './es.json'),
  fr: () => import(/* webpackChunkName: "locale-fr" */ './fr.json'),
  it: () => import(/* webpackChunkName: "locale-it" */ './it.json'),
  ja: () => import(/* webpackChunkName: "locale-ja" */ './ja.json'),
  ko: () => import(/* webpackChunkName: "locale-ko" */ './ko.json'),
  pl: () => import(/* webpackChunkName: "locale-pl" */ './pl.json'),
  ru: () => import(/* webpackChunkName: "locale-ru" */ './ru.json'),
  uk: () => import(/* webpackChunkName: "locale-uk" */ './uk.json'),
  zh: () => import(/* webpackChunkName: "locale-zh" */ './zh.json'),
};
const localeLoadErrors = new Map<AsyncLocaleCode, Error>();

const localeBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read: (language, _namespace, callback) => {
    const code = language.split('-')[0];

    if (code === 'en') {
      callback(null, en);

      return;
    }
    if (!Object.hasOwn(localeLoaders, code)) {
      callback(new Error(`Unsupported locale: ${language}`), false);

      return;
    }

    const localeCode = code as AsyncLocaleCode;

    localeLoaders[localeCode]()
      .then((module) => {
        localeLoadErrors.delete(localeCode);
        callback(null, module.default);
      })
      .catch((error: unknown) => {
        const loadError = error instanceof Error ? error : new Error(`Could not load locale: ${language}`);

        localeLoadErrors.set(localeCode, loadError);
        callback(loadError, false);
      });
  },
};

const opts: InitOptions = {
  interpolation: {
    escapeValue: false,
  },
  fallbackLng: 'en',
  debug: false,
  defaultNS: 'translation',
  load: 'languageOnly',
  ns: ['translation'],
  partialBundledLanguages: true,
  supportedLngs: [...SUPPORTED_LOCALE_CODES],
  resources: {
    en: { translation: en },
  },
};

i18next.use(LanguageDetector).use(localeBackend);
const initialization = i18next.init(opts);

export const localizationReady = initialization.then(async (translation) => {
  const requestedCode = i18next.language?.split('-')[0] as SupportedLocaleCode | undefined;

  if (requestedCode && requestedCode !== 'en' && !i18next.hasResourceBundle(requestedCode, 'translation')) {
    const loadError = localeLoadErrors.get(requestedCode) ?? new Error(`Could not load locale: ${requestedCode}`);

    await i18next.changeLanguage('en');
    throw loadError;
  }

  return translation;
});

export interface LocaleInformation {
  plugins: {
    [pluginName: string]: {
      bottomIconLabel?: string;
      title?: string;
      helpBody?: string;
      [key: string]: string | undefined;
    };
  };
}

export class Localization implements LocaleInformation {
  plugins: LocaleInformation['plugins'];
  private static instance_: Localization;

  static getInstance(): Localization {
    if (!Localization.instance_) {
      Localization.instance_ = new Localization();
    }

    return Localization.instance_;
  }

  constructor() {
    this.plugins = this.loadPlugins();

    requestIdleCallback(this.preCacheTranslations.bind(this));
  }

  /** Next key to warm; the pre-cache resumes here across idle slices. */
  private preCacheIndex_ = 0;

  /**
   * Pre-caches translations for the current language. Warming all ~2,900 keys
   * in one callback measured as a 1.3 s main-thread block a few seconds after
   * boot - exactly when the user first interacts. Process keys only while the
   * idle budget lasts, then resume in the next idle period.
   */
  private preCacheTranslations(deadline?: IdleDeadline) {
    const hasIdleBudget = () => !deadline || deadline.timeRemaining() > 2;

    while (this.preCacheIndex_ < Keys.length && hasIdleBudget()) {
      t7e(Keys[this.preCacheIndex_]);
      this.preCacheIndex_ += 1;
    }
    if (this.preCacheIndex_ < Keys.length) {
      requestIdleCallback(this.preCacheTranslations.bind(this));
    }
  }

  private loadPlugins(): LocaleInformation['plugins'] {
    return {};
  }
}
