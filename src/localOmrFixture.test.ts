import { describe, expect, it } from 'vitest'
import gold from '../fixtures/omr/piano-quarter-notes.musicxml?raw'
import recognized from '../fixtures/omr/audiveris-5.11.0.musicxml?raw'
import { parseMusicXml } from './musicxml'

describe('captured real Audiveris 5.11.0 output', () => {
  it('imports the original two-bar exercise with the gold pitches, timing and hands', () => {
    const expected = parseMusicXml(gold).song
    const actual = parseMusicXml(recognized).song
    const events = (song: typeof actual) => song.notes.map(n => [n.pitch, n.start, n.duration, n.hand])
    expect(events(actual)).toEqual(events(expected))
    expect(actual.notes).toHaveLength(16)
    expect(actual.duration).toEqual(expected.duration)
  })
})
