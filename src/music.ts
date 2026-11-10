/** All times are seconds; velocity is normalized to [0, 1]. */
export type Note = { id: string; pitch: number; start: number; duration: number; velocity: number; hand: 'left' | 'right'; finger?: number }
export type Song = { id: string; title: string; notes: Note[]; tempo: number; scoreXml?: string }

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** An original, freely reusable practice study, composed for this application. */
export const demoSong: Song = {
  id: 'morning-light', title: 'Morning Light', tempo: 96,
  notes: (() => {
    const beat = 60 / 96
    const melody = [64, 67, 72, 71, 67, 64, 62, 67, 65, 69, 74, 72, 69, 65, 64, 67, 64, 67, 72, 76, 74, 71, 67, 62, 65, 64, 62, 67, 64, 62, 60, 60]
    const notes: Note[] = melody.map((pitch, i) => ({ id: `r${i}`, pitch, start: i * beat, duration: beat * (i === 31 ? 1.8 : 0.85), velocity: 0.72, hand: 'right' }))
    ;[48, 43, 53, 48, 45, 43, 53, 48].forEach((pitch, i) => {
      for (let step = 0; step < 4; step++) notes.push({ id: `l${i}-${step}`, pitch: pitch + [0, 7, 12, 7][step], start: (i * 4 + step) * beat, duration: beat * 0.9, velocity: 0.52, hand: 'left' })
    })
    return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  })(),
}

type Event = { tick: number; order: number; kind: 'on' | 'off' | 'sustain' | 'tempo'; channel?: number; pitch?: number; value: number }

/**
 * Read Standard MIDI format 0/1 with PPQN timing and all tempo changes.
 * CC64 sustain extends released notes until pedal-up. Other controllers,
 * instruments and percussion (channel 10) are ignored. Unclosed notes end at
 * the final event. Hand is inferred by pitch (<60 is left), except our own
 * exports, marked with a sequencer text event, preserve hand via channels 0/1.
 * MIDI format 2 and SMPTE division are intentionally unsupported. Imports are
 * bounded to 8 MiB, 256 tracks, 200,000 events and 1,024 overlapping notes
 * per channel/pitch to keep malformed input from monopolizing the UI thread.
 */
export function parseMidi(buffer: ArrayBuffer): Song {
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('MIDI file is too large (maximum 8 MiB).')
  const bytes = new Uint8Array(buffer)
  let pos = 0
  let limit = bytes.length
  const fail = (message: string): never => { throw new Error(`Invalid MIDI: ${message}`) }
  const read = () => pos < limit ? bytes[pos++] : fail('unexpected end of file')
  const u16 = () => read() * 256 + read()
  const u32 = () => read() * 16777216 + read() * 65536 + read() * 256 + read()
  const text = (length: number) => {
    if (pos + length > limit) fail('truncated event')
    const result = new TextDecoder().decode(bytes.subarray(pos, pos + length)); pos += length; return result
  }
  const variable = () => {
    let value = 0
    for (let i = 0; i < 4; i++) { const b = read(); value = value * 128 + (b & 127); if (!(b & 128)) return value }
    return fail('invalid variable-length number')
  }
  if (text(4) !== 'MThd') fail('missing header')
  const headerSize = u32()
  if (headerSize < 6 || pos + headerSize > limit) fail('invalid header size')
  const format = u16(), tracks = u16(), division = u16()
  if (format > 1) fail('only MIDI format 0 and 1 are supported')
  if (division & 0x8000) fail('SMPTE timing is not supported')
  if (!division || !tracks || (format === 0 && tracks !== 1)) fail('invalid timing or track count')
  if (tracks > 256) fail('too many tracks (maximum 256)')
  pos += headerSize - 6
  const events: Event[] = []
  let title = '', ownExport = false, lastTick = 0, order = 0, eventCount = 0
  for (let track = 0; track < tracks; track++) {
    limit = bytes.length
    if (text(4) !== 'MTrk') fail('missing track chunk')
    const size = u32(), end = pos + size
    if (end > bytes.length) fail('truncated track')
    limit = end
    let tick = 0, running = 0
    while (pos < end) {
      if (++eventCount > 200000) fail('too many events (maximum 200,000)')
      tick += variable(); lastTick = Math.max(lastTick, tick)
      let status = read()
      if (status < 128) { if (!running) fail('missing running status'); pos--; status = running }
      else if (status < 240) running = status
      else running = 0
      if (status === 255) {
        const type = read(), length = variable()
        if (pos + length > end) fail('truncated meta event')
        if (type === 81) {
          if (length !== 3) fail('invalid tempo event')
          const tempo = read() * 65536 + read() * 256 + read()
          if (!tempo) fail('zero tempo')
          events.push({ tick, order: order++, kind: 'tempo', value: tempo })
        } else {
          const value = text(length)
          if (type === 3 && !title) title = value
          if (type === 1 && value === 'PianoPractice:Hands:v1') ownExport = true
          if (type === 47) { if (length !== 0) fail('invalid end-of-track'); break }
        }
      } else if (status === 240 || status === 247) {
        const length = variable(); if (pos + length > end) fail('truncated sysex'); pos += length
      } else if (status >= 240) fail('unsupported system event')
      else {
        const kind = status >> 4, channel = status & 15
        const a = read(), b = kind === 12 || kind === 13 ? 0 : read()
        if (a > 127 || b > 127) fail('invalid channel data')
        if (channel === 9) continue
        if (kind === 8 || kind === 9) events.push({ tick, order: order++, kind: kind === 8 || b === 0 ? 'off' : 'on', channel, pitch: a, value: b })
        if (kind === 11 && a === 64) events.push({ tick, order: order++, kind: 'sustain', channel, value: b })
      }
    }
    pos = end
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  type Pending = { pitch: number; start: number; velocity: number; channel: number }
  const active = new Map<string, Pending[]>(), sustained = new Map<number, Pending[]>(), pedal = new Set<number>()
  const notes: Note[] = []
  let previousTick = 0, seconds = 0, microseconds = 500000, tempo = 120
  const finish = (note: Pending, end: number) => {
    if (end <= note.start) return
    notes.push({ id: `n${notes.length}`, pitch: note.pitch, start: note.start, duration: end - note.start, velocity: note.velocity, hand: ownExport && note.channel <= 1 ? (note.channel === 1 ? 'left' : 'right') : note.pitch < 60 ? 'left' : 'right' })
  }
  for (const event of events) {
    seconds += (event.tick - previousTick) * microseconds / (division * 1000000); previousTick = event.tick
    if (event.kind === 'tempo') { microseconds = event.value; if (event.tick === 0) tempo = 60000000 / microseconds; continue }
    const channel = event.channel!, key = `${channel}:${event.pitch}`
    if (event.kind === 'on') {
      const queue = active.get(key) ?? []
      if (queue.length >= 1024) fail('too many overlapping notes at one pitch')
      queue.push({ pitch: event.pitch!, start: seconds, velocity: event.value / 127, channel }); active.set(key, queue)
    } else if (event.kind === 'off') {
      const note = active.get(key)?.shift()
      if (note) {
        if (pedal.has(channel)) { const queue = sustained.get(channel) ?? []; queue.push(note); sustained.set(channel, queue) }
        else finish(note, seconds)
      }
    } else if (event.value >= 64) pedal.add(channel)
    else { pedal.delete(channel); sustained.get(channel)?.forEach(note => finish(note, seconds)); sustained.delete(channel) }
  }
  seconds += (lastTick - previousTick) * microseconds / (division * 1000000)
  active.forEach(queue => queue.forEach(note => finish(note, seconds)))
  sustained.forEach(queue => queue.forEach(note => finish(note, seconds)))
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  if (!notes.length) throw new Error('This MIDI file contains no playable notes.')
  return { id: `midi-${Date.now()}`, title: title.trim() || 'Imported MIDI', tempo, notes }
}

/** Export a format-0 piano MIDI, preserving seconds at a single tempo. */
export function exportMidi(song: Song): Uint8Array {
  if (!Number.isFinite(song.tempo) || song.tempo <= 0) throw new Error('Tempo must be positive.')
  const ppqn = 480, microseconds = clamp(Math.round(60000000 / song.tempo), 1, 0xffffff)
  const ticksPerSecond = ppqn * 1000000 / microseconds
  const variable = (value: number): number[] => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) throw new Error('Song exceeds MIDI timing limits.')
    const result = [value & 127]
    while ((value = Math.floor(value / 128))) result.unshift((value & 127) | 128)
    return result
  }
  const encodeText = (type: number, value: string) => { const data = [...new TextEncoder().encode(value)]; return [0, 255, type, ...variable(data.length), ...data] }
  const track = [...encodeText(3, song.title), ...encodeText(1, 'PianoPractice:Hands:v1'), 0, 255, 81, 3, (microseconds >> 16) & 255, (microseconds >> 8) & 255, microseconds & 255]
  const events: { tick: number; off: boolean; data: number[] }[] = []
  for (const note of song.notes) {
    if (![note.start, note.duration, note.pitch, note.velocity].every(Number.isFinite) || note.start < 0 || note.duration <= 0 || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) throw new Error('Song contains an invalid note.')
    const channel = note.hand === 'left' ? 1 : 0, start = Math.round(note.start * ticksPerSecond), end = Math.max(start + 1, Math.round((note.start + note.duration) * ticksPerSecond))
    events.push({ tick: start, off: false, data: [144 | channel, note.pitch, clamp(Math.round(note.velocity * 127), 1, 127)] }, { tick: end, off: true, data: [128 | channel, note.pitch, 0] })
  }
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off))
  let previous = 0
  for (const event of events) { track.push(...variable(event.tick - previous), ...event.data); previous = event.tick }
  track.push(0, 255, 47, 0)
  const length = track.length
  return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...track])
}

/** Clip intersecting notes to [start, end), rebasing the result to zero. */
export function trimSong(song: Song, start: number, end: number): Song {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Choose a valid trim range.')
  return { ...song, notes: song.notes.filter(note => note.start < end && note.start + note.duration > start).map(note => {
    const from = Math.max(note.start, start), to = Math.min(note.start + note.duration, end)
    return { ...note, start: from - start, duration: to - from }
  }) }
}

/** Reject transpositions outside MIDI range rather than silently losing notes. */
export function transposeSong(song: Song, semitones: number): Song {
  if (!Number.isInteger(semitones)) throw new Error('Transpose must be a whole number of semitones.')
  if (song.notes.some(note => note.pitch + semitones < 0 || note.pitch + semitones > 127)) throw new Error('Transposition exceeds the MIDI note range.')
  return { ...song, notes: song.notes.map(note => ({ ...note, pitch: note.pitch + semitones })) }
}

export function formatTime(seconds: number): string {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
