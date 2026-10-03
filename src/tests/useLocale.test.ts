import { afterEach, describe, expect, it } from 'vitest'
import { resolveLocale, setLocale } from '../composables/useLocale'
import { i18n } from '../locales/schema'

const DEFAULT_LOCALE = 'en-US'
const SUPPORTED_LOCALES = [
  'ar',
  'cs',
  'de-DE',
  'en-US',
  'eo',
  'es',
  'fr-FR',
  'hi',
  'id',
  'it',
  'ja-JP',
  'ko-KR',
  'nl-NL',
  'pl',
  'pt-BR',
  'ru-RU',
  'sk-SK',
  'sv',
  'tr',
  'vi-VN',
  'zh-HK',
  'zh-Hans',
  'zh-TW',
]

describe('useLocale', () => {
  afterEach(() => {
    setLocale(DEFAULT_LOCALE)
  })

  it('bundles the supported locales', () => {
    // 'uk' is added by this branch; keep it out of the list above so the
    // literal stays mergeable with locales added on main.
    const expected = [...SUPPORTED_LOCALES, 'uk'].sort()
    expect(Object.keys(i18n.global.messages).sort()).toEqual(expected)
  })

  it('uses en-US as the default locale', () => {
    expect((i18n.global as any).locale).toBe(DEFAULT_LOCALE)
  })

  it('switches the active locale', () => {
    setLocale('ja-JP')
    expect((i18n.global as any).locale).toBe('ja-JP')

    setLocale('de-DE')
    expect((i18n.global as any).locale).toBe('de-DE')
  })

  describe('resolveLocale', () => {
    it('returns the requested tag when it is an exact available locale', () => {
      expect(resolveLocale('ja-JP')).toBe('ja-JP')
      expect(resolveLocale('de-DE')).toBe('de-DE')
      expect(resolveLocale('zh-HK')).toBe('zh-HK')
      expect(resolveLocale('zh-Hans')).toBe('zh-Hans')
      expect(resolveLocale('zh-TW')).toBe('zh-TW')
      expect(resolveLocale('eo')).toBe('eo')
    })

    it('aliases Simplified-Chinese region tags to the zh-Hans bundle', () => {
      // Both zh-CN and zh-SG have no exact bundle; both must resolve to the
      // Simplified-Chinese bundle, not to en-US. This is the regression from
      // issue #915: a Simplified-Chinese browser was falling to en-US because
      // the exact-match check rejected the region tag before any fallback.
      expect(resolveLocale('zh-CN')).toBe('zh-Hans')
      expect(resolveLocale('zh-SG')).toBe('zh-Hans')
    })

    it('aliases single-bundle region tags to their sole base-language bundle', () => {
      // Each source region has no bundle of its own and exactly one base-
      // language bundle exists in the message map. Issue #926: without
      // these entries a region-tag browser for any of these languages falls
      // to en-US even though ?lang=<base> works.
      expect(resolveLocale('ar-EG')).toBe('ar')
      expect(resolveLocale('es-ES')).toBe('es')
      expect(resolveLocale('hi-IN')).toBe('hi')
      expect(resolveLocale('id-ID')).toBe('id')
      expect(resolveLocale('it-IT')).toBe('it')
      expect(resolveLocale('pl-PL')).toBe('pl')
      expect(resolveLocale('sv-SE')).toBe('sv')
      expect(resolveLocale('tr-TR')).toBe('tr')
    })

    it('does not alias Traditional-Chinese region tags', () => {
      // Each Traditional region has its own bundle, so they must keep their
      // own tag. The exact-match path handles the bundled ones; the alias
      // path must NOT collapse them onto zh-Hans or zh-TW.
      expect(resolveLocale('zh-HK')).toBe('zh-HK')
      expect(resolveLocale('zh-TW')).toBe('zh-TW')
      // zh-MO has no bundle and no alias entry — it falls to the default
      // rather than silently picking one of the Traditional variants.
      expect(resolveLocale('zh-MO')).toBe(DEFAULT_LOCALE)
    })

    it('does not alias bare zh to any of the Chinese bundles', () => {
      // Three Chinese bundles (zh-HK, zh-Hans, zh-TW) share the base "zh".
      // The skill rules forbid generic fallback that picks arbitrarily between
      // siblings; this is the test that locks the policy in place.
      expect(resolveLocale('zh')).toBe(DEFAULT_LOCALE)
    })

    it('does not introduce subtag fallback for other languages', () => {
      // The policy from content-maintenance/SKILL.md: a region-tag file
      // (`sk-SK`) is not picked for a bare `sk` browser, and a multi-bundle
      // base (`de-DE` + a hypothetical `de-AT`) is not collapsed onto a
      // single bundle. Single-bundle regions that need routing (ar/es/hi/
      // id/it/pl/sv/tr, plus uk-UA from PR #925) get an explicit
      // LOCALE_ALIASES entry, not generic subtag fallback. resolveLocale
      // honours that — only the explicit LOCALE_ALIASES entries get a
      // second chance.
      expect(resolveLocale('sk')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('de-AT')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('fr-CA')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('ja')).toBe(DEFAULT_LOCALE)
    })

    it('falls back to the default locale when the tag has no match', () => {
      expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('xx')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('klingon')).toBe(DEFAULT_LOCALE)
    })
  })
})
