import type { CinematicTransitionLine } from '@/config/wolves-cinematic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransitionSfxPlayer, transitionSfxCues } from '@/components/wolves/cinematic/transition-sfx'
import { CINEMATIC_SEGMENTS } from '@/config/wolves-cinematic'

const STATIC_LINES: readonly CinematicTransitionLine[] = [
  { kind: 'speaker', speaker: 'krook', text: 'line that carries no cue' },
  { kind: 'static', text: '-- static --', effect: 'static' },
]

const EXPLOSION_LINES: readonly CinematicTransitionLine[] = [
  { kind: 'cue', text: 'cue that carries no effect' },
  { kind: 'sfx', text: '*** explosion sound', effect: 'explosion' },
]

const EVERY_EFFECT_LINES: readonly CinematicTransitionLine[] = [
  { kind: 'static', text: '-- static --', effect: 'static' },
  { kind: 'sfx', text: '*** knock', effect: 'bulkhead-knock' },
  { kind: 'sfx', text: '*** response', effect: 'bulkhead-response' },
  { kind: 'sfx', text: '*** explosion sound', effect: 'explosion' },
]

const originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext')

function createAudioParamMock() {
  return {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  }
}

function createAudioNodeMock() {
  return {
    connect: vi.fn(),
  }
}

interface MockBufferSource {
  connect: ReturnType<typeof vi.fn>
  buffer: AudioBuffer | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface MockOscillator {
  connect: ReturnType<typeof vi.fn>
  type: string
  frequency: ReturnType<typeof createAudioParamMock>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface MockBiquadFilter {
  connect: ReturnType<typeof vi.fn>
  type: string
  frequency: ReturnType<typeof createAudioParamMock>
  Q: ReturnType<typeof createAudioParamMock>
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  state: AudioContextState = 'running'
  currentTime = 10
  sampleRate = 48_000
  destination = { kind: 'destination' } as unknown as AudioDestinationNode
  resume = vi.fn(async () => {
    this.state = 'running'
  })

  close = vi.fn(async () => {})
  bufferSourceStarts = 0
  oscillatorStarts = 0
  channelData: Float32Array[] = []
  bufferSources: MockBufferSource[] = []
  oscillators: MockOscillator[] = []
  biquads: MockBiquadFilter[] = []

  constructor() {
    MockAudioContext.instances.push(this)
  }

  createBuffer(_channels: number, length: number) {
    // One Float32Array per buffer, returned by every getChannelData call, so
    // the samples the module writes survive for assertions.
    const channel = new Float32Array(length)
    this.channelData.push(channel)
    return {
      length,
      getChannelData: () => channel,
    } as unknown as AudioBuffer
  }

  createBufferSource() {
    const node = {
      ...createAudioNodeMock(),
      buffer: null as AudioBuffer | null,
      start: vi.fn(() => { this.bufferSourceStarts++ }),
      stop: vi.fn(),
    }
    this.bufferSources.push(node)
    return node as unknown as AudioBufferSourceNode
  }

  createBiquadFilter() {
    const node = {
      ...createAudioNodeMock(),
      type: 'lowpass',
      frequency: createAudioParamMock(),
      Q: createAudioParamMock(),
    }
    this.biquads.push(node)
    return node as unknown as BiquadFilterNode
  }

  createGain() {
    return {
      ...createAudioNodeMock(),
      gain: createAudioParamMock(),
    } as unknown as GainNode
  }

  createOscillator() {
    const node = {
      ...createAudioNodeMock(),
      type: 'sine',
      frequency: createAudioParamMock(),
      start: vi.fn(() => { this.oscillatorStarts++ }),
      stop: vi.fn(),
    }
    this.oscillators.push(node)
    return node as unknown as OscillatorNode
  }
}

describe('transition-sfx helper', () => {
  beforeEach(() => {
    MockAudioContext.instances = []
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: MockAudioContext,
    })
  })

  afterEach(() => {
    if (originalAudioContextDescriptor) {
      Object.defineProperty(window, 'AudioContext', originalAudioContextDescriptor)
    }
    else {
      Reflect.deleteProperty(window, 'AudioContext')
    }
    vi.restoreAllMocks()
  })

  it('extracts exactly the authored static and sfx cues from the structured transition lines', () => {
    expect(transitionSfxCues(CINEMATIC_SEGMENTS[4].transitionLore ?? [])).toEqual([
      { effect: 'bulkhead-knock' },
      { effect: 'bulkhead-response' },
    ])

    expect(transitionSfxCues(CINEMATIC_SEGMENTS[3].transitionLore ?? [])).toEqual([
      { effect: 'static' },
    ])
  })

  it('plays each transition key only once but replays on a new transition entry', async () => {
    const player = createTransitionSfxPlayer()

    await player.playTransition('segment-4-entry-1', CINEMATIC_SEGMENTS[4].transitionLore ?? [])
    const [context] = MockAudioContext.instances
    const firstPassOscillators = context.oscillatorStarts

    await player.playTransition('segment-4-entry-1', CINEMATIC_SEGMENTS[4].transitionLore ?? [])
    expect(context.oscillatorStarts).toBe(firstPassOscillators)

    await player.playTransition('segment-4-entry-2', CINEMATIC_SEGMENTS[4].transitionLore ?? [])

    expect(firstPassOscillators).toBeGreaterThan(0)
    expect(context.oscillatorStarts).toBe(firstPassOscillators * 2)
    player.destroy()
  })

  it('silently skips playback when the audio context stays blocked', async () => {
    class BlockedAudioContext extends MockAudioContext {
      override state: AudioContextState = 'suspended'
      override resume = vi.fn(async () => {
        throw new Error('blocked')
      })
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: BlockedAudioContext,
    })
    const player = createTransitionSfxPlayer()

    await expect(player.playTransition('segment-5-entry-1', CINEMATIC_SEGMENTS[5].transitionLore ?? [])).resolves.toBeUndefined()

    const [context] = BlockedAudioContext.instances
    expect(context?.bufferSourceStarts ?? 0).toBe(0)
    expect(context?.oscillatorStarts ?? 0).toBe(0)
    player.destroy()
  })

  it('keeps non-cue transition lines out of the cue list', () => {
    expect(transitionSfxCues([
      { kind: 'speaker', speaker: 'krook', text: 'no cue here' },
      { kind: 'cue', text: 'also no cue here' },
    ])).toEqual([])
  })

  it('renders the static burst through a bandpass-filtered noise buffer', async () => {
    const player = createTransitionSfxPlayer()
    await player.playTransition('static-entry', STATIC_LINES)

    const [context] = MockAudioContext.instances
    expect(context.bufferSourceStarts).toBe(1)
    expect(context.oscillatorStarts).toBe(0)

    const [bandpass] = context.biquads
    expect(bandpass.type).toBe('bandpass')
    expect(bandpass.frequency.setValueAtTime).toHaveBeenCalledWith(2400, context.currentTime + 0.04)
    expect(bandpass.Q.setValueAtTime).toHaveBeenCalledWith(1.4, context.currentTime + 0.04)

    const [source] = context.bufferSources
    expect(source.buffer).not.toBeNull()
    expect(source.start).toHaveBeenCalledWith(context.currentTime + 0.04)
    expect(source.stop).toHaveBeenCalledWith(context.currentTime + 0.04 + 0.2)

    player.destroy()
  })

  it('fills the noise buffer deterministically and within the authored amplitude', async () => {
    const player = createTransitionSfxPlayer()
    await player.playTransition('static-noise-1', STATIC_LINES)
    const first = MockAudioContext.instances[0].channelData[0]

    // 0.2s of noise at the mocked 48kHz rate.
    expect(first.length).toBe(Math.floor(48_000 * 0.2))
    expect(first.some(sample => sample !== 0)).toBe(true)
    expect(Math.max(...first.map(Math.abs))).toBeLessThanOrEqual(0.85)

    await player.playTransition('static-noise-2', STATIC_LINES)
    const second = MockAudioContext.instances[0].channelData[1]
    expect(Array.from(second.slice(0, 32))).toEqual(Array.from(first.slice(0, 32)))

    player.destroy()
  })

  it('renders the explosion as a lowpassed noise body plus a sawtooth rumble', async () => {
    const player = createTransitionSfxPlayer()
    await player.playTransition('explosion-entry', EXPLOSION_LINES)

    const [context] = MockAudioContext.instances
    expect(context.bufferSourceStarts).toBe(1)
    expect(context.oscillatorStarts).toBe(1)

    const [lowpass] = context.biquads
    expect(lowpass.type).toBe('lowpass')
    expect(lowpass.frequency.setValueAtTime).toHaveBeenCalledWith(220, context.currentTime + 0.04)
    expect(lowpass.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(80, context.currentTime + 0.04 + 0.9)

    const [rumble] = context.oscillators
    expect(rumble.type).toBe('sawtooth')
    expect(rumble.frequency.setValueAtTime).toHaveBeenCalledWith(58, context.currentTime + 0.04)
    expect(rumble.stop).toHaveBeenCalledWith(context.currentTime + 0.04 + 0.95)

    player.destroy()
  })

  it('spaces consecutive cues by the per-effect gap', async () => {
    const player = createTransitionSfxPlayer()
    await player.playTransition('every-effect', EVERY_EFFECT_LINES)

    const [context] = MockAudioContext.instances
    const base = context.currentTime + 0.04
    // static 0.28, bulkhead-knock 0.46, bulkhead-response 0.72.
    const staticStart = base
    const knockStart = base + 0.28
    const responseStart = knockStart + 0.46
    const explosionStart = responseStart + 0.72

    const bufferStarts = context.bufferSources.map(source => source.start.mock.calls[0][0])
    expect(bufferStarts[0]).toBeCloseTo(staticStart, 6)
    expect(bufferStarts[1]).toBeCloseTo(explosionStart, 6)

    const oscillatorStarts = context.oscillators.map(oscillator => oscillator.start.mock.calls[0][0])
    // knock: body + overtone; response: two knocks offset by 0.24; explosion: rumble.
    expect(oscillatorStarts[0]).toBeCloseTo(knockStart, 6)
    expect(oscillatorStarts[2]).toBeCloseTo(responseStart, 6)
    expect(oscillatorStarts[4]).toBeCloseTo(responseStart + 0.24, 6)
    expect(oscillatorStarts[6]).toBeCloseTo(explosionStart, 6)

    player.destroy()
  })

  it('falls back to the prefixed webkitAudioContext constructor', async () => {
    Reflect.deleteProperty(window, 'AudioContext')
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      writable: true,
      value: MockAudioContext,
    })

    const player = createTransitionSfxPlayer()
    await player.playTransition('webkit-entry', STATIC_LINES)

    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0].bufferSourceStarts).toBe(1)

    player.destroy()
    Reflect.deleteProperty(window, 'webkitAudioContext')
  })

  it('stays silent when no audio context constructor is available', async () => {
    Reflect.deleteProperty(window, 'AudioContext')
    const player = createTransitionSfxPlayer()

    await expect(player.playTransition('no-ctor', STATIC_LINES)).resolves.toBeUndefined()
    expect(MockAudioContext.instances).toHaveLength(0)

    player.destroy()
  })

  it('stays silent when constructing the audio context throws', async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: class {
        constructor() {
          throw new Error('no audio device')
        }
      },
    })

    const player = createTransitionSfxPlayer()
    await expect(player.playTransition('ctor-throws', STATIC_LINES)).resolves.toBeUndefined()
    player.destroy()
  })

  it('abandons the remaining cues when scheduling throws mid-sequence', async () => {
    class FailingAudioContext extends MockAudioContext {
      override createOscillator(): OscillatorNode {
        throw new Error('node budget exhausted')
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FailingAudioContext,
    })

    const player = createTransitionSfxPlayer()
    await expect(player.playTransition('failing', EVERY_EFFECT_LINES)).resolves.toBeUndefined()

    const [context] = MockAudioContext.instances
    // The static cue schedules first and survives; the knock aborts the rest,
    // so the explosion never reaches a second buffer source.
    expect(context.bufferSourceStarts).toBe(1)

    player.destroy()
  })

  it('does nothing for a transition that carries no cues', async () => {
    const player = createTransitionSfxPlayer()
    await player.playTransition('speaker-only', [
      { kind: 'speaker', speaker: 'krook', text: 'nothing to schedule' },
    ])

    expect(MockAudioContext.instances).toHaveLength(0)
    player.destroy()
  })

  it('unlocks on the first user gesture and detaches every listener on destroy', async () => {
    class SuspendedAudioContext extends MockAudioContext {
      override state: AudioContextState = 'suspended'
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: SuspendedAudioContext,
    })

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const player = createTransitionSfxPlayer()

    player.armFromUserGestures()
    // Re-arming must not register a second set of listeners.
    player.armFromUserGestures()

    const armed = addSpy.mock.calls.filter(([name]) => ['pointerdown', 'keydown', 'touchstart'].includes(name as string))
    expect(armed.map(([name]) => name)).toEqual(['pointerdown', 'keydown', 'touchstart'])

    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()
    await Promise.resolve()

    const [context] = MockAudioContext.instances
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')

    player.destroy()
    expect(context.close).toHaveBeenCalledTimes(1)

    const detached = removeSpy.mock.calls.filter(([name]) => ['pointerdown', 'keydown', 'touchstart'].includes(name as string))
    expect(detached.map(([name]) => name)).toEqual(['pointerdown', 'keydown', 'touchstart'])

    window.dispatchEvent(new Event('keydown'))
    await Promise.resolve()
    expect(MockAudioContext.instances).toHaveLength(1)
  })

  it('tolerates destroy before anything was armed or played', () => {
    const player = createTransitionSfxPlayer()
    expect(() => player.destroy()).not.toThrow()
    expect(MockAudioContext.instances).toHaveLength(0)
  })
})
