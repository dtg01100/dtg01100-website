import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SectionPicker from '../components/sections/SectionPicker.vue'
import { i18n } from '../locales/schema'

const wrappers: ReturnType<typeof mount>[] = []

function mountPicker(classicStatus: 'verified' | 'unavailable' = 'verified') {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.endsWith('/dakota-versions.json')) {
      return {
        ok: true,
        json: async () => ({
          checkedAt: '2026-08-25T00:00:00.000Z',
          status: 'verified',
          sources: [],
          packages: { kernel: '7.0.7', systemd: '260.2' }
        })
      }
    }
    if (input.endsWith('/stream-versions.yml')) {
      return {
        ok: true,
        text: async () => `stable:
  status: ${classicStatus}
  base: Fedora 44
  kernel: 9.1.0
lts:
  status: verified
  kernel: 8.2.0
`
      }
    }
    throw new Error('offline')
  }))

  const wrapper = mount(SectionPicker, {
    global: {
      plugins: [i18n],
      provide: { visibleSection: ref('') }
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('sectionPicker.vue', () => {
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) {
      wrapper.unmount()
    }
    vi.unstubAllGlobals()
  })

  it('keeps Classic and LTS separate from next-generation product destinations', () => {
    const wrapper = mountPicker()
    const primaryDestinations = wrapper.get('.classic-download-grid')
      .findAll('.card-box')
      .map(card => card.attributes('href'))
    const nextDestinations = wrapper.get('.next-generation-section')
      .findAll('.card-box')
      .map(card => card.attributes('href'))

    expect(new Set(primaryDestinations)).toEqual(new Set([
      'https://docs.projectbluefin.io/downloads/',
      undefined
    ]))
    expect(new Set(nextDestinations)).toEqual(new Set([
      '/dakota/',
      '/server/',
      'https://github.com/projectbluefin/utah'
    ]))
    const classic = wrapper.find('a.card-box[href="https://docs.projectbluefin.io/downloads/"]')
    expect(classic.exists()).toBe(true)
    expect(classic.get('img').attributes('alt')).toBe('Bluefin Classic')
  })

  it('keeps LTS Coming Soon and non-downloadable even if a version feed reports it verified', async () => {
    const wrapper = mountPicker()
    await flushPromises()
    const lts = wrapper.findAll('.card-box').find(card => card.find('img[alt="Bluefin LTS"]').exists())

    expect(lts).toBeDefined()
    expect(lts?.element.tagName).toBe('DIV')
    expect(lts?.attributes('href')).toBeUndefined()
    expect(lts?.get('.alpha-badge-title').text()).toBe('Coming Soon')
    expect(lts?.findAll('.version-row')).toHaveLength(0)
  })

  it('withholds unverified Classic metadata without disabling its download destination', async () => {
    const wrapper = mountPicker('unavailable')
    await flushPromises()
    const classic = wrapper.find('a.card-box[href="https://docs.projectbluefin.io/downloads/"]')

    expect(classic.exists()).toBe(true)
    expect(classic.findAll('.version-row')).toHaveLength(0)
  })

  it('does not show Classic stream metadata on the server product card', async () => {
    const wrapper = mountPicker()
    await flushPromises()
    const classic = wrapper.find('a.card-box[href="https://docs.projectbluefin.io/downloads/"]')
    expect(classic.exists()).toBe(true)
    expect(classic.find('.version-info').exists()).toBe(true)
    expect(wrapper.get('a.card-box[href="/server/"]').find('.version-info').exists()).toBe(false)
  })
})
