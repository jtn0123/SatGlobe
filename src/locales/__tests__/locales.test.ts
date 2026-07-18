import { Localization, SUPPORTED_LOCALES, localizationReady, type LocaleInformation, type SupportedLocale } from '@app/locales/locales';
import i18next from 'i18next';

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
