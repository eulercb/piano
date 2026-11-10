import { describe, expect, it } from 'vitest'
import { demoSong, exportMidi, formatTime, songDuration, parseMidi, transposeSong, trimSong, type Song } from './music'

const makeMidi = (tracks: number[][], division = 480) => {
  const data = [77,84,104,100,0,0,0,6,0,tracks.length > 1 ? 1 : 0,0,tracks.length,division >> 8,division & 255]
  for (const track of tracks) data.push(77,84,114,107,0,0,(track.length >> 8) & 255,track.length & 255,...track)
  return new Uint8Array(data).buffer
}
const song: Song = { id: 'test', title: 'Test étude', tempo: 120, notes: [
  { id: 'one', pitch: 72, start: 0, duration: 1, velocity: 0.8, hand: 'left' },
  { id: 'two', pitch: 48, start: 0.5, duration: 1, velocity: 0.5, hand: 'right' },
] }

describe('MIDI', () => {
  it('preserves trailing silence through MIDI export and import', () => {
    const padded = { ...song, duration: 3 }
    const restored = parseMidi(exportMidi(padded).buffer as ArrayBuffer)
    expect(songDuration(restored)).toBeCloseTo(3)
    expect(restored.notes[1].start + restored.notes[1].duration).toBeCloseTo(1.5)
  })
  it('round-trips seconds, Unicode title, velocity and explicit hand', () => {
    const output = exportMidi(song)
    const parsed = parseMidi(output.buffer as ArrayBuffer)
    expect(parsed.title).toBe(song.title)
    expect(parsed.tempo).toBe(120)
    expect(parsed.notes).toHaveLength(2)
    parsed.notes.forEach((note, i) => {
      expect(note.pitch).toBe(song.notes[i].pitch)
      expect(note.hand).toBe(song.notes[i].hand)
      expect(note.start).toBeCloseTo(song.notes[i].start, 3)
      expect(note.duration).toBeCloseTo(song.notes[i].duration, 3)
      expect(note.velocity).toBeCloseTo(song.notes[i].velocity, 2)
    })
  })
  it('integrates a tempo map shared between type-1 tracks', () => {
    const buffer = makeMidi([
      [0,255,81,3,7,161,32, 131,96,255,81,3,15,66,64, 131,96,255,47,0],
      [0,144,60,100, 135,64,128,60,0, 0,255,47,0],
    ])
    expect(parseMidi(buffer).notes[0].duration).toBeCloseTo(1.5)
  })
  it('supports running status and note-on zero as note-off', () => {
    const parsed = parseMidi(makeMidi([[0,144,60,100,0,64,100,131,96,60,0,0,64,0,0,255,47,0]]))
    expect(parsed.notes).toHaveLength(2)
    expect(parsed.notes[0].duration).toBe(0.5)
  })
  it('extends notes with sustain CC64 until pedal-up', () => {
    const parsed = parseMidi(makeMidi([[0,176,64,127,0,144,60,100,131,96,128,60,0,131,96,176,64,0,0,255,47,0]]))
    expect(parsed.notes[0].duration).toBe(1)
  })
  it('closes hanging notes at the end of the track', () => {
    expect(parseMidi(makeMidi([[0,144,60,100,131,96,255,47,0]])).notes[0].duration).toBe(0.5)
  })
  it('pairs overlapping same-pitch notes FIFO', () => {
    const parsed = parseMidi(makeMidi([[0,144,60,100,120,144,60,90,120,128,60,0,120,128,60,0,0,255,47,0]]))
    expect(parsed.notes.map(note => note.duration)).toEqual([0.25,0.25])
  })
  it('rejects invalid, truncated, SMPTE and empty files', () => {
    expect(() => parseMidi(new ArrayBuffer(0))).toThrow(/Invalid MIDI/)
    expect(() => parseMidi(makeMidi([[0,255,47,0]], 0xe728))).toThrow(/SMPTE/)
    expect(() => parseMidi(makeMidi([[0,144,60]]))).toThrow(/unexpected end/)
    expect(() => parseMidi(makeMidi([[0,255,47,0]]))).toThrow(/no playable notes/)
    expect(() => parseMidi(makeMidi([[0,60,100]]))).toThrow(/running status/)
  })
  it('rejects malformed VLQ and data bytes', () => {
    expect(() => parseMidi(makeMidi([[128,128,128,128,0]]))).toThrow(/variable-length/)
    expect(() => parseMidi(makeMidi([[0,144,255,100]]))).toThrow(/channel data/)
  })
  it('bounds oversized imports before parsing', () => {
    expect(() => parseMidi(new ArrayBuffer(8 * 1024 * 1024 + 1))).toThrow(/too large/)
  })
  it('rejects invalid exports and round-trips the demo', () => {
    expect(() => exportMidi({ ...song, tempo: 0 })).toThrow(/Tempo/)
    expect(() => exportMidi({ ...song, notes: [{ ...song.notes[0], start: -1 }] })).toThrow(/invalid note/)
    expect(parseMidi(exportMidi(demoSong).buffer as ArrayBuffer).notes).toHaveLength(demoSong.notes.length)
  })
})

describe('editing', () => {
  it('keeps a trimmed passage full length including its trailing silence', () => {
    const trimmed = trimSong({ ...song, duration: 3 }, 0, 2.5)
    expect(songDuration(trimmed)).toBe(2.5)
    expect(songDuration(transposeSong(trimmed, 1))).toBe(2.5)
    expect(songDuration(song)).toBe(1.5)
  })
  it('clips crossing notes and rebases without mutating the source', () => {
    const result = trimSong(song, 0.25, 1.25)
    expect(result.notes.map(note => [note.start, note.duration])).toEqual([[0,0.75],[0.25,0.75]])
    expect(song.notes[0].duration).toBe(1)
  })
  it('excludes notes exactly outside the trim region', () => {
    expect(trimSong(song,1,1.5).notes.map(note => note.id)).toEqual(['two'])
    expect(() => trimSong(song, 1, 1)).toThrow()
  })
  it('transposes immutably and rejects out-of-range results', () => {
    expect(transposeSong(song, 12).notes[0].pitch).toBe(84)
    expect(song.notes[0].pitch).toBe(72)
    expect(() => transposeSong(song, 100)).toThrow(/range/)
    expect(() => transposeSong(song, 0.5)).toThrow(/whole/)
  })
  it('preserves optional fingering through edits', () => {
    const fingered = { ...song, scoreXml: '<score-partwise/>', notes: song.notes.map(note => ({ ...note, finger: 3 })) }
    expect(trimSong(fingered, 0.25, 1.25).notes.every(note => note.finger === 3)).toBe(true)
    expect(transposeSong(fingered, 2).notes.every(note => note.finger === 3)).toBe(true)
    expect(trimSong(fingered, 0.25, 1.25).scoreXml).toBe(fingered.scoreXml)
    expect(transposeSong(fingered, 2).scoreXml).toBe(fingered.scoreXml)
  })
  it('formats finite non-negative time', () => {
    expect(formatTime(125.9)).toBe('2:05')
    expect(formatTime(-1)).toBe('0:00')
    expect(formatTime(Infinity)).toBe('0:00')
  })
})
