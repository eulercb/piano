import { describe, expect, it } from 'vitest'
import gold from '../fixtures/omr/piano-quarter-notes.musicxml?raw'
import recognized from '../fixtures/omr/audiveris-5.11.0.musicxml?raw'
import rhythmGold from '../fixtures/omr/matrix/rhythm-accidentals.musicxml?raw'
import rhythmRecognized from '../fixtures/omr/matrix/audiveris-5.11.0/rhythm-accidentals/recognized.public.musicxml?raw'
import skewRecognized from '../fixtures/omr/matrix/audiveris-5.11.0/rhythm-skew-contrast/recognized.public.musicxml?raw'
import chordsGold from '../fixtures/omr/matrix/chords-ties.musicxml?raw'
import chordsRecognized from '../fixtures/omr/matrix/audiveris-5.11.0/chords-ties/recognized.public.musicxml?raw'
import { parseMusicXml } from './musicxml'

describe('real Audiveris output and derived public fixtures', () => {
  it('imports the original two-bar exercise with the gold pitches, timing and hands', () => {
    const expected = parseMusicXml(gold).song
    const actual = parseMusicXml(recognized).song
    const events = (song: typeof actual) => song.notes.map(n => [n.pitch, n.start, n.duration, n.hand])
    expect(events(actual)).toEqual(events(expected))
    expect(actual.notes).toHaveLength(16)
    expect(actual.duration).toEqual(expected.duration)
  })

  it.each([
    ['clean rhythm image', rhythmRecognized],
    ['fixed skew/contrast variant, not a phone photo', skewRecognized],
  ])('imports %s without correcting the engine output', (_name, captured) => {
    const expected = parseMusicXml(rhythmGold)
    const actual = parseMusicXml(captured)
    const events = (song: typeof actual.song) => song.notes.map(n => [n.pitch, n.start, n.duration, n.hand])
    expect(events(actual.song)).toEqual(events(expected.song))
    expect(actual.song.notes).toHaveLength(11)
    expect(actual.song.duration).toEqual(expected.song.duration)
    expect(actual.warnings).toEqual(expected.warnings)
  })

  it('refuses the public chord/tie copy with unchanged zero divisions, while its gold score is valid', () => {
    expect(parseMusicXml(chordsGold).song.notes).toHaveLength(12)
    // Actual engine success is not successful MusicXML import. Do not repair the
    // export or infer its time scale to make this fixture pass.
    expect(() => parseMusicXml(chordsRecognized)).toThrow('invalid divisions')
  })
})
