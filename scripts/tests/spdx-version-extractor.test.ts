import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  canonicalElementForm,
  extractMappedVersions,
  normalizeVersion,
  packageElement,
  packageElementMatches,
} from '../lib/spdx-version-extractor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/dakota-linux-elements.spdx.json'), 'utf8'),
)

describe('normalizeVersion', () => {
  it('accepts plain numeric versions', () => {
    expect(normalizeVersion('7.0.7')).toBe('7.0.7')
    expect(normalizeVersion('6.12.40')).toBe('6.12.40')
    expect(normalizeVersion('595.71.05')).toBe('595.71.05')
  })

  it('accepts versions with kernel suffix', () => {
    expect(normalizeVersion('7.1.8-ogc1')).toBe('7.1.8-ogc1')
    expect(normalizeVersion('6.12.40-rc2')).toBe('6.12.40-rc2')
  })

  it('accepts versions with RPM epoch/release', () => {
    expect(normalizeVersion('1:260.2-1')).toBe('1:260.2-1')
  })

  it('rejects commit hashes', () => {
    // SHA-256 of the empty string — unambiguously a valid 64-hex hash
    expect(normalizeVersion('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBeUndefined()
    expect(normalizeVersion('c9372e733d75cf3c5197a0dd29f8a4a422e2dddb9020cab3c179a6f3df03d4be')).toBeUndefined()
  })

  it('rejects null and non-string values', () => {
    expect(normalizeVersion(null)).toBeUndefined()
    expect(normalizeVersion(undefined)).toBeUndefined()
    expect(normalizeVersion(42)).toBeUndefined()
  })
})

describe('packageElement', () => {
  it('returns the bst-element referenceLocator', () => {
    const pkg = FIXTURE.packages.find(p => p.versionInfo === '7.0.7')
    expect(packageElement(pkg)).toBe('components/linux.bst')
  })

  it('returns undefined when no bst-element ref exists', () => {
    expect(packageElement({ name: 'linux', versionInfo: '7.0.7' })).toBeUndefined()
  })
})

describe('extractMappedVersions', () => {
  it('resolves kernel to components/linux.bst version', () => {
    const result = extractMappedVersions(FIXTURE, {
      kernel: { name: 'linux', element: 'components/linux.bst' },
    })
    expect(result.values.kernel).toBe('7.0.7')
    expect(result.missingRequired).toHaveLength(0)
    expect(result.ambiguous).toHaveLength(0)
  })

  it('resolves ogc-kernel from core/linux-ogc.bst', () => {
    const result = extractMappedVersions(FIXTURE, {
      'ogc-kernel': { name: 'linux', element: 'core/linux-ogc.bst' },
    })
    expect(result.values['ogc-kernel']).toBe('7.1.8-ogc1')
  })

  it('resolves nvidia from the NVIDIA-Linux-x86 package', () => {
    const result = extractMappedVersions(FIXTURE, {
      nvidia: { name: 'NVIDIA-Linux-x86' },
    })
    expect(result.values.nvidia).toBe('595.71.05')
  })

  it('reports ambiguous when a name-only mapping matches multiple distinct versions', () => {
    const result = extractMappedVersions(FIXTURE, {
      kernel: { name: 'linux' },
    })
    expect(result.values.kernel).toBeUndefined()
    expect(result.ambiguous).toContain('kernel')
  })

  it('reports missing required fields', () => {
    const result = extractMappedVersions(FIXTURE, {
      brew: { name: 'homebrew', required: true },
    })
    expect(result.missingRequired).toContain('brew')
  })

  it('reports missing optional fields', () => {
    const result = extractMappedVersions(FIXTURE, {
      brew: { name: 'homebrew' },
    })
    expect(result.missingOptional).toContain('brew')
  })

  it('skips duplicate evidence entries (same version, different elements)', () => {
    const sbom = {
      packages: [
        { name: 'foo', versionInfo: '1.2.3', externalRefs: [{ referenceType: 'bst-element', referenceLocator: 'a/foo.bst' }] },
        { name: 'foo', versionInfo: '1.2.3', externalRefs: [{ referenceType: 'bst-element', referenceLocator: 'b/foo.bst' }] },
      ],
    }
    const result = extractMappedVersions(sbom, { foo: { name: 'foo' } })
    expect(result.values.foo).toBe('1.2.3')
    expect(result.ambiguous).toHaveLength(0)
  })

  it('rejects fields and reports them', () => {
    const sbom = {
      packages: [
        { name: 'linux', versionInfo: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      ],
    }
    const result = extractMappedVersions(sbom, { kernel: { name: 'linux', required: true } })
    expect(result.missingRequired).toContain('kernel')
    expect(result.rejected.some(r => r.field === 'kernel')).toBe(true)
  })

  it('versionInfo takes precedence over version (Syft regression)', () => {
    const sbom = {
      packages: [
        { name: 'kernel-core', versionInfo: '7.1.6-201.fc44', version: '7.1.6' },
      ],
    }
    const result = extractMappedVersions(sbom, { kernel: { name: 'kernel-core' } })
    expect(result.values.kernel).toBe('7.1.6-201.fc44')
  })

  it('falls back to version when versionInfo is absent (Syft)', () => {
    const sbom = {
      packages: [
        { name: 'kernel-core', version: '7.1.6-201.fc44' },
      ],
    }
    const result = extractMappedVersions(sbom, { kernel: { name: 'kernel-core' } })
    expect(result.values.kernel).toBe('7.1.6-201.fc44')
  })

  it('dakota SPDX extraction uses versionInfo from BuildStream packages', () => {
    // Verify the existing fixture still works — versionInfo is the standard SPDX field
    const result = extractMappedVersions(FIXTURE, {
      kernel: { name: 'linux', element: 'components/linux.bst' },
    })
    expect(result.values.kernel).toBe('7.0.7')
  })
})

describe('canonicalElementForm', () => {
  it('collapses buildstream-sbom-style locators to a flat form', () => {
    expect(canonicalElementForm('core/linux-fdsdk.bst')).toBe('core-linux-fdsdk')
    expect(canonicalElementForm('freedesktop-sdk.bst:bootstrap/linux-headers.bst'))
      .toBe('freedesktop-sdk-bootstrap-linux-headers')
    expect(canonicalElementForm('freedesktop-sdk.bst:extensions/mesa/mesa.bst'))
      .toBe('freedesktop-sdk-extensions-mesa-mesa')
  })

  it('returns an empty string for non-string or empty input', () => {
    expect(canonicalElementForm('')).toBe('')
    expect(canonicalElementForm(undefined)).toBe('')
    expect(canonicalElementForm(null)).toBe('')
    expect(canonicalElementForm(42)).toBe('')
  })
})

describe('packageElement — collect_manifest SPDXID fallback', () => {
  // The buildstream-plugins-community collect_manifest plugin encodes the
  // bst-element locator into the SPDXID itself (stripping .bst, '/', and ':'),
  // and never populates externalRefs. The fixture reflects the live server
  // SBOM shape: SPDXRef-freedesktop-sdk-components-linux-0 ↔
  // freedesktop-sdk.bst:components/linux.bst.
  const collectManifestPackages = [
    {
      SPDXID: 'SPDXRef-freedesktop-sdk-bootstrap-linux-headers-0',
      name: 'linux',
      versionInfo: '6.18.41',
    },
    {
      SPDXID: 'SPDXRef-freedesktop-sdk-components-linux-0',
      name: 'linux',
      versionInfo: '7.2.2',
    },
  ]

  it('returns the SPDXID-derived locator when externalRefs is absent', () => {
    const kernel = collectManifestPackages[1]
    expect(packageElement(kernel)).toBe('freedesktop-sdk-components-linux')
  })

  it('matches the dotted locator via packageElementMatches', () => {
    const kernel = collectManifestPackages[1]
    expect(packageElementMatches(kernel, 'freedesktop-sdk.bst:components/linux.bst')).toBe(true)
  })

  it('does not match the bootstrap headers via packageElementMatches', () => {
    const kernel = collectManifestPackages[1]
    expect(packageElementMatches(kernel, 'freedesktop-sdk.bst:bootstrap/linux-headers.bst')).toBe(false)
  })

  it('still matches externalRefs-backed packages with exact locator equality', () => {
    const pkg = {
      SPDXID: 'SPDXRef-core-linux-fdsdk.bst-0',
      name: 'linux',
      externalRefs: [
        { referenceType: 'bst-element', referenceLocator: 'core/linux-fdsdk.bst' },
      ],
    }
    expect(packageElementMatches(pkg, 'core/linux-fdsdk.bst')).toBe(true)
    expect(packageElementMatches(pkg, 'components/linux.bst')).toBe(false)
  })

  it('extractMappedVersions resolves the kernel element via SPDXID fallback', () => {
    const sbom = { packages: collectManifestPackages }
    const result = extractMappedVersions(sbom, {
      kernel: { name: 'linux', element: 'freedesktop-sdk.bst:components/linux.bst', required: true },
    })
    expect(result.ambiguous).toEqual([])
    expect(result.missingRequired).toEqual([])
    expect(result.values.kernel).toBe('7.2.2')
  })

  it('extractMappedVersions reports ambiguity when a name-only mapping matches multiple SPDXIDs', () => {
    const sbom = { packages: collectManifestPackages }
    const result = extractMappedVersions(sbom, {
      kernel: { name: 'linux', required: true },
    })
    expect(result.ambiguous).toContain('kernel')
  })
})
