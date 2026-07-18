import { readFileSync } from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.resolve(__dirname, '../../src/locales');
const ALL_LANGUAGES = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'ru', 'uk', 'zh', 'pl', 'cs', 'it'] as const;
const NON_ENGLISH = ALL_LANGUAGES.filter((l) => l !== 'en');
const CJK_LANGUAGES = new Set(['ja', 'ko', 'zh']);

/** Extract `{placeholder}` tokens from a string. */
function extractPlaceholders(text: string): string[] {
  const matches = text.match(/\{(\w+)\}/gu);

  return matches ? matches.sort() : [];
}

/** Extract HTML tags from a string (opening and closing). */
function extractHtmlTags(text: string): string[] {
  const matches = text.match(/<\/?[a-z][a-z0-9]*[^>]*>/giu);

  return matches ? matches.sort() : [];
}

/** Recursively flatten a nested object to [dotKey, leafValue] pairs. */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const result: [string, string][] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];

    if (typeof val === 'object' && val !== null) {
      result.push(...flattenKeys(val as Record<string, unknown>, fullKey));
    } else if (typeof val === 'string') {
      result.push([fullKey, val]);
    }
  }

  return result;
}

function loadLocale(lang: string): Map<string, string> {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  const json = JSON.parse(readFileSync(filePath, 'utf8'));

  return new Map(flattenKeys(json));
}

describe('Locale structural consistency', () => {
  const enMap = loadLocale('en');
  const otherMaps = new Map(NON_ENGLISH.map((lang) => [lang, loadLocale(lang)]));

  describe('placeholder parity', () => {
    const keysWithPlaceholders = [...enMap.entries()].filter(([, val]) => /\{\w+\}/u.test(val));

    it('should have English keys with placeholders to validate', () => {
      expect(keysWithPlaceholders.length).toBeGreaterThan(0);
    });

    for (const lang of NON_ENGLISH) {
      it(`${lang}: all placeholders match English`, () => {
        const langMap = otherMaps.get(lang)!;
        const mismatches: string[] = [];

        for (const [key, enVal] of keysWithPlaceholders) {
          const langVal = langMap.get(key);

          if (langVal === undefined) {
            continue; // Missing key is caught by translation.test.ts
          }

          const enPlaceholders = extractPlaceholders(enVal);
          const langPlaceholders = extractPlaceholders(langVal);

          if (JSON.stringify(enPlaceholders) !== JSON.stringify(langPlaceholders)) {
            mismatches.push(`  ${key}: en=${enPlaceholders.join(',')} ${lang}=${langPlaceholders.join(',')}`);
          }
        }

        if (mismatches.length > 0) {
          // eslint-disable-next-line no-console
          console.error(`[${lang}] Placeholder mismatches:\n${mismatches.join('\n')}`);
        }

        expect(mismatches).toHaveLength(0);
      });
    }
  });

  describe('HTML tag parity (advisory)', () => {
    // HTML restructuring across translations is often intentional (e.g. <br> → <ul>/<li>,
    // single vs double quotes). This test warns but does not fail — use it as a review aid.
    const keysWithHtml = [...enMap.entries()].filter(([, val]) => /<[a-z]/iu.test(val));

    it('should have English keys with HTML tags to validate', () => {
      expect(keysWithHtml.length).toBeGreaterThan(0);
    });

    for (const lang of NON_ENGLISH) {
      it(`${lang}: HTML tags reviewed`, () => {
        const langMap = otherMaps.get(lang)!;
        const mismatches: string[] = [];

        for (const [key, enVal] of keysWithHtml) {
          const langVal = langMap.get(key);

          if (langVal === undefined) {
            continue;
          }

          const enTags = extractHtmlTags(enVal);
          const langTags = extractHtmlTags(langVal);

          if (JSON.stringify(enTags) !== JSON.stringify(langTags)) {
            mismatches.push(`  ${key}: en=[${enTags.join(', ')}] ${lang}=[${langTags.join(', ')}]`);
          }
        }

        if (mismatches.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[${lang}] HTML tag differences (review, not blocking):\n${mismatches.join('\n')}`);
        }

        // Advisory only — logged for review but does not block CI
      });
    }
  });

  describe('no empty translations', () => {
    // Very short strings (prepositions like "at", "to") may be legitimately empty
    // in agglutinative languages where they are incorporated into other words.
    const MIN_EN_LENGTH_FOR_EMPTY_CHECK = 4;

    for (const lang of NON_ENGLISH) {
      it(`${lang}: no empty strings where English is non-empty`, () => {
        const langMap = otherMaps.get(lang)!;
        const empties: string[] = [];

        for (const [key, enVal] of enMap) {
          if (enVal.trim().length < MIN_EN_LENGTH_FOR_EMPTY_CHECK) {
            continue;
          }

          const langVal = langMap.get(key);

          if (langVal !== undefined && langVal.trim().length === 0) {
            empties.push(`  ${key}`);
          }
        }

        if (empties.length > 0) {
          // eslint-disable-next-line no-console
          console.error(`[${lang}] Empty translations:\n${empties.join('\n')}`);
        }

        expect(empties).toHaveLength(0);
      });
    }
  });

  describe('suspiciously short translations (advisory)', () => {
    // Country names, abbreviations, and tooltips are naturally shorter in many languages.
    // This test warns but does not fail — use the Ollama script for deeper quality review.
    const MIN_RATIO_LATIN = 0.25;
    const MIN_RATIO_CJK = 0.15;
    const MIN_EN_LENGTH = 20;
    // Skip categories where short translations are expected
    const SKIP_PREFIXES = ['countries.'];

    for (const lang of NON_ENGLISH) {
      it(`${lang}: short translations reviewed`, () => {
        const langMap = otherMaps.get(lang)!;
        const isCjk = CJK_LANGUAGES.has(lang);
        const minRatio = isCjk ? MIN_RATIO_CJK : MIN_RATIO_LATIN;
        const suspicious: string[] = [];

        for (const [key, enVal] of enMap) {
          if (enVal.length < MIN_EN_LENGTH) {
            continue;
          }

          if (SKIP_PREFIXES.some((p) => key.startsWith(p))) {
            continue;
          }

          const langVal = langMap.get(key);

          if (langVal === undefined) {
            continue;
          }

          const ratio = langVal.length / enVal.length;

          if (ratio < minRatio && langVal.trim().length > 0) {
            suspicious.push(`  ${key}: en=${enVal.length}chars, ${lang}=${langVal.length}chars (${(ratio * 100).toFixed(0)}%)`);
          }
        }

        if (suspicious.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[${lang}] Suspiciously short translations (review, not blocking):\n${suspicious.join('\n')}`);
        }

        // Advisory only — logged for review but does not block CI
      });
    }
  });
});
