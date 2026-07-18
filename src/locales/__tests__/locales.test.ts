import { Localization, SUPPORTED_LOCALES, localizationReady, type LocaleInformation, type SupportedLocale } from '@app/locales/locales';
import i18next, { type BackendModule, type LanguageDetectorModule, type ResourceKey } from 'i18next';

const ANTARCTICA_SENTINELS = {
  en: 'Antarctica',
  de: 'Antarktis',
  es: 'Antártida',
  fr: 'Antarctique',
  ja: '南極大陸',
  ko: '남극',
  ru: 'Антарктида',
  uk: 'Антарктида',
  zh: '南极洲',
  pl: 'Antarktyka',
  cs: 'Antarktida',
  it: 'Antartide',
} satisfies Record<SupportedLocale['code'], string>;

describe.sequential('Locales', () => {
  const flatMapOfAllKeys: string[] = [];

  beforeAll(async () => {
    await localizationReady;
  });

  afterAll(async () => {
    await i18next.changeLanguage('en');
    SUPPORTED_LOCALES.filter(({ code }) => code !== 'en').forEach(({ code }) => {
      i18next.removeResourceBundle(code, 'translation');
    });
  });

  const setup = (Localization: LocaleInformation) => {
    /*
     * Create a flat array of all keys in the localization object,
     * this needs to be deep nested so the function might be plugins.SensorListPlugin.bottomIconLabel for example
     */

    const flatMap = (obj: LocaleInformation, prefix: string = ''): string[] => Object.keys(obj).flatMap((key) => {
      const newPrefix = prefix ? `${prefix}.${key}` : key;


      return typeof obj[key] === 'object' ? flatMap(obj[key], newPrefix) : newPrefix;
    });

    flatMapOfAllKeys.push(...flatMap(Localization));
  };

  it('starts with only the bundled English resource registered', () => {
    expect(Object.keys(i18next.store.data)).toEqual(['en']);
  });

  it('initializes without a Locize support notice', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const isolated = i18next.createInstance();

      await isolated.init({
        fallbackLng: 'en',
        lng: 'en',
        resources: {
          en: { translation: { countries: { AQ: ANTARCTICA_SENTINELS.en } } },
        },
      });

      const loggedLocizeNotice = infoSpy.mock.calls
        .flat()
        .some((argument) => String(argument).toLowerCase().includes('locize'));

      expect(loggedLocizeNotice).toBe(false);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('loads a selected non-English locale on demand', async () => {
    await i18next.changeLanguage('en');

    expect(i18next.hasResourceBundle('it', 'translation')).toBe(false);

    await i18next.changeLanguage('it');

    expect(i18next.hasResourceBundle('it', 'translation')).toBe(true);
    expect(i18next.t('countries.AQ')).toBe('Antartide');
  });

  it.each(SUPPORTED_LOCALES)('loads the exact Antarctica sentinel for $nativeName ($code)', async ({ code }) => {
    await i18next.changeLanguage(code);
    const localization = Localization.getInstance();

    flatMapOfAllKeys.length = 0;
    setup(localization);
    validateLocalizationKeys(localization, flatMapOfAllKeys);

    expect(i18next.language).toBe(code);
    expect(i18next.resolvedLanguage).toBe(code);
    expect(i18next.hasResourceBundle(code, 'translation')).toBe(true);
    expect(i18next.t('countries.AQ')).toBe(ANTARCTICA_SENTINELS[code]);
  });

  it('keeps the later explicit language request active when an older lazy load resolves last', async () => {
    const createGate = () => {
      let release = (_resource: ResourceKey): void => undefined;
      const promise = new Promise<ResourceKey>((resolve) => {
        release = resolve;
      });

      return { promise, release };
    };
    const italianGate = createGate();
    const germanGate = createGate();
    const gates = new Map([
      ['it', italianGate],
      ['de', germanGate],
    ]);
    const backendReads: string[] = [];
    const cachedLanguages: string[] = [];
    const languageChanges: string[] = [];
    const detector: LanguageDetectorModule = {
      type: 'languageDetector',
      detect: () => 'en',
      cacheUserLanguage: (language) => cachedLanguages.push(language),
    };
    const backend: BackendModule = {
      type: 'backend',
      init: () => undefined,
      read: (language, _namespace, callback) => {
        backendReads.push(language);
        const gate = gates.get(language);

        if (!gate) {
          callback(new Error(`Unexpected locale read: ${language}`), false);

          return;
        }
        gate.promise.then((resource) => callback(null, resource));
      },
    };
    const isolated = i18next.createInstance();

    isolated.use(detector).use(backend);
    await isolated.init({
      defaultNS: 'translation',
      fallbackLng: 'en',
      load: 'languageOnly',
      ns: ['translation'],
      partialBundledLanguages: true,
      resources: {
        en: { translation: { countries: { AQ: ANTARCTICA_SENTINELS.en } } },
      },
      supportedLngs: ['en', 'de', 'it'],
    });
    isolated.on('languageChanged', (language) => languageChanges.push(language));

    const italianChange = isolated.changeLanguage('it-IT');

    await vi.waitFor(() => expect(backendReads).toContain('it'));
    const germanChange = isolated.changeLanguage('de');

    await vi.waitFor(() => expect(backendReads).toContain('de'));
    germanGate.release({ countries: { AQ: ANTARCTICA_SENTINELS.de } });
    await germanChange;
    italianGate.release({ countries: { AQ: ANTARCTICA_SENTINELS.it } });
    await italianChange;

    expect(isolated.language).toBe('de');
    expect(isolated.resolvedLanguage).toBe('de');
    expect(isolated.t('countries.AQ')).toBe(ANTARCTICA_SENTINELS.de);
    expect(isolated.hasResourceBundle('de', 'translation')).toBe(true);
    expect(isolated.hasResourceBundle('it', 'translation')).toBe(true);
    expect(cachedLanguages.at(-1)).toBe('de');
    expect(languageChanges).toEqual(['de']);
  });

  it('resolves a detected regional tag through the language-only backend', async () => {
    const backendReads: string[] = [];
    const cachedLanguages: string[] = [];
    const detector: LanguageDetectorModule = {
      type: 'languageDetector',
      detect: () => 'it-IT',
      cacheUserLanguage: (language) => cachedLanguages.push(language),
    };
    const backend: BackendModule = {
      type: 'backend',
      init: () => undefined,
      read: (language, _namespace, callback) => {
        backendReads.push(language);
        if (language === 'it') {
          callback(null, { countries: { AQ: ANTARCTICA_SENTINELS.it } });

          return;
        }
        callback(new Error(`Unexpected locale read: ${language}`), false);
      },
    };
    const isolated = i18next.createInstance();

    isolated.use(detector).use(backend);
    await isolated.init({
      defaultNS: 'translation',
      fallbackLng: 'en',
      load: 'languageOnly',
      ns: ['translation'],
      partialBundledLanguages: true,
      resources: {
        en: { translation: { countries: { AQ: ANTARCTICA_SENTINELS.en } } },
      },
      supportedLngs: ['en', 'de', 'it'],
    });

    expect(isolated.language).toBe('it-IT');
    expect(isolated.resolvedLanguage).toBe('it');
    expect(isolated.t('countries.AQ')).toBe(ANTARCTICA_SENTINELS.it);
    expect(isolated.hasResourceBundle('it', 'translation')).toBe(true);
    expect(backendReads).toEqual(['it']);
    expect(cachedLanguages).toEqual(['it-IT']);
  });

  it('pre-caches all translations without throwing', async () => {
    await i18next.changeLanguage('en');
    const localization = Localization.getInstance() as unknown as { preCacheTranslations(): void };

    expect(() => localization.preCacheTranslations()).not.toThrow();
  });
});

// Check that every function in the localization object works
const validateLocalizationKeys = (localization: LocaleInformation, flatMapOfAllKeys: string[]) => {
  flatMapOfAllKeys.forEach((key) => {
    const splitKey = key.split('.');

    if (splitKey.length === 1) {
      expect(() => localization[key]).not.toThrow();
      expect(() => localization[key]).not.toBe(key);
      // console.warn(localization[key]);
    } else if (splitKey.length === 2) {
      expect(() => localization[splitKey[0]][splitKey[1]]).not.toThrow();
      expect(() => localization[splitKey[0]][splitKey[1]]).not.toBe(key);
      // console.warn(localization[splitKey[0]][splitKey[1]]);
    } else if (splitKey.length === 3) {
      expect(() => localization[splitKey[0]][splitKey[1]][splitKey[2]]).not.toThrow();
      expect(() => localization[splitKey[0]][splitKey[1]][splitKey[2]]).not.toBe(key);
      // console.warn(localization[splitKey[0]][splitKey[1]][splitKey[2]]);
    } else if (splitKey.length === 4) {
      expect(() => localization[splitKey[0]][splitKey[1]][splitKey[2]][splitKey[3]]).not.toThrow();
      expect(() => localization[splitKey[0]][splitKey[1]][splitKey[2]][splitKey[3]]).not.toBe(key);
      // console.warn(localization[splitKey[0]][splitKey[1]][splitKey[2]][splitKey[3]]);
    }
  });
};
