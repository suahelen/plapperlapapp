/**
 * Microphone recording for spoken answers. The clip is converted in the browser to
 * 16 kHz mono PCM16 WAV – exactly what the speech model expects – so the server needs
 * no audio decoding and uploads stay small (~32 KB per second).
 */

export const TARGET_RATE = 16_000

/** True if this browser can record here (microphone access needs HTTPS or localhost). */
export function canRecord(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
}

export interface Recorder {
  /** Stops recording and returns the clip as WAV. */
  stop(): Promise<Blob>
  /** Stops recording and discards the clip. */
  cancel(): void
}

/**
 * Starts recording. Call from a user gesture (tap/click), otherwise some browsers keep
 * the audio context suspended. `onLevel` receives the input loudness (0–1) for a meter.
 */
export async function startRecording(onLevel?: (level: number) => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext()
  await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but works everywhere without a separate worklet file;
  // for a few seconds of audio its main-thread cost is negligible.
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  node.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(data))
    if (onLevel) {
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
    }
  }
  source.connect(node)
  node.connect(ctx.destination) // required for onaudioprocess to fire in Chrome

  const release = () => {
    node.onaudioprocess = null
    source.disconnect()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  return {
    async stop() {
      const rate = ctx.sampleRate
      release()
      return encodeWav(downsample(concat(chunks), rate, TARGET_RATE), TARGET_RATE)
    },
    cancel: release,
  }
}

export function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** Resamples by averaging the source samples that fall into each target sample (a simple low-pass). */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples
  if (fromRate < toRate) throw new Error('upsampling is not supported')
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j]
    out[i] = sum / (end - start)
  }
  return out
}

/** Encodes mono float samples (-1…1) as a PCM16 WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}
