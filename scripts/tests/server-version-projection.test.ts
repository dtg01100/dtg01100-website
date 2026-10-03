import { describe, expect, it } from 'vitest'
import { projectServerVersions } from '../lib/server-version-projection.js'

describe('projectServerVersions', () => {
  it('returns unavailable when no bluefin-server image is verified', () => {
    const audit = {
      checkedAt: '2026-10-03T00:00:00.000Z',
      images: [
        {
          id: 'dakota',
          product: 'dakota',
          image: 'ghcr.io/projectbluefin/dakota:stable',
          imageDigest: 'sha256:ddd',
          sbomDigest: 'sha256:eee',
          status: 'verified',
          values: { kernel: '7.2.6' },
        },
      ],
    }

    const result = projectServerVersions(audit)

    expect(result.checkedAt).toBe('2026-10-03T00:00:00.000Z')
    expect(result.status).toBe('unavailable')
    expect(result.sources).toEqual([])
    expect(result.packages).toEqual({})
  })

  it('publishes verified kernel and systemd from the bluefin-server SBOM', () => {
    const audit = {
      checkedAt: '2026-10-03T00:00:00.000Z',
      images: [
        {
          id: 'bluefin-server',
          product: 'bluefin-server',
          image: 'ghcr.io/projectbluefin/bluefin-server:latest',
          imageDigest: 'sha256:aaa',
          sbomDigest: 'sha256:bbb',
          sbomSource: 'embedded',
          status: 'verified',
          values: {
            kernel: '7.2.2',
            systemd: '261.2',
          },
        },
      ],
    }

    const result = projectServerVersions(audit)

    expect(result.status).toBe('verified')
    expect(result.sources).toEqual([
      {
        id: 'bluefin-server',
        image: 'ghcr.io/projectbluefin/bluefin-server:latest',
        imageDigest: 'sha256:aaa',
        sbomDigest: 'sha256:bbb',
      },
    ])
    expect(result.packages).toEqual({
      kernel: '7.2.2',
      systemd: '261.2',
    })
  })

  it('keeps verified values for a degraded server image and omits only the missing optional fields', () => {
    const audit = {
      checkedAt: '2026-10-03T00:00:00.000Z',
      images: [
        {
          id: 'bluefin-server',
          product: 'bluefin-server',
          image: 'ghcr.io/projectbluefin/bluefin-server:latest',
          imageDigest: 'sha256:aaa',
          sbomDigest: 'sha256:bbb',
          sbomSource: 'embedded',
          status: 'degraded',
          values: { kernel: '7.2.2' },
        },
      ],
    }

    const result = projectServerVersions(audit)

    expect(result.status).toBe('verified')
    expect(result.packages).toEqual({ kernel: '7.2.2' })
  })

  it('returns unavailable for an unavailable server image with no values', () => {
    const audit = {
      checkedAt: '2026-10-03T00:00:00.000Z',
      images: [
        {
          id: 'bluefin-server',
          product: 'bluefin-server',
          image: 'ghcr.io/projectbluefin/bluefin-server:latest',
          status: 'unavailable',
          errorCode: 'missing-sbom',
          error: 'No SPDX referrer found',
        },
      ],
    }

    const result = projectServerVersions(audit)

    expect(result.status).toBe('unavailable')
    expect(result.sources).toEqual([])
    expect(result.packages).toEqual({})
  })

  it('honours a checkedAt override', () => {
    const audit = {
      checkedAt: '2026-10-03T00:00:00.000Z',
      images: [],
    }

    const result = projectServerVersions(audit, '2026-10-04T12:00:00.000Z')

    expect(result.checkedAt).toBe('2026-10-04T12:00:00.000Z')
  })
})
