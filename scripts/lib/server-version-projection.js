/**
 * Project verified SBOM audit results into the public ServerVersions shape.
 *
 * Consumes the output of verifyRegistry (keyed by registry ID) and produces
 * the public/server-versions.json structure with status, sources, and packages.
 */

import { IMAGE_SBOM_REGISTRY } from './image-sbom-registry.js'

const SERVER_IDS = IMAGE_SBOM_REGISTRY
  .filter(r => r.product === 'bluefin-server')
  .map(r => r.id)

/**
 * Values may be published from a `verified` image and from a `degraded` one —
 * degraded means every required field resolved and only optional fields were
 * omitted. An `unavailable` image publishes nothing, whatever it carries.
 *
 * @param {{ status: string, values?: Record<string,string> }} image
 * @returns {boolean}
 */
function hasPublishableValues(image) {
  return image != null
    && (image.status === 'verified' || image.status === 'degraded')
    && image.values != null
}

/**
 * @param {{ checkedAt: string, images: Array<{ id: string, product?: string, image: string, imageDigest?: string, sbomDigest?: string, status: string, values?: Record<string,string> }> }} auditResult
 * @param {string} [checkedAt] - override timestamp (defaults to auditResult.checkedAt)
 * @returns {{ checkedAt: string, status: 'verified'|'unavailable', sources: Array<{ id: string, image: string, imageDigest: string, sbomDigest: string }>, packages: Record<string, string> }}
 */
export function projectServerVersions(auditResult, checkedAt) {
  const timestamp = checkedAt ?? auditResult.checkedAt

  const serverImages = auditResult.images.filter(img => SERVER_IDS.includes(img.id))
  const baseImage = serverImages.find(img => img.id === 'bluefin-server')

  if (!hasPublishableValues(baseImage)) {
    return {
      checkedAt: timestamp,
      status: 'unavailable',
      sources: [],
      packages: {},
    }
  }

  const sources = serverImages
    .filter(img => hasPublishableValues(img) && img.imageDigest && img.sbomDigest)
    .map(img => ({
      id: img.id,
      image: img.image,
      imageDigest: img.imageDigest,
      sbomDigest: img.sbomDigest,
    }))

  return {
    checkedAt: timestamp,
    status: 'verified',
    sources,
    packages: { ...baseImage.values },
  }
}
