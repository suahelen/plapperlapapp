import { describe, expect, it } from 'vitest'
import { concat, downsample, encodeWav } from './recorder'

describe('recorder helpers', () => {
  it('downsamples 48 kHz to 16 kHz by averaging', () => {
    const input = new Float32Array([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1])
    expect(Array.from(downsample(input, 48_000, 16_000)).map((x) => +x.toFixed(2))).toEqual([0.3, 1, -1])
    expect(downsample(input, 16_000, 16_000)).toBe(input)
  })

  it('handles non-integer ratios such as 44.1 kHz', () => {
    const out = downsample(new Float32Array(44_100).fill(0.5), 44_100, 16_000)
    expect(out.length).toBe(16_000)
    expect(out.every((x) => Math.abs(x - 0.5) < 1e-6)).toBe(true)
  })

  it('concatenates chunks in order', () => {
    expect(Array.from(concat([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3])
  })

  it('writes a 16 kHz mono PCM16 WAV header and clamped samples', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000)
    const v = new DataView(await blob.arrayBuffer())
    const text = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(at + i)))
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 16_000, 16])
    expect([v.getUint32(40, true), blob.size]).toEqual([8, 52])
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767])
  })
})
