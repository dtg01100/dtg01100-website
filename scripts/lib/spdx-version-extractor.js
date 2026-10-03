/**
 * Element-aware SPDX version extraction.
 *
 * BuildStream SBOMs list a package once per build element, so the same name
 * can carry multiple versions.  This extractor allows callers to pin a version
 * to a specific bst-element locator, or to a Syft type/foundBy selector, and
 * reports ambiguity rather than silently picking the numerically highest value.
 */

/**
 * Normalise a raw version string.
 *
 * Accepts:
 *   - plain numeric segments:                7.0.7, 6.12.40, 595.71.05
 *   - kernel suffixes like -ogc1, -rc2:      7.1.8-ogc1
 *   - RPM epoch/release:                     1:260.2-1
 *
 * Rejects full commit hashes (≥ 40 hex chars with no dots) and non-strings.
 *
 * @param {unknown} raw
 * @returns {string|undefined}
 */
export function normalizeVersion(raw) {
  if (typeof raw !== 'string') {
    return undefined
  }
  // Reject hex commit hashes: 40+ hex chars with no dots
  if (/^[0-9a-f]{40,}$/i.test(raw)) {
    return undefined
  }
  // Accept: optional epoch, numeric segments, optional suffix (-ogc1, -rc2, -1, etc.)
  if (/^(?:\d+:)?\d+(?:\.\d+)*(?:-[A-Z0-9.]+)?$/i.test(raw)) {
    return raw
  }
  return undefined
}

/**
 * Canonical form of a bst-element locator for cross-plugin comparison.
 *
 * BuildStream SBOMs emit the locator in two distinct shapes:
 *
 *   - buildstream-sbom plugin keeps each segment verbatim and exposes the
 *     locator through `externalRefs[].referenceLocator`. Locator form:
 *     `freedesktop-sdk.bst:bootstrap/linux-headers.bst`.
 *
 *   - buildstream-plugins-community collect_manifest plugin strips `.bst` from
 *     every segment, replaces the path separator (`/`) with `-`, and joins
 *     segments with `-`; the result lives only in the SPDXID prefix:
 *     `SPDXRef-freedesktop-sdk-bootstrap-linux-headers-0`.
 *
 * To disambiguate the same kernel element across both shapes, normalise both
 * sides to a flat, project-or-element-only string with every separator
 * collapsed to `-` and `.bst` stripped.
 *
 * @param {string} locator
 * @returns {string}
 */
export function canonicalElementForm(locator) {
  if (typeof locator !== 'string' || locator === '') {
    return ''
  }
  return locator
    .split(':')
    .map(segment => segment.replace(/\.bst$/u, '').replace(/[/.]/gu, '-'))
    .join('-')
}

/**
 * Canonical form of an SPDXID (after stripping the SPDXRef- prefix and the
 * trailing per-element instance index). Used to compare collect_manifest
 * SPDXIDs against a locator authored in
 * `freedesktop-sdk.bst:components/linux.bst` form.
 *
 * @param {string} spdxId
 * @returns {string|undefined}
 */
export function canonicalSpdxIdForm(spdxId) {
  if (typeof spdxId !== 'string' || !spdxId.startsWith('SPDXRef-')) {
    return undefined
  }
  return spdxId.slice('SPDXRef-'.length).replace(/-\d+$/u, '')
}

/**
 * Return the bst-element referenceLocator for a package, if present.
 *
 * Prefers `externalRefs[].referenceLocator` (the buildstream-sbom shape). When
 * the SBOM was produced by the collect_manifest plugin (which omits
 * externalRefs), falls back to a canonical form derived from the SPDXID
 * prefix; callers that need exact locator equality must compare against
 * {@link canonicalElementForm} on both sides via {@link packageElementMatches}.
 *
 * @param {object} pkg - SPDX package object
 * @returns {string|undefined}
 */
export function packageElement(pkg) {
  const fromRefs = pkg.externalRefs?.find(ref => ref.referenceType === 'bst-element')?.referenceLocator
  if (fromRefs) {
    return fromRefs
  }
  return canonicalSpdxIdForm(pkg.SPDXID)
}

/**
 * Decide whether a package's bst-element matches a registry selector.
 *
 * Equivalent to `packageElement(pkg) === locator` for externalRefs-backed
 * packages, and additionally handles collect_manifest SPDXIDs whose locator
 * is encoded as a flat SPDXID prefix.
 *
 * @param {object} pkg - SPDX package object
 * @param {string} locator - registry element selector
 * @returns {boolean}
 */
export function packageElementMatches(pkg, locator) {
  if (locator == null) {
    return true
  }
  const fromRefs = pkg.externalRefs?.find(ref => ref.referenceType === 'bst-element')?.referenceLocator
  if (fromRefs != null) {
    return fromRefs === locator
  }
  const pkgForm = canonicalElementForm(canonicalSpdxIdForm(pkg.SPDXID) ?? '')
  const selectorForm = canonicalElementForm(locator)
  return pkgForm !== '' && pkgForm === selectorForm
}

/**
 * Extract versions from an SPDX document using a field-to-mapping registry.
 *
 * Each mapping entry may include:
 *   - `name`     {string}  SPDX package name  (required)
 *   - `element`  {string}  bst-element locator (BuildStream pin)
 *   - `type`     {string}  Syft artifact type selector
 *   - `foundBy`  {string}  Syft foundBy selector
 *   - `required` {boolean} if true, a miss is a missingRequired entry
 *
 * @param {object} sbom - parsed SPDX document
 * @param {Record<string, {name:string, element?:string, type?:string, foundBy?:string, required?:boolean}>} mappings
 * @returns {{ values: Record<string,string>, missingRequired: string[], missingOptional: string[], ambiguous: string[], rejected: Array<{field:string, value:unknown}> }}
 */
export function extractMappedVersions(sbom, mappings) {
  const values = {}
  const missingRequired = []
  const missingOptional = []
  const ambiguous = []
  const rejected = []

  const packages = sbom.packages ?? sbom.artifacts ?? []

  for (const [field, mapping] of Object.entries(mappings)) {
    // Filter by name
    let candidates = packages.filter(pkg => pkg.name === mapping.name)

    // Apply element pin (BuildStream)
    if (mapping.element != null) {
      candidates = candidates.filter(pkg => packageElementMatches(pkg, mapping.element))
    }

    // Apply Syft selectors
    if (mapping.type != null) {
      candidates = candidates.filter(pkg => pkg.type === mapping.type)
    }
    if (mapping.foundBy != null) {
      candidates = candidates.filter(pkg => pkg.foundBy === mapping.foundBy)
    }

    // Normalise and partition into accepted / rejected
    const accepted = []
    for (const pkg of candidates) {
      const raw = pkg.versionInfo ?? pkg.version
      const v = normalizeVersion(raw)
      if (v != null) {
        accepted.push(v)
      }
      else if (raw != null) {
        rejected.push({ field, value: raw })
      }
    }

    // De-duplicate (identical versions from different build elements are safe)
    const distinct = [...new Set(accepted)]

    if (distinct.length === 0) {
      if (mapping.required) {
        missingRequired.push(field)
      }
      else {
        missingOptional.push(field)
      }
    }
    else if (distinct.length > 1) {
      ambiguous.push(field)
    }
    else {
      values[field] = distinct[0]
    }
  }

  return { values, missingRequired, missingOptional, ambiguous, rejected }
}
