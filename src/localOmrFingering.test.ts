import { describe, expect, it } from 'vitest'
import gold from '../fixtures/omr/fingering/piano-fingerings.musicxml?raw'
import baseline from '../fixtures/omr/fingering/audiveris-5.11.0/default.public.musicxml?raw'
import enabled from '../fixtures/omr/fingering/audiveris-5.11.0/fingerings-enabled.public.musicxml?raw'
import { parseMusicXml } from './musicxml'

// Reviewed against each exported note in document order, independently of the
// app importer: MIDI pitch, measure-relative onset and duration in quarters,
// written hand, optional finger. These fixtures contain no ties or rests.
type WrittenNote = readonly [pitch: number, beat: number, duration: number, hand: 'left' | 'right', finger?: number]
const original: readonly WrittenNote[][] = [
  [[60, 0, 1, 'right', 1], [62, 1, 1, 'right', 2], [64, 2, 1, 'right'], [65, 3, 1, 'right', 4],
   [48, 0, 1, 'left', 5], [47, 1, 1, 'left', 4], [45, 2, 1, 'left'], [43, 3, 1, 'left', 2]],
  [[67, 0, 1, 'right', 5], [64, 1, 1, 'right', 1], [67, 1, 1, 'right', 3], [65, 2, 1, 'right'], [64, 3, 1, 'right', 2],
   [53, 0, 1, 'left', 1], [52, 1, 1, 'left', 2], [50, 2, 1, 'left', 3], [48, 3, 1, 'left']],
]
const triplet = 2 / 3
const captured: readonly WrittenNote[][] = [
  [[60, 0, 1, 'right', 1], [62, 1, 1, 'right'], [64, 2, 1, 'right'], [65, 3, 1, 'right', 4],
   [48, 0, 1, 'left', 2], [47, 1, 1, 'left', 4], [45, 2, 1, 'left'], [43, 3, 1, 'left']],
  [[67, 0, triplet, 'right', 2], [64, triplet, triplet, 'right'], [67, triplet, triplet, 'right', 1],
   [65, 2 * triplet, triplet, 'right'], [64, 2, 1, 'right'],
   [53, 0, 1, 'left', 1], [52, triplet, triplet, 'left'], [50, 2 * triplet, triplet, 'left'], [48, 2, triplet, 'left']],
]

function checkImport(xml: string, expected: readonly WrittenNote[][], marks: number, totalSeconds: number) {
  const { song, scoreTimeline } = parseMusicXml(xml)
  expect(song).toMatchObject({ scoreOrigin: 'musicxml', scoreXml: xml, tempo: 120, duration: totalSeconds })
  expect(song.notes).toHaveLength(17)
  expect(song.notes.filter(note => note.finger !== undefined)).toHaveLength(marks)
  expect(scoreTimeline.measures.map(measure => measure.start)).toEqual([0, 2])
  const byId = new Map(song.notes.map(note => [note.id, note]))
  for (const [measure, notes] of expected.entries()) {
    for (const [index, [pitch, beat, duration, hand, finger]] of notes.entries()) {
      const sourceId = `0:${measure}:${index}`
      const note = byId.get(`xml-${sourceId}`)!
      expect(note).toMatchObject({ pitch, hand, sourceNoteIds: [sourceId] })
      expect(note.finger).toBe(finger)
      expect(note.start).toBeCloseTo(measure * 2 + beat / 2, 10)
      expect(note.duration).toBeCloseTo(duration / 2, 10)
    }
  }
}

describe('synthetic OMR fingering fixture import, not recognition acceptance', () => {
  it('preserves 13 gold marks on both staves, including separate chord heads and repeated pitches', () => {
    checkImport(gold, original, 13, 4)
  })

  it('keeps the actual default output unmarked, with its erroneous second-bar timing', () => {
    const unmarked = captured.map(measure => measure.map(([pitch, beat, duration, hand]): WrittenNote =>
      [pitch, beat, duration, hand]))
    checkImport(baseline, unmarked, 0, 3.5)
  })

  it('preserves seven enabled-output marks, including incorrect and displaced marks, without repairing recognition', () => {
    // C3 and the first G4 of bar 2 retain 2 rather than the gold 5.
    // The dyad is at a wrong onset; its E4 is unmarked and its G4 retains 1 rather than 3.
    checkImport(enabled, captured, 7, 3.5)
  })
})
