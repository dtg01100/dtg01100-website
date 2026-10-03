import type { ServerVersions } from '../composables'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ServerVersion from '../components/server/ServerVersion.vue'

// Mock getServerVersions to bypass the module-level singleton cache.
// vi.mock is hoisted above all imports, so the plain static import above is
// fine — the factory's reference to the mock is inside a closure that only
// runs when a test calls getServerVersions.
const getServerVersionsMock = vi.fn<() => Promise<ServerVersions>>()
vi.mock('../composables', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../composables')>()
  return { ...orig, getServerVersions: () => getServerVersionsMock() }
})

const FULL_VERSIONS: ServerVersions = {
  checkedAt: '2026-10-03T00:00:00Z',
  status: 'verified',
  sources: [
    { id: 'bluefin-server', image: 'ghcr.io/projectbluefin/bluefin-server:latest', imageDigest: 'sha256:aaa', sbomDigest: 'sha256:bbb' },
  ],
  packages: {
    kernel: '7.2.2',
    systemd: '261.2',
  },
}

describe('serverVersion.vue', () => {
  afterEach(() => {
    getServerVersionsMock.mockReset()
  })

  it('does not fetch server-versions.json directly', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    mount(ServerVersion)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders version rows from fetched data', async () => {
    getServerVersionsMock.mockResolvedValue(FULL_VERSIONS)

    const wrapper = mount(ServerVersion)
    await flushPromises()

    const rows = wrapper.findAll('.version-row')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.get('.version-label').text())).toContain('Kernel')
    expect(rows.map(r => r.get('.version-label').text())).toContain('systemd')
    expect(rows.find(r => r.get('.version-label').text() === 'Kernel')!
      .get('.version-value').text()).toBe('7.2.2')
  })

  it('filters version rows to known labels only', async () => {
    getServerVersionsMock.mockResolvedValue({
      ...FULL_VERSIONS,
      packages: {
        ...FULL_VERSIONS.packages,
        unknownPackage: '1.0.0',
      },
    })

    const wrapper = mount(ServerVersion)
    await flushPromises()

    const rows = wrapper.findAll('.version-row')
    expect(rows).toHaveLength(2)
    const labels = rows.map(r => r.get('.version-label').text())
    expect(labels).not.toContain('unknownPackage')
  })

  it('renders no version rows when fetch fails', async () => {
    getServerVersionsMock.mockRejectedValue(new Error('network error'))

    const wrapper = mount(ServerVersion)
    await flushPromises()

    expect(wrapper.findAll('.version-row')).toHaveLength(0)
    expect(wrapper.find('.version-info').exists()).toBe(false)
  })

  it('falls back to the unavailability message when fetch fails', async () => {
    getServerVersionsMock.mockRejectedValue(new Error('network error'))

    const wrapper = mount(ServerVersion)
    await flushPromises()

    expect(wrapper.text()).toContain(
      'Version details will appear when Bluefin Server publishes a verifiable image SBOM.'
    )
  })

  it('falls back to the unavailability message when status is unavailable', async () => {
    getServerVersionsMock.mockResolvedValue({
      checkedAt: '2026-10-03T00:00:00Z',
      status: 'unavailable',
      sources: [],
      packages: {},
    })

    const wrapper = mount(ServerVersion)
    await flushPromises()

    expect(wrapper.findAll('.version-row')).toHaveLength(0)
    expect(wrapper.text()).toContain(
      'Version details will appear when Bluefin Server publishes a verifiable image SBOM.'
    )
  })

  it('contains no Flatcar, Docker, containerd, Ignition, etcd, or NVIDIA rows', async () => {
    getServerVersionsMock.mockResolvedValue(FULL_VERSIONS)

    const wrapper = mount(ServerVersion)
    await flushPromises()

    const text = wrapper.text()
    for (const term of ['Docker', 'containerd', 'Ignition', 'etcd', 'NVIDIA', 'Flatcar']) {
      expect(text).not.toContain(term)
    }
  })

  it('links to the GitHub releases page in a new tab', () => {
    getServerVersionsMock.mockResolvedValue(FULL_VERSIONS)

    const wrapper = mount(ServerVersion)

    const link = wrapper.get('a.release-link')
    expect(link.attributes('href')).toBe('https://github.com/projectbluefin/server/releases')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })
})
