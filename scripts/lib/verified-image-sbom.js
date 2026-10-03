import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SPDX_ARTIFACT_TYPE = 'application/vnd.spdx+json'

export class EvidenceError extends Error {
  constructor(code, image, message) {
    super(message)
    this.name = 'EvidenceError'
    this.code = code
    this.image = image
  }
}

/**
 * A failure of the verification machinery itself: a missing binary, a timeout,
 * a transport error, a throttled or broken registry, or output the tool was
 * supposed to produce and did not.
 *
 * It is deliberately NOT an EvidenceError. An EvidenceError means the
 * publisher did not publish the evidence, and sanitizes the affected fields out
 * of the website. A ToolingError means we could not look, so it must abort the
 * run before any output, cache, or deployment is touched — a network blip must
 * never be published as "this product has no verified versions".
 */
export class ToolingError extends Error {
  constructor(code, tool, message) {
    super(message)
    this.name = 'ToolingError'
    this.code = code
    this.tool = tool
  }
}

/** Every text surface a child-process failure can hide its cause in. */
function failureText(err) {
  return [err?.message, err?.stderr, err?.stdout]
    .map(part => (typeof part === 'string' ? part : (part?.toString?.() ?? '')))
    .join('\n')
}

const TIMEOUT_PATTERN = /timed out|timeout|context deadline exceeded/i
const THROTTLE_PATTERN = /\b(?:429|500|502|503|504)\b|too ?many ?requests|internal server error|service unavailable|bad gateway|gateway time-?out/i
const TRANSPORT_PATTERN = /ECONNRESET|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|connection refused|connection reset|no such host|network is unreachable|i\/o timeout|dial tcp|tls: handshake failure|remote error: tls|certificate signed by unknown authority/i
const ABSENCE_PATTERN = /NAME_UNKNOWN|MANIFEST_UNKNOWN|manifest unknown|name unknown|repository name not known|\bnot found\b|\b404\b/i

/**
 * Classify a child-process failure as a tooling/transport failure.
 *
 * @param {any} err - error thrown by the run function
 * @param {string} tool - binary that failed, for the message
 * @returns {ToolingError|null} null when the failure is not identifiably a
 *   tooling failure and the caller should apply its own evidence rules
 */
export function classifyToolFailure(err, tool) {
  const text = failureText(err)

  if (err?.code === 'ENOENT' && String(err?.syscall ?? '').startsWith('spawn')) {
    return new ToolingError('tool-missing', tool, `${tool} is not installed or not on PATH: ${text}`)
  }
  if (err?.code === 'ETIMEDOUT' || err?.killed === true || err?.signal != null || TIMEOUT_PATTERN.test(text)) {
    return new ToolingError('tool-timeout', tool, `${tool} timed out: ${text}`)
  }
  if (THROTTLE_PATTERN.test(text)) {
    return new ToolingError('registry-unavailable', tool, `registry rejected the ${tool} request: ${text}`)
  }
  if (TRANSPORT_PATTERN.test(text)) {
    return new ToolingError('transport', tool, `${tool} could not reach the registry: ${text}`)
  }
  if (typeof err?.code === 'string' && ['EACCES', 'EIO', 'ENOSPC', 'EMFILE', 'ENOENT'].includes(err.code)) {
    return new ToolingError('tool-io', tool, `${tool} failed with a local I/O error (${err.code}): ${text}`)
  }
  return null
}

/**
 * Decide whether a registry failure text describes a genuinely absent artifact.
 *
 * @param {any} err
 * @returns {boolean}
 */
function describesAbsence(err) {
  return ABSENCE_PATTERN.test(failureText(err))
}

/**
 * Resolve a tagged image reference to its immutable digest form.
 * @param {string} image - fully qualified image with tag or digest
 * @param {Function} run - execFileSync-compatible function
 * @returns {string} repository@sha256:... reference
 */
export function resolveImageDigest(image, run = execFileSync) {
  try {
    const result = JSON.parse(run('oras', ['manifest', 'fetch', '--descriptor', image], { encoding: 'utf8' }))
    const repository = image.replace(/[:@].*$/, '')
    return `${repository}@${result.digest}`
  }
  catch (err) {
    const tooling = classifyToolFailure(err, 'oras')
    if (tooling != null) {
      throw tooling
    }
    if (describesAbsence(err)) {
      throw new EvidenceError('image-not-found', image, `Cannot resolve ${image}: ${failureText(err)}`)
    }
    throw new ToolingError('tool-failure', 'oras', `oras manifest fetch failed for ${image}: ${failureText(err)}`)
  }
}

/**
 * Enumerate all OCI referrers attached to an image digest.
 * @param {string} imageAtDigest - repository@sha256:... reference
 * @param {Function} run - execFileSync-compatible function
 * @returns {Array} referrers array
 */
export function discoverReferrers(imageAtDigest, run = execFileSync) {
  let raw
  try {
    raw = run('oras', ['discover', '--format', 'json', imageAtDigest], { encoding: 'utf8' })
  }
  catch (err) {
    const tooling = classifyToolFailure(err, 'oras')
    if (tooling != null) {
      throw tooling
    }
    if (describesAbsence(err)) {
      throw new EvidenceError('image-not-found', imageAtDigest, `Cannot discover referrers for ${imageAtDigest}: ${failureText(err)}`)
    }
    throw new ToolingError('tool-failure', 'oras', `oras discover failed for ${imageAtDigest}: ${failureText(err)}`)
  }
  let result
  try {
    result = JSON.parse(raw)
  }
  catch (err) {
    // The tool owns this document; unparseable output means the tool, not the
    // publisher, is broken.
    throw new ToolingError('malformed-output', 'oras', `Malformed oras discovery JSON for ${imageAtDigest}: ${err.message}`)
  }
  return result.referrers ?? []
}

/**
 * Verify SLSA provenance attestation via cosign.
 * @param {string} imageAtDigest - repository@sha256:... reference
 * @param {{ certificateIdentityRegexp: string, certificateOidcIssuer: string }} policy
 * @param {Function} run - execFileSync-compatible function
 */
export function verifyImageProvenance(imageAtDigest, policy, run = execFileSync) {
  try {
    run('cosign', [
      'verify-attestation',
      '--type',
      'https://slsa.dev/provenance/v1',
      '--certificate-identity-regexp',
      policy.certificateIdentityRegexp,
      '--certificate-oidc-issuer',
      policy.certificateOidcIssuer,
      imageAtDigest,
    ], { encoding: 'utf8' })
  }
  catch (err) {
    const tooling = classifyToolFailure(err, 'cosign')
    if (tooling != null) {
      throw tooling
    }
    const msg = failureText(err)
    if (/no matching attestation|no attestations|not found/i.test(msg)) {
      throw new EvidenceError('missing-provenance', imageAtDigest, `No provenance attestation found for ${imageAtDigest}: ${msg}`)
    }
    throw new EvidenceError('invalid-provenance', imageAtDigest, `Provenance verification failed for ${imageAtDigest}: ${msg}`)
  }
}

/**
 * Verify that the discovered SPDX referrer artifact itself carries a keyless
 * signature from the publisher identity the image's provenance is held to.
 *
 * `oras discover` is an unsigned registry listing: any writer to the
 * repository can attach a referrer, and the provenance check binds the image
 * digest only. Without this check the artifact whose bytes become the
 * published version claims is trusted merely because the registry listed it
 * next to a well-signed image.
 *
 * @param {string} repository - image repository without tag/digest
 * @param {string} digest - sha256:... digest of the SPDX referrer manifest
 * @param {{ certificateIdentityRegexp: string, certificateOidcIssuer: string }} policy
 * @param {Function} run - execFileSync-compatible function
 */
export function verifySbomSignature(repository, digest, policy, run = execFileSync) {
  const ref = `${repository}@${digest}`
  try {
    run('cosign', [
      'verify',
      '--certificate-identity-regexp',
      policy.certificateIdentityRegexp,
      '--certificate-oidc-issuer',
      policy.certificateOidcIssuer,
      ref,
    ], { encoding: 'utf8' })
    return { signed: true }
  }
  catch (err) {
    const tooling = classifyToolFailure(err, 'cosign')
    if (tooling != null) {
      throw tooling
    }
    if (describesAbsence(err)) {
      throw new ToolingError('registry-unavailable', 'cosign', `registry rejected the cosign request for ${ref}: ${failureText(err)}`)
    }
    const msg = failureText(err)
    throw new EvidenceError('invalid-sbom-signature', ref, `SPDX referrer signature verification failed for ${ref}: ${msg}`)
  }
}

/**
 * Pull and parse an SPDX referrer by its digest.
 * @param {string} repository - image repository without tag/digest
 * @param {string} digest - sha256:... digest of the SPDX referrer
 * @param {Function} run - execFileSync-compatible function
 * @param {object} fsImpl - fs module (for testing injection)
 * @returns {object} parsed SPDX document
 */
export function pullSpdxReferrer(repository, digest, run = execFileSync, fsImpl = fs) {
  const outputDir = fsImpl.mkdtempSync(path.join(os.tmpdir(), 'website-sbom-'))
  try {
    run('oras', ['pull', `${repository}@${digest}`, '--output', outputDir], { encoding: 'utf8' })
    const files = fsImpl.readdirSync(outputDir)
    const jsonFile = files.find(name => name.endsWith('.json'))
    if (!jsonFile) {
      throw new EvidenceError('invalid-sbom', repository, `No JSON file in SBOM referrer for ${repository}@${digest}`)
    }
    return JSON.parse(fsImpl.readFileSync(path.join(outputDir, jsonFile), 'utf8'))
  }
  catch (err) {
    if (err instanceof EvidenceError || err instanceof ToolingError) {
      throw err
    }
    const tooling = classifyToolFailure(err, 'oras')
    if (tooling != null) {
      throw tooling
    }
    if (describesAbsence(err) || err instanceof SyntaxError) {
      // The referrer was discovered but its artifact is absent or corrupt:
      // that is a publisher problem, so it sanitizes rather than blocks.
      throw new EvidenceError('invalid-sbom', repository, `Failed to read SPDX referrer ${digest}: ${failureText(err)}`)
    }
    throw new ToolingError('tool-failure', 'oras', `oras pull failed for ${repository}@${digest}: ${failureText(err)}`)
  }
  finally {
    fsImpl.rmSync(outputDir, { recursive: true, force: true })
  }
}

/**
 * Title annotation key carried on every OCI layer for an OCI 1.1 artifact.
 */
const OCI_TITLE_ANNOTATION = 'org.opencontainers.image.title'

/**
 * Read an OCI artifact manifest and return the layer whose
 * `org.opencontainers.image.title` annotation ends with `.spdx.json`.
 *
 * Some publishers (projectbluefin/server, for example) ship the SBOM as a
 * layer inside the artifact manifest rather than as a separate SPDX referrer.
 * The signed provenance over the artifact then authenticates the SBOM bytes by
 * association, so reading the layer is safe once provenance has been
 * verified.
 *
 * @param {string} imageAtDigest - repository@sha256:... reference
 * @param {Function} run - execFileSync-compatible function
 * @returns {{ digest: string, size: number } | undefined}
 */
export function findEmbeddedSpdxLayer(imageAtDigest, run = execFileSync) {
  let raw
  try {
    raw = run('oras', ['manifest', 'fetch', imageAtDigest], { encoding: 'utf8' })
  }
  catch (err) {
    const tooling = classifyToolFailure(err, 'oras')
    if (tooling != null) {
      throw tooling
    }
    if (describesAbsence(err)) {
      throw new EvidenceError('image-not-found', imageAtDigest, `Cannot fetch manifest for ${imageAtDigest}: ${failureText(err)}`)
    }
    throw new ToolingError('tool-failure', 'oras', `oras manifest fetch failed for ${imageAtDigest}: ${failureText(err)}`)
  }
  let manifest
  try {
    manifest = JSON.parse(raw)
  }
  catch (err) {
    throw new ToolingError('malformed-output', 'oras', `Malformed oras manifest JSON for ${imageAtDigest}: ${err.message}`)
  }
  const layers = Array.isArray(manifest?.layers) ? manifest.layers : []
  const matches = layers.filter((layer) => {
    const title = layer?.annotations?.[OCI_TITLE_ANNOTATION]
    return typeof title === 'string' && title.endsWith('.spdx.json')
  })
  if (matches.length === 0) {
    return undefined
  }
  if (matches.length > 1) {
    throw new EvidenceError('ambiguous-sbom', imageAtDigest, `Multiple .spdx.json layers found in ${imageAtDigest}`)
  }
  const layer = matches[0]
  return { digest: layer.digest, size: layer.size }
}

/**
 * Pull and parse an SPDX layer embedded inside an OCI artifact.
 *
 * @param {string} repository - image repository without tag/digest
 * @param {string} digest - sha256:... digest of the SPDX layer
 * @param {Function} run - execFileSync-compatible function
 * @param {object} fsImpl - fs module (for testing injection)
 * @returns {object} parsed SPDX document
 */
export function pullEmbeddedSpdx(repository, digest, run = execFileSync, fsImpl = fs) {
  // `oras blob fetch --output` takes a file path (or `-` for stdout); it
  // does `os.Create(outputPath)` on whatever it gets, and rejects a
  // directory with "is a directory". Write the layer to a tmpfile inside
  // a mkdtemp dir, then read back the only JSON file in that dir
  // (#921 review).
  const outputDir = fsImpl.mkdtempSync(path.join(os.tmpdir(), 'website-embedded-sbom-'))
  const outputPath = path.join(outputDir, 'sbom.spdx.json')
  try {
    run('oras', ['blob', 'fetch', `${repository}@${digest}`, '--output', outputPath], { encoding: 'utf8' })
    return JSON.parse(fsImpl.readFileSync(outputPath, 'utf8'))
  }
  catch (err) {
    if (err instanceof EvidenceError || err instanceof ToolingError) {
      throw err
    }
    const tooling = classifyToolFailure(err, 'oras')
    if (tooling != null) {
      throw tooling
    }
    if (describesAbsence(err) || err instanceof SyntaxError) {
      throw new EvidenceError('invalid-sbom', repository, `Failed to read SPDX layer ${digest}: ${failureText(err)}`)
    }
    throw new ToolingError('tool-failure', 'oras', `oras blob fetch failed for ${repository}@${digest}: ${failureText(err)}`)
  }
  finally {
    fsImpl.rmSync(outputDir, { recursive: true, force: true })
  }
}

/**
 * Collect and verify a complete SBOM for an image registry record.
 *
 * Two publisher shapes are supported:
 *   1. The publisher attaches the SBOM as a separate SPDX-typed referrer to
 *      the image (the standard pattern used by dakota/bluefin). The referrer
 *      digest is then optionally co-signed with cosign, and the layer is
 *      pulled from the registry.
 *   2. The publisher embeds the SBOM as a `*.spdx.json` layer inside the OCI
 *      artifact manifest itself (projectbluefin/server). The artifact's
 *      provenance signature then authenticates the SBOM bytes by
 *      association. Records opt into this shape by setting
 *      `record.sbomSource === 'embedded'`.
 *
 * @param {import('./image-sbom-registry.js').ImageSbomRecord} record
 * @param {{ run?: Function, fs?: object }} dependencies
 * @returns {Promise<{ id, image, imageDigest, sbomDigest, sbomSignature?: 'verified'|'missing', sbomSource: 'referrer'|'embedded', checkedAt, sbom }>}
 */
export async function collectVerifiedImageSbom(record, dependencies = {}) {
  const run = dependencies.run ?? execFileSync
  const fsImpl = dependencies.fs ?? fs

  const imageAtDigest = resolveImageDigest(record.image, run)
  const imageDigest = imageAtDigest.split('@')[1]

  const repository = record.image.replace(/[:@].*$/, '')

  if (record.sbomSource === 'embedded') {
    // Path 2: SBOM embedded as a layer inside the artifact (server shape).
    // The artifact manifest is signed as part of the publisher's provenance
    // attestation, so verifying the provenance over the artifact digest
    // also authenticates the SBOM bytes by association. Verify
    // provenance *before* reading the manifest so the security argument
    // ("the SBOM bytes are authentic by association with the signed
    // manifest") holds — the manifest we then read is the one the
    // signature attests to (#921 review).
    verifyImageProvenance(imageAtDigest, {
      certificateIdentityRegexp: record.certificateIdentityRegexp,
      certificateOidcIssuer: record.certificateOidcIssuer,
    }, run)

    const embedded = findEmbeddedSpdxLayer(imageAtDigest, run)
    if (embedded == null) {
      throw new EvidenceError('missing-sbom', record.image, `No embedded .spdx.json layer found in ${record.image}`)
    }

    const sbom = pullEmbeddedSpdx(repository, embedded.digest, run, fsImpl)

    return {
      id: record.id,
      image: record.image,
      imageDigest,
      sbomDigest: embedded.digest,
      sbomSource: 'embedded',
      checkedAt: new Date().toISOString(),
      sbom,
    }
  }

  // Path 1: SPDX referrer (dakota/bluefin shape).
  const referrers = discoverReferrers(imageAtDigest, run)
  const spdxReferrers = referrers.filter(r => r.artifactType === SPDX_ARTIFACT_TYPE)

  if (spdxReferrers.length === 0) {
    throw new EvidenceError('missing-sbom', record.image, `No SPDX referrer found for ${record.image}`)
  }
  if (spdxReferrers.length > 1) {
    throw new EvidenceError('ambiguous-sbom', record.image, `Multiple SPDX referrers found for ${record.image}`)
  }

  const sbomReferrer = spdxReferrers[0]
  const sbomDigest = sbomReferrer.digest

  verifyImageProvenance(imageAtDigest, {
    certificateIdentityRegexp: record.certificateIdentityRegexp,
    certificateOidcIssuer: record.certificateOidcIssuer,
  }, run)

  // The referrer digest comes from the unsigned discovery listing, and the
  // provenance check above binds the image digest only. Hold the artifact we
  // are about to read to the same publisher identity before its bytes are
  // trusted.
  const hasSignature = Array.isArray(sbomReferrer.referrers) && sbomReferrer.referrers.length > 0
  if (hasSignature) {
    verifySbomSignature(repository, sbomDigest, {
      certificateIdentityRegexp: record.certificateIdentityRegexp,
      certificateOidcIssuer: record.certificateOidcIssuer,
    }, run)
  }

  const sbom = pullSpdxReferrer(repository, sbomDigest, run, fsImpl)

  return {
    id: record.id,
    image: record.image,
    imageDigest,
    sbomDigest,
    sbomSignature: hasSignature ? 'verified' : 'missing',
    sbomSource: 'referrer',
    checkedAt: new Date().toISOString(),
    sbom,
  }
}
