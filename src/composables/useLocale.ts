import { i18n } from '../locales/schema'

/**
 * Set the active locale.
 * vue-i18n is configured in LEGACY mode, where i18n.global.locale
 * is a plain string — NOT a ref. Never write .locale.value.
 */
export function setLocale(locale: string): void {
  ;(i18n.global as unknown as { locale: string }).locale = locale
}

/**
 * Default locale used when the requested tag has no exact or aliased match.
 * vue-i18n is initialised to this value in src/locales/schema.ts, so callers
 * that ignore the return value of resolveLocale() and rely on i18n's own
 * behaviour end up here too.
 */
export const DEFAULT_LOCALE = 'en-US'

/**
 * Region → script/region alias map for browsers that report a language the
 * bundle does not ship verbatim but whose speakers share one of the shipped
 * bundles unambiguously. The keys are the tags LibreOffice/Safari/Firefox/
 * Chromium emit from `navigator.language` or from the `lang` URL parameter;
 * the values are the exact tags in src/locales/*.json.
 *
 * Two aliases, each unambiguous because the source tag has no bundle of its
 * own and exactly one shipped bundle shares its base language:
 *   - `uk-UA` → `uk`: a `uk-UA` browser has no `uk.json` to read from, and
 *     `uk` is the only Ukrainian bundle, so routing the region tag to it is
 *     unambiguous. This closes issue #905: a browser reporting `uk-UA`
 *     previously fell to the default instead of the Ukrainian bundle.
 *   - `zh-CN`/`zh-SG`/`zh-MY` → `zh-Hans`: neither region has its own bundle,
 *     and `zh-Hans` is the only Simplified-Chinese bundle, so routing is
 *     unambiguous.
 * Traditional-Chinese regions (`zh-HK`, `zh-TW`) each have their own bundle;
 * the script-side region `zh-MO` is not aliased and has no bundle of its own,
 * so it falls to the default. Collapsing any of them onto another Chinese
 * bundle would pick the wrong orthography for a real user.
 *
 * Adding more aliases is allowed only when the alias target is the *only*
 * bundle the source language ships. Generic subtag fallback (bare `zh` →
 * `zh-Hans`, or `cs-CZ` → `cs`) is intentionally absent: it lets a single
 * browser tag resolve through any of N siblings, which is how a bundle gets
 * rendered in the wrong script for a real user.
 */
export const LOCALE_ALIASES: Readonly<Record<string, string>> = {
  'uk-UA': 'uk',
  'zh-CN': 'zh-Hans',
  'zh-SG': 'zh-Hans',
  'zh-MY': 'zh-Hans',
}

/**
 * Resolve a locale tag — typically `window.navigator.language` or the value
 * of `?lang=` — to one that exists in the bundled i18n message map.
 *
 * Resolution order:
 *   1. Exact match against `i18n.global.availableLocales`.
 *   2. Region→script alias (`LOCALE_ALIASES`) whose value is itself
 *      available — the alias target must be a real bundle, not a guess.
 *   3. `DEFAULT_LOCALE`.
 *
 * Callers should pass the resolved tag to `setLocale`. The `?lang=` URL
 * parameter still wins over `navigator.language`, and an explicit exact
 * match still wins over an alias; this function is only the fallback path
 * that was previously `if (availableLocales.includes(tag)) setLocale(tag)`
 * in App.vue / DakotaApp.vue / ServerApp.vue.
 */
export function resolveLocale(requested: string): string {
  const available: readonly string[] = i18n.global.availableLocales
  if (available.includes(requested)) {
    return requested
  }
  const alias = LOCALE_ALIASES[requested]
  if (alias && available.includes(alias)) {
    return alias
  }
  return DEFAULT_LOCALE
}
